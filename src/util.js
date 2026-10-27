import { ts } from './logic.js';

const params = new URLSearchParams(location.search);
export const MOCK = window.LOCKOUT_MODE === 'mock';
// Test-only: lets several tabs on one device act as different players.
const PROFILE = params.get('profile') || '';
const key = (k) => `lockout:${PROFILE ? PROFILE + ':' : ''}${k}`;

export const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(key(k));
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(key(k), JSON.stringify(v));
    } catch {}
  },
};

const savedTheme = store.get('theme');
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;

export function getTheme() {
  const saved = store.get('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  store.set('theme', next);
  document.documentElement.dataset.theme = next;
  return next;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function clientId() {
  let id = store.get('clientId');
  if (!id) {
    id = uuid();
    store.set('clientId', id);
  }
  return id;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export function makeCode(len = 4) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

export function ago(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts(t)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function stamp(t, startedAt) {
  // "12:34 in" — game-relative time for recap
  if (!startedAt) return '';
  return `${clock(ts(t) - ts(startedAt))} in`;
}

export function vibrate(pattern = 40) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function recentGames() {
  return store.get('recent', []);
}
export function rememberGame(code, title) {
  const list = recentGames().filter((g) => g.code !== code);
  list.unshift({ code, title, at: Date.now() });
  store.set('recent', list.slice(0, 6));
}
export function forgetGame(code) {
  store.set('recent', recentGames().filter((g) => g.code !== code));
}

export function extFor(type = '') {
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('webm')) return 'webm';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('jpeg')) return 'jpg';
  return 'bin';
}

export const fmtMB = (bytes) => `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)} MB`;
