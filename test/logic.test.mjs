import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';

const T0 = Date.parse('2026-10-25T20:00:00Z');
const iso = (sec) => new Date(T0 + sec * 1000).toISOString();
let idn = 0;
const sub = (square, team, sec, extra = {}) => ({ id: `s${++idn}`, square, team, created_at: iso(sec), status: 'active', video_path: 'v', ...extra });
const players = [
  { id: 'a', team: 0 }, { id: 'b', team: 0 },
  { id: 'c', team: 1 }, { id: 'd', team: 1 },
];
const baseGame = (settings, extra = {}) => ({ id: 'g', status: 'active', board: Array(settings.size ** 2).fill('x'), settings, pending_winner: null, ...extra });

test('parseChallenges strips bullets, numbering, dupes', () => {
  const out = L.parseChallenges('1. Find a bald person\n- win a race\n\n• Win a race\n  [ ] lift 10,000 lbs  \n2) serenade a stranger');
  assert.deepEqual(out, ['Find a bald person', 'win a race', 'lift 10,000 lbs', 'serenade a stranger']);
});

test('boardLines counts', () => {
  assert.equal(L.boardLines(3).length, 8);
  assert.equal(L.boardLines(5).length, 12);
  assert.deepEqual(L.boardLines(3).at(-1), [2, 4, 6]);
});

test('normalizeSettings clamps', () => {
  const s = L.normalizeSettings({ size: 9, teamCount: 1, win: { type: 'lines', n: 99 } });
  assert.equal(s.size, 7); assert.equal(s.teamCount, 2); assert.equal(s.win.n, 16);
  assert.equal(L.boardLines(7).length, 16);
  assert.equal(L.winTarget(L.normalizeSettings({ size: 7, win: { type: 'majority' } })).n, 25);
  assert.equal(L.winTarget(L.normalizeSettings({ size: 5, win: { type: 'majority' } })).n, 13);
});

test('first bingo by replay order wins, even if other team also completes later', () => {
  const settings = L.normalizeSettings({ size: 3, win: { type: 'lines', n: 1 } });
  const subs = [sub(0, 0, 1), sub(3, 1, 2), sub(1, 0, 3), sub(4, 1, 4), sub(5, 1, 5), sub(2, 0, 6)];
  // team 1 completed row 1 (3,4,5) at t=5, team 0 row 0 at t=6
  assert.equal(L.findConditionWinner(subs, settings).team, 1);
});

test('decide: set pending, then finish after review window', () => {
  const settings = { size: 3, teamCount: 2, win: { type: 'lines', n: 1 }, reviewSecs: 30 };
  const subs = [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3)];
  const now = T0 + 10_000;
  let acts = L.decide({ game: baseGame(settings), players, submissions: subs, contests: [], votes: [] }, now);
  assert.equal(acts[0].kind, 'setPending'); assert.equal(acts[0].team, 0);
  const g2 = baseGame(settings, { pending_winner: 0, pending_reason: 'condition', finalize_at: new Date(now + 30_000).toISOString() });
  assert.deepEqual(L.decide({ game: g2, players, submissions: subs, contests: [], votes: [] }, now + 5_000), []);
  acts = L.decide({ game: g2, players, submissions: subs, contests: [], votes: [] }, now + 31_000);
  assert.equal(acts[0].kind, 'finish'); assert.equal(acts[0].team, 0);
});

test('decide: open contest blocks finish; missing clip waits up to grace', () => {
  const settings = { size: 3, teamCount: 2, win: { type: 'lines', n: 1 }, reviewSecs: 10 };
  const subs = [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3, { video_path: null })];
  const fin = T0 + 60_000;
  const g = baseGame(settings, { pending_winner: 0, pending_reason: 'condition', finalize_at: new Date(fin).toISOString() });
  const contest = { id: 'c1', submission_id: subs[0].id, status: 'open', created_at: new Date(fin - 5000).toISOString() };
  assert.deepEqual(L.decide({ game: g, players, submissions: subs, contests: [contest], votes: [] }, fin + 1000), []);
  assert.deepEqual(L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, fin + 1000), []);
  assert.equal(L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, fin + 121_000)[0].kind, 'finish');
});

