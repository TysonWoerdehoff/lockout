import { html, useState, useEffect, useRef, useMemo } from './h.js';
import { CLIENT_ID, uploader, useBus, toast, claimSquare, openContest, castVote, hostRule, endGameNow, go, backend } from './core.js';
import { derive, teamInfo, contestTally, describeWin, eligibleVoters, CONTEST_SECONDS, ts, normalizeSettings, pointsFor, BOUNTY_MULT, MODE_INFO } from './logic.js';
import { store, clock, ago, vibrate } from './util.js';
import { Icon } from './icons.js';
import { Sheet, TeamDot, Thumb, Video, Empty, PointChip } from './ui.js';
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
    const rush = normalizeSettings(game.settings).mode === 'rush';
    const label = (s) => `“${short(game.board?.[s.square])}”`;
    for (const s of submissions) {
      if (p.subs.has(s.id) || s.player_id === me.id) continue;
      const t = teamInfo(game, s.team);
      toast(`${t.name} ${rush ? 'finished' : 'locked'} ${label(s)}`, { color: t.color });
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
        toast(c.status === 'rejected' ? `❌ ${teamInfo(game, s.team).name}’s ${label(s)} got thrown out${rush ? '' : ' — square’s open again'}` : `✅ ${label(s)} stands`, { kind: c.status === 'rejected' ? 'bad' : 'ok' });
      }
    }
    if (p.pending === null && cur.pending !== null) {
      const t = cur.pending >= 0 ? teamInfo(game, cur.pending) : null;
      const what = game.pending_reason === 'clinch' ? 'clinched it' : game.pending_reason === 'condition' ? 'hit the goal' : 'is in the lead';
      toast(t ? `🏁 ${t.name} ${what} — review time!` : '🏁 Review time!', { color: t?.color, ms: 5000 });
      vibrate([100, 60, 100, 60, 200]);
    }
  }, [data.at]);
}

