import { html } from './h.js';

const I = (d, extra = '') => ({ size = 20, ...p } = {}) =>
  html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ...${p}>${d}${extra}</svg>`;

export const Icon = {
  camera: I(html`<path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />`),
  upload: I(html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />`),
  play: I(html`<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />`),
  grid: I(html`<rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />`),
  feed: I(html`<rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" />`),
  users: I(html`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />`),
  share: I(html`<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" />`),
  x: I(html`<path d="M18 6L6 18M6 6l12 12" />`),
  check: I(html`<path d="M20 6L9 17l-5-5" />`),
  scale: I(html`<path d="M12 3v18" /><path d="M5 7h14" /><path d="M5 7l-3 7a4 4 0 0 0 6 0z" /><path d="M19 7l-3 7a4 4 0 0 0 6 0z" /><path d="M8 21h8" />`),
  crown: I(html`<path d="M3 18h18l-2-11-5 4-2-6-2 6-5-4z" />`),
  clock: I(html`<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />`),
  lock: I(html`<rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />`),
  dice: I(html`<rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />`),
  flip: I(html`<path d="M20 7h-9a5 5 0 0 0 0 10h1" /><path d="M17 4l3 3-3 3" /><path d="M4 17h3" />`),
  more: I(html`<circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" />`),
  home: I(html`<path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />`),
  pencil: I(html`<path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />`),
  download: I(html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />`),
  refresh: I(html`<path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />`),
  chevL: I(html`<path d="M15 18l-6-6 6-6" />`),
  chevR: I(html`<path d="M9 18l6-6-6-6" />`),
  flag: I(html`<path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" />`),
  hourglass: I(html`<path d="M6 2h12M6 22h12M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10" />`),
};