test('contest outcomes: majority, ties favor claimer, timeout', () => {
  const s = sub(0, 0, 1);
  const c = { id: 'c1', submission_id: s.id, status: 'open', created_at: iso(10) };
  const now = T0 + 20_000;
  // eligible = c, d (team 1)
  assert.equal(L.contestOutcome(c, s, players, [{ contest_id: 'c1', player_id: 'c', legit: false }], now), null);
  assert.equal(L.contestOutcome(c, s, players, [{ contest_id: 'c1', player_id: 'c', legit: false }, { contest_id: 'c1', player_id: 'd', legit: false }], now), 'rejected');
  assert.equal(L.contestOutcome(c, s, players, [{ contest_id: 'c1', player_id: 'c', legit: false }, { contest_id: 'c1', player_id: 'd', legit: true }], now), 'upheld');
  // votes from the claiming team don't count
  assert.equal(L.contestOutcome(c, s, players, [{ contest_id: 'c1', player_id: 'a', legit: true }, { contest_id: 'c1', player_id: 'c', legit: false }], now), null);
  // timeout with 1 reject vs 0 legit → rejected
  assert.equal(L.contestOutcome(c, s, players, [{ contest_id: 'c1', player_id: 'c', legit: false }], T0 + 10_000 + 121_000), 'rejected');
});

test('decide: rejected contest heals submission; resolve before win logic', () => {
  const settings = { size: 3, teamCount: 2, win: { type: 'lines', n: 1 }, reviewSecs: 10 };
  const subs = [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3)];
  const contest = { id: 'c1', submission_id: subs[2].id, status: 'rejected', created_at: iso(4) };
  const acts = L.decide({ game: baseGame(settings), players, submissions: subs, contests: [contest], votes: [] }, T0 + 9000);
  assert.deepEqual(acts, [{ kind: 'rejectSubmission', submissionId: subs[2].id }]);
});

test('decide: clear pending when contest removes the win', () => {
  const settings = { size: 3, teamCount: 2, win: { type: 'lines', n: 1 }, reviewSecs: 10 };
  const subs = [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3, { status: 'rejected' })];
  const g = baseGame(settings, { pending_winner: 0, pending_reason: 'condition', finalize_at: iso(20) });
  assert.deepEqual(L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, T0 + 9000), [{ kind: 'clearPending', from: 0 }]);
});

test('decide: time up → leader with tiebreaks; tie → -1', () => {
  const settings = { size: 3, teamCount: 2, win: { type: 'lines', n: 1 }, reviewSecs: 0 };
  const g = baseGame(settings, { ends_at: iso(100) });
  let subs = [sub(0, 0, 1), sub(4, 1, 2), sub(8, 1, 3)];
  let a = L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, T0 + 101_000);
  assert.equal(a[0].kind, 'setPending'); assert.equal(a[0].team, 1); assert.equal(a[0].reason, 'time');
  subs = [sub(0, 0, 5), sub(4, 1, 2)]; // equal squares, team 1 got there first
  a = L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, T0 + 101_000);
  assert.equal(a[0].team, 1);
  a = L.decide({ game: g, players, submissions: [], contests: [], votes: [] }, T0 + 101_000);
  assert.equal(a[0].team, -1);
});

test('squares and majority targets', () => {
  const s10 = L.normalizeSettings({ size: 5, win: { type: 'squares', n: 3 } });
  assert.equal(L.findConditionWinner([sub(0, 1, 1), sub(9, 1, 2), sub(20, 1, 3)], s10).team, 1);
  const maj = L.normalizeSettings({ size: 3, win: { type: 'majority' } }); // 5 of 9
  assert.equal(L.findConditionWinner([0, 1, 3, 5].map((q, i) => sub(q, 0, i)), maj), null);
});

