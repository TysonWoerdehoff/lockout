import { html, render, useState, useEffect, useRef } from './h.js';
import { backend, CLIENT_ID, useGameData, useNow, applyAction, go } from './core.js';
import { decide } from './logic.js';
import { MOCK, rememberGame } from './util.js';
import { Home, JoinGate, SetupNeeded, Logo } from './home.js';
import { Lobby } from './lobby.js';
import { Game, useNotifications } from './game.js';
import { Recap } from './recap.js';
import { Toaster } from './ui.js';

const parseHash = () => {
  const m = location.hash.match(/^#\/g\/([A-Za-z]{4,6})/);
  return { code: m ? m[1].toUpperCase() : null };
};

function App() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const f = () => {
      setRoute(parseHash());
      scrollTo(0, 0);
    };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  if (!backend) return html`<${SetupNeeded} /><${Toaster} />`;
  return html`${route.code ? html`<${GameRoot} key=${route.code} code=${route.code} />` : html`<${Home} />`}<${Toaster} />`;
}

/** Every phone runs the referee: contest results, the review window, and game end. */
function useReferee(data, refresh) {
  const latest = useRef(data);
  latest.current = data;
  const status = data.game?.status;
  useEffect(() => {
    if (status !== 'active') return;
    const recent = new Map();
    let stopped = false;
    const tick = async () => {
      const d = latest.current;
      if (!d.game || d.online === false) return;
      const acts = decide(d, Date.now());
      for (const a of acts) {
        const { finalizeAt, ...rest } = a;
        const k = JSON.stringify(rest);
        if (recent.has(k) && Date.now() - recent.get(k) < 4000) continue;
        recent.set(k, Date.now());
        try {
          await applyAction(a, d.game);
        } catch (e) {
          console.warn('referee', a, e);
        }
        if (stopped) return;
        refresh();
      }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [status, data.game?.id]);
}

function GameRoot({ code }) {
  const [data, refresh] = useGameData(code);
  const now = useNow(1000);
  const me = data.players?.find((p) => p.client_id === CLIENT_ID) || null;
  useReferee(data, refresh);
  useNotifications(data, me);

  useEffect(() => {
    if (me && data.game) rememberGame(data.game.code, `${me.name} · ${data.game.code}`);
  }, [!!me, data.game?.status]);

  if (data.loading) {
    return html`<main class="page narrow center-col"><div class="spin"><${Logo} size=${48} /></div><p class="muted">Loading game ${code}…</p></main>`;
  }
  if (data.notFound) {
    return html`<main class="page narrow center-col">
      <h1 class="display">No game “${code}”</h1>
      <p class="muted">Double-check the code with whoever invited you.</p>
      <button class="btn" onClick=${() => go(null)}>Back home</button>
    </main>`;
  }
  if (!data.game) {
    return html`<main class="page narrow center-col">
      <h1 class="display">Can’t reach the game</h1>
      <p class="muted">${data.error || 'Check your connection.'}</p>
      <button class="btn" onClick=${refresh}>Try again</button>
      <button class="link-btn" onClick=${() => go(null)}>Back home</button>
    </main>`;
  }

  const offline = data.online === false && html`<div class="offline">Reconnecting…</div>`;
  if (data.game.status === 'finished') return html`${offline}<${Recap} data=${data} me=${me} refresh=${refresh} />`;
  if (!me) return html`${offline}<${JoinGate} data=${data} refresh=${refresh} />`;
  if (data.game.status === 'lobby') return html`${offline}<${Lobby} data=${data} me=${me} refresh=${refresh} />`;
  return html`${offline}<${Game} data=${data} me=${me} refresh=${refresh} now=${now} />`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && !MOCK && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
