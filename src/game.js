import { html, useState, useEffect, useRef, useMemo } from './h.js';
import { CLIENT_ID, uploader, useBus, toast, claimSquare, openContest, castVote, hostRule, endGameNow, go, backend, bus } from './core.js';
import { derive, teamInfo, contestTally, describeWin, eligibleVoters, CONTEST_SECONDS, ts } from './logic.js';
import { store, clock, ago, vibrate, getTheme } from './util.js';
import { Icon } from './icons.js';
import { Sheet, ConfirmSheet, TeamDot, Thumb, Video, Empty, ThemeToggle } from './ui.js';
import { Recorder, useVideoPicker, canRecord } from './recorder.js';
import { ClipViewer } from './clips.js';
import { shareInvite } from './lobby.js';
import { RULES } from './home.js';

const short = (s = '', n = 34) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---------------- notifications ----------------
export function useNotifications(data, me) {
  const prev = useRef(null);
  useEffect(() => {
    const { game, submissions = [], contests = [] } = data;
    if (!game || !me) return;
    const cur = {
      subs: new Set(submissions.map((s) => s.id)),
      contests: new Map(contests.map((c) => [c.id, c.status])),
      pending: game.pending_winner ?? null,
    };
    const p = prev.current;
    prev.current = cur;
    if (!p || game.status !== 'active') return;
    const subById = new Map(submissions.map((s) => [s.id, s]));
    const label = (s) => `"${short(game.board?.[s.square])}"`;
    for (const s of submissions) {
      if (p.subs.has(s.id) || s.player_id === me.id) continue;
      const t = teamInfo(game, s.team);
      toast(`${t.name} locked ${label(s)}`, { color: t.color });
      vibrate(30);
    }
    for (const c of contests) {
      const s = subById.get(c.submission_id);
      if (!s) continue;
      const old = p.contests.get(c.id);
      if (!old && c.opened_by !== me.id) {
      toast(s.team === me.team ? `⚖️ Your ${label(s)} is being contested!` : `⚖️ ${label(s)} is contested — go vote`, { kind: 'warn' });
        vibrate([60, 40, 60]);
      }
      if (old === 'open' && c.status !== 'open') {
      toast(c.status === 'rejected' ? `❌ ${label(s)} got thrown out — the square is open again` : `✅ ${label(s)} stands`, { kind: c.status === 'rejected' ? 'bad' : 'ok' });
      }
    }
    if (p.pending === null && cur.pending !== null) {
      const t = cur.pending >= 0 ? teamInfo(game, cur.pending) : null;
      toast(t ? `🏁 ${t.name} hit the goal — review time!` : '🏁 Review time!', { color: t?.color, ms: 5000 });
      vibrate([100, 60, 100, 60, 200]);
    }
  }, [data.at]);
}