// ---------------- main game screen ----------------
export function Game({ data, me, refresh, now }) {
  const { game, players } = data;
  const d = useMemo(() => derive(data, now), [data.at, Math.floor(now / 1000)]);
  const isHost = game.host_id === CLIENT_ID;
  const [tab, setTab] = useState('board');
  const [openSq, setOpenSq] = useState(null);
  const [menu, setMenu] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [seen, setSeen] = useState(() => store.get(`seen:${game.id}`, 0));
  useBus('uploads');

  useEffect(() => {
    if (tab === 'feed') {
      const t = Date.now();
      setSeen(t);
      store.set(`seen:${game.id}`, t);
    }
  }, [tab, data.at]);

  const myTeam = me.team != null && me.team < d.settings.teamCount ? teamInfo(game, me.team) : null;
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

  // Bounty alert when a new one starts (time-driven, so it lives here rather than in useNotifications).
  const bk = d.bounty?.current?.k ?? null;
  const prevBk = useRef(undefined);
  useEffect(() => {
    if (prevBk.current !== undefined && bk != null && bk !== prevBk.current && game.status === 'active') {
      toast(`💰 Bounty! “${short(game.board?.[d.bounty.current.square])}” is worth double`, { kind: 'warn', ms: 6000 });
      vibrate([80, 50, 80]);
    }
    prevBk.current = bk;
  }, [bk]);

  const hint = [
    d.paused ? 'Game paused for review' : d.rush ? 'Every team can do every square' : 'Tap a square to claim it with a video',
    describeWin(d.settings),
  ];
  if (d.bounty?.nextAt && !d.paused && game.status === 'active') hint.push(`next bounty in ${clock(d.bounty.nextAt - now)}`);

  let timer;
  if (game.ends_at) {
    const left = ts(game.ends_at) - now;
    timer = html`<span class=${`timer ${left < 5 * 60000 ? 'hot' : ''}`}><${Icon.clock} size=${15} />${left > 0 ? `${clock(left)} left` : 'Time!'}</span>`;
  } else {
    timer = html`<span class="timer"><${Icon.clock} size=${15} />${clock(now - ts(game.started_at))}</span>`;
  }

  return html`<main class="page game">
    <header class="g-head">
      ${myTeam
        ? html`<span class="my-team" style=${`--tc:${myTeam.color};--ti:${myTeam.ink}`}>${myTeam.name}</span>`
        : html`<span class="my-team none">No team</span>`}
      ${timer}
      <button class="icon-btn" onClick=${() => setMenu(true)} aria-label="Menu"><${Icon.more} /></button>
    </header>

    <${Scoreboard} game=${game} d=${d} me=${me} />
    <${Banners} data=${data} d=${d} me=${me} now=${now} refresh=${refresh}
      onOpenSquare=${setOpenSq} onReview=${(team) => openViewer(data.submissions.filter((s) => s.status === 'active' && s.team === team).sort((a, b) => ts(a.created_at) - ts(b.created_at)), 0)} />

    ${tab === 'board' &&
    html`<section class="board-wrap">
      <${Board} game=${game} d=${d} highlight=${highlight} onTap=${setOpenSq} dim=${d.paused} perspective=${me.team} />
      <p class="hint center">${hint.join(' · ')}</p>
    </section>`}
    ${tab === 'feed' && html`<${Feed} data=${data} d=${d} me=${me} list=${claimList} openViewer=${openViewer} now=${now} />`}
    ${tab === 'teams' && html`<${TeamsTab} data=${data} d=${d} me=${me} refresh=${refresh} />`}

    <nav class="tabbar">
      <button class=${tab === 'board' ? 'on' : ''} onClick=${() => setTab('board')}><${Icon.grid} /><span>Board</span></button>
      <button class=${tab === 'feed' ? 'on' : ''} onClick=${() => setTab('feed')}>
        <${Icon.feed} /><span>Feed</span>${unseen > 0 && tab !== 'feed' && html`<b class="badge">${unseen > 9 ? '9+' : unseen}</b>`}
      </button>
      <button class=${tab === 'teams' ? 'on' : ''} onClick=${() => setTab('teams')}><${Icon.users} /><span>Teams</span></button>
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
        <button class="btn" onClick=${() => shareInvite(game)}><${Icon.share} size=${18} /> Invite more players</button>
        <dl class="facts">
          <div><dt>Mode</dt><dd>${MODE_INFO[d.settings.mode].label}</dd></div>
          <div><dt>To win</dt><dd>${describeWin(d.settings)}</dd></div>
          ${d.pointsMode && html`<div><dt>Bingo bonus</dt><dd>${d.settings.bingoBonus ? `+${d.settings.bingoBonus}` : 'Off'}</dd></div>`}
          ${d.pointsMode && html`<div><dt>Bounties</dt><dd>${d.settings.bounty.on ? `Every ${d.settings.bounty.every} min` : 'Off'}</dd></div>`}
          <div><dt>Board</dt><dd>${d.settings.size}×${d.settings.size}</dd></div>
          <div><dt>Time limit</dt><dd>${d.settings.timeLimitMin ? `${d.settings.timeLimitMin} min` : 'None'}</dd></div>
          <div><dt>Review window</dt><dd>${d.settings.reviewSecs}s</dd></div>
        </dl>
        ${d.pointsMode && html`<p class="hint">${MODE_INFO[d.settings.mode].blurb}</p>`}
        <details class="details"><summary>How to play</summary>${RULES}</details>
        ${isHost &&
        html`<button class="btn danger" onClick=${async () => {
          if (!confirm(`End the game now? The team with the most ${d.pointsMode ? 'points' : 'squares'} wins.`)) return;
          await endGameNow(data);
          setMenu(false);
          refresh();
        }}><${Icon.flag} size=${18} /> End game now</button>`}
        <button class="btn ghost" onClick=${() => go(null)}><${Icon.home} size=${18} /> Home (game keeps going)</button>
      </div>
    </${Sheet}>
  </main>`;
}

