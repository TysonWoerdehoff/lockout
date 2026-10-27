import { useState, useEffect, useRef, useCallback } from './h.js';
import { supabaseBackend } from './backend-supabase.js';
import { mockBackend } from './backend-mock.js';
import { localBackend } from './backend-local.js';
import { createUploader } from './uploads.js';
import { store, clientId, makeCode, extFor, rememberGame } from './util.js';
import { DEFAULT_SETTINGS, normalizeSettings, makeBoard, fillTeams, leader, teamStats } from './logic.js';

const cfg = window.LOCKOUT_CONFIG || {};
const MODE = window.LOCKOUT_MODE || 'supabase';
export const backend = MODE === 'local' ? localBackend() : MODE === 'mock' ? mockBackend() : cfg.supabaseUrl && cfg.supabaseKey ? supabaseBackend(cfg) : null;
export const CLIENT_ID = clientId();

// --- tiny event bus ---
const subs = new Map();
export const bus = {
  on(ev, fn) {
    if (!subs.has(ev)) subs.set(ev, new Set());
    subs.get(ev).add(fn);
    return () => subs.get(ev).delete(fn);
  },
  emit(ev, data) {
    subs.get(ev)?.forEach((fn) => fn(data));
  },
};

export const uploader = backend ? createUploader(backend, () => bus.emit('uploads')) : null;
uploader?.resume();

export function useBus(ev) {
  const [, set] = useState(0);
  useEffect(() => bus.on(ev, () => set((n) => n + 1)), [ev]);
}

export function toast(msg, opts = {}) {
  bus.emit('toast', { msg: friendlyError(msg), ...opts, id: Math.random() });
}