// ---------------- main game screen ----------------
export function Game({ data, me, refresh, now }) {
  const { game, players } = data;
  const d = useMemo(() => derive(data, now), [data.at, Math.floor(now / 1000)]);
  const isHost = game.host_id === CLIENT_ID;
  const [tab, setTab] = useState(() => {
    const saved = store.get(`game:tab:${game.id}`, 'board');
    return ['board', 'feed', 'teams', 'plan', 'map'].includes(saved) ? saved : 'board';
  });
  const [openSq, setOpenSq] = useState(null);
  const [menu, setMenu] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [endBusy, setEndBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState('');
  const [viewer, setViewer] = useState(null);
  const [seen, setSeen] = useState(() => store.get(`seen:${game.id}`, 0));
  const tracker = html`<${LocationTracker} game=${game} me=${me} refresh=${refresh} />`;

  useEffect(() => {
    store.set(`game:tab:${game.id}`, tab);
  }, [game.id, tab]);

  useEffect(() => {
    if (tab === 'feed') {
      const t = Date.now();
      setSeen(t);
      store.set(`seen:${game.id}`, t);
    }
  }, [tab, data.at]);

  const pendingTeam = d.paused && game.pending_winner >= 0 ? game.pending_winner : null;
  const highlight = useMemo(() => {
    if (pendingTeam == null || game.pending_reason !== 'condition') return new Set();
    return new Set((d.stats[pendingTeam]?.lineList || []).flat());
  }, [pendingTeam, d]);

  const claimList = useMemo(
    () => [...data.submissions].sort((a, b) => ts(b.created_at) - ts(a.created_at)),
    [data.at]
  );
  const unseen = data.submissions.filter((s) => ts(s.created_at) > seen && s.player_id !== me.id).length +
    data.contests.filter((c) => ts(c.created_at) > seen && c.opened_by !== me.id).length;

  const openViewer = (list, index) => setViewer({ list, index });

  let timer;
  if (game.ends_at) {
    const left = ts(game.ends_at) - now;
    timer = html`<span class=${`timer ${left < 5 * 60000 ? 'hot' : ''}`}><${Icon.clock} size=${15} />${left > 0 ? `${clock(left)} / ${d.settings.timeLimitMin} min` : 'Time!'}</span>`;
  } else {
    timer = html`<span class="timer"><${Icon.clock} size=${15} />${clock(now - ts(game.started_at))}</span>`;
  }

  return html`<main class=${`page game ${tab === 'map' ? 'map-active' : ''} ${tab === 'feed' ? 'feed-active' : ''}`}>
    ${tracker}
    <header class="g-head">
      <span class="lobby-code">${game.code}</span>
      ${timer}
      <button class="icon-btn" onClick=${() => setMenu(true)} aria-label="Menu"><${Icon.more} /></button>
    </header>

    <${Scoreboard} game=${game} d=${d} me=${me} />
    <${Banners} data=${data} d=${d} me=${me} now=${now} refresh=${refresh}
      onOpenSquare=${setOpenSq} onReview=${(team) => openViewer(data.submissions.filter((s) => s.status === 'active' && s.team === team).sort((a, b) => ts(a.created_at) - ts(b.created_at)), 0)} />

    ${tab === 'board' &&
    html`<section class="board-wrap">
      <${Board} game=${game} d=${d} highlight=${highlight} onTap=${setOpenSq} dim=${d.paused} />
      <p class="hint center">${d.paused ? 'Game paused for review' : d.settings.lockout ? 'Tap a square to claim it with a video' : 'Tap a square to submit or challenge clips'} · ${describeWin(d.settings)}</p>
    </section>`}
    ${tab === 'feed' && html`<${Feed} data=${data} d=${d} me=${me} list=${claimList} openViewer=${openViewer} now=${now} refresh=${refresh} />`}
    ${tab === 'teams' && html`<${TeamsTab} data=${data} d=${d} me=${me} refresh=${refresh} />`}
    ${tab === 'plan' && html`<${PlanTab} data=${data} d=${d} me=${me} onOpenSquare=${setOpenSq} />`}
    ${tab === 'map' && html`<${MapTab} data=${data} me=${me} onOpenSquare=${setOpenSq} />`}

    <nav class="tabbar">
      <button class=${tab === 'board' ? 'on' : ''} onClick=${() => setTab('board')}><${Icon.grid} /><span>Board</span></button>
      <button class=${tab === 'feed' ? 'on' : ''} onClick=${() => setTab('feed')}>
        <${Icon.feed} /><span>Feed</span>${unseen > 0 && tab !== 'feed' && html`<b class="badge">${unseen > 9 ? '9+' : unseen}</b>`}
      </button>
      <button class=${tab === 'teams' ? 'on' : ''} onClick=${() => setTab('teams')}><${Icon.users} /><span>Teams</span></button>
      <button class=${tab === 'plan' ? 'on' : ''} onClick=${() => setTab('plan')}><${Icon.flip} /><span>Plan</span></button>
      <button class=${tab === 'map' ? 'on' : ''} onClick=${() => setTab('map')}><${Icon.map} /><span>Map</span></button>
    </nav>

    ${openSq !== null &&
    html`<${SquareSheet} key=${openSq} data=${data} d=${d} me=${me} square=${openSq} now=${now} refresh=${refresh}
      onClose=${() => setOpenSq(null)} />`}

    ${viewer &&
    html`<${ClipViewer} data=${data} list=${viewer.list} index=${viewer.index}
      onIndex=${(i) => setViewer({ ...viewer, index: i })} onClose=${() => setViewer(null)}
      footer=${(() => {
        const s = viewer.list[viewer.index];
        if (!s || s.status !== 'active') return null;
        return html`<button class="btn light full" onClick=${() => { setViewer(null); setOpenSq(s.square); }}><${Icon.scale} size=${18} /> Details / contest</button>`;
      })()} />`}

    <${Sheet} open=${menu} onClose=${() => setMenu(false)} title="Game ${game.code}">
      <div class="stack">
        <div class="row theme-setting"><span>Appearance</span><${ThemeToggle} /></div>
        ${backend.kind === 'local' ? html`<button class="btn ghost" disabled=${pushBusy} onClick=${async () => {
          setPushBusy(true); setPushStatus('');
          try { await backend.enablePush(game.id, me.id); setPushStatus('Push alerts enabled on this device.'); }
          catch (error) { setPushStatus(error.message || 'Could not enable push alerts.'); }
          finally { setPushBusy(false); }
        }}>${pushBusy ? 'Enabling…' : 'Enable push notifications'}</button>` : html`<p class="hint">Push alerts require the local server mode. This game is using ${backend.kind}.</p>`}
        ${pushStatus && html`<p class="hint" role="status">${pushStatus}</p>`}
        <button class="btn" onClick=${() => shareInvite(game)}><${Icon.share} size=${18} /> Invite more players</button>
        <dl class="facts">
          <div><dt>To win</dt><dd>${describeWin(d.settings)}</dd></div>
          <div><dt>Board</dt><dd>${d.settings.size} \u00d7 ${d.settings.size}</dd></div>
          <div><dt>Time limit</dt><dd>${d.settings.timeLimitMin ? `${d.settings.timeLimitMin} min` : 'None'}</dd></div>
          <div><dt>Review window</dt><dd>${d.settings.reviewSecs}s</dd></div>
        </dl>
        <details class="details"><summary>How to play</summary>${RULES}</details>
        ${isHost &&
        html`<button class="btn danger" onClick=${async () => {
          setConfirmEnd(true);
        }}><${Icon.flag} size=${18} /> End game now</button>`}
        <button class="btn ghost" onClick=${() => go(null)}><${Icon.home} size=${18} /> Home (game keeps going)</button>
      </div>
    </${Sheet}>
    <${ConfirmSheet} open=${confirmEnd} onClose=${() => !endBusy && setConfirmEnd(false)}
      title="End game now?" message="The game will finish immediately, and the team with the most squares wins."
      confirmLabel="End game" danger=${true} busy=${endBusy}
      onConfirm=${async () => { setEndBusy(true); try { await endGameNow(data); setConfirmEnd(false); setMenu(false); refresh(); } finally { setEndBusy(false); } }} />
  </main>`;
}

function PlanTab({ data, d, me, onOpenSquare }) {
  const game = data.game, plans = game.plans || {};
  const all = [...Array(d.settings.size * d.settings.size)].map((_, i) => i);
  const mine = plans[me.team] || [];
  const ordered = [...mine.filter((i) => all.includes(i)), ...all.filter((i) => !mine.includes(i))];
  const [order, setOrder] = useState(ordered), [swipePreview, setSwipePreview] = useState(null), [draggingSquare, setDraggingSquare] = useState(null), [dragDy, setDragDy] = useState(0);
  const orderRef = useRef(order), swipe = useRef(null), drag = useRef(null), swipeTimer = useRef(null), autoScrollFrame = useRef(null), suppressClick = useRef(false);
  orderRef.current = order;
  useEffect(() => setOrder(ordered), [game.plans, game.board]);
  useEffect(() => () => { clearTimeout(swipeTimer.current); if (autoScrollFrame.current) cancelAnimationFrame(autoScrollFrame.current); }, []);
  // Keep tracking on window: the dragged row is reordered under the pointer, so
  // relying on events from its original button can lose pointer capture mid-drag.
  useEffect(() => {
    if (draggingSquare === null) return;
    const move = (e) => dragMove(e);
    const end = (e) => dragEnd(e);
    const cancel = (e) => { if (drag.current && (e.type === 'blur' || document.hidden || e.pointerId === drag.current.pointer)) dragEnd({ pointerId: drag.current.pointer, clientX: drag.current.clientX, clientY: drag.current.clientY }); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [draggingSquare]);
  const claimed = new Set(data.submissions.filter((s) => s.status === 'active').map((s) => s.square));
  async function saveOrder(next) { try { await backend.update('games', { plans: { ...plans, [me.team]: next } }, { id: game.id }); } catch (error) { toast(error.message || 'Could not save the task order'); } }
  function moveTo(from, to) {
    if (from < 0 || from >= orderRef.current.length || to < 0 || to >= orderRef.current.length || from === to) return null;
    const next = [...orderRef.current]; next.splice(to, 0, next.splice(from, 1)[0]); orderRef.current = next; setOrder(next); return next;
  }
  function endSwipe(e, cancelled = false) {
    const start = swipe.current; if (!start || start.pointer !== e.pointerId) return;
    swipe.current = null; clearTimeout(swipeTimer.current);
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const commit = !cancelled && start.horizontal && Math.abs(dx) >= 90 && Math.abs(dx) > Math.abs(dy);
    if (!start.horizontal) { setSwipePreview(null); suppressClick.current = false; return; }
    suppressClick.current = !!start.horizontal;
    setSwipePreview({ index: start.index, dx: commit ? Math.sign(dx) * window.innerWidth : 0, direction: dx > 0 ? 'top' : 'bottom', committing: true });
    swipeTimer.current = setTimeout(() => { if (commit) { const next = moveTo(start.index, dx > 0 ? 0 : orderRef.current.length - 1); if (next) saveOrder(next); } setSwipePreview(null); suppressClick.current = false; }, 180);
  }
  function updateDragPosition(active) {
    const rows = [...document.querySelectorAll('.plan-list li[data-plan-square]')]
      .filter((row) => Number(row.dataset.planSquare) !== active.square)
      .map((row) => ({ square: Number(row.dataset.planSquare), mid: row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 }))
      .sort((a, b) => a.mid - b.mid);
    const destination = rows.findIndex((row) => active.clientY < row.mid);
    const to = destination < 0 ? rows.length : destination;
    const from = orderRef.current.indexOf(active.square);
    if (to !== from) {
      const next = moveTo(from, to);
      if (next) active.changed = true;
    }
    active.toIndex = to;
    setDragDy(active.clientY - active.startY + window.scrollY - active.startScrollY - (to - active.startIndex) * active.rowStep);
  }
  function autoScrollDrag() {
    const active = drag.current;
    if (!active) { autoScrollFrame.current = null; return; }
    const edge = 84, lowerEdge = window.innerHeight - 100;
    const speed = active.clientY < edge ? -Math.min(16, Math.ceil((edge - active.clientY) / 5)) : active.clientY > lowerEdge ? Math.min(16, Math.ceil((active.clientY - lowerEdge) / 5)) : 0;
    if (speed) { const before = window.scrollY; window.scrollBy(0, speed); if (window.scrollY !== before) updateDragPosition(active); else { autoScrollFrame.current = null; return; } }
    autoScrollFrame.current = requestAnimationFrame(autoScrollDrag);
  }
  function dragMove(e) {
    const active = drag.current; if (!active || active.pointer !== e.pointerId) return;
    active.clientX = e.clientX; active.clientY = e.clientY;
    updateDragPosition(active);
    const nearEdge = e.clientY < 84 || e.clientY > window.innerHeight - 100;
    if (nearEdge && !autoScrollFrame.current) autoScrollFrame.current = requestAnimationFrame(autoScrollDrag);
    else if (!nearEdge && autoScrollFrame.current) { cancelAnimationFrame(autoScrollFrame.current); autoScrollFrame.current = null; }
  }
  function dragEnd(e) {
    const active = drag.current; if (!active || active.pointer !== e.pointerId) return;
    active.clientX = e.clientX; active.clientY = e.clientY; updateDragPosition(active);
    if (autoScrollFrame.current) cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = null; drag.current = null; setDraggingSquare(null); setDragDy(0);
    if (active.changed) saveOrder(orderRef.current);
  }
  return html`<section class="card plan-card">
    <h2 class="h2">Team plan <span class="muted">· ${teamInfo(game, me.team).name}</span></h2>
    <p class="hint">Drag the dots to reorder. Swipe right to move a task to the top or left to move it to the bottom.</p>
    <ol class="plan-list">${order.map((square, i) => {
      const done = claimed.has(square);
      const squareTeams = [...new Set(data.submissions.filter((s) => s.square === square && s.status === 'active').map((s) => s.team))].map((team) => teamInfo(game, team));
      const fillTeams = d.settings.lockout ? squareTeams.slice(0, 1) : squareTeams;
      return html`<li key=${square} class=${draggingSquare === square ? 'dragging' : ''} data-plan-index=${i} data-plan-square=${square} role="button" tabIndex="0" aria-label=${`${i + 1}. ${game.board?.[square]}`}
        onClick=${() => { if (!suppressClick.current && !window.getSelection?.().toString()) onOpenSquare(square); }}
        onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSquare(square); } }}
        onPointerDown=${(e) => { if (e.target.closest('.plan-handle')) return; clearTimeout(swipeTimer.current); suppressClick.current = false; swipe.current = { x: e.clientX, y: e.clientY, index: i, pointer: e.pointerId, horizontal: false, selectingText: !!e.target.closest('.plan-task') }; }}
        onPointerMove=${(e) => { const start = swipe.current; if (!start || start.pointer !== e.pointerId || start.selectingText) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { start.horizontal = true; suppressClick.current = true; if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId); setSwipePreview({ index: start.index, dx: Math.max(-window.innerWidth, Math.min(window.innerWidth, dx)), direction: dx > 0 ? 'top' : 'bottom', committing: false }); } else if (start.horizontal) setSwipePreview({ index: start.index, dx: Math.max(-window.innerWidth, Math.min(window.innerWidth, dx)), direction: dx >= 0 ? 'top' : 'bottom', committing: false }); }}
        onPointerUp=${(e) => endSwipe(e)} onPointerCancel=${(e) => endSwipe(e, true)}>
        <div class=${`plan-swipe-bg ${swipePreview?.index === i ? swipePreview.direction : ''}`} style=${`opacity:${swipePreview?.index === i ? Math.min(1, Math.abs(swipePreview.dx) / 90) : 0}`}>
          ${swipePreview?.index === i && html`<span>${swipePreview.direction === 'top' ? '\u2191' : '\u2193'}</span>`}
        </div>
        <div class=${`plan-row-content ${done ? 'done' : ''} ${draggingSquare === square ? 'dragging' : ''} ${swipePreview?.index === i ? (swipePreview.committing ? 'committing' : 'swiping') : ''}`} style=${`transform:translate(${swipePreview?.index === i ? swipePreview.dx : 0}px,${draggingSquare === square ? dragDy : 0}px);opacity:${swipePreview?.index === i ? Math.max(0, 1 - Math.abs(swipePreview.dx) / Math.max(window.innerWidth, 1)) : 1}`}>
          ${done && html`<span class="plan-team-colors" style=${`--team-count:${fillTeams.length}`} aria-hidden="true">${fillTeams.map((team) => html`<i style=${`--team-color:${team.color}`}></i>`)}</span>`}
          <button type="button" class="plan-handle" aria-label=${`Reorder ${game.board?.[square]}`} onClick=${(e) => e.stopPropagation()} onPointerDown=${(e) => { e.preventDefault(); e.stopPropagation(); clearTimeout(swipeTimer.current); swipe.current = null; setSwipePreview(null); const row = e.currentTarget.closest('[data-plan-square]'); const nextRow = row?.nextElementSibling; const rowStep = nextRow ? nextRow.getBoundingClientRect().top - row.getBoundingClientRect().top : row?.getBoundingClientRect().height + 6; const index = orderRef.current.indexOf(square); drag.current = { square, pointer: e.pointerId, startY: e.clientY, startScrollY: window.scrollY, clientX: e.clientX, clientY: e.clientY, startIndex: index, rowStep, toIndex: index, changed: false }; setDraggingSquare(square); try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} }}><i></i><i></i><i></i><i></i><i></i><i></i></button>
          <span class=${`plan-task ${done ? 'plan-task-open' : ''}`}><span class="plan-num">${i + 1}</span><span>${game.board?.[square]}</span></span>
        </div>
      </li>`;
    })}</ol>
  </section>`;
}