function Scoreboard({ game, d, me }) {
  const key = d.pointsMode ? 'points' : 'squares';
  const top = Math.max(...d.stats.map((s) => s[key]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return html`<div class="scores" role="list">
    ${d.stats.map((st) => {
      const t = teamInfo(game, st.team);
      const lead = st[key] > 0 && st[key] === top;
      let sub;
      if (d.pointsMode) {
        if (d.settings.target) sub = `of ${d.settings.target} pts`;
        else if (d.settings.bingoBonus) sub = `pts · ${plural(st.lines, 'bingo')}`;
        else sub = `pts · ${st.squares} sq`;
      } else sub = d.target.type === 'lines' ? `${st.lines}/${d.target.n} bingo${d.target.n === 1 ? '' : 's'}` : `of ${d.target.n}`;
      return html`<div role="listitem" class=${`score ${me.team === st.team ? 'mine' : ''}`} style=${`--tc:${t.color};--ti:${t.ink}`}
        aria-label=${`${t.name}: ${d.pointsMode ? plural(st.points, 'point') : plural(st.squares, 'square')}`}>
        <span class="score-name">${lead ? html`<${Icon.crown} size=${12} />` : ''}${t.name}</span>
        <span class="score-num">${st[key]}</span>
        <span class="score-sub">${sub}</span>
      </div>`;
    })}
  </div>`;
}

export function Board({ game, d, highlight = new Set(), onTap, dim, perspective }) {
  const n = d.settings.size;
  const bountySq = d.bounty?.current?.square;
  return html`<div class=${`board ${dim ? 'dim' : ''} ${d.pointsMode ? 'pts' : ''}`} style=${`--n:${n}`} data-size=${n}>
    ${(game.board || []).map((text, i) => {
      const claims = d.claimsBySquare.get(i) || [];
      const fill = d.rush ? claims.find((c) => c.team === perspective) || null : claims[0] || null;
      const team = fill ? teamInfo(game, fill.team) : null;
      const sub = fill?.sub;
      const contestOpen = claims.some((c) => d.contestBySub.get(c.sub.id)?.status === 'open');
      const up = sub && !sub.video_path ? uploader?.status(sub.id) : null;
      const isBounty = bountySq === i;
      const base = d.pointsMode ? pointsFor(d.settings, text) : 0;
      const cls = ['sq', fill ? 'claimed' : '', highlight.has(i) ? 'hl' : '', isBounty ? 'bounty' : '', text.length > 28 ? 'long' : '', text.length > 48 ? 'xlong' : ''].join(' ');
      let badge = null;
      if (contestOpen) badge = html`<span class="sq-badge warn"><${Icon.scale} size=${11} /></span>`;
      else if (sub && !sub.video_path) badge = html`<span class="sq-badge">${up ? `${Math.round((up.pct || 0) * 100)}%` : html`<${Icon.hourglass} size=${10} />`}</span>`;
      else if (sub) badge = html`<span class="sq-badge"><${Icon.play} size=${10} /></span>`;
      const who = claims.map((c) => teamInfo(game, c.team).name).join(', ');
      return html`<button key=${i} class=${cls} style=${team ? `--tc:${team.color};--ti:${team.ink}` : ''} onClick=${() => onTap?.(i)}
        aria-label=${`${text}${d.pointsMode ? `, ${base} point${base === 1 ? '' : 's'}` : ''}${isBounty ? ', bounty: double points' : ''}${who ? `, done by ${who}` : ', open'}`}>
        ${d.pointsMode && html`<span class=${`sq-pts ${isBounty ? 'x2' : ''}`}>${isBounty ? `💰${base * BOUNTY_MULT}` : base}</span>`}
        <span class="sq-txt">${text}</span>
        ${d.rush && claims.length > 0 && html`<span class="sq-dots">${claims.map((c) => html`<i class=${c.first ? 'first' : ''} style=${`--dc:${teamInfo(game, c.team).color}`}></i>`)}</span>`}
        ${badge}
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
    const reasonHead = { condition: `${t?.name} hit the goal!`, clinch: `${t?.name} clinched it!`, time: 'Time’s up!', full: 'Board’s done!' };
    const headline = reasonHead[game.pending_reason] || 'Review time!';
    const sub =
      game.pending_reason === 'condition' ? '' : game.pending_reason === 'clinch' ? ' Nobody can catch them.' : t ? ` ${t.name} leads.` : ' It’s a tie so far.';
    let status;
    if (left > 0) status = html`<b class="mono">${clock(left)}</b> to contest`;
    else if (openCount) status = `Waiting on ${openCount} contest${openCount === 1 ? '' : 's'}…`;
    else if (waitingUpload) status = 'Waiting for their clips to finish uploading…';
    else status = 'Finalizing…';
    out.push(html`<div class="banner review" style=${t ? `--tc:${t.color};--ti:${t.ink}` : ''}>
      <div class="grow">
        <b>${headline}</b>${sub}
        <p>${me.team === pw ? 'Hold tight — other teams can still contest your clips.' : 'Game paused. Check their clips and contest anything sketchy.'}</p>
        <p class="banner-status">${status}</p>
      </div>
      ${pw >= 0 && html`<button class="btn small light" onClick=${() => onReview(pw)}>Review</button>`}
    </div>`);
  }

  const bc = d.bounty?.current;
  if (bc && game.status === 'active' && !d.paused) {
    const text = game.board?.[bc.square] ?? '';
    const base = pointsFor(d.settings, text);
    const mineDone = d.rush && (d.claimsBySquare.get(bc.square) || []).some((c) => c.team === me.team);
    out.push(html`<button class="banner bounty" onClick=${() => onOpenSquare(bc.square)}>
      <span class="bounty-ico" aria-hidden="true">💰</span>
      <div class="grow"><b>Bounty: “${short(text, 44)}”</b>
        <p>${mineDone ? 'Your team already did this one' : `Worth ${base * BOUNTY_MULT} instead of ${base}`} · ${clock(bc.endAt - now)} left</p></div>
      <${Icon.chevR} size=${18} />
    </button>`);
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
        <div class="grow"><b>Vote: is ${t.name}’s “${challenge}” legit?</b><p>Tap to watch the clip and vote</p></div>
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
  const { game } = data;
  const text = game.board?.[square] ?? '';
  const claims = d.claimsBySquare.get(square) || [];
  const [rec, setRec] = useState(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const mine = claims.find((c) => c.team === me.team);
  const taken = d.rush ? !!mine : claims.length > 0;
  let blocker = null;
  if (!active) blocker = 'The game is over.';
  else if (d.paused) blocker = 'Game is paused for review — hang tight.';
  else if (d.timeUp) blocker = 'Time’s up!';
  else if (!hasTeam) blocker = 'Pick a team first.';

  const base = pointsFor(d.settings, text);
  const isBounty = d.bounty?.current?.square === square;
  const worth = base * (d.rush && claims.length === 0 ? 2 : 1) * (isBounty ? BOUNTY_MULT : 1);

  async function lockIn() {
    setBusy(true);
    try {
      const r = await claimSquare(data, me, square, rec);
      if (r.conflict) {
        toast(d.rush ? 'A teammate already finished this one.' : 'Too slow — another team locked it first 😬', { kind: 'bad', ms: 5000 });
      } else {
        toast(d.pointsMode ? `Locked in for ${worth} pt${worth === 1 ? '' : 's'}! Uploading your clip…` : 'Locked in! Uploading your clip…', { color: myTeam.color });
        vibrate([30, 40, 30]);
      }
      setRec(null);
      refresh();
      onClose();
    } catch (e) {
      toast(`Couldn’t lock it in (${e.message || 'network'}). Check your signal and try again — your clip is still here.`, { kind: 'bad', ms: 6000 });
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

  let status;
  if (d.rush) status = claims.length ? `${claims.length}/${d.settings.teamCount} teams done` : 'nobody yet';
  else status = claims.length ? 'locked' : 'open';
  const ruleHint = d.rush
    ? claims.length === 0
      ? 'First team to finish it earns double. Every team can do it once.'
      : `Already done by ${claims.length} team${claims.length === 1 ? '' : 's'} — you can still score it.`
    : 'First team to lock it in owns it.';

  const claimUI = rec
    ? html`<div class="stack">
        <video class="video" src=${previewUrl} controls playsinline autoplay muted></video>
        <p class="muted small">Check your clip. Once you lock it in, it’s posted for everyone.</p>
        ${blocker && html`<p class="note bad">${blocker}</p>`}
        <div class="row">
          <button class="btn ghost" onClick=${() => setRec(null)} disabled=${busy}>Retake</button>
          <button class="btn big grow team-btn" style=${myTeam ? `--tc:${myTeam.color};--ti:${myTeam.ink}` : ''}
            onClick=${lockIn} disabled=${busy || !!blocker}>
            <${Icon.lock} size=${18} /> ${busy ? 'Locking…' : d.pointsMode ? `Lock it in · ${worth} pt${worth === 1 ? '' : 's'}` : 'Lock it in'}
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
        <p class="muted small center">${ruleHint} Clips can be up to 60 seconds.</p>
      </div>`;

  return html`<${Sheet} open onClose=${() => !busy && onClose()} title="">
    <p class="eyebrow sq-eyebrow">Square ${square + 1} · ${status}
      ${d.pointsMode && html`<span class="worth"><${PointChip} v=${base} small /> ${base === 1 ? 'point' : 'points'}</span>`}</p>
    <h2 class="challenge">${text}</h2>
    ${isBounty && html`<p class="note bounty">💰 Bounty — worth double for the next ${clock(d.bounty.current.endAt - now)}.</p>`}
    ${!taken && html`${d.pointsMode && !rec && !blocker && html`<p class="worth-now">Worth <b>${worth}</b> pt${worth === 1 ? '' : 's'} right now${d.rush && claims.length === 0 ? ' (first team bonus)' : ''}</p>`}${claimUI}`}
    ${rec && taken && html`<p class="note bad">${d.rush ? 'A teammate finished this while you were filming — no need to post yours.' : `${teamInfo(game, claims[0].team).name} locked this while you were filming 😬`}</p>`}
    ${d.rush && claims.length > 0 && html`<h4 class="eyebrow claims-label">Done by</h4>`}
    ${claims.map((c) => html`<${ClaimBlock} key=${c.sub.id} claim=${c} data=${data} d=${d} me=${me} now=${now} refresh=${refresh} />`)}
    ${picker}
  </${Sheet}>`;
}

function ClaimBlock({ claim, data, d, me, now, refresh }) {
  const { game, players, contests } = data;
  const sub = claim.sub;
  const [contesting, setContesting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const team = teamInfo(game, sub.team);
  const player = players.find((p) => p.id === sub.player_id);
  const contest = contests.find((c) => c.submission_id === sub.id);
  const up = !sub.video_path ? uploader?.status(sub.id) : null;
  const hasTeam = me.team != null && me.team < d.settings.teamCount;
  const canContest = game.status === 'active' && hasTeam && me.team !== sub.team && !contest;
  const tags = [];
  if (d.pointsMode) {
    tags.push(`+${claim.value} pt${claim.value === 1 ? '' : 's'}`);
    if (d.rush && claim.first) tags.push('⚡ first');
    if (claim.bounty) tags.push('💰 bounty');
  }

  async function submitContest() {
    setBusy(true);
    try {
      const r = await openContest(data, me, sub, reason);
      if (r.conflict) toast('That clip was already contested once — it can’t be contested again.', { kind: 'bad' });
      else toast('Contest opened ⚖️ Other players are voting.');
      setContesting(false);
      refresh();
    } catch (e) {
      toast(e.message || 'Could not open contest', { kind: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="claim-block">
    <div class="row wrap">
      <div class="claim-head" style=${`--tc:${team.color};--ti:${team.ink}`}>
        <${Icon.lock} size=${14} /> ${team.name}${player ? ` · ${player.name}` : ''} · ${ago(sub.created_at, now)}
      </div>
      ${tags.length > 0 && html`<span class="claim-tags">${tags.join(' · ')}</span>`}
    </div>
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
    html`<button class="btn ghost full" onClick=${() => setContesting(true)}><${Icon.scale} size=${18} /> Contest ${team.name}’s clip</button>`}
    ${contesting &&
    html`<div class="stack contest-form">
      <label class="label" for=${`rsn-${sub.id}`}>What’s wrong with it? (optional)</label>
      <input id=${`rsn-${sub.id}`} class="input" maxlength="120" placeholder="e.g. That’s not a stranger, that’s his roommate" value=${reason}
        onInput=${(e) => setReason(e.currentTarget.value)} />
      <p class="muted small">Players on other teams vote. Majority decides; ties keep the claim. Each clip can only be contested once.</p>
      <div class="row">
        <button class="btn ghost" onClick=${() => setContesting(false)}>Cancel</button>
        <button class="btn grow" onClick=${submitContest} disabled=${busy}>${busy ? 'Opening…' : 'Open contest'}</button>
      </div>
    </div>`}
  </div>`;
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
    if (!confirm(outcome === 'rejected' ? 'Throw this claim out?' : 'Keep this claim?')) return;
    await hostRule(contest, outcome);
    refresh();
  }

  const pct = (n) => (tally.eligible ? (n / tally.eligible) * 100 : 0);
  return html`<div class="contest-box">
    <p><b><${Icon.scale} size=${16} /> Contested${openerTeam ? ` by ${openerTeam.name}` : ''}${opener ? ` (${opener.name})` : ''}</b></p>
    ${contest.reason && html`<p class="quote">“${contest.reason}”</p>`}
    <div class="tally" aria-label="Vote tally">
      <div class="tally-bar"><span class="t-rej" style=${`width:${pct(tally.reject)}%`}></span><span class="t-leg" style=${`width:${pct(tally.legit)}%`}></span></div>
      <p class="small"><b class="bad-text">${tally.reject} not legit</b> · <b class="ok-text">${tally.legit} legit</b> · ${tally.voted}/${tally.eligible} voted · decides in ${clock(left)}</p>
    </div>
    ${eligible
      ? html`<div class="row">
          <button class=${`btn grow vote ${mine?.legit === true ? 'on ok' : ''}`} disabled=${busy} onClick=${() => vote(true)}><${Icon.check} size=${18} /> Legit</button>
          <button class=${`btn grow vote ${mine?.legit === false ? 'on bad' : ''}`} disabled=${busy} onClick=${() => vote(false)}><${Icon.x} size=${18} /> Not legit</button>
        </div>`
      : html`<p class="muted small">${me.team === sub.team ? 'Your team can’t vote on its own clip.' : 'Only players on a team can vote.'}</p>`}
    ${isHost &&
    html`<div class="row host-rule"><span class="muted small grow">Host override</span>
      <button class="btn small ghost" onClick=${() => rule('upheld')}>Keep it</button>
      <button class="btn small ghost" onClick=${() => rule('rejected')}>Throw out</button>
    </div>`}
  </div>`;
}

// ---------------- feed ----------------
function Feed({ data, d, me, list, openViewer, now }) {
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
  events.sort((a, b) => b.at - a.at);

  if (events.length <= 1) return html`<section class="feed"><${Empty}>No clips yet. Go claim something!</${Empty}></section>`;

  return html`<section class="feed">
    ${events.map((e) => {
      if (e.type === 'start') return html`<div key=${e.k} class="feed-sys">🏁 Game on · ${ago(e.at, now)}</div>`;
      const t = teamInfo(game, e.s.team);
      const ch = game.board?.[e.s.square] ?? '';
      if (e.type === 'claim') {
        const p = players.find((x) => x.id === e.s.player_id);
        const c = contests.find((x) => x.submission_id === e.s.id);
        const badge = e.s.status === 'rejected' ? '❌' : c?.status === 'open' ? '⚖️' : c?.status === 'upheld' ? '✅' : null;
        return html`<div key=${e.k} class=${`feed-item ${e.s.status === 'rejected' ? 'struck' : ''}`}>
          <${Thumb} sub=${e.s} team=${t} badge=${badge} onClick=${() => openViewer(list, list.findIndex((x) => x.id === e.s.id))} />
          <div class="grow">
            <p class="feed-who"><${TeamDot} team=${t} /> <b>${t.name}</b>${p ? ` · ${p.name}` : ''}</p>
            <p class="feed-what">${ch}</p>
            <p class="muted small">${(() => {
              const cl = d.claimBySub.get(e.s.id);
              return d.pointsMode && cl ? html`<b class="pts-text">+${cl.value}</b>${cl.first && d.rush ? ' ⚡' : ''}${cl.bounty ? ' 💰' : ''} · ` : '';
            })()}${ago(e.at, now)}${e.s.status === 'rejected' ? ' · thrown out' : ''}${!e.s.video_path ? ' · uploading…' : ''}</p>
          </div>
        </div>`;
      }
      const opener = players.find((x) => x.id === e.c.opened_by);
      const ot = opener?.team != null ? teamInfo(game, opener.team) : null;
      if (e.type === 'contest')
        return html`<div key=${e.k} class="feed-sys warn">⚖️ ${ot ? ot.name : 'Someone'} contested ${t.name}’s “${short(ch, 40)}” · ${ago(e.at, now)}</div>`;
      return html`<div key=${e.k} class=${`feed-sys ${e.c.status === 'rejected' ? 'bad' : 'ok'}`}>
        ${e.c.status === 'rejected' ? `❌ Thrown out — ${t.name}’s “${short(ch, 40)}”${d.rush ? '' : ' is open again'}` : `✅ Ruled legit — ${t.name} keeps “${short(ch, 40)}”`}
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
        <div class="team-row-head"><b>${t.name}</b><span>${d.pointsMode ? `${st.points} pts · ` : ''}${st.squares} square${st.squares === 1 ? '' : 's'} · ${st.lines} bingo${st.lines === 1 ? '' : 's'}</span></div>
        <ul class="members">
          ${members.map((p) => {
            const n = data.submissions.filter((s) => s.player_id === p.id && s.status === 'active').length;
            return html`<li class=${p.id === me.id ? 'me' : ''}><span class="grow">${p.name}${p.client_id === game.host_id ? ' ★' : ''}</span><span class="muted">${n} clip${n === 1 ? '' : 's'}</span></li>`;
          })}
          ${members.length === 0 && html`<li class="muted">Nobody</li>`}
        </ul>
      </div>`;
    })}
    ${players.some((p) => p.team == null) &&
    html`<p class="muted small">Spectating: ${players.filter((p) => p.team == null).map((p) => p.name).join(', ')}</p>`}
  </section>`;
}