function friendlyError(msg) {
  const m = String(msg || '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'Can’t reach the server — check your connection and try again.';
  if (/schema cache|does not exist|relation .* not/i.test(m)) return 'The database isn’t set up yet — run setup.sql in the Supabase SQL Editor.';
  if (/row-level security|permission denied/i.test(m)) return 'The database blocked that — re-run setup.sql in the Supabase SQL Editor.';
  return m;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Resolve a storage path to a playable URL (sync on Supabase, async in mock mode). */
export function useMedia(path) {
  const [url, setUrl] = useState(() => {
    const u = path ? backend.mediaUrl(path) : null;
    return typeof u === 'string' ? u : null;
  });
  useEffect(() => {
    if (!path) return setUrl(null);
    const u = backend.mediaUrl(path);
    if (typeof u === 'string') setUrl(u);
    else u.then(setUrl);
  }, [path]);
  return url;
}

const iso = (t) => new Date(t).toISOString();

/** Loads a game by code and keeps it live (realtime + polling fallback). */
export function useGameData(code) {
  const [state, setState] = useState({ loading: true });
  const refreshRef = useRef(() => {});

  useEffect(() => {
    let alive = true;
    let gameId = null;
    let unsub = null;
    let realtimeOk = false;
    let seq = 0;
    let applied = 0;
    let debounce = null;
    let poll = null;

    async function fetchAll() {
      const my = ++seq;
      try {
        const games = await backend.select('games', gameId ? { id: gameId } : { code });
        const game = games[0];
        if (!game) {
          if (alive) setState({ loading: false, notFound: true });
          return;
        }
        if (!gameId) {
          gameId = game.id;
          unsub = backend.subscribe(gameId, schedule, (status) => {
            realtimeOk = status === 'SUBSCRIBED';
            if (realtimeOk) schedule();
          });
        }
        const [players, submissions, contests, votes] = await Promise.all(
          ['players', 'submissions', 'contests', 'votes'].map((t) => backend.select(t, { game_id: gameId }))
        );
        const messages = await backend.select('messages', { game_id: gameId }).catch((error) => {
          console.warn('Game messages are unavailable; apply the latest setup.sql to enable chat.', error);
          return [];
        });
        const locations = await backend.select('locations', { game_id: gameId }, { orderBy: 'created_at', ascending: false, limit: 10000 }).catch((error) => {
          console.warn('Location data is unavailable; loading the game without map history.', error);
          return [];
        });
        if (!alive || my < applied) return;
        applied = my;
        setState({ loading: false, game, players, submissions, contests, votes, locations, messages, online: true, at: Date.now() });
      } catch (e) {
        console.warn('fetch failed', e);
        if (alive) setState((s) => ({ ...s, loading: false, online: false, error: e.message || String(e) }));
      }
    }
    function schedule() {
      clearTimeout(debounce);
      debounce = setTimeout(fetchAll, 120);
    }
    function loop() {
      poll = setTimeout(async () => {
        if (document.visibilityState === 'visible') await fetchAll();
        if (alive) loop();
      }, realtimeOk ? 12000 : 3500);
    }
    refreshRef.current = schedule;
    fetchAll();
    loop();
    const onVis = () => document.visibilityState === 'visible' && schedule();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', schedule);
    window.addEventListener('focus', schedule);
    return () => {
      alive = false;
      unsub?.();
      clearTimeout(debounce);
      clearTimeout(poll);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', schedule);
      window.removeEventListener('focus', schedule);
    };
  }, [code]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return [state, refresh];
}

// ---------------- actions ----------------

export async function createGame(name, from = null) {
  const last = store.get('lastSetup', {});
  const settings = normalizeSettings(from?.settings || last.settings || DEFAULT_SETTINGS);
  const challenges = from?.challenges || last.challenges || [];
  for (let i = 0; i < 8; i++) {
    const code = makeCode();
    const r = await backend.insert('games', {
      code,
      host_id: CLIENT_ID,
      status: 'lobby',
      settings,
      challenges,
      team_names: from?.team_names || [],
    });
    if (r.conflict) continue;
    const p = await backend.insert('players', { game_id: r.data.id, client_id: CLIENT_ID, name, team: from?.team ?? null });
    if (p.conflict) throw new Error('Could not join your new game');
    rememberGame(code, `${name}'s game`);
    return r.data;
  }
  throw new Error('Could not create a game — try again');
}

/** Join a game. Returns {ok} or {nameTaken: player}. */
export async function joinGame(game, name, team = null) {
  const r = await backend.insert('players', { game_id: game.id, client_id: CLIENT_ID, name, team });
  if (!r.conflict) {
    rememberGame(game.code, name);
    return { ok: true };
  }
  const players = await backend.select('players', { game_id: game.id });
  const mine = players.find((p) => p.client_id === CLIENT_ID);
  if (mine) return { ok: true };
  const taken = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  return taken ? { nameTaken: taken } : { error: 'Could not join' };
}

/** "That's me" — move an existing player slot to this device (switched phone / installed the app). */
export async function reclaimPlayer(game, player) {
  await backend.update('players', { client_id: CLIENT_ID }, { id: player.id });
  rememberGame(game.code, player.name);
}

export async function startGame(data, challenges, liveSettings) {
  const { game, players } = data;
  const settings = normalizeSettings(liveSettings || game.settings);
  const board = makeBoard(challenges, settings.size);
  const changes = fillTeams(players, settings.teamCount);
  await Promise.all(changes.map((c) => backend.update('players', { team: c.team }, { id: c.id })));
  const now = Date.now();
  const rows = await backend.update(
    'games',
    {
      status: 'active',
      board,
      challenges,
      settings,
      started_at: iso(now),
      ends_at: settings.timeLimitMin ? iso(now + settings.timeLimitMin * 60000) : null,
      pending_winner: null,
      pending_reason: null,
      finalize_at: null,
    },
    { id: game.id, status: 'lobby' }
  );
  store.set('lastSetup', { settings, challenges });
  return rows.length > 0;
}

export async function claimSquare(data, me, square, rec) {
  const { game } = data;
  const settings = normalizeSettings(game.settings);
  const latest = store.get(`map:last-location:${game.id}:${me.id}`);
  const fresh = latest && Date.now() - latest.at <= 120000 && Number.isFinite(+latest.latitude) && Number.isFinite(+latest.longitude);
  const location = game.settings?.locationSharingEnabled && fresh ? latest : null;
  const r = await backend.insert('submissions', {
    game_id: game.id, square, team: me.team, player_id: me.id, status: 'active', lockout: settings.lockout,
    task_latitude: location ? +location.latitude : null,
    task_longitude: location ? +location.longitude : null,
  });
  if (r.conflict) return { conflict: true };
  const id = r.data.id;
  await uploader.enqueue({
    id,
    gameId: game.id,
    video: rec.blob,
    mime: rec.mime,
    videoPath: `${game.id}/${id}.${extFor(rec.mime)}`,
    thumb: rec.thumb || null,
    thumbPath: `${game.id}/${id}.jpg`,
    attempts: 0,
  });
  return { ok: true, id };
}

export async function disbandGame(game) {
  const [current] = await backend.select('games', { id: game.id, status: 'lobby' });
  if (!current) return false;
  await backend.remove('games', { id: game.id, status: 'lobby' });
  return true;
}

export async function openContest(data, me, sub, reason) {
  const r = await backend.insert('contests', {
    game_id: data.game.id,
    submission_id: sub.id,
    opened_by: me.id,
    reason: reason?.trim() || null,
    status: 'open',
  });
  if (r.conflict) return { conflict: true };
  await castVote(data, me, r.data, false);
  return { ok: true };
}

export async function castVote(data, me, contest, legit) {
  await backend.upsert('votes', { contest_id: contest.id, game_id: data.game.id, player_id: me.id, legit }, 'contest_id,player_id');
}

export async function hostRule(contest, outcome) {
  const rows = await backend.update(
    'contests',
    { status: outcome, resolved_at: iso(Date.now()), resolved_by: 'host' },
    { id: contest.id, status: 'open' }
  );
  if (rows.length && outcome === 'rejected') {
    await backend.update('submissions', { status: 'rejected' }, { id: contest.submission_id, status: 'active' });
  }
}

export async function endGameNow(data) {
  const settings = normalizeSettings(data.game.settings);
  const active = data.submissions.filter((s) => s.status === 'active');
  const lead = leader(teamStats(settings, active));
  await backend.update(
    'games',
    { status: 'finished', winner: lead >= 0 ? lead : null, end_reason: 'host', finished_at: iso(Date.now()), pending_winner: null },
    { id: data.game.id, status: 'active' }
  );
}

/** Apply one action from logic.decide(). All writes are conditional, so racing clients are safe. */
export async function applyAction(a, game) {
  const now = iso(Date.now());
  switch (a.kind) {
    case 'rejectSubmission':
      return backend.update('submissions', { status: 'rejected' }, { id: a.submissionId, status: 'active' });
    case 'resolveContest': {
      await backend.update('contests', { status: a.outcome, resolved_at: now, resolved_by: 'vote' }, { id: a.contestId, status: 'open' });
      if (a.outcome === 'rejected') await backend.update('submissions', { status: 'rejected' }, { id: a.submissionId, status: 'active' });
      return;
    }
    case 'setPending':
      return backend.update(
        'games',
        { pending_winner: a.team, pending_reason: a.reason, finalize_at: iso(a.finalizeAt) },
        { id: game.id, status: 'active', pending_winner: null }
      );
    case 'changePending':
      return backend.update(
        'games',
        { pending_winner: a.team, pending_reason: a.reason, finalize_at: iso(a.finalizeAt) },
        { id: game.id, status: 'active', pending_winner: a.from }
      );
    case 'clearPending':
      return backend.update(
        'games',
        { pending_winner: null, pending_reason: null, finalize_at: null },
        { id: game.id, status: 'active', pending_winner: a.from }
      );
    case 'finish':
      return backend.update(
        'games',
        { status: 'finished', winner: a.team >= 0 ? a.team : null, end_reason: a.reason, finished_at: now },
        { id: game.id, status: 'active' }
      );
  }
}

export async function rematch(data, me) {
  const { game } = data;
  const g = await createGame(me.name, {
    settings: game.settings,
    challenges: game.challenges,
    team_names: game.team_names,
    team: me.team,
  });
  await backend.update('games', { next_code: g.code }, { id: game.id });
  return g;
}

export function go(code) {
  location.hash = code ? `#/g/${code}` : '#/';
}
