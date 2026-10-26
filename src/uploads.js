// Durable upload queue: a clip is saved on the phone first, so a dead zone on campus
// doesn't lose it. Jobs survive app restarts (IndexedDB) and retry with backoff.

const DB_NAME = 'lockout-uploads';
const STORE = 'jobs';
let dbp;

function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  });
}
const putJob = (job) => tx('readwrite', (s) => s.put(job)).catch(() => {});
const delJob = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {});
const allJobs = () => tx('readonly', (s) => s.getAll()).catch(() => []);

export function createUploader(backend, onChange) {
  const jobs = new Map(); // id -> job
  const progress = new Map(); // id -> { pct, error }
  const running = new Set();
  const timers = new Map();

  const set = (id, v) => {
    progress.set(id, { ...(progress.get(id) || {}), ...v });
    onChange?.();
  };

  async function run(id) {
    const job = jobs.get(id);
    if (!job || running.has(id)) return;
    running.add(id);
    clearTimeout(timers.get(id));
    set(id, { error: null, pct: progress.get(id)?.pct || 0 });
    try {
      if (job.thumb && !job.thumbDone) {
        try {
          await backend.upload(job.thumbPath, job.thumb, 'image/jpeg');
          job.thumbDone = true;
        } catch (e) {
          if (!e.status) throw e; // offline → retry whole job later
          job.thumb = null; // thumbnail is optional; don't block the clip on it
        }
        putJob(job);
      }
      await backend.upload(job.videoPath, job.video, job.mime, (p) => set(id, { pct: p }));
      await backend.update('submissions', { video_path: job.videoPath, thumb_path: job.thumbDone ? job.thumbPath : null }, { id });
      jobs.delete(id);
      progress.delete(id);
      await delJob(id);
      onChange?.();
    } catch (e) {
      job.attempts = (job.attempts || 0) + 1;
      const wait = Math.min(60_000, 3000 * 2 ** Math.min(job.attempts, 5));
      set(id, { error: e.message || 'Upload failed', retryAt: Date.now() + wait });
      timers.set(id, setTimeout(() => run(id), wait));
    } finally {
      running.delete(id);
    }
  }

  async function enqueue(job) {
    jobs.set(job.id, job);
    set(job.id, { pct: 0 });
    await putJob(job);
    run(job.id);
  }

  async function resume() {
    for (const job of await allJobs()) {
      if (!jobs.has(job.id)) jobs.set(job.id, job);
      run(job.id);
    }
  }

  const retryAll = () => jobs.forEach((_, id) => run(id));
  window.addEventListener('online', retryAll);

  return {
    enqueue,
    resume,
    retry: run,
    status: (id) => progress.get(id) || null,
    pending: () => [...jobs.keys()],
    localBlob: (id) => jobs.get(id)?.video || null,
  };
}
