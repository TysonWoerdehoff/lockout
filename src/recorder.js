import { html, useState, useEffect, useRef } from './h.js';
import { Icon } from './icons.js';
import { clock, fmtMB } from './util.js';

export const MAX_CLIP_SECS = 60;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const prefs = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return prefs.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

function friendly(e) {
  if (!navigator.mediaDevices) return 'The in-app camera needs a secure (https) page. Use “Upload video” instead.';
  if (e?.name === 'NotAllowedError') return 'Camera access is blocked. Allow camera & microphone for this app in your phone settings, or use “Upload video”.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No camera found on this device.';
  if (e?.name === 'NotReadableError') return 'Your camera is busy in another app. Close it and try again.';
  return `Couldn't start the camera (${e?.message || e}).`;
}

function grabFrame(video, maxW = 360) {
  return new Promise((resolve) => {
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return resolve(null);
      const scale = Math.min(1, maxW / w);
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(b), 'image/jpeg', 0.72);
    } catch {
      resolve(null);
    }
  });
}

const once = (el, ev, ms) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    el.addEventListener(ev, () => (clearTimeout(t), res()), { once: true });
  });

export async function thumbFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.src = url;
  try {
    v.load();
    await once(v, 'loadeddata', 5000);
    const target = Math.min(0.5, (v.duration || 1) / 2);
    if (Math.abs(v.currentTime - target) > 0.05) {
      v.currentTime = target;
      await once(v, 'seeked', 3000);
    }
    return await grabFrame(v);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Full-screen in-app camera. Records compressed 720p clips (keeps uploads small on campus wifi). */
export function Recorder({ onDone, onCancel, onUseUpload }) {
  const videoRef = useRef();
  const recRef = useRef(null);
  const chunks = useRef([]);
  const thumbRef = useRef(null);
  const startedAt = useRef(0);
  const [facing, setFacing] = useState('environment');
  const [stream, setStream] = useState(null);
  const [phase, setPhase] = useState('starting'); // starting | ready | recording | error
  const [err, setErr] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let s;
    let cancelled = false;
    setPhase('starting');
    (async () => {
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        setStream(s);
        const v = videoRef.current;
        v.srcObject = s;
        await v.play().catch(() => {});
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setErr(friendly(e));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => {
      const e = (Date.now() - startedAt.current) / 1000;
      setElapsed(e);
      if (e >= MAX_CLIP_SECS) stop();
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  function start() {
    const mime = pickMime();
    let rec;
    try {
      const opts = { videoBitsPerSecond: 1_600_000, audioBitsPerSecond: 96_000 };
      rec = new MediaRecorder(stream, mime ? { ...opts, mimeType: mime } : opts);
    } catch {
      rec = new MediaRecorder(stream);
    }
    chunks.current = [];
    thumbRef.current = null;
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      const type = (rec.mimeType || mime || chunks.current[0]?.type || 'video/mp4').split(';')[0];
      const blob = new Blob(chunks.current, { type });
      const duration = (Date.now() - startedAt.current) / 1000;
      onDone({ blob, mime: type, thumb: thumbRef.current, duration });
    };
    recRef.current = rec;
    startedAt.current = Date.now();
    rec.start();
    setElapsed(0);
    setPhase('recording');
    setTimeout(async () => {
      if (videoRef.current) thumbRef.current = await grabFrame(videoRef.current);
    }, 700);
  }

  function stop() {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }

  const left = MAX_CLIP_SECS - elapsed;
  return html`
    <div class="rec">
      <video ref=${videoRef} class=${`rec-video ${facing === 'user' ? 'mirror' : ''}`} playsinline muted autoplay></video>
      <div class="rec-top">
        <button class="rec-round" onClick=${() => (phase === 'recording' ? null : onCancel())} aria-label="Close" disabled=${phase === 'recording'}>
          <${Icon.x} />
        </button>
        ${phase === 'recording'
          ? html`<div class="rec-timer"><span class="rec-dot"></span>${clock(elapsed * 1000)}${left < 10 ? html`<small> · ${Math.ceil(left)}s left</small>` : ''}</div>`
          : html`<div class="rec-hint">Max ${MAX_CLIP_SECS}s</div>`}
        <button class="rec-round" onClick=${() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled=${phase !== 'ready'} aria-label="Flip camera">
          <${Icon.flip} />
        </button>
      </div>
      ${phase === 'error' &&
      html`<div class="rec-error">
        <p>${err}</p>
        <button class="btn" onClick=${onUseUpload}><${Icon.upload} size=${18} /> Upload video instead</button>
        <button class="btn ghost light" onClick=${onCancel}>Cancel</button>
      </div>`}
      ${phase === 'starting' && html`<div class="rec-error"><p>Starting camera…</p></div>`}
      <div class="rec-bottom">
        ${phase === 'ready' && html`<button class="shutter" onClick=${start} aria-label="Start recording"><span></span></button>`}
        ${phase === 'recording' && html`<button class="shutter on" onClick=${stop} aria-label="Stop recording"><span></span></button>`}
      </div>
    </div>
  `;
}

/** Hidden file input that resolves a picked video into the same shape as a recording. */
export function useVideoPicker(onPicked, onError) {
  const inputRef = useRef();
  const el = html`<input
    ref=${inputRef}
    type="file"
    accept="video/*"
    style="display:none"
    onChange=${async (e) => {
      const f = e.currentTarget.files?.[0];
      e.currentTarget.value = '';
      if (!f) return;
      if (f.size > MAX_UPLOAD_BYTES) return onError(`That video is ${fmtMB(f.size)} — the limit is 50 MB. Record in the app instead (it shrinks clips automatically) or trim it.`);
      const thumb = await thumbFromBlob(f);
      onPicked({ blob: f, mime: f.type || 'video/mp4', thumb, duration: null });
    }}
  />`;
  return [el, () => inputRef.current?.click()];
}
