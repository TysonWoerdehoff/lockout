// In-browser fake backend for local testing (?mock). Shares state across tabs of one browser
// via localStorage + BroadcastChannel; clips are kept in IndexedDB.
import { uuid } from './util.js';

const DBKEY = 'lockout-mock-db';
const TABLES = ['games', 'players', 'submissions', 'contests', 'votes'];
const chan = new BroadcastChannel('lockout-mock');

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(DBKEY)) || {};
    for (const t of TABLES) d[t] ||= [];
    return d;
  } catch {
    return Object.fromEntries(TABLES.map((t) => [t, []]));
  }
}
function save(d, table) {
  localStorage.setItem(DBKEY, JSON.stringify(d));
  chan.postMessage({ table });
  listeners.forEach((fn) => fn(table)); // same tab
}
const listeners = new Set();

const matches = (row, match = {}) => Object.entries(match).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));

function violates(d, table, row, selfId) {
  const others = d[table].filter((r) => (r.id ?? `${r.contest_id}:${r.player_id}`) !== selfId);
  if (table === 'games') return others.some((r) => r.code === row.code);
  if (table === 'players')
    return others.some((r) => r.game_id === row.game_id && (r.client_id === row.client_id || r.name.toLowerCase() === row.name.toLowerCase()));
  if (table === 'submissions')
    return row.status === 'active' && others.some((r) => r.game_id === row.game_id && r.square === row.square && (r.lane || 0) === (row.lane || 0) && r.status === 'active');
  if (table === 'contests') return others.some((r) => r.submission_id === row.submission_id);
  return false;
}

const DEFAULTS = {
  games: { status: 'lobby', settings: {}, challenges: [], team_names: [], board: null, pending_winner: null, winner: null },
  players: { team: null },
  submissions: { status: 'active', video_path: null, thumb_path: null, lane: 0 },
  contests: { status: 'open' },
  votes: {},
};

// --- tiny IndexedDB file store ---
let filesDB;
function fdb() {
  return (filesDB ||= new Promise((res, rej) => {
    const r = indexedDB.open('lockout-mock-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function putFile(path, blob) {
  const db = await fdb();
  await new Promise((res, rej) => {
    const tx = db.transaction('f', 'readwrite');
    tx.objectStore('f').put(blob, path);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function getFile(path) {
  const db = await fdb();
  return new Promise((res) => {
    const r = db.transaction('f').objectStore('f').get(path);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  });
}
const urlCache = new Map();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function mockBackend() {
  return {
    kind: 'mock',
    async select(table, match) {
      await delay(15);
      return load()[table].filter((r) => matches(r, match)).map((r) => ({ ...r }));
    },
    async insert(table, row) {
      await delay(20);
      const d = load();
      const full = { ...DEFAULTS[table], ...row, created_at: new Date().toISOString() };
      if (table !== 'votes') full.id ||= uuid();
      if (violates(d, table, full, full.id ?? `${full.contest_id}:${full.player_id}`)) return { conflict: true };
      d[table].push(full);
      save(d, table);
      return { data: { ...full } };
    },
    async update(table, patch, match) {
      await delay(20);
      const d = load();
      const out = [];
      for (const r of d[table]) {
        if (!matches(r, match)) continue;
        const next = { ...r, ...patch };
        if (violates(d, table, next, r.id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
        Object.assign(r, patch);
        out.push({ ...r });
      }
      if (out.length) save(d, table);
      return out;
    },
    async upsert(table, row) {
      await delay(15);
      const d = load();
      const i = d[table].findIndex((r) => r.contest_id === row.contest_id && r.player_id === row.player_id);
      if (i >= 0) d[table][i] = { ...d[table][i], ...row };
      else d[table].push({ ...row, created_at: new Date().toISOString() });
      save(d, table);
    },
    async remove(table, match) {
      const d = load();
      d[table] = d[table].filter((r) => !matches(r, match));
      save(d, table);
    },
    subscribe(gameId, onEvent, onStatus) {
      const fn = (e) => onEvent(e.data?.table || e);
      chan.addEventListener('message', fn);
      listeners.add(onEvent);
      setTimeout(() => onStatus?.('SUBSCRIBED'), 30);
      return () => {
        chan.removeEventListener('message', fn);
        listeners.delete(onEvent);
      };
    },
    async upload(path, blob, contentType, onProgress) {
      for (let p = 0.25; p <= 1; p += 0.25) {
        await delay(120);
        onProgress?.(p);
      }
      await putFile(path, blob);
    },
    async mediaUrl(path) {
      if (!path) return null;
      if (urlCache.has(path)) return urlCache.get(path);
      const b = await getFile(path);
      if (!b) return null;
      const u = URL.createObjectURL(b);
      urlCache.set(path, u);
      return u;
    },
    async downloadUrl(path) {
      return this.mediaUrl(path);
    },
  };
}
