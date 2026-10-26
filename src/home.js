import { html, useState, useEffect } from './h.js';
import { backend, createGame, joinGame, reclaimPlayer, go, toast } from './core.js';
import { store, cleanCode, recentGames, isIOS, isStandalone, MOCK } from './util.js';
import { Icon } from './icons.js';
import { Sheet } from './ui.js';

let deferredPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  dispatchEvent(new Event('lockout-installable'));
});

export function Logo({ size = 56 }) {
  return html`<svg class="logo" width=${size} height=${size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="16" fill="var(--ink)" />
    <g transform="translate(12 12)">
      <rect x="0" y="0" width="11" height="11" rx="2.5" fill="#e5484d" />
      <rect x="14.5" y="0" width="11" height="11" rx="2.5" fill="var(--bg)" opacity=".9" />
      <rect x="29" y="0" width="11" height="11" rx="2.5" fill="#3e63dd" />
      <rect x="0" y="14.5" width="11" height="11" rx="2.5" fill="var(--bg)" opacity=".9" />
      <rect x="14.5" y="14.5" width="11" height="11" rx="2.5" fill="#f0a51f" />
      <rect x="29" y="14.5" width="11" height="11" rx="2.5" fill="var(--bg)" opacity=".9" />
      <rect x="0" y="29" width="11" height="11" rx="2.5" fill="#2b9a5f" />
      <rect x="14.5" y="29" width="11" height="11" rx="2.5" fill="var(--bg)" opacity=".9" />
      <rect x="29" y="29" width="11" height="11" rx="2.5" fill="#e5484d" />
    </g>
  </svg>`;
}

export const RULES = html`<ol class="rules">
  <li><b>Tap a square</b>, film yourself doing it, and lock it in. First team to lock a square owns it — nobody else can take it.</li>
  <li><b>Every clip is public</b> the moment it’s posted. Watch the feed to keep each other honest.</li>
  <li><b>Think a clip is bogus?</b> Contest it. Players on the other teams vote; majority wins, ties go to the team that claimed it. Contests auto-decide after 2 minutes.</li>
  <li><b>When a team hits the goal</b>, the game pauses for a short review window. If nothing gets overturned, they win.</li>
</ol>`;

export function SetupNeeded() {
  return html`<main class="page narrow center-col">
    <${Logo} size=${64} />
    <h1 class="display">Lockout</h1>
    <p class="muted">This copy isn’t connected to a database yet. Add your Supabase URL and key to <code>config.js</code>.</p>
    <a class="btn" href="?mock">Try the offline demo</a>
  </main>`;
}