function worldPoint(lat, lon, zoom) {
  const scale = 256 * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
  const longitude = Number(lon) || 0;
  const x = (longitude + 180) / 360 * scale;
  const sin = Math.sin(latitude * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function closestLocation(samples, at) {
  if (!samples?.length) return null;
  if (!Number.isFinite(at)) return samples[samples.length - 1];
  let low = 0, high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (Date.parse(samples[mid].created_at) < at) low = mid + 1;
    else high = mid;
  }
  const before = samples[Math.max(0, low - 1)];
  const after = samples[Math.min(samples.length - 1, low)];
  return Math.abs(Date.parse(before.created_at) - at) <= Math.abs(Date.parse(after.created_at) - at) ? before : after;
}

function MapTab({ data, me, onOpenSquare }) {
  const game = data.game;
  const viewKey = `map:view:${game.id}`;
  const savedView = store.get(viewKey, {});
  const [darkMap, setDarkMap] = useState(() => getTheme() === 'dark');
  const [showPeople, setShowPeople] = useState(() => store.get(`map:people:${data.game.id}`, true));
  const [showTasks, setShowTasks] = useState(() => store.get(`map:tasks:${data.game.id}`, true));
  const [mapSize, setMapSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [tilesFailed, setTilesFailed] = useState(false);
  const [geoError, setGeoError] = useState(() => store.get(`map:geo-error:${data.game.id}`, ''));
  const [center, setCenter] = useState(() => savedView.center || { latitude: 20, longitude: 0 });
  const [zoom, setZoom] = useState(() => savedView.zoom || 2);
  const [pan, setPan] = useState(() => savedView.pan || { x: 0, y: 0 });
  const panStart = useRef(null);
  const activePointers = useRef(new Map());
  const pinchStart = useRef(null);
  const hasCentered = useRef(!!savedView.centered);
  useEffect(() => {
    const syncTheme = () => setDarkMap(getTheme() === 'dark');
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', syncTheme);
    return () => { observer.disconnect(); media?.removeEventListener?.('change', syncTheme); };
  }, []);
  const enabled = game.settings?.locationSharingEnabled === true;
  const interval = Math.max(1, Number(game.settings?.locationUpdateIntervalMin) || 1);
  const positions = data.locations || [];
  const positionsByPlayer = useMemo(() => {
    const grouped = new Map();
    for (const point of positions) {
      if (!Number.isFinite(+point.latitude) || !Number.isFinite(+point.longitude)) continue;
      const key = `${point.player_id}:${point.visibility || 'team'}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(point);
    }
    for (const samples of grouped.values()) samples.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return grouped;
  }, [positions]);
  const displayed = useMemo(() => positions.filter((p) => {
    const player = data.players.find((x) => x.id === p.player_id);
    const kind = p.visibility || 'team';
    if (p.player_id === me.id) return kind !== 'opponent';
    if (!enabled || !showPeople) return false;
    if (player?.team === me.team) return kind === 'team';
    return kind === 'opponent';
  }), [positions, data.players, me.id, me.team, enabled, showPeople]);
  const latest = useMemo(() => {
    const result = new Map();
    for (const p of displayed) if (!result.has(p.player_id) || Date.parse(p.created_at) > Date.parse(result.get(p.player_id).created_at)) result.set(p.player_id, p);
    return result;
  }, [displayed]);
  useEffect(() => {
    if (hasCentered.current || !latest.size) return;
    const initial = latest.get(me.id) || [...latest.values()][0];
    if (!initial) return;
    hasCentered.current = true;
    const nextCenter = { latitude: +initial.latitude, longitude: +initial.longitude };
    setCenter(nextCenter);
    setZoom(15);
    setPan({ x: 0, y: 0 });
    store.set(viewKey, { center: nextCenter, zoom: 15, pan: { x: 0, y: 0 }, centered: true });
  }, [latest, me.id]);
  const cp = worldPoint(+center.latitude, +center.longitude, zoom);
  const left = cp.x - mapSize.w / 2 - pan.x;
  const top = cp.y - mapSize.h / 2 - pan.y;
  const tileX = Math.floor(left / 256), tileY = Math.floor(top / 256);
  const tileCols = Math.ceil(mapSize.w / 256) + 2;
  const tileRows = Math.ceil(mapSize.h / 256) + 2;
  const tiles = [...Array(tileRows)].flatMap((_, iy) => [...Array(tileCols)].map((_, ix) => {
    const x = tileX + ix - 1, rawY = tileY + iy - 1, n = 2 ** zoom;
    const y = Math.max(0, Math.min(n - 1, rawY));
    const tileHost = ['a', 'b', 'c'][((x % 3) + 3) % 3];
    return html`<img key=${`${zoom}/${((x % n) + n) % n}/${rawY}`} class="map-tile" draggable="false" src=${`https://tile-${tileHost}.openstreetmap.fr/hot/${zoom}/${((x % n) + n) % n}/${((y % n) + n) % n}.png`}
      onError=${() => setTilesFailed(true)} style=${`left:${x * 256 - left}px;top:${y * 256 - top}px`} />`;
  }));
  function xy(lat, lon) { const p = worldPoint(+lat, +lon, zoom); return { x: p.x - left, y: p.y - top }; }
  useEffect(() => {
    const el = document.querySelector('.map-canvas');
    if (!el) return;
    const resize = () => setMapSize({ w: el.clientWidth, h: el.clientHeight });
    resize();
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(resize);
      observer.observe(el); return () => observer.disconnect();
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => bus.on('location-status', (event) => event.gameId === game.id && setGeoError(event.message)), [game.id]);
  const taskPins = useMemo(() => {
    const pins = [];
    if (game.settings?.showTaskPins !== false && showTasks) {
    for (const sub of data.submissions.filter((s) => s.status === 'active' && (s.player_id === me.id || s.team === me.team || (enabled && showPeople)))) {
      if (sub.task_latitude != null && sub.task_longitude != null && Number.isFinite(+sub.task_latitude) && Number.isFinite(+sub.task_longitude)) {
        pins.push({ sub, point: { latitude: +sub.task_latitude, longitude: +sub.task_longitude, created_at: sub.created_at } });
        continue;
      }
      const neededVisibility = sub.team === me.team || sub.player_id === me.id ? 'team' : 'opponent';
      const samples = positionsByPlayer.get(`${sub.player_id}:${neededVisibility}`);
      const closest = closestLocation(samples, Date.parse(sub.created_at));
      if (!closest) continue;
      const tolerance = neededVisibility === 'opponent' ? Math.max(120000, interval * 30000 + 30000) : 90000;
      if (Math.abs(Date.parse(closest.created_at) - Date.parse(sub.created_at)) > tolerance) continue;
      pins.push({ sub, point: closest });
    }
    }
    return pins;
  }, [game.settings?.showTaskPins, showTasks, data.submissions, positionsByPlayer, me.id, me.team, enabled, showPeople]);
  const taskNumbers = useMemo(() => {
    const counts = new Map(), numbers = new Map();
    const completed = data.submissions.filter((sub) => sub.status === 'active' && sub.team != null)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)));
    for (const sub of completed) {
      const number = (counts.get(sub.team) || 0) + 1;
      counts.set(sub.team, number);
      numbers.set(sub.id, number);
    }
    return numbers;
  }, [data.submissions]);
  const tracks = useMemo(() => [...new Set(displayed.map((p) => p.player_id))].map((id) => ({
    id,
    points: [...(positionsByPlayer.get(`${id}:team`) || []), ...(positionsByPlayer.get(`${id}:opponent`) || [])]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(-500),
  })).filter((t) => t.points.length > 1), [displayed, positionsByPlayer]);
  const toggleTasks = () => { if (game.settings?.showTaskPins === false) return; setShowTasks((old) => { store.set(`map:tasks:${game.id}`, !old); return !old; }); };
  const togglePeople = () => { if (!enabled) return; setShowPeople((old) => { store.set(`map:people:${game.id}`, !old); return !old; }); };
  const saveView = (next) => store.set(viewKey, { center, zoom, pan, centered: true, ...next });
  const zoomTo = (nextZoom, anchor = { x: mapSize.w / 2, y: mapSize.h / 2 }) => {
    const level = Math.max(2, Math.min(18, nextZoom));
    const oldCenter = worldPoint(center.latitude, center.longitude, zoom);
    const newCenter = worldPoint(center.latitude, center.longitude, level);
    const focus = { x: oldCenter.x + anchor.x - mapSize.w / 2 - pan.x, y: oldCenter.y + anchor.y - mapSize.h / 2 - pan.y };
    const nextPan = { x: anchor.x - focus.x * (2 ** (level - zoom)) + newCenter.x - mapSize.w / 2, y: anchor.y - focus.y * (2 ** (level - zoom)) + newCenter.y - mapSize.h / 2 };
    setZoom(level); setPan(nextPan);
    saveView({ zoom: level, pan: nextPan });
  };
  const zoomBy = (amount, anchor) => zoomTo(zoom + amount, anchor);
  const locateMe = () => {
    const own = latest.get(me.id);
    if (!own) return;
    hasCentered.current = true;
    setCenter({ latitude: +own.latitude, longitude: +own.longitude });
    setZoom(15);
    setPan({ x: 0, y: 0 });
    saveView({ center: { latitude: +own.latitude, longitude: +own.longitude }, zoom: 15, pan: { x: 0, y: 0 } });
  };
  return html`<section class="map-page">
    <div class=${`map-canvas ${darkMap ? 'dark-map' : ''} ${panStart.current ? 'panning' : ''}`} aria-label="Player and completed task map"
      onPointerDown=${(e) => {
        if (e.target.closest('.map-tools')) return;
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        if (activePointers.current.size === 1) panStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        if (activePointers.current.size === 2) {
          const [a, b] = [...activePointers.current.values()];
          pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom, midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, panX: pan.x, panY: pan.y, center: worldPoint(center.latitude, center.longitude, zoom) };
          panStart.current = null;
        }
      }}
      onPointerMove=${(e) => {
        if (activePointers.current.has(e.pointerId)) activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.current.size >= 2 && pinchStart.current) {
          const [a, b] = [...activePointers.current.values()];
          const start = pinchStart.current;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const nextZoom = Math.max(2, Math.min(18, Math.round(start.zoom + Math.log2(Math.max(distance, 1) / Math.max(start.distance, 1)))));
          const focusX = start.center.x + start.midpoint.x - mapSize.w / 2 - start.panX;
          const focusY = start.center.y + start.midpoint.y - mapSize.h / 2 - start.panY;
          const scaled = 2 ** (nextZoom - start.zoom);
          const nextCenter = worldPoint(center.latitude, center.longitude, nextZoom);
          setZoom(nextZoom);
          setPan({ x: midpoint.x - focusX * scaled + nextCenter.x - mapSize.w / 2, y: midpoint.y - focusY * scaled + nextCenter.y - mapSize.h / 2 });
          return;
        }
        const start = panStart.current;
        if (!start || start.pointerId !== e.pointerId) return;
        setPan({ x: start.panX + e.clientX - start.x, y: start.panY + e.clientY - start.y });
      }}
      onPointerUp=${(e) => {
        activePointers.current.delete(e.pointerId);
        pinchStart.current = null;
        if (activePointers.current.size === 1) {
          const [id, point] = [...activePointers.current.entries()][0];
          panStart.current = { pointerId: id, x: point.x, y: point.y, panX: pan.x, panY: pan.y };
        } else panStart.current = null;
        saveView({ zoom, pan });
        setPan((p) => ({ ...p }));
      }}
      onPointerCancel=${(e) => {
        activePointers.current.delete(e.pointerId);
        pinchStart.current = null;
        panStart.current = null;
        setPan((p) => ({ ...p }));
      }}
      onWheel=${(e) => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); zoomBy(e.deltaY > 0 ? -1 : 1, { x: e.clientX - rect.left, y: e.clientY - rect.top }); }}>
      ${tiles}
      ${!latest.size && html`<div class="map-empty">${enabled ? 'Waiting for device location' : 'Location sharing is off for this game.'}</div>`}
      ${tilesFailed && html`<div class="map-message">Map tiles could not load. Check the internet connection.</div>`}
      <div class="map-tools">
        <button class=${`map-tool ${showTasks && game.settings?.showTaskPins !== false ? 'on' : ''}`} disabled=${game.settings?.showTaskPins === false} onClick=${toggleTasks} title="Toggle completed task pins" aria-label="Toggle completed task pins"><${Icon.pin} /></button>
        <button class=${`map-tool ${showPeople && enabled ? 'on' : ''}`} disabled=${!enabled} onClick=${togglePeople} title=${enabled ? 'Toggle teammates and allowed opponents' : 'Location sharing is off in game settings'} aria-label="Toggle teammates and allowed opponents"><${Icon.users} /></button>
        <button class="map-tool" onClick=${locateMe} disabled=${!latest.has(me.id)} title="Center on me" aria-label="Center on me"><${Icon.locate} /></button>
        <button class="map-tool map-zoom" onClick=${() => zoomBy(1)} disabled=${zoom >= 18} title="Zoom in" aria-label="Zoom in">+</button>
        <button class="map-tool map-zoom" onClick=${() => zoomBy(-1)} disabled=${zoom <= 2} title="Zoom out" aria-label="Zoom out">−</button>
      </div>
      ${geoError && html`<div class="map-message">${geoError}</div>`}
      ${latest.size > 0 && html`<svg class="map-tracks" viewBox=${`0 0 ${mapSize.w} ${mapSize.h}`} preserveAspectRatio="none">
        ${tracks.map((track) => { const color = teamInfo(game, data.players.find((p) => p.id === track.id)?.team ?? 0).color; return html`<polyline points=${track.points.map((p) => { const q = xy(p.latitude, p.longitude); return `${q.x},${q.y}`; }).join(' ')} stroke=${color} />`; })}
      </svg>`}
      ${displayed.filter((p) => latest.get(p.player_id) === p).map((p) => { const pos = xy(p.latitude, p.longitude); const player = data.players.find((x) => x.id === p.player_id); const team = teamInfo(game, player?.team ?? 0); return html`<span class="map-marker" style=${`left:${pos.x}px;top:${pos.y}px;--tc:${team.color};--ti:${team.ink}`}>${player?.name || 'Player'}</span>`; })}
      ${taskPins.map(({ sub, point }) => { const pos = xy(point.latitude, point.longitude); const taskNumber = taskNumbers.get(sub.id) || 1; const team = teamInfo(game, sub.team); return html`<button key=${sub.id} type="button" class="task-pin" style=${`left:${pos.x}px;top:${pos.y}px;--tc:${team.color};--ti:${team.ink}`} title=${game.board?.[sub.square]} aria-label=${`Task ${taskNumber} for ${team.name}: ${game.board?.[sub.square]}`} onPointerDown=${(e) => e.stopPropagation()} onClick=${(e) => { e.stopPropagation(); onOpenSquare(sub.square); }}>${taskNumber}</button>`; })}
    </div>
  </section>`;
}

function LocationTracker({ game, me, refresh }) {
  const enabled = game.status === 'active' && game.settings?.locationSharingEnabled === true;
  const interval = Math.max(1, Number(game.settings?.locationUpdateIntervalMin) || 1);
  useEffect(() => {
    const report = (message) => {
      store.set(`map:geo-error:${game.id}`, message);
      bus.emit('location-status', { gameId: game.id, message });
    };
    if (!enabled) { report(''); return; }
    if (!window.isSecureContext) {
      report('iPhone location requires HTTPS. A local network address using http:// is not secure; use an HTTPS address.');
      return;
    }
    if (!navigator.geolocation) { report('This browser does not provide location services.'); return; }
    report('');
    let lastTeamSent = 0;
    let lastOpponentSent = 0;
    let sending = false;
    const watch = navigator.geolocation.watchPosition(async ({ coords }) => {
      const now = Date.now();
      store.set(`map:last-location:${game.id}:${me.id}`, { latitude: coords.latitude, longitude: coords.longitude, at: now });
      const teamDue = now - lastTeamSent >= 10000;
      const opponentDue = now - lastOpponentSent >= interval * 60000;
      if (sending || (!teamDue && !opponentDue)) return;
      sending = true;
      try {
        const base = { game_id: game.id, player_id: me.id, latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
        const updates = [];
        if (teamDue) updates.push(backend.insert('locations', { ...base, visibility: 'team' }));
        if (opponentDue) updates.push(backend.insert('locations', { ...base, visibility: 'opponent' }));
        await Promise.all(updates);
        if (teamDue) lastTeamSent = now;
        if (opponentDue) lastOpponentSent = now;
        report('');
        refresh();
      } catch (error) {
        report(`Could not save your location: ${error.message}`);
      } finally { sending = false; }
    }, (error) => {
      const message = error.code === 1 ? 'Location permission was denied. Allow location for this site in iPhone Settings > Safari > Location.' :
        error.code === 2 ? 'Your device could not determine its location. Check Location Services and try outdoors.' :
        error.code === 3 ? 'Location request timed out. Keep the game open and try again.' : (error.message || 'Location is unavailable.');
      report(message);
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [enabled, interval, game.id, me.id]);
  return null;
}

function Scoreboard({ game, d, me }) {
  const top = Math.max(...d.stats.map((s) => s.squares));
  return html`<div class="scores" role="list">
    ${d.stats.map((st) => {
      const t = teamInfo(game, st.team);
      const lead = st.squares > 0 && st.squares === top;
      const sub = d.target.type === 'lines' ? `${st.lines}/${d.target.n} bingo${d.target.n === 1 ? '' : 's'}` : `of ${d.target.n}`;
      return html`<div role="listitem" class=${`score ${me.team === st.team ? 'mine' : ''}`} style=${`--tc:${t.color};--ti:${t.ink}`}>
        <span class="score-name">${lead ? html`<${Icon.crown} size=${12} />` : ''}${t.name}</span>
        <span class="score-num">${st.squares}</span>
        <span class="score-sub">${sub}</span>
      </div>`;
    })}
  </div>`;
}

export function Board({ game, d, highlight = new Set(), onTap, dim }) {
  const n = d.settings.size;
  return html`<div class=${`board ${dim ? 'dim' : ''}`} style=${`--n:${n}`} data-size=${n}>
    ${(game.board || []).map((text, i) => {
      const subs = d.owner.get(i) || [];
      const teams = [...new Set(subs.map((s) => s.team))].map((team) => teamInfo(game, team));
      const team = teams[0] || null;
      const uploading = subs.some((s) => !s.video_path && uploader?.status(s.id));
      const shared = !d.settings.lockout && teams.length > 1;
      const cls = ['sq', subs.length ? 'claimed' : '', shared ? 'shared' : '', highlight.has(i) ? 'hl' : '', text.length > 28 ? 'long' : '', text.length > 48 ? 'xlong' : ''].join(' ');
      let badge = null;
      if (uploading) badge = html`<span class="sq-badge"><${Icon.hourglass} size=${10} /></span>`;
      return html`<button key=${i} class=${cls} style=${`${team ? `--tc:${shared ? 'transparent' : team.color};--ti:${shared ? 'var(--ink)' : team.ink}` : ''};--team-count:${teams.length}`} onClick=${() => onTap?.(i)}
        aria-label=${`${text}${teams.length ? `, submitted by ${teams.map((t) => t.name).join(', ')}` : ', open'}`}>
        ${shared && html`<span class="sq-colors">${teams.map((t) => html`<i style=${`--team-color:${t.color}`} title=${t.name}></i>`)}</span>`}
        <span class="sq-txt">${text}</span>${badge}
      </button>`;
    })}
  </div>`;
}

function Banners({ data, d, me, now, refresh, onOpenSquare, onReview }) {
  const { game, players, submissions, contests, votes } = data;
  const out = [];
  const subById = new Map(submissions.map((s) => [s.id, s]));

  if (d.paused) {
    const pw = game.pending_winner;
    const t = pw >= 0 ? teamInfo(game, pw) : null;
    const left = ts(game.finalize_at) - now;
    const openCount = contests.filter((c) => c.status === 'open').length;
    const waitingUpload = pw >= 0 && submissions.some((s) => s.status === 'active' && s.team === pw && !s.video_path);
    const headline =
      game.pending_reason === 'condition' ? `${t?.name} hit the goal!` : game.pending_reason === 'time' ? "Time's up!" : 'Board is full!';
    const sub =
      game.pending_reason === 'condition' ? '' : t ? ` ${t.name} leads.` : " It's a tie so far.";
    let status;
    if (left > 0) status = html`<b class="mono">${clock(left)}</b> to contest`;
    else if (openCount) status = `Waiting on ${openCount} contest${openCount === 1 ? '' : 's'}`;
    else if (waitingUpload) status = 'Waiting for their clips to finish uploading';
    else status = 'Finalizing';
    out.push(html`<div class="banner review" style=${t ? `--tc:${t.color};--ti:${t.ink}` : ''}>
      <div class="grow">
        <b>${headline}</b>${sub}
        <p>${me.team === pw ? 'Hold tight — other teams can still contest your clips.' : 'Game paused. Check their clips and contest anything sketchy.'}</p>
        <p class="banner-status">${status}</p>
      </div>
      ${pw >= 0 && html`<button class="btn small light" onClick=${() => onReview(pw)}>Review</button>`}
    </div>`);
  }

  for (const c of contests) {
    if (c.status !== 'open') continue;
    const s = subById.get(c.submission_id);
    if (!s) continue;
    const t = teamInfo(game, s.team);
    const challenge = short(game.board?.[s.square], 40);
    const tally = contestTally(c, s, players, votes);
    const mine = votes.find((v) => v.contest_id === c.id && v.player_id === me.id);
    if (s.team === me.team) {
      out.push(html`<button class="banner contest mine" onClick=${() => onOpenSquare(s.square)}>
        <${Icon.scale} size=${20} />
        <div class="grow"><b>Your “${challenge}” is contested</b><p>${tally.reject} not legit · ${tally.legit} legit · ${tally.voted}/${tally.eligible} voted</p></div>
      </button>`);
    } else if (tally.eligibleIds.has(me.id) && !mine) {
      out.push(html`<button class="banner contest" onClick=${() => onOpenSquare(s.square)}>
        <${Icon.scale} size=${20} />
        <div class="grow"><b>Vote: is “${challenge}” from ${t.name} legit?</b><p>Tap to watch the clip and vote</p></div>
        <${Icon.chevR} size=${18} />
      </button>`);
    }
  }

  const failing = (uploader?.pending() || []).map((id) => [id, uploader.status(id)]).filter(([, st]) => st?.error);
  if (failing.length) {
    out.push(html`<div class="banner upload">
      <${Icon.upload} size=${20} />
      <div class="grow"><b>${failing.length} clip${failing.length === 1 ? '' : 's'} waiting to upload</b><p>Saved on your phone — retrying automatically.</p></div>
      <button class="btn small" onClick=${() => failing.forEach(([id]) => uploader.retry(id))}>Retry</button>
    </div>`);
  }

  if (me.team == null || me.team >= d.settings.teamCount) {
    out.push(html`<div class="banner pick">
      <div class="grow"><b>Pick a team to start claiming squares</b>
        <div class="row wrap">
          ${d.stats.map((st) => {
            const t = teamInfo(game, st.team);
            return html`<button class="btn small team-pick" style=${`--tc:${t.color};--ti:${t.ink}`}
              onClick=${async () => { await backend.update('players', { team: st.team }, { id: me.id }); refresh(); }}>${t.name}</button>`;
          })}
        </div>
      </div>
    </div>`);
  }
  return out.length ? html`<div class="banners">${out}</div>` : null;
}

// ---------------- square detail / claim / contest ----------------
function SquareSheet({ data, d, me, square, onClose, refresh, now }) {
  const { game, players, contests, votes } = data;
  const text = game.board?.[square] ?? '';
  const squareSubs = d.owner.get(square) || [];
  const [selectedId, setSelectedId] = useState(() => d.settings.lockout ? squareSubs[0]?.id || null : null);
  const sub = squareSubs.find((s) => s.id === selectedId) || (d.settings.lockout ? squareSubs[0] || null : null);
  const [rec, setRec] = useState(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contesting, setContesting] = useState(false);
  const [reason, setReason] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [picker, pick] = useVideoPicker(
    (r) => setRec(r),
    (msg) => toast(msg, { kind: 'bad', ms: 6000 })
  );
  useBus('uploads');

  useEffect(() => {
    if (!rec) return setPreviewUrl(null);
    const u = URL.createObjectURL(rec.blob);
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [rec]);

  const hasTeam = me.team != null && me.team < d.settings.teamCount;
  const myTeam = hasTeam ? teamInfo(game, me.team) : null;
  const active = game.status === 'active';
  let blocker = null;
  if (!active) blocker = 'The game is over.';
  else if (d.paused) blocker = 'Game is paused for review; hang tight.';
  else if (d.timeUp) blocker = "Time's up!";
  else if (!hasTeam) blocker = 'Pick a team first.';

  async function lockIn() {
    setBusy(true);
    try {
      const r = await claimSquare(data, me, square, rec);
      if (r.conflict) {
        toast('Too slow — another team locked it first.', { kind: 'bad', ms: 5000 });
      } else {
        toast('Locked in! Uploading your clip',  { color: myTeam.color });
        vibrate([30, 40, 30]);
      }
      setRec(null);
      refresh();
      onClose();
    } catch (e) {
      toast(`Couldn't lock it in (${e.message || 'network'}). Check your signal and try again — your clip is still here.`, { kind: 'bad', ms: 6000 });
    } finally {
      setBusy(false);
    }
  }

  async function submitContest() {
    setBusy(true);
    try {
      const r = await openContest(data, me, sub, reason);
      if (r.conflict) toast("That clip was already contested once; it can't be contested again.", { kind: 'bad' });
      else toast('Contest opened. Other players are voting.');
      setContesting(false);
      refresh();
    } catch (e) {
      toast(e.message || 'Could not open contest', { kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  if (recording) {
    return html`<${Recorder}
      onDone=${(r) => { setRec(r); setRecording(false); }}
      onCancel=${() => setRecording(false)}
      onUseUpload=${() => { setRecording(false); pick(); }} />${picker}`;
  }

  // ---- open square ----
  if (!d.settings.lockout && !sub && squareSubs.length && !rec) {
    const mySubmission = hasTeam && squareSubs.some((s) => s.team === me.team);
    return html`<${Sheet} open onClose=${onClose} title="Square ${square + 1}">
      <h2 class="challenge">${text}</h2>
      <p class="muted small">${squareSubs.length} team${squareSubs.length === 1 ? '' : 's'} submitted. Open a clip to watch or challenge it.</p>
      <div class="square-submissions">
        ${squareSubs.map((s) => {
          const t = teamInfo(game, s.team);
          const p = players.find((x) => x.id === s.player_id);
          const c = contests.find((x) => x.submission_id === s.id);
          return html`<div class="square-submission" style=${`--tc:${t.color};--ti:${t.ink}`}>
            <span class="tdot"></span><span class="grow"><b>${t.name}</b><small>${p ? ` · ${p.name}` : ''} · ${ago(s.created_at, now)}</small></span>
            <button class="btn small" onClick=${() => setSelectedId(s.id)}>${c?.status === 'open' ? 'View contest' : 'Watch / challenge'}</button>
          </div>`;
        })}
      </div>
      ${active && !blocker && hasTeam && !mySubmission
        ? html`<div class="stack">
            ${canRecord() && html`<button class="btn big team-btn" style=${`--tc:${myTeam.color};--ti:${myTeam.ink}`} onClick=${() => setRecording(true)}><${Icon.camera} size=${20} /> Submit for ${myTeam.name}</button>`}
            <button class=${`btn ${canRecord() ? 'ghost' : 'big'}`} onClick=${pick}><${Icon.upload} size=${18} /> Upload for ${myTeam.name}</button>
          </div>`
        : hasTeam && mySubmission ? html`<p class="note">Your team already submitted for this square.</p>` : null}
      ${picker}
    </${Sheet}>`;
  }

  if (!sub) {
    return html`<${Sheet} open onClose=${() => !busy && onClose()} title="">
      <p class="eyebrow">Square ${square + 1} · open</p>
      <h2 class="challenge">${text}</h2>
      ${rec
        ? html`<div class="stack">
            <video class="video" src=${previewUrl} controls playsinline autoplay muted></video>
            <p class="muted small">Check your clip. Once you lock it in, it's posted for everyone.</p>
            ${blocker && html`<p class="note bad">${blocker}</p>`}
            <div class="row">
              <button class="btn ghost" onClick=${() => setRec(null)} disabled=${busy}>Retake</button>
              <button class="btn big grow team-btn" style=${myTeam ? `--tc:${myTeam.color};--ti:${myTeam.ink}` : ''}
                onClick=${lockIn} disabled=${busy || !!blocker}>
                <${Icon.lock} size=${18} /> ${busy ? 'Locking…' : 'Lock it in'}
              </button>
            </div>
          </div>`
        : blocker
        ? html`<p class="note">${blocker}</p>`
        : html`<div class="stack">
            ${canRecord() &&
            html`<button class="btn big team-btn" style=${`--tc:${myTeam.color};--ti:${myTeam.ink}`} onClick=${() => setRecording(true)}>
              <${Icon.camera} size=${20} /> Record proof
            </button>`}
            <button class=${`btn ${canRecord() ? 'ghost' : 'big'}`} onClick=${pick}><${Icon.upload} size=${18} /> Upload a video</button>
            <p class="muted small center">${d.settings.lockout ? 'First team to lock it in owns it.' : 'Your team can submit once. Other teams can submit and challenge clips too.'} Clips can be up to 60 seconds.</p>
          </div>`}
      ${picker}
    </${Sheet}>`;
  }

  // ---- claimed square ----
  const team = teamInfo(game, sub.team);
  const player = players.find((p) => p.id === sub.player_id);
  const contest = contests.find((c) => c.submission_id === sub.id);
  const up = !sub.video_path ? uploader?.status(sub.id) : null;
  const canContest = active && hasTeam && me.team !== sub.team && !contest;

  return html`<${Sheet} open onClose=${onClose} title="">
    ${!d.settings.lockout && html`<button class="btn ghost small square-back" onClick=${() => setSelectedId(null)}>All submissions for this square</button>`}
    <div class="claim-head" style=${`--tc:${team.color};--ti:${team.ink}`}>
      <${Icon.lock} size=${14} /> ${team.name}${player ? ` · ${player.name}` : ''} · ${ago(sub.created_at, now)}
    </div>
    <h2 class="challenge">${text}</h2>
    ${rec && sub.team !== me.team && html`<p class="note bad">${team.name} locked this while you were filming.</p>`}
    <${Video} path=${sub.video_path} poster=${sub.thumb_path} localBlob=${uploader?.localBlob(sub.id)} />
    ${up &&
    html`<div class="upbar">
      <div class="upbar-fill" style=${`width:${Math.round((up.pct || 0) * 100)}%`}></div>
      <span>${up.error ? `Upload paused: ${up.error}` : `Uploading ${Math.round((up.pct || 0) * 100)}%`}</span>
      ${up.error && html`<button class="btn small" onClick=${() => uploader.retry(sub.id)}>Retry</button>`}
    </div>`}

    ${contest?.status === 'open' &&
    html`<${ContestPanel} data=${data} contest=${contest} sub=${sub} me=${me} now=${now} refresh=${refresh} />`}
    ${contest?.status === 'upheld' && html`<p class="note ok"><${Icon.check} size=${16} /> Survived a contest — this one stands.</p>`}
    ${canContest && !contesting &&
    html`<button class="btn ghost full" onClick=${() => setContesting(true)}><${Icon.scale} size=${18} /> Contest this clip</button>`}
    ${contesting &&
    html`<div class="stack contest-form">
      <label class="label" for="rsn">What's wrong with it? (optional)</label>
      <input id="rsn" class="input" maxlength="120" placeholder="e.g. That's not a stranger, that's his roommate" value=${reason}
        onInput=${(e) => setReason(e.currentTarget.value)} />
      <p class="muted small">Players on other teams vote. Majority decides; ties keep the claim. Each clip can only be contested once.</p>
      <div class="row">
        <button class="btn ghost" onClick=${() => setContesting(false)}>Cancel</button>
        <button class="btn grow" onClick=${submitContest} disabled=${busy}>${busy ? 'Opening…' : 'Open contest'}</button>
      </div>
    </div>`}
  </${Sheet}>`;
}

function ContestPanel({ data, contest, sub, me, now, refresh }) {
  const { game, players, votes } = data;
  const tally = contestTally(contest, sub, players, votes);
  const mine = votes.find((v) => v.contest_id === contest.id && v.player_id === me.id);
  const opener = players.find((p) => p.id === contest.opened_by);
  const openerTeam = opener?.team != null ? teamInfo(game, opener.team) : null;
  const eligible = tally.eligibleIds.has(me.id);
  const isHost = game.host_id === CLIENT_ID;
  const left = Math.min(CONTEST_SECONDS * 1000, ts(contest.created_at) + CONTEST_SECONDS * 1000 - now);
  const [busy, setBusy] = useState(false);
  const [confirmOutcome, setConfirmOutcome] = useState(null);

  async function vote(legit) {
    setBusy(true);
    try {
      await castVote(data, me, contest, legit);
      vibrate(20);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function rule(outcome) {
    setConfirmOutcome(outcome);
  }

  const pct = (n) => (tally.eligible ? (n / tally.eligible) * 100 : 0);
  return html`<div class="contest-box">
    <p><b><${Icon.scale} size=${16} /> Contested${openerTeam ? ` by ${openerTeam.name}` : ''}${opener ? ` (${opener.name})` : ''}</b></p>
    ${contest.reason && html`<p class="quote">${contest.reason}</p>`}
    <div class="tally" aria-label="Vote tally">
      <div class="tally-bar"><span class="t-rej" style=${`width:${pct(tally.reject)}%`}></span><span class="t-leg" style=${`width:${pct(tally.legit)}%`}></span></div>
      <p class="small"><b class="bad-text">${tally.reject} not legit</b> · <b class="ok-text">${tally.legit} legit</b> · ${tally.voted}/${tally.eligible} voted · decides in ${clock(left)}</p>
    </div>
    ${eligible
      ? html`<div class="row">
          <button class=${`btn grow vote ${mine?.legit === true ? 'on ok' : ''}`} disabled=${busy} onClick=${() => vote(true)}><${Icon.check} size=${18} /> Legit</button>
          <button class=${`btn grow vote ${mine?.legit === false ? 'on bad' : ''}`} disabled=${busy} onClick=${() => vote(false)}><${Icon.x} size=${18} /> Not legit</button>
        </div>`
      : html`<p class="muted small">${me.team === sub.team ? 'Your team can? vote on its own clip.' : 'Only players on a team can vote.'}</p>`}
    ${isHost &&
    html`<div class="row host-rule"><span class="muted small grow">Host override</span>
      <button class="btn small ghost" onClick=${() => rule('upheld')}>Keep it</button>
      <button class="btn small ghost" onClick=${() => rule('rejected')}>Throw out</button>
    </div>
    <${ConfirmSheet} open=${confirmOutcome !== null} onClose=${() => !busy && setConfirmOutcome(null)}
      title=${confirmOutcome === 'rejected' ? 'Throw this claim out?' : 'Keep this claim?'}
      message=${confirmOutcome === 'rejected' ? 'The clip will be rejected and the square will reopen.' : 'The claim will stand as accepted.'}
      confirmLabel=${confirmOutcome === 'rejected' ? 'Throw out' : 'Keep claim'} danger=${confirmOutcome === 'rejected'} busy=${busy}
      onConfirm=${async () => { setBusy(true); try { await hostRule(contest, confirmOutcome); setConfirmOutcome(null); refresh(); } finally { setBusy(false); } }} />`}
  </div>`;
}

// ---------------- feed ----------------
function Feed({ data, d, me, list, openViewer, now, refresh }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const feedRef = useRef(null);
  const nearBottom = useRef(true);
  const { game, players, contests } = data;
  const subById = new Map(data.submissions.map((s) => [s.id, s]));
  const events = [];
  for (const s of data.submissions) events.push({ k: `s${s.id}`, at: ts(s.created_at), type: 'claim', s });
  for (const c of contests) {
    const s = subById.get(c.submission_id);
    if (!s) continue;
    events.push({ k: `c${c.id}`, at: ts(c.created_at), type: 'contest', c, s });
    if (c.status !== 'open' && c.resolved_at) events.push({ k: `r${c.id}`, at: ts(c.resolved_at), type: 'ruling', c, s });
  }
  if (game.started_at) events.push({ k: 'start', at: ts(game.started_at), type: 'start' });
  for (const message of data.messages || []) events.push({ k: `m${message.id}`, at: ts(message.created_at), type: 'message', message });
  events.sort((a, b) => b.at - a.at);
  useEffect(() => {
    const el = feedRef.current;
    if (el && nearBottom.current) el.scrollTop = 0;
  }, [data.at]);

  const send = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const result = await backend.insert('messages', {
        game_id: game.id, player_id: me.id, player_name: me.name, body: body.slice(0, 500),
      });
      if (result?.conflict) throw new Error('Could not send message. Please try again.');
      setDraft('');
      refresh();
    } catch (error) {
      toast(error.message || 'Message could not be sent.', { kind: 'bad' });
    } finally {
      setSending(false);
    }
  };
  return html`<section class="feed feed-reverse" ref=${feedRef} onScroll=${(e) => { nearBottom.current = Math.abs(e.currentTarget.scrollTop) < 100; }}>
    <form class="feed-compose" onSubmit=${send}>
      <input aria-label="Message to the game" maxlength="500" placeholder="Message your game" value=${draft}
        onInput=${(event) => setDraft(event.currentTarget.value)} />
      <button class="btn small" type="submit" disabled=${sending || !draft.trim()}>${sending ? 'Sending…' : 'Send'}</button>
    </form>
    ${events.length <= 1 && html`<${Empty}>No activity yet. Send a message or claim a square!</${Empty}>`}
    ${events.map((e) => {
      if (e.type === 'start') return html`<div key=${e.k} class="feed-sys">Game on · ${ago(e.at, now)}</div>`;
      if (e.type === 'message') {
        const author = players.find((p) => p.id === e.message.player_id);
        const team = author?.team != null ? teamInfo(game, author.team) : null;
        return html`<article key=${e.k} class=${`feed-message ${e.message.player_id === me.id ? 'mine' : ''}`} style=${team ? `--tc:${team.color};--ti:${team.ink}` : ''}>
          <p class="feed-message-who">${e.message.player_name || author?.name || 'Player'} <time>${ago(e.at, now)}</time></p>
          <p class="feed-message-body">${e.message.body}</p>
        </article>`;
      }
      const t = teamInfo(game, e.s.team);
      const ch = game.board?.[e.s.square] ?? '';
      if (e.type === 'claim') {
        const p = players.find((x) => x.id === e.s.player_id);
        const c = contests.find((x) => x.submission_id === e.s.id);
        const badge = e.s.status === 'rejected' ? '!' : c?.status === 'open' ? '⚖' : c?.status === 'upheld' ? '✓' : null;
        return html`<div key=${e.k} class=${`feed-item ${e.s.status === 'rejected' ? 'struck' : ''}`}>
          <${Thumb} sub=${e.s} team=${t} badge=${badge} onClick=${() => openViewer(list, list.findIndex((x) => x.id === e.s.id))} />
          <div class="grow">
            <p class="feed-who"><${TeamDot} team=${t} /> <b>${t.name}</b>${p ? ` · ${p.name}` : ''}</p>
            <p class="feed-what">${ch}</p>
            <p class="muted small">${ago(e.at, now)}${e.s.status === 'rejected' ? ' · thrown out' : ''}${!e.s.video_path ? ' · uploading' : ''}</p>
          </div>
        </div>`;
      }
      const opener = players.find((x) => x.id === e.c.opened_by);
      const ot = opener?.team != null ? teamInfo(game, opener.team) : null;
      if (e.type === 'contest') return html`<div key=${e.k} class="feed-sys warn">${ot ? ot.name : 'Someone'} contested ${t.name}: ${short(ch, 40)} · ${ago(e.at, now)}</div>`;
      return html`<div key=${e.k} class=${`feed-sys ${e.c.status === 'rejected' ? 'bad' : 'ok'}`}>
        ${e.c.status === 'rejected' ? `Thrown out: ${short(ch, 40)} is open again` : `Ruled legit: ${t.name} keeps ${short(ch, 40)}`}
        ${e.c.resolved_by === 'host' ? ' (host call)' : ''} · ${ago(e.at, now)}
      </div>`;
    })}
  </section>`;
}

// ---------------- teams ----------------
function TeamsTab({ data, d, me }) {
  const { game, players } = data;
  return html`<section class="teams-tab">
    ${d.stats.map((st) => {
      const t = teamInfo(game, st.team);
      const members = players.filter((p) => p.team === st.team);
      return html`<div class="team-row" style=${`--tc:${t.color};--ti:${t.ink}`}>
        <div class="team-row-head"><b>${t.name}</b><span>${st.squares} square${st.squares === 1 ? '' : 's'} · ${st.lines} bingo${st.lines === 1 ? '' : 's'}</span></div>
        <ul class="members">
          ${members.map((p) => {
            const n = data.submissions.filter((s) => s.player_id === p.id && s.status === 'active').length;
            return html`<li class=${p.id === me.id ? 'me' : ''}><span class="grow">${p.name}${p.client_id === game.host_id ? ' (host)' : ''}</span><span class="muted">${n} clip${n === 1 ? '' : 's'}</span></li>`;
          })}
          ${members.length === 0 && html`<li class="muted">Nobody</li>`}
        </ul>
      </div>`;
    })}
    ${players.some((p) => p.team == null) &&
    html`<p class="muted small">Spectating: ${players.filter((p) => p.team == null).map((p) => p.name).join(', ')}</p>`}
  </section>`;
}