test('fillTeams balances, randomTeams round-robins', () => {
  const ps = [{ id: 1, team: 0 }, { id: 2, team: 0 }, { id: 3, team: null }, { id: 4, team: null }, { id: 5, team: null }];
  const ch = L.fillTeams(ps, 3);
  assert.deepEqual(ch, [{ id: 3, team: 1 }, { id: 4, team: 2 }, { id: 5, team: 1 }]);
  const r = L.randomTeams(ps, 2, () => 0.5);
  assert.equal(r.filter((x) => x.team === 0).length, 3);
});

test('ts handles microseconds', () => {
  assert.equal(L.ts('2026-10-25T20:00:00.123456+00:00'), Date.parse('2026-10-25T20:00:00.123Z'));
});

// ---------------- points / rush / bounties ----------------
const pg = (settings, extra = {}) => ({
  id: 'game-1', status: 'active', started_at: iso(0), board: [...Array(settings.size ** 2)].map((_, i) => `c${i}`),
  settings, pending_winner: null, ...extra,
});

test('points lockout: values from pts map, bingo bonus', () => {
  const settings = { size: 3, mode: 'points', bingoBonus: 5, pts: { c0: 3, c1: 2 } };
  const g = pg(settings);
  const sc = L.scoreGame(g, [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3), sub(4, 1, 4)], [], T0 + 10_000);
  assert.equal(sc.teams[0].points, 3 + 2 + 1 + 5);
  assert.equal(sc.teams[0].lines, 1);
  assert.equal(sc.teams[1].points, 1);
});

test('rush: every team can claim, first earns double, dup by same team ignored', () => {
  const settings = { size: 3, mode: 'rush', pts: { c0: 3 } };
  const g = pg(settings);
  const subs = [sub(0, 1, 1, { lane: 1 }), sub(0, 0, 2, { lane: 0 }), sub(0, 0, 3, { lane: 0 }), sub(5, 0, 4)];
  const sc = L.scoreGame(g, subs, [], T0 + 10_000);
  assert.equal(sc.teams[1].points, 6); // first: 3 × 2
  assert.equal(sc.teams[0].points, 3 + 2); // second on c0 (3) + first on c5 (1×2)
  assert.equal(sc.bySquare.get(0).length, 2);
});

test('target: first to N by replay', () => {
  const settings = { size: 3, mode: 'points', target: 4, pts: { c0: 3 } };
  const g = pg(settings);
  const sc = L.scoreGame(g, [sub(0, 0, 1), sub(1, 1, 2), sub(2, 1, 3), sub(3, 1, 4), sub(4, 1, 5), sub(5, 0, 6)], [], T0 + 10_000);
  assert.equal(L.firstToTarget(sc).team, 1); // team 1 hit 4 at t=5, team 0 hit 4 at t=6
});

test('bounties: deterministic schedule, open squares only, collected once, 2×', () => {
  L.setMinuteMs(1000); // 1 "minute" = 1s
  try {
    const settings = { size: 3, mode: 'points', bounty: { on: true, every: 10 } }; // every 10s
    const g = pg(settings);
    const early = [sub(0, 0, 1), sub(1, 0, 2)];
    const sc1 = L.scoreGame(g, early, [], T0 + 15_000);
    assert.equal(sc1.bounty.list.length, 1);
    const b = sc1.bounty.list[0];
    assert.ok(![0, 1].includes(b.square), 'bounty lands on an open square');
    assert.equal(sc1.bounty.current.square, b.square);
    assert.equal(sc1.bounty.nextAt, T0 + 20_000);
    // same schedule on every phone
    assert.equal(L.scoreGame(g, early, [], T0 + 15_000).bounty.list[0].square, b.square);
    // claim it inside the window → 2×, bounty gone
    const sc2 = L.scoreGame(g, [...early, sub(b.square, 1, 12)], [], T0 + 15_000);
    assert.equal(sc2.teams[1].points, 2);
    assert.equal(sc2.bounty.current, null);
    // claim after the window → normal value
    const sc3 = L.scoreGame(g, [...early, sub(b.square, 1, 25)], [], T0 + 26_000);
    const claim = sc3.claims.find((c) => c.square === b.square);
    assert.equal(claim.bounty, sc3.bounty.list[1]?.square === b.square && claim.at >= sc3.bounty.list[1].startAt);
  } finally {
    L.setMinuteMs(60000);
  }
});