export function Home() {
  const [name, setName] = useState(store.get('name', ''));
  const [code, setCode] = useState(() => cleanCode(new URLSearchParams(location.search).get('join') || ''));
  const [busy, setBusy] = useState(null);
  const [installable, setInstallable] = useState(!!deferredPrompt);
  const [iosHelp, setIosHelp] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const recent = recentGames();

  useEffect(() => {
    const f = () => setInstallable(true);
    addEventListener('lockout-installable', f);
    return () => removeEventListener('lockout-installable', f);
  }, []);

  const cleanName = name.trim().slice(0, 24);
  const saveName = () => store.set('name', cleanName);

  async function create() {
    if (!cleanName) return toast('Enter your name first');
    saveName();
    setBusy('create');
    try {
      const g = await createGame(cleanName);
      go(g.code);
    } catch (e) {
      toast(e.message || 'Could not create game', { kind: 'bad' });
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    const c = cleanCode(code);
    if (!cleanName) return toast('Enter your name first');
    if (c.length < 4) return toast('Enter the 4-letter game code');
    saveName();
    setBusy('join');
    try {
      const [g] = await backend.select('games', { code: c });
      if (!g) return toast(`No game with code ${c}`, { kind: 'bad' });
      sessionStorage.setItem('lockout-autojoin', c);
      go(c);
    } catch (e) {
      toast(e.message || 'Could not join', { kind: 'bad' });
    } finally {
      setBusy(null);
    }
  }

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      setInstallable(false);
    }
  }

  return html`<main class="page narrow home">
    <header class="home-hero">
      <${Logo} size=${64} />
      <h1 class="display">Lockout</h1>
      <p class="tagline">Bingo for real life. Every square needs video proof — and once it’s yours, it’s locked.</p>
      ${MOCK && html`<span class="pill">Demo mode — data stays on this device</span>`}
    </header>

    <section class="card">
      <label class="label" for="nm">Your name</label>
      <input id="nm" class="input" placeholder="e.g. Tyson" value=${name} maxlength="24" autocomplete="nickname"
        onInput=${(e) => setName(e.currentTarget.value)} />
      <button class="btn big" onClick=${create} disabled=${!!busy}>${busy === 'create' ? 'Creating…' : 'Create a game'}</button>
      <div class="or"><span>or join one</span></div>
      <div class="row">
        <input class="input code-input" placeholder="CODE" value=${code} maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false"
          onInput=${(e) => setCode(cleanCode(e.currentTarget.value))} onKeyDown=${(e) => e.key === 'Enter' && join()} />
        <button class="btn" onClick=${join} disabled=${!!busy}>${busy === 'join' ? '…' : 'Join'}</button>
      </div>
    </section>

    ${recent.length > 0 &&
    html`<section class="card">
      <h2 class="h2">Recent games</h2>
      <div class="list">
        ${recent.map(
          (r) => html`<button class="list-item" onClick=${() => go(r.code)}>
            <span class="code-chip">${r.code}</span><span class="grow">${r.title}</span><${Icon.chevR} size=${18} />
          </button>`
        )}
      </div>
    </section>`}

    ${!isStandalone() &&
    html`<section class="card install">
      <div>
        <h2 class="h2">Put it on your home screen</h2>
        <p class="muted small">Opens full-screen like a real app.</p>
      </div>
      ${installable
        ? html`<button class="btn" onClick=${install}>Install</button>`
        : html`<button class="btn ghost" onClick=${() => setIosHelp(true)}>How?</button>`}
    </section>`}

    <button class="link-btn" onClick=${() => setRulesOpen(true)}>How to play</button>

    <${Sheet} open=${iosHelp} onClose=${() => setIosHelp(false)} title="Add to Home Screen">
      ${isIOS()
        ? html`<ol class="rules">
            <li>Open this page in <b>Safari</b>.</li>
            <li>Tap the <b>Share</b> button <span class="kbd"><${Icon.share} size=${14} /></span> at the bottom.</li>
            <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          </ol>`
        : html`<ol class="rules">
            <li>Open this page in <b>Chrome</b>.</li>
            <li>Tap the <b>⋮</b> menu in the top-right.</li>
            <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
          </ol>`}
      <p class="muted small">Your games carry over — if you were already in one, rejoin with the same name and tap “That’s me”.</p>
    </${Sheet}>

    <${Sheet} open=${rulesOpen} onClose=${() => setRulesOpen(false)} title="How to play">${RULES}</${Sheet}>
  </main>`;
}

/** Shown when you open a game link but aren't a player yet. */
export function JoinGate({ data, refresh }) {
  const { game } = data;
  const [name, setName] = useState(store.get('name', ''));
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState(null);
  const auto = sessionStorage.getItem('lockout-autojoin') === game.code;

  async function join(n = name) {
    const clean = n.trim().slice(0, 24);
    if (!clean) return toast('Enter your name');
    store.set('name', clean);
    setBusy(true);
    try {
      const r = await joinGame(game, clean);
      sessionStorage.removeItem('lockout-autojoin');
      if (r.nameTaken) setTaken(r.nameTaken);
      else if (r.error) toast(r.error, { kind: 'bad' });
      refresh();
    } catch (e) {
      toast(e.message || 'Could not join', { kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (auto && name.trim()) join();
  }, []);

  async function itsMe() {
    setBusy(true);
    try {
      await reclaimPlayer(game, taken);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const status = game.status === 'lobby' ? 'Waiting in the lobby' : game.status === 'active' ? 'Game in progress — you can still join' : 'This game is over';

  return html`<main class="page narrow center-col">
    <${Logo} size=${56} />
    <p class="muted">Game</p>
    <div class="code-big">${game.code}</div>
    <p class="muted small">${status}</p>
    ${taken
      ? html`<section class="card wide">
          <p><b>${taken.name}</b> is already in this game. Is that you on another phone (or before installing the app)?</p>
          <button class="btn big" onClick=${itsMe} disabled=${busy}>Yes, that’s me</button>
          <button class="btn ghost" onClick=${() => setTaken(null)}>No — pick another name</button>
        </section>`
      : html`<section class="card wide">
          <label class="label" for="jn">Your name</label>
          <input id="jn" class="input" value=${name} maxlength="24" onInput=${(e) => setName(e.currentTarget.value)}
            onKeyDown=${(e) => e.key === 'Enter' && join()} />
          <button class="btn big" onClick=${() => join()} disabled=${busy}>${busy ? 'Joining…' : 'Join game'}</button>
        </section>`}
    <button class="link-btn" onClick=${() => go(null)}>Back home</button>
  </main>`;
}
