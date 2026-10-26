// Pure game rules. No DOM, no network — unit tested in test/logic.test.mjs.

export const TEAM_PALETTE = [
  { name: 'Red', color: '#e5484d', ink: '#ffffff' },
  { name: 'Blue', color: '#3e63dd', ink: '#ffffff' },
  { name: 'Green', color: '#2b9a5f', ink: '#ffffff' },
  { name: 'Gold', color: '#f0a51f', ink: '#241700' },
  { name: 'Purple', color: '#8e4ec6', ink: '#ffffff' },
  { name: 'Orange', color: '#f2661a', ink: '#ffffff' },
  { name: 'Pink', color: '#d6409f', ink: '#ffffff' },
  { name: 'Teal', color: '#0e9888', ink: '#ffffff' },
];
export const MAX_TEAMS = TEAM_PALETTE.length;
export const CONTEST_SECONDS = 120; // a contest auto-resolves on the votes cast after this
export const UPLOAD_GRACE_SECONDS = 120; // how long a win waits for the winner's clips to finish uploading
export const MAX_CHALLENGE_LEN = 120;

export const MODES = ['classic', 'points', 'rush'];
export const MODE_INFO = {
  classic: { label: 'Bingo', blurb: 'Classic lockout. First team to the goal wins.' },
  points: { label: 'Points', blurb: 'Lockout, but squares are worth points. Most points wins.' },
  rush: { label: 'Rush', blurb: 'No lockout — every team can do every square. First team to finish a square earns double.' },
};
export const POINT_MAX = 5;
export const BONUS_OPTIONS = [0, 2, 3, 5];
export const BOUNTY_EVERY = [10, 15, 20, 30];
export const BOUNTY_MULT = 2;

let MINUTE_MS = 60000;
/** Test hook: shrink "minutes" so bounties can be exercised quickly. */
export function setMinuteMs(ms) {
  MINUTE_MS = ms;
}

