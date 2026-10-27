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

    <${FinishMap} data=${data} />

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

function mapWorldPoint(latitude, longitude, zoom) {
  const scale = 256 * 2 ** zoom;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, Number(latitude) || 0));
  const lon = Number(longitude) || 0;
  const sin = Math.sin(lat * Math.PI / 180);
  return { x: (lon + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

function FinishMap({ data }) {
  const { game, players, submissions, locations = [] } = data;
  const validLocations = locations.filter((point) => Number.isFinite(+point.latitude) && Number.isFinite(+point.longitude));
  const tracksByPlayer = new Map();
  for (const point of validLocations) {
    if (!tracksByPlayer.has(point.player_id)) tracksByPlayer.set(point.player_id, []);
    tracksByPlayer.get(point.player_id).push(point);
  }
  for (const track of tracksByPlayer.values()) track.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const complete = submissions.filter((sub) => sub.status === 'active' && sub.team != null)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)));
  const taskNumbers = new Map(), counts = new Map();
  for (const sub of complete) { const number = (counts.get(sub.team) || 0) + 1; counts.set(sub.team, number); taskNumbers.set(sub.id, number); }
  const pins = complete.flatMap((sub) => {
    if (sub.task_latitude != null && sub.task_longitude != null && Number.isFinite(+sub.task_latitude) && Number.isFinite(+sub.task_longitude)) {
      return [{ sub, latitude: +sub.task_latitude, longitude: +sub.task_longitude }];
    }
    const samples = tracksByPlayer.get(sub.player_id) || [];
    if (!samples.length) return [];
    const at = Date.parse(sub.created_at);
    const closest = samples.reduce((best, sample) => Math.abs(Date.parse(sample.created_at) - at) < Math.abs(Date.parse(best.created_at) - at) ? sample : best, samples[0]);
    const tolerance = Math.max(120000, (Number(game.settings?.locationUpdateIntervalMin) || 1) * 30000 + 30000);
    return Math.abs(Date.parse(closest.created_at) - at) <= tolerance ? [{ sub, latitude: +closest.latitude, longitude: +closest.longitude }] : [];
  });

  const tracks = [...tracksByPlayer.entries()].map(([id, points]) => ({
    id,
    player: players.find((player) => player.id === id),
    points,
  })).filter((track) => track.player?.team != null && track.points.length > 1);
  const allPoints = [
    ...validLocations.map((point) => ({ latitude: +point.latitude, longitude: +point.longitude })),
    ...pins.map(({ latitude, longitude }) => ({ latitude, longitude })),
  ];
  if (!allPoints.length) return html`<section class="card finish-map"><h2 class="h2">Game map</h2><p class="muted">No location data was recorded during this game.</p></section>`;

  const width = 528, height = 320, padding = 36;
  const normalized = allPoints.map((point) => mapWorldPoint(point.latitude, point.longitude, 0));
  const boundsAt = (level) => {
    const scale = 2 ** level;
    return { minX: Math.min(...normalized.map((p) => p.x * scale)), maxX: Math.max(...normalized.map((p) => p.x * scale)), minY: Math.min(...normalized.map((p) => p.y * scale)), maxY: Math.max(...normalized.map((p) => p.y * scale)) };
  };
  let zoom = 18, bounds = boundsAt(zoom);
  while (zoom > 2) {
    if (bounds.maxX - bounds.minX <= width - padding * 2 && bounds.maxY - bounds.minY <= height - padding * 2) break;
    zoom--;
    bounds = boundsAt(zoom);
  }
  const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
  const left = centerX - width / 2, top = centerY - height / 2, tileCount = 2 ** zoom;
  const minTileX = Math.floor(left / 256), maxTileX = Math.floor((left + width) / 256);
  const minTileY = Math.floor(top / 256), maxTileY = Math.floor((top + height) / 256);
  const toScreen = (latitude, longitude) => { const point = mapWorldPoint(latitude, longitude, zoom); return { x: point.x - left, y: point.y - top }; };
  const tiles = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
      const x = ((tileX % tileCount) + tileCount) % tileCount;
      const tileHost = ['a', 'b', 'c'][x % 3];
      tiles.push({ key: `${zoom}/${x}/${tileY}`, x: tileX * 256 - left, y: tileY * 256 - top, url: `https://tile-${tileHost}.openstreetmap.fr/hot/${zoom}/${x}/${tileY}.png` });
    }
  }

  return html`<section class="card finish-map">
    <h2 class="h2">Game map</h2>
    <div class="finish-map-canvas" role="img" aria-label="Map showing player routes and completed task pins">
      ${tiles.map((tile) => html`<img key=${tile.key} class="finish-map-tile" src=${tile.url} alt="" draggable="false" style=${`left:${tile.x / width * 100}%;top:${tile.y / height * 100}%;width:${256 / width * 100}%;height:${256 / height * 100}%`} />`)}
      <svg class="finish-map-overlay" viewBox=${`0 0 ${width} ${height}`} aria-hidden="true">
        ${tracks.map((track) => {
          const color = teamInfo(game, track.player.team).color;
          const points = track.points.map((point) => toScreen(point.latitude, point.longitude));
          return html`<polyline points=${points.map((point) => `${point.x},${point.y}`).join(' ')} stroke=${color} />`;
        })}
        ${pins.map(({ sub, latitude, longitude }) => {
          const point = toScreen(latitude, longitude), team = teamInfo(game, sub.team);
          return html`<g transform=${`translate(${point.x} ${point.y})`}><circle r="13" fill=${team.color} stroke="#fff" stroke-width="2" /><text y="4" text-anchor="middle" fill="#fff">${taskNumbers.get(sub.id)}</text><title>${`Task ${taskNumbers.get(sub.id)}: ${game.board?.[sub.square] || ''}`}</title></g>`;
        })}
      </svg>
    </div>
  </section>`;
}