test('bounty stable when a pre-bounty claim is thrown out later', () => {
  L.setMinuteMs(1000);
  try {
    const settings = { size: 3, mode: 'points', bounty: { on: true, every: 10 } };
    const g = pg(settings);
    const s0 = sub(0, 0, 1);
    const before = L.scoreGame(g, [s0], [], T0 + 12_000).bounty.list[0].square;
    const rejected = { ...s0, status: 'rejected' };
    const contest = { id: 'c', submission_id: s0.id, status: 'rejected', created_at: iso(11), resolved_at: iso(13) };
    const after = L.scoreGame(g, [rejected], [contest], T0 + 14_000).bounty.list[0].square;
    assert.equal(after, before);
  } finally {
    L.setMinuteMs(60000);
  }
});

test('clinch: ends when nobody can catch the leader', () => {
  const settings = { size: 3, mode: 'points', reviewSecs: 10, pts: { c0: 5, c1: 5, c2: 5 } };
  const g = pg(settings);
  const subs = [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3)]; // 15 + nothing left worth more than 6 for team 1
  const acts = L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, T0 + 5000);
  assert.equal(acts[0].kind, 'setPending');
  assert.equal(acts[0].reason, 'clinch');
  assert.equal(acts[0].team, 0);
  // with bounties on and no time limit, the open squares could double → 12 < 15, still clinched
  const gb = pg({ ...settings, bounty: { on: true, every: 10 } });
  assert.equal(L.decide({ game: gb, players, submissions: subs, contests: [], votes: [] }, T0 + 5000)[0].reason, 'clinch');
  // bingo bonus 10: team 0 has 15 + 10 = 25; team 1 could still get 6 + rows 1 & 2 (20) = 26 → not clinched
  const gx = pg({ ...settings, bingoBonus: 10 });
  assert.deepEqual(L.decide({ game: gx, players, submissions: subs, contests: [], votes: [] }, T0 + 5000), []);
});

test('rush: not clinched while others can still score on claimed squares; time-up → points leader', () => {
  const settings = { size: 3, mode: 'rush', reviewSecs: 0 };
  const g = pg(settings, { ends_at: iso(100) });
  const subs = [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3)];
  assert.deepEqual(L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, T0 + 50_000), []);
  const a = L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, T0 + 101_000);
  assert.equal(a[0].reason, 'time');
  assert.equal(a[0].team, 0);
});

test('same team, new reason keeps the review countdown', () => {
  const settings = { size: 3, mode: 'points', target: 3, reviewSecs: 30 };
  const fin = iso(40);
  const g = pg(settings, { pending_winner: 0, pending_reason: 'clinch', finalize_at: fin });
  const subs = [sub(0, 0, 1), sub(1, 0, 2), sub(2, 0, 3)];
  const a = L.decide({ game: g, players, submissions: subs, contests: [], votes: [] }, T0 + 20_000);
  assert.equal(a[0].kind, 'changePending');
  assert.equal(a[0].reason, 'condition');
  assert.equal(a[0].finalizeAt, L.ts(fin));
});

test('classic mode unaffected by points settings', () => {
  const settings = { size: 3, mode: 'classic', bingoBonus: 5, pts: { c0: 5 }, bounty: { on: true, every: 10 } };
  const sc = L.scoreGame(pg(settings), [sub(0, 0, 1)], [], T0 + 9e6);
  assert.equal(sc.teams[0].points, 1);
  assert.equal(sc.bounty.list.length, 0);
});