export const DEFAULT_SETTINGS = {
  size: 5,
  teamCount: 2,
  mode: 'classic', // 'classic' | 'points' | 'rush'
  win: { type: 'lines', n: 1 }, // classic only: 'lines' | 'squares' | 'majority'
  target: 0, // points modes: first to N points (0 = no target)
  bingoBonus: 0, // points modes: extra points per completed line
  bounty: { on: false, every: 15 },
  pts: {}, // challenge text -> point value (1 is the default and isn't stored)
  timeLimitMin: 0, // 0 = no limit
  reviewSecs: 30,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const int = (v, d) => (Number.isFinite(+v) ? Math.round(+v) : d);

export function normalizeSettings(s = {}) {
  const size = clamp(int(s.size, 5), 3, 7);
  const total = size * size;
  const teamCount = clamp(int(s.teamCount, 2), 2, MAX_TEAMS);
  const type = ['lines', 'squares', 'majority'].includes(s.win?.type) ? s.win.type : 'lines';
  const maxN = type === 'lines' ? 2 * size + 2 : total;
  const n = clamp(int(s.win?.n, type === 'squares' ? Math.min(10, total) : 1), 1, maxN);
  const every = int(s.bounty?.every, 15);
  return {
    size,
    teamCount,
    mode: MODES.includes(s.mode) ? s.mode : 'classic',
    win: { type, n },
    target: clamp(int(s.target, 0), 0, 999),
    bingoBonus: clamp(int(s.bingoBonus, 0), 0, 20),
    bounty: { on: !!s.bounty?.on, every: BOUNTY_EVERY.includes(every) ? every : 15 },
    pts: normPts(s.pts),
    timeLimitMin: clamp(int(s.timeLimitMin, 0), 0, 600),
    reviewSecs: clamp(int(s.reviewSecs, 30), 0, 300),
  };
}

function normPts(p) {
  const out = {};
  if (p && typeof p === 'object') {
    for (const [k, v] of Object.entries(p)) {
      const n = int(v, 1);
      if (k && n >= 2 && n <= POINT_MAX) out[k] = n;
    }
  }
  return out;
}

export const isPointsMode = (s) => s.mode === 'points' || s.mode === 'rush';
export const pointsFor = (settings, text) => settings.pts?.[text] || 1;

export function teamInfo(game, i) {
  const base = TEAM_PALETTE[i] || TEAM_PALETTE[0];
  const custom = (game?.team_names || [])[i];
  return { ...base, index: i, name: (custom && String(custom).trim()) || base.name };
}

/** Parse pasted text into a clean challenge list (strips bullets/numbering, dedupes). */
export function parseChallenges(text) {
  const seen = new Set();
  const out = [];
  for (let raw of String(text || '').split(/\r?\n/)) {
    let line = raw
      .replace(/^\s*(?:[-*•·◦▪]|\d+[.)]|\[\s?\]|☐)\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    if (line.length > MAX_CHALLENGE_LEN) line = line.slice(0, MAX_CHALLENGE_LEN).trim();
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeBoard(challenges, size, rng = Math.random) {
  const need = size * size;
  if (challenges.length < need) throw new Error(`Need ${need} challenges, have ${challenges.length}`);
  return shuffle(challenges, rng).slice(0, need);
}

const linesCache = new Map();
/** All winning lines (rows, columns, two diagonals) as arrays of square indices. */
export function boardLines(size) {
  if (linesCache.has(size)) return linesCache.get(size);
  const L = [];
  for (let r = 0; r < size; r++) L.push([...Array(size)].map((_, c) => r * size + c));
  for (let c = 0; c < size; c++) L.push([...Array(size)].map((_, r) => r * size + c));
  L.push([...Array(size)].map((_, i) => i * size + i));
  L.push([...Array(size)].map((_, i) => i * size + (size - 1 - i)));
  linesCache.set(size, L);
  return L;
}

export function winTarget(settings) {
  const total = settings.size * settings.size;
  if (settings.win.type === 'majority') return { type: 'squares', n: Math.floor(total / 2) + 1 };
  return { type: settings.win.type, n: settings.win.n };
}

export function describeWin(settings) {
  const s = normalizeSettings(settings);
  if (isPointsMode(s)) return s.target > 0 ? `First to ${s.target} points` : 'Most points wins';
  const t = winTarget(s);
  if (s.win.type === 'majority') return `First to ${t.n} squares (majority)`;
  if (t.type === 'squares') return `First to ${t.n} square${t.n === 1 ? '' : 's'}`;
  return t.n === 1 ? 'First bingo wins' : `First to ${t.n} bingos`;
}

/** Robust timestamp parse (Supabase returns microseconds, which some Safari versions dislike). */
export function ts(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/(\.\d{3})\d+/, '$1').replace(' ', 'T');
  return Date.parse(s);
}

const byTime = (a, b) => ts(a.created_at) - ts(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function countLines(set, size) {
  let n = 0;
  for (const line of boardLines(size)) if (line.every((q) => set.has(q))) n++;
  return n;
}

function meets(set, target, size) {
  if (target.type === 'squares') return set.size >= target.n;
  return countLines(set, size) >= target.n;
}

/** Replay live claims in order; the first team to satisfy the win condition. */
export function findConditionWinner(active, settings) {
  const target = winTarget(settings);
  const owned = new Map();
  for (const s of [...active].sort(byTime)) {
    if (s.team >= settings.teamCount) continue;
    if (!owned.has(s.team)) owned.set(s.team, new Set());
    const set = owned.get(s.team);
    set.add(s.square);
    if (meets(set, target, settings.size)) return { team: s.team, at: s.created_at, submissionId: s.id };
  }
  return null;
}

/** Per-team squares, completed lines, and time of latest claim. */
export function teamStats(settings, active) {
  const stats = [...Array(settings.teamCount)].map((_, team) => ({ team, squares: 0, lines: 0, lineList: [], lastAt: 0 }));
  const owner = new Map();
  for (const s of active) {
    const st = stats[s.team];
    if (!st) continue;
    st.squares++;
    st.lastAt = Math.max(st.lastAt, ts(s.created_at) || 0);
    owner.set(s.square, s.team);
  }
  for (const line of boardLines(settings.size)) {
    const t = owner.get(line[0]);
    if (t === undefined) continue;
    if (line.every((q) => owner.get(q) === t)) {
      stats[t].lines++;
      stats[t].lineList.push(line);
    }
  }
  return stats;
}

/** Team with most squares (then lines, then whoever got there first). -1 = no clear leader. */
export function leader(stats) {
  const sorted = [...stats].sort((a, b) => b.squares - a.squares || b.lines - a.lines || a.lastAt - b.lastAt);
  const [a, b] = sorted;
  if (!a || a.squares === 0) return -1;
  if (b && b.squares === a.squares && b.lines === a.lines && b.lastAt === a.lastAt) return -1;
  return a.team;
}

/** Players who may vote on a contest: everyone on a team other than the claiming team. */
export function eligibleVoters(players, sub) {
  return players.filter((p) => p.team !== null && p.team !== undefined && p.team !== sub.team);
}

export function contestTally(contest, sub, players, votes) {
  const eligible = eligibleVoters(players, sub);
  const ids = new Set(eligible.map((p) => p.id));
  const vs = votes.filter((v) => v.contest_id === contest.id && ids.has(v.player_id));
  const reject = vs.filter((v) => !v.legit).length;
  return { eligible: eligible.length, reject, legit: vs.length - reject, voted: vs.length, eligibleIds: ids };
}

/** 'rejected' | 'upheld' | null (still open). Ties go to the claiming team. */
export function contestOutcome(contest, sub, players, votes, now) {
  const { eligible: E, reject, legit } = contestTally(contest, sub, players, votes);
  if (E === 0) return 'upheld';
  if (reject * 2 > E) return 'rejected';
  if (legit * 2 >= E) return 'upheld';
  if (now >= ts(contest.created_at) + CONTEST_SECONDS * 1000) return reject > legit ? 'rejected' : 'upheld';
  return null;
}

/**
 * Decide which state transitions are due. Every client runs this; writes are conditional
 * so duplicates are harmless. Returns a list of actions for the backend to apply.
 */
export function decide({ game, players, submissions, contests, votes }, now) {
  const actions = [];
  if (!game || game.status !== 'active' || !game.board) return actions;
  const subById = new Map(submissions.map((s) => [s.id, s]));

  for (const c of contests) {
    const s = subById.get(c.submission_id);
    if (!s) continue;
    if (c.status === 'rejected' && s.status === 'active') actions.push({ kind: 'rejectSubmission', submissionId: s.id });
    if (c.status === 'open') {
      const outcome = s.status === 'rejected' ? 'rejected' : contestOutcome(c, s, players, votes, now);
      if (outcome) actions.push({ kind: 'resolveContest', contestId: c.id, submissionId: s.id, outcome });
    }
  }
  if (actions.length) return actions; // let contest results land before judging the win

  const settings = normalizeSettings(game.settings);
  const total = settings.size * settings.size;
  const active = submissions.filter((s) => s.status === 'active');
  const timeUp = !!game.ends_at && now >= ts(game.ends_at);

  let candidate = null;
  let reason = null;
  if (!isPointsMode(settings)) {
    const condWinner = findConditionWinner(active, settings);
    const full = new Set(active.map((s) => s.square)).size >= total;
    if (condWinner) {
      candidate = condWinner.team;
      reason = 'condition';
    } else if (timeUp || full) {
      candidate = leader(teamStats(settings, active));
      reason = timeUp ? 'time' : 'full';
    }
  } else {
    const sc = scoreGame(game, submissions, contests, now);
    const hit = firstToTarget(sc);
    if (hit) {
      candidate = hit.team;
      reason = 'condition';
    } else if (timeUp) {
      candidate = leaderByPoints(sc.teams);
      reason = 'time';
    } else {
      const cl = clinched(sc, game);
      if (cl != null) {
        candidate = cl;
        reason = 'clinch';
      } else if (exhausted(sc)) {
        candidate = leaderByPoints(sc.teams);
        reason = 'full';
      }
    }
  }

  const pending = game.pending_winner ?? null;
  const finalizeAt = now + settings.reviewSecs * 1000;
  if (candidate === null) {
    if (pending !== null) actions.push({ kind: 'clearPending', from: pending });
    return actions;
  }
  if (pending === null) {
    actions.push({ kind: 'setPending', team: candidate, reason, finalizeAt });
    return actions;
  }
  if (pending !== candidate) {
    actions.push({ kind: 'changePending', from: pending, team: candidate, reason, finalizeAt });
    return actions;
  }
  if (game.pending_reason !== reason) {
    // Same team, different reason (e.g. clinched, then also hit the target): keep the countdown.
    actions.push({ kind: 'changePending', from: pending, team: candidate, reason, finalizeAt: ts(game.finalize_at) || finalizeAt });
    return actions;
  }

  const fin = ts(game.finalize_at);
  if (!(now >= fin)) return actions;
  if (contests.some((c) => c.status === 'open')) return actions;
  if (candidate >= 0) {
    const waiting = active.some((s) => s.team === candidate && !s.video_path);
    if (waiting && now < fin + UPLOAD_GRACE_SECONDS * 1000) return actions;
  }
  actions.push({ kind: 'finish', team: candidate, reason });
  return actions;
}

/** Everything the UI needs, derived from raw rows. */
export function derive(state, now = Date.now()) {
  const { game, players = [], submissions = [], contests = [] } = state;
  const sc = scoreGame(game, submissions, contests, now);
  const settings = sc.settings;
  const active = submissions.filter((s) => s.status === 'active');
  const owner = new Map();
  for (const [q, cs] of sc.bySquare) owner.set(q, cs[0].sub);
  const claimBySub = new Map(sc.claims.map((c) => [c.sub.id, c]));
  const contestBySub = new Map(contests.map((c) => [c.submission_id, c]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  const timeUp = !!game?.ends_at && now >= ts(game.ends_at);
  const paused = game?.status === 'active' && game?.pending_winner != null;
  const target = isPointsMode(settings) ? { type: 'points', n: settings.target } : winTarget(settings);
  return {
    settings,
    active,
    owner,
    claimsBySquare: sc.bySquare,
    claimBySub,
    stats: sc.teams,
    bounty: sc.bounty,
    pointsMode: sc.pointsMode,
    rush: sc.rush,
    contestBySub,
    playerById,
    timeUp,
    paused,
    target,
  };
}

/** Leader for "end now" / recap, in whatever currency the mode uses. -1 = tie. */
export function currentLeader(game, submissions, contests, now = Date.now()) {
  const sc = scoreGame(game, submissions, contests, now);
  if (sc.pointsMode) return leaderByPoints(sc.teams);
  return leader(teamStats(sc.settings, submissions.filter((s) => s.status === 'active')));
}

/** Put unassigned players on the smallest teams. Returns [{id, team}] changes. */
export function fillTeams(players, teamCount) {
  const counts = [...Array(teamCount)].fill(0);
  for (const p of players) if (p.team != null && p.team < teamCount) counts[p.team]++;
  const changes = [];
  for (const p of players) {
    if (p.team != null && p.team < teamCount) continue;
    let best = 0;
    for (let t = 1; t < teamCount; t++) if (counts[t] < counts[best]) best = t;
    counts[best]++;
    changes.push({ id: p.id, team: best });
  }
  return changes;
}

export function randomTeams(players, teamCount, rng = Math.random) {
  return shuffle(players, rng).map((p, i) => ({ id: p.id, team: i % teamCount }));
}

/** Lines to highlight for the winner on the final board. */
export function winningLines(settings, active, team) {
  if (team == null || team < 0) return [];
  return teamStats(settings, active)[team]?.lineList || [];
}

// ======================= points, Rush, bounties =======================

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const linesThroughCache = new Map();
function linesThrough(size) {
  if (linesThroughCache.has(size)) return linesThroughCache.get(size);
  const m = [...Array(size * size)].map(() => []);
  for (const line of boardLines(size)) for (const q of line) m[q].push(line);
  linesThroughCache.set(size, m);
  return m;
}

/** When (if ever) a claim was thrown out — so history can be replayed as it looked at any moment. */
function rejectedAt(sub, contestBySub) {
  if (sub.status !== 'rejected') return Infinity;
  const c = contestBySub.get(sub.id);
  const t = c && c.status === 'rejected' ? ts(c.resolved_at) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Bounties run on a fixed clock: every N minutes after the start, a pseudo-random square that was
 * open at that moment becomes worth 2× until someone claims it or the next bounty starts.
 * Every phone computes the same schedule from the game id, so no server job is needed.
 */
export function computeBounties(game, settings, subs, contestBySub, now) {
  const empty = { list: [], current: null, nextAt: null, every: 0 };
  if (!game?.started_at || !game.board || !isPointsMode(settings) || !settings.bounty.on) return empty;
  const F = settings.bounty.every * MINUTE_MS;
  const start = ts(game.started_at);
  const endsAt = game.ends_at ? ts(game.ends_at) : Infinity;
  const limit = game.finished_at ? Math.min(now, ts(game.finished_at)) : now;
  const total = game.board.length;
  const rush = settings.mode === 'rush';
  const list = [];
  const maxK = Math.min(500, Math.floor((limit - start) / F));
  for (let k = 1; k <= maxK; k++) {
    const startAt = start + k * F;
    if (startAt >= endsAt) break;
    const takenBy = new Map();
    for (const s of subs) {
      if (ts(s.created_at) < startAt && rejectedAt(s, contestBySub) > startAt) {
        if (!takenBy.has(s.square)) takenBy.set(s.square, new Set());
        takenBy.get(s.square).add(s.team);
      }
    }
    const eligible = [];
    for (let q = 0; q < total; q++) {
      const n = takenBy.get(q)?.size || 0;
      if (rush ? n < settings.teamCount : n === 0) eligible.push(q);
    }
    const prev = list[list.length - 1]?.square;
    const pool = eligible.length > 1 ? eligible.filter((q) => q !== prev) : eligible;
    if (!pool.length) continue;
    list.push({
      k,
      square: pool[hash32(`${game.id}:${k}`) % pool.length],
      startAt,
      endAt: Math.min(start + (k + 1) * F, endsAt),
      collectedBy: null,
      collectedTeam: null,
    });
  }
  const next = start + (maxK + 1) * F;
  return { list, current: null, nextAt: !game.finished_at && next < endsAt ? next : null, every: F };
}

/**
 * Score everything. Claims are replayed in order: in lockout modes the first live claim owns a
 * square; in Rush each team can claim each square once and the first team earns double.
 */
export function scoreGame(game, submissions = [], contests = [], now = Date.now()) {
  const settings = normalizeSettings(game?.settings);
  const board = game?.board || [];
  const pointsMode = isPointsMode(settings);
  const rush = settings.mode === 'rush';
  const contestBySub = new Map(contests.map((c) => [c.submission_id, c]));
  const subs = submissions.filter((s) => s.team != null && s.team >= 0 && s.team < settings.teamCount && s.square < board.length);
  const bounty = computeBounties(game, settings, subs, contestBySub, now);
  const active = subs.filter((s) => s.status === 'active').sort(byTime);
  const teams = [...Array(settings.teamCount)].map((_, team) => ({ team, points: 0, squares: 0, lines: 0, lineList: [], lastAt: 0, set: new Set() }));
  const claims = [];
  const bySquare = new Map();

  for (const s of active) {
    const T = teams[s.team];
    if (T.set.has(s.square)) continue;
    const prior = bySquare.get(s.square) || [];
    if (!rush && prior.length) continue;
    const at = ts(s.created_at);
    const first = prior.length === 0;
    let b = null;
    for (const x of bounty.list) {
      if (x.square === s.square && x.collectedBy == null && at >= x.startAt && at < x.endAt) {
        b = x;
        break;
      }
    }
    if (b) {
      b.collectedBy = s.id;
      b.collectedTeam = s.team;
    }
    const base = pointsFor(settings, board[s.square]);
    const value = pointsMode ? base * (rush && first ? 2 : 1) * (b ? BOUNTY_MULT : 1) : 1;
    const claim = { sub: s, square: s.square, team: s.team, base, first, bounty: !!b, value, at };
    claims.push(claim);
    prior.push(claim);
    bySquare.set(s.square, prior);
    T.set.add(s.square);
    T.squares++;
    T.points += value;
    T.lastAt = Math.max(T.lastAt, at || 0);
  }

  const bonus = pointsMode ? settings.bingoBonus : 0;
  for (const line of boardLines(settings.size)) {
    for (const T of teams) {
      if (line.every((q) => T.set.has(q))) {
        T.lines++;
        T.lineList.push(line);
        T.points += bonus;
      }
    }
  }

  const live = bounty.list[bounty.list.length - 1];
  if (live && live.collectedBy == null && now >= live.startAt && now < live.endAt && !game?.finished_at) bounty.current = live;
  return { settings, board, pointsMode, rush, claims, bySquare, teams, bounty };
}

/** Points leader: most points, then most squares, then whoever got there first. -1 = dead tie / nobody. */
export function leaderByPoints(teams) {
  const sorted = [...teams].sort((a, b) => b.points - a.points || b.squares - a.squares || a.lastAt - b.lastAt);
  const [a, b] = sorted;
  if (!a || (a.points === 0 && a.squares === 0)) return -1;
  if (b && b.points === a.points && b.squares === a.squares && b.lastAt === a.lastAt) return -1;
  return a.team;
}

/** First team to reach the points target, replaying claims in order. */
export function firstToTarget(sc) {
  const { settings } = sc;
  if (!(settings.target > 0)) return null;
  const through = linesThrough(settings.size);
  const bonus = settings.bingoBonus;
  const pts = sc.teams.map(() => 0);
  const sets = sc.teams.map(() => new Set());
  for (const c of sc.claims) {
    pts[c.team] += c.value;
    sets[c.team].add(c.square);
    if (bonus) for (const line of through[c.square]) if (line.every((q) => sets[c.team].has(q))) pts[c.team] += bonus;
    if (pts[c.team] >= settings.target) return { team: c.team, at: c.at };
  }
  return null;
}

/** Most points a team could still add (assumes every remaining bounty lands on its best squares). */
export function maxGain(sc, team, game) {
  const { settings, board, rush } = sc;
  const T = sc.teams[team];
  const total = settings.size * settings.size;
  const values = [];
  for (let q = 0; q < total; q++) {
    if (T.set.has(q)) continue;
    const taken = sc.bySquare.get(q)?.length || 0;
    if (!rush && taken) continue;
    values.push(pointsFor(settings, board[q]) * (rush && taken === 0 ? 2 : 1));
  }
  let gain = values.reduce((a, b) => a + b, 0);
  if (settings.bounty.on && values.length) {
    let k = Infinity;
    if (game?.ends_at) {
      const end = ts(game.ends_at);
      const nextAt = sc.bounty.nextAt;
      const future = nextAt != null && nextAt < end ? Math.floor((end - nextAt) / sc.bounty.every) + 1 : 0;
      k = future + (sc.bounty.current ? 1 : 0);
    }
    values.sort((a, b) => b - a);
    gain += values.slice(0, Math.min(k, values.length)).reduce((a, b) => a + b, 0) * (BOUNTY_MULT - 1);
  }
  if (settings.bingoBonus) {
    for (const line of boardLines(settings.size)) {
      if (line.every((q) => T.set.has(q))) continue;
      if (line.every((q) => T.set.has(q) || rush || !(sc.bySquare.get(q)?.length))) gain += settings.bingoBonus;
    }
  }
  return gain;
}

/** Team that can no longer be caught, or null. */
export function clinched(sc, game) {
  const L = leaderByPoints(sc.teams);
  if (L < 0) return null;
  const lp = sc.teams[L].points;
  if (lp <= 0) return null;
  for (const T of sc.teams) if (T.team !== L && T.points + maxGain(sc, T.team, game) >= lp) return null;
  return L;
}

/** Nothing left that anyone could claim. */
export function exhausted(sc) {
  const total = sc.settings.size * sc.settings.size;
  if (!sc.rush) return sc.bySquare.size >= total;
  return sc.teams.every((T) => T.set.size >= total);
}
