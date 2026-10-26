import { html, useState, useEffect, useRef } from './h.js';
import { bus, useMedia, backend } from './core.js';
import { Icon } from './icons.js';

export function Sheet({ open, onClose, children, title, tall }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose?.();
    addEventListener('keydown', k);
    document.body.classList.add('noscroll');
    return () => {
      removeEventListener('keydown', k);
      document.body.classList.remove('noscroll');
    };
  }, [open]);
  if (!open) return null;
  return html`
    <div class="sheet-wrap" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
      <div class=${`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true">
        <div class="sheet-grab"></div>
        ${title !== undefined &&
        html`<div class="sheet-head">
          <h3>${title}</h3>
          <button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon.x} /></button>
        </div>`}
        <div class="sheet-body">${children}</div>
      </div>
    </div>
  `;
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(
    () =>
      bus.on('toast', (t) => {
        setItems((xs) => [...xs.filter((x) => x.msg !== t.msg).slice(-1), t]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.ms || 3200);
      }),
    []
  );
  return html`<div class="toasts" aria-live="polite">
    ${items.map(
      (t) => html`<div key=${t.id} class=${`toast ${t.kind || ''}`} style=${t.color ? `--tc:${t.color}` : ''}>
        ${t.color && html`<span class="dot"></span>`}<span>${t.msg}</span>
      </div>`
    )}
  </div>`;
}

export function Seg({ value, options, onChange, disabled }) {
  return html`<div class=${`seg ${disabled ? 'disabled' : ''}`} role="radiogroup">
    ${options.map(
      (o) => html`<button
        role="radio"
        aria-checked=${o.value === value}
        class=${o.value === value ? 'on' : ''}
        disabled=${disabled}
        onClick=${() => onChange(o.value)}
      >
        ${o.label}
      </button>`
    )}
  </div>`;
}

export function Stepper({ value, min, max, onChange, disabled, suffix = '', step = 1, fmt, label = '' }) {
  return html`<div class="stepper">
    <button disabled=${disabled || value <= min} onClick=${() => onChange(Math.max(min, value - step))} aria-label=${`Decrease ${label}`.trim()}>−</button>
    <span class=${fmt ? 'wide' : ''}>${fmt ? fmt(value) : value}${suffix}</span>
    <button disabled=${disabled || value >= max} onClick=${() => onChange(Math.min(max, value + step))} aria-label=${`Increase ${label}`.trim()}>+</button>
  </div>`;
}

export function Switch({ on, onChange, label }) {
  return html`<button class="switch" role="switch" aria-checked=${!!on} aria-label=${label} onClick=${() => onChange(!on)}><span></span></button>`;
}

export const PointChip = ({ v, small }) => html`<span class=${`pchip p${Math.min(5, v)} ${small ? 'small' : ''}`}>${v}</span>`;

export const TeamDot = ({ team, size = 10 }) =>
  html`<span class="tdot" style=${`--tc:${team.color};width:${size}px;height:${size}px`}></span>`;

export function Thumb({ sub, team, onClick, badge }) {
  const url = useMedia(sub.thumb_path);
  return html`<button class="thumb" style=${`--tc:${team.color};--ti:${team.ink}`} onClick=${onClick}>
    ${url ? html`<img src=${url} alt="" loading="lazy" />` : html`<span class="thumb-ph"></span>`}
    <span class="thumb-play">${sub.video_path ? html`<${Icon.play} size=${18} />` : html`<${Icon.hourglass} size=${16} />`}</span>
    ${badge && html`<span class="thumb-badge">${badge}</span>`}
  </button>`;
}

export function Video({ path, poster, autoPlay, localBlob }) {
  const url = useMedia(path);
  const posterUrl = useMedia(poster);
  const [local, setLocal] = useState(null);
  useEffect(() => {
    if (url || !localBlob) return;
    const u = URL.createObjectURL(localBlob);
    setLocal(u);
    return () => URL.revokeObjectURL(u);
  }, [url, localBlob]);
  const src = url || local;
  const ref = useRef();
  useEffect(() => {
    if (autoPlay && ref.current) ref.current.play?.().catch(() => {});
  }, [src]);
  if (!src) return html`<div class="video-wait"><${Icon.hourglass} /> Clip is still uploading…</div>`;
  return html`<video ref=${ref} class="video" src=${src} poster=${posterUrl || undefined} controls playsinline preload="metadata"></video>`;
}

export function DownloadLink({ path, name, light }) {
  const [href, setHref] = useState(null);
  useEffect(() => {
    if (!path) return;
    const u = backend.downloadUrl(path, name);
    if (typeof u === 'string') setHref(u);
    else u.then(setHref);
  }, [path]);
  if (!href) return null;
  return html`<a class=${`btn ghost small ${light ? 'light' : ''}`} href=${href} download=${name} target="_blank" rel="noopener"><${Icon.download} size=${16} /> Save clip</a>`;
}

/** Simple confetti burst in the given colors. */
export function Confetti({ colors }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current;
    if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = c.getContext('2d');
    const dpr = devicePixelRatio || 1;
    const W = (c.width = innerWidth * dpr);
    const H = (c.height = innerHeight * dpr);
    const parts = [...Array(140)].map(() => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (-Math.random() * 16 - 6) * dpr,
      s: (Math.random() * 6 + 4) * dpr,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf;
    let t = 0;
    const step = () => {
      t++;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.45 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (t < 240) raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, []);
  return html`<canvas class="confetti" ref=${ref}></canvas>`;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}
