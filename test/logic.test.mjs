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
  assert.equal(s.size, 5); assert.equal(s.teamCount, 2); assert.equal(s.win.n, 12);
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
