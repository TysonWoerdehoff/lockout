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

export const DEFAULT_SETTINGS = {
  size: 5,
  teamCount: 2,
  win: { type: 'lines', n: 1 }, // 'lines' | 'squares' | 'majority'
  timeLimitMin: 0, // 0 = no limit
  reviewSecs: 30,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const int = (v, d) => (Number.isFinite(+v) ? Math.round(+v) : d);

export function normalizeSettings(s = {}) {
  const size = clamp(int(s.size, 5), 3, 5);
  const total = size * size;
  const teamCount = clamp(int(s.teamCount, 2), 2, MAX_TEAMS);
  const type = ['lines', 'squares', 'majority'].includes(s.win?.type) ? s.win.type : 'lines';
  const maxN = type === 'lines' ? 2 * size + 2 : total;
  const n = clamp(int(s.win?.n, type === 'squares' ? Math.min(10, total) : 1), 1, maxN);
  return {
    size,
    teamCount,
    win: { type, n },
    timeLimitMin: clamp(int(s.timeLimitMin, 0), 0, 600),
    reviewSecs: clamp(int(s.reviewSecs, 30), 0, 300),
  };
}

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
  const condWinner = findConditionWinner(active, settings);
  const timeUp = !!game.ends_at && now >= ts(game.ends_at);
  const full = new Set(active.map((s) => s.square)).size >= total;

  let candidate = null;
  let reason = null;
  if (condWinner) {
    candidate = condWinner.team;
    reason = 'condition';
  } else if (timeUp || full) {
    candidate = leader(teamStats(settings, active));
    reason = timeUp ? 'time' : 'full';
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
  if (pending !== candidate || game.pending_reason !== reason) {
    actions.push({ kind: 'changePending', from: pending, team: candidate, reason, finalizeAt });
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
  const { game, players = [], submissions = [], contests = [], votes = [] } = state;
  const settings = normalizeSettings(game?.settings);
  const active = submissions.filter((s) => s.status === 'active');
  const owner = new Map(active.map((s) => [s.square, s]));
  const stats = teamStats(settings, active);
  const contestBySub = new Map(contests.map((c) => [c.submission_id, c]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  const timeUp = !!game?.ends_at && now >= ts(game.ends_at);
  const paused = game?.status === 'active' && game?.pending_winner != null;
  return { settings, active, owner, stats, contestBySub, playerById, timeUp, paused, target: winTarget(settings) };
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
