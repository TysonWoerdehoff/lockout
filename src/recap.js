import { html, useState, useMemo } from './h.js';
import { CLIENT_ID, rematch, joinGame, go, toast } from './core.js';
import { derive, teamInfo, winningLines, ts } from './logic.js';
import { store, clock, stamp } from './util.js';
import { Icon } from './icons.js';
import { Thumb, Confetti, Empty } from './ui.js';
import { ClipViewer } from './clips.js';
import { Board } from './game.js';
import { backend } from './core.js';

export function Recap({ data, me, refresh }) {
  const { game, players, submissions } = data;
  const d = useMemo(() => derive(data), [data.at]);
  const [view, setView] = useState('time');
  const [viewer, setViewer] = useState(null);
  const [busy, setBusy] = useState(false);
  const isHost = game.host_id === CLIENT_ID;
  const winner = game.winner != null ? teamInfo(game, game.winner) : null;
  const lines = useMemo(() => new Set(winningLines(d.settings, d.active, game.winner).flat()), [data.at]);
  const duration = game.finished_at && game.started_at ? clock(ts(game.finished_at) - ts(game.started_at)) : null;

  const reasonText = {
    condition: 'hit the goal',
    time: 'had the most squares when time ran out',
    full: 'had the most squares on a full board',
    host: 'were ahead when the host ended it',
  }[game.end_reason] || 'won';

  const standings = [...d.stats].sort((a, b) => b.squares - a.squares || b.lines - a.lines);
  const timeline = useMemo(() => [...submissions].filter((s) => s.video_path || s.status === 'active').sort((a, b) => ts(a.created_at) - ts(b.created_at)), [data.at]);
  const byTeam = useMemo(() => [...timeline].sort((a, b) => a.team - b.team || ts(a.created_at) - ts(b.created_at)), [timeline]);
  const list = view === 'time' ? timeline : byTeam;
  const colors = winner ? [winner.color, '#ffffff', winner.color, '#f0a51f'] : ['#e5484d', '#3e63dd', '#2b9a5f', '#f0a51f'];

  async function doRematch() {
    setBusy(true);
    try {
      const g = await rematch(data, me);
      go(g.code);
    } catch (e) {
      toast(e.message || 'Could not create rematch', { kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  async function joinRematch() {
    setBusy(true);
    try {
      const [g] = await backend.select('games', { code: game.next_code });
      if (!g) return toast('Rematch not found', { kind: 'bad' });
      if (me) {
        const r = await joinGame(g, me.name, me.team);
        if (r.nameTaken) sessionStorage.setItem('lockout-autojoin', '');
      } else sessionStorage.setItem('lockout-autojoin', g.code);
      go(g.code);
    } finally {
      setBusy(false);
    }
  }

  return html`<main class="page recap">
    <${Confetti} colors=${colors} />
    <header class="recap-hero" style=${winner ? `--tc:${winner.color};--ti:${winner.ink}` : ''}>
      <p class="eyebrow">Game ${game.code} · final${duration ? ` · ${duration}` : ''}</p>
      ${winner
        ? html`<h1 class="display"><${Icon.crown} size=${30} /> ${winner.name} wins!</h1><p>${winner.name} ${reasonText}.</p>`
        : html`<h1 class="display">It’s a tie!</h1><p>Nobody pulled ahead.</p>`}
      ${me && winner && me.team === game.winner && html`<p class="pill light">That’s you 🎉</p>`}
    </header>

    ${game.next_code &&
    !isHost &&
    html`<button class="banner rematch" onClick=${joinRematch} disabled=${busy}>
      <${Icon.refresh} size=${20} /><div class="grow"><b>Rematch lobby is open</b><p>Same rules, same teams — tap to join</p></div><${Icon.chevR} />
    </button>`}

    <section class="card">
      <h2 class="h2">Standings</h2>
      <ol class="standings">
        ${standings.map((st, i) => {
          const t = teamInfo(game, st.team);
          const members = players.filter((p) => p.team === st.team).map((p) => p.name).join(', ');
          return html`<li style=${`--tc:${t.color};--ti:${t.ink}`}>
            <span class="place">${i + 1}</span>
            <div class="grow"><b>${t.name}</b><p class="muted small">${members || '—'}</p></div>
            <span class="st-num">${st.squares}<small> sq · ${st.lines} bingo${st.lines === 1 ? '' : 's'}</small></span>
          </li>`;
        })}
      </ol>
    </section>

    <section class="card">
      <h2 class="h2">Final board</h2>
      <${Board} game=${game} d=${d} highlight=${lines}
        onTap=${(i) => {
          const list = d.owner.get(i) || [];
          if (list.length) setViewer({ list, index: 0 });
        }} />
    </section>

    <section class="card">
      <div class="card-head">
        <h2 class="h2">All the clips <span class="muted">· ${timeline.length}</span></h2>
        <div class="seg small">
          <button class=${view === 'time' ? 'on' : ''} onClick=${() => setView('time')}>Timeline</button>
          <button class=${view === 'team' ? 'on' : ''} onClick=${() => setView('team')}>By team</button>
        </div>
      </div>
      ${list.length === 0
        ? html`<${Empty}>No clips this game.</${Empty}>`
        : html`<div class="clip-grid">
            ${list.map((s, i) => {
              const t = teamInfo(game, s.team);
              const p = players.find((x) => x.id === s.player_id);
              const ch = game.board?.[s.square] ?? '';
              return html`<div class="clip-card">
                <${Thumb} sub=${s} team=${t} badge=${s.status === 'rejected' ? '❌' : null} onClick=${() => setViewer({ list, index: i })} />
                <p class="clip-title">${ch}</p>
                <p class="muted tiny"><span class="tdot" style=${`--tc:${t.color}`}></span> ${t.name}${p ? ` · ${p.name}` : ''} · ${stamp(s.created_at, game.started_at)}</p>
              </div>`;
            })}
          </div>`}
    </section>

    <div class="recap-foot">
      ${isHost &&
      (game.next_code
        ? html`<button class="btn big" onClick=${() => go(game.next_code)}>Go to rematch lobby</button>`
        : html`<button class="btn big" onClick=${doRematch} disabled=${busy}><${Icon.refresh} size=${18} /> ${busy ? 'Setting up…' : 'Rematch (same crew)'}</button>`)}
      <button class="btn ghost" onClick=${() => go(null)}><${Icon.home} size=${18} /> Home</button>
    </div>

    ${viewer &&
    html`<${ClipViewer} data=${data} list=${viewer.list} index=${viewer.index}
      onIndex=${(i) => setViewer({ ...viewer, index: i })} onClose=${() => setViewer(null)} />`}
  </main>`;
}
