import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(ROOT, process.env.WEB_ROOT || 'docs');
const DATA = resolve(ROOT, process.env.DATA_DIR || 'data/local');
const DB_FILE = join(DATA, 'db.json');
const CLIPS = join(DATA, 'clips');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const MODE = ['supabase', 'local', 'mock'].includes(process.env.LOCKOUT_MODE) ? process.env.LOCKOUT_MODE : 'supabase';
const TABLES = new Set(['games', 'players', 'submissions', 'contests', 'votes', 'locations', 'messages']);
const MAX_BODY = 50 * 1024 * 1024;
const listeners = new Set();
let writeNumber = 0;
let vapidKeys = null;

if (MODE === 'local') {
  mkdirSync(CLIPS, { recursive: true });
  if (!existsSync(DB_FILE)) saveDb(emptyDb());
  const keyFile = join(DATA, 'vapid-keys.json');
  if (existsSync(keyFile)) vapidKeys = JSON.parse(readFileSync(keyFile, 'utf8'));
  else {
    vapidKeys = webPush.generateVAPIDKeys();
    writeFileSync(keyFile, JSON.stringify(vapidKeys, null, 2), { mode: 0o600 });
  }
  webPush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:lockout@example.com', vapidKeys.publicKey, vapidKeys.privateKey);
}

function emptyDb() {
  return { games: [], players: [], submissions: [], contests: [], votes: [], locations: [], messages: [], push_subscriptions: [], push_reminders: [] };
}

function readDb() {
  try {
    const db = JSON.parse(readFileSync(DB_FILE, 'utf8'));
    for (const table of TABLES) db[table] ||= [];
    db.push_subscriptions ||= [];
    db.push_reminders ||= [];
    return db;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyDb();
    throw new Error(`Could not read ${DB_FILE}: ${error.message}`);
  }
}

function saveDb(db) {
  mkdirSync(DATA, { recursive: true });
  const temp = `${DB_FILE}.${process.pid}.${++writeNumber}.tmp`;
  writeFileSync(temp, JSON.stringify(db, null, 2));
  renameSync(temp, DB_FILE);
}

function matches(row, match) {
  return Object.entries(match).every(([key, value]) => value === null ? row[key] == null : row[key] === value);
}

function conflict(table, row, db, self = null) {
  const rows = db[table].filter((other) => other !== self);
  if (table === 'games' && rows.some((other) => other.code === row.code)) return 'A game with that code already exists';
  if (table === 'players' && rows.some((other) => other.game_id === row.game_id && (other.client_id === row.client_id || other.name.toLowerCase() === row.name.toLowerCase()))) return 'That player already exists';
  if (table === 'submissions' && row.status === 'active' && rows.some((other) => other.game_id === row.game_id && other.square === row.square && other.status === 'active' &&
    (other.team === row.team || (row.lockout !== false && other.lockout !== false)))) return 'That square is already claimed';
  if (table === 'contests' && rows.some((other) => other.submission_id === row.submission_id)) return 'That clip already has a contest';
  if (table === 'votes' && rows.some((other) => other.contest_id === row.contest_id && other.player_id === row.player_id)) return 'That player already voted';
  return null;
}

function defaults(table) {
  return {
    games: { status: 'lobby', settings: {}, challenges: [], team_names: [], plans: {}, board: null, pending_winner: null, winner: null },
    players: { team: null },
    submissions: { status: 'active', lockout: true, video_path: null, thumb_path: null, task_latitude: null, task_longitude: null },
    contests: { status: 'open' },
    votes: {},
    locations: { visibility: 'team' },
    messages: { player_name: '', body: '' },
  }[table];
}

function checkRefs(table, row, db) {
  const has = (name, id) => db[name].some((item) => item.id === id);
  if (table !== 'games' && row.game_id && !has('games', row.game_id)) return 'Game does not exist';
  if (table === 'submissions' && row.player_id && !has('players', row.player_id)) return 'Player does not exist';
  if (table === 'contests' && !has('submissions', row.submission_id)) return 'Submission does not exist';
  if (table === 'votes' && (!has('contests', row.contest_id) || !has('players', row.player_id))) return 'Contest or player does not exist';
  if (table === 'locations' && row.player_id && !has('players', row.player_id)) return 'Player does not exist';
  if (table === 'messages' && row.player_id && !has('players', row.player_id)) return 'Player does not exist';
  return null;
}

function notify(table, row) {
  const message = `data: ${JSON.stringify({ type: 'change', table, game_id: row?.game_id || null })}\n\n`;
  for (const client of listeners) {
    if (!client.gameId || !row?.game_id || client.gameId === row.game_id) client.response.write(message);
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

async function sendGamePush(gameId, payload, exceptPlayerId = null) {
  const db = readDb();
  const targets = db.push_subscriptions.filter((sub) => sub.game_id === gameId && sub.player_id !== exceptPlayerId);
  await Promise.allSettled(targets.map(async (sub) => {
    try { await webPush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 3600 }); }
    catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        const current = readDb();
        current.push_subscriptions = current.push_subscriptions.filter((row) => row.id !== sub.id);
        saveDb(current);
      } else console.warn('Push delivery failed:', error.statusCode || error.message);
    }
  }));
}

async function bodyBuffer(request, max = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function safeClipPath(relative) {
  const file = resolve(CLIPS, relative);
  if (!file.startsWith(`${CLIPS}${sep}`)) throw Object.assign(new Error('Invalid clip path'), { status: 400 });
  return file;
}

async function handleApi(request, response, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[1] === 'push' && MODE === 'local') {
    if (parts[2] === 'key' && request.method === 'GET') return json(response, 200, { publicKey: vapidKeys.publicKey });
    if (parts[2] === 'subscribe' && request.method === 'POST') {
      const { game_id, player_id, subscription } = JSON.parse((await bodyBuffer(request, 256 * 1024)).toString('utf8'));
      const db = readDb();
      if (!db.games.some((game) => game.id === game_id) || !db.players.some((player) => player.id === player_id && player.game_id === game_id)) return json(response, 404, { error: 'Game or player not found' });
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return json(response, 400, { error: 'Invalid push subscription' });
      const old = db.push_subscriptions.find((row) => row.subscription.endpoint === subscription.endpoint);
      if (old) Object.assign(old, { game_id, player_id, subscription });
      else db.push_subscriptions.push({ id: randomUUID(), game_id, player_id, subscription, created_at: new Date().toISOString() });
      saveDb(db);
      return json(response, 200, { ok: true });
    }
    if (parts[2] === 'unsubscribe' && request.method === 'POST') {
      const { endpoint } = JSON.parse((await bodyBuffer(request, 16 * 1024)).toString('utf8'));
      const db = readDb();
      db.push_subscriptions = db.push_subscriptions.filter((row) => row.subscription.endpoint !== endpoint);
      saveDb(db);
      return json(response, 200, { ok: true });
    }
  }
  if (parts[1] === 'events' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
    response.write(`data: ${JSON.stringify({ type: 'status', status: 'SUBSCRIBED' })}\n\n`);
    const client = { response, gameId: url.searchParams.get('game_id') };
    listeners.add(client);
    const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 20000);
    response.on('close', () => { clearInterval(heartbeat); listeners.delete(client); });
    return;
  }

  if (parts[1] === 'storage') {
    const relative = url.searchParams.get('path') || '';
    const file = safeClipPath(relative);
    if (request.method === 'POST') {
      const data = await bodyBuffer(request);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
      response.writeHead(204, { 'cache-control': 'no-store' });
      return response.end();
    }
    if (request.method === 'GET') {
      if (!existsSync(file) || !statSync(file).isFile()) return json(response, 404, { error: 'Clip not found' });
      const contentType = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime' })[extname(file).toLowerCase()] || 'application/octet-stream';
      const download = url.searchParams.get('download');
      const size = statSync(file).size;
      const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      const disposition = download ? { 'content-disposition': `attachment; filename="${download.replace(/["\r\n]/g, '_')}"` } : {};
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[2] && range[1] ? Math.min(size - 1, Number(range[2])) : size - 1;
        if (start >= size || end < start) {
          response.writeHead(416, { 'content-range': `bytes */${size}` });
          return response.end();
        }
        response.writeHead(206, { 'content-type': contentType, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store', ...disposition });
        return createReadStream(file, { start, end }).pipe(response);
      }
      response.writeHead(200, { 'content-type': contentType, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store', ...disposition });
      return createReadStream(file).pipe(response);
    }
    return json(response, 405, { error: 'Method not allowed' });
  }

  const table = parts[1];
  if (!TABLES.has(table)) return json(response, 404, { error: 'Unknown API route' });
  const match = JSON.parse(url.searchParams.get('match') || '{}');
  const options = JSON.parse(url.searchParams.get('options') || '{}');
  const db = readDb();

  if (parts[2] === 'upsert' && request.method === 'POST') {
    const row = JSON.parse((await bodyBuffer(request, 1024 * 1024)).toString('utf8'));
    const existing = db[table].find((item) => table === 'votes' && item.contest_id === row.contest_id && item.player_id === row.player_id);
    if (existing) Object.assign(existing, row);
    else {
      const full = { ...defaults(table), ...row, ...(table === 'votes' ? {} : { id: row.id || randomUUID() }), created_at: row.created_at || new Date().toISOString() };
      const refError = checkRefs(table, full, db);
      const duplicate = conflict(table, full, db);
      if (refError) return json(response, 400, { error: refError });
      if (duplicate) return json(response, 409, { error: duplicate });
      db[table].push(full);
    }
    saveDb(db);
    notify(table, existing || db[table].at(-1));
    return json(response, 200, { ok: true });
  }

  if (request.method === 'GET') {
    let rows = db[table].filter((row) => matches(row, match));
    if (options.orderBy) {
      const direction = options.ascending === false ? -1 : 1;
      rows.sort((a, b) => direction * ((Date.parse(a[options.orderBy]) || 0) - (Date.parse(b[options.orderBy]) || 0) || String(a.id).localeCompare(String(b.id))));
    }
    if (Number.isInteger(options.limit) && options.limit > 0) rows = rows.slice(0, options.limit);
    return json(response, 200, rows);
  }
  if (request.method === 'POST') {
    const row = JSON.parse((await bodyBuffer(request, 1024 * 1024)).toString('utf8'));
    const full = { ...defaults(table), ...row, ...(table === 'votes' ? {} : { id: row.id || randomUUID() }), created_at: row.created_at || new Date().toISOString() };
    const refError = checkRefs(table, full, db);
    const duplicate = conflict(table, full, db);
    if (refError) return json(response, 400, { error: refError });
    if (duplicate) return json(response, 409, { error: duplicate });
    db[table].push(full);
    saveDb(db);
    notify(table, full);
    if (table === 'submissions' && full.status === 'active') {
      const game = db.games.find((row) => row.id === full.game_id);
      const player = db.players.find((row) => row.id === full.player_id);
      const task = game?.board?.[full.square] || 'a task';
      void sendGamePush(full.game_id, { title: 'Task completed', body: `${player?.name || 'A player'} completed “${task}”`, url: `/#/g/${game?.code || ''}` }, full.player_id);
    }
    return json(response, 201, full);
  }
  if (request.method === 'PATCH') {
    const patch = JSON.parse((await bodyBuffer(request, 1024 * 1024)).toString('utf8'));
    const changed = db[table].filter((row) => matches(row, match));
    for (const row of changed) {
      const next = { ...row, ...patch };
      const duplicate = conflict(table, next, db, row);
      const refError = checkRefs(table, next, db);
      if (duplicate) return json(response, 409, { error: duplicate });
      if (refError) return json(response, 400, { error: refError });
    }
    for (const row of changed) Object.assign(row, patch);
    if (changed.length) {
      saveDb(db);
      changed.forEach((row) => notify(table, row));
    }
    return json(response, 200, changed);
  }
  if (request.method === 'DELETE') {
    const removed = db[table].filter((row) => matches(row, match));
    db[table] = db[table].filter((row) => !matches(row, match));
    if (table === 'games' && removed.length) {
      const gameIds = new Set(removed.map((row) => row.id));
      const submissions = db.submissions.filter((row) => gameIds.has(row.game_id));
      const submissionIds = new Set(submissions.map((row) => row.id));
      const contests = db.contests.filter((row) => gameIds.has(row.game_id));
      const contestIds = new Set(contests.map((row) => row.id));
      db.players = db.players.filter((row) => !gameIds.has(row.game_id));
      db.submissions = db.submissions.filter((row) => !gameIds.has(row.game_id));
      db.contests = db.contests.filter((row) => !gameIds.has(row.game_id));
      db.votes = db.votes.filter((row) => !gameIds.has(row.game_id) && !submissionIds.has(row.submission_id) && !contestIds.has(row.contest_id));
      db.locations = db.locations.filter((row) => !gameIds.has(row.game_id));
      db.messages = db.messages.filter((row) => !gameIds.has(row.game_id));
      db.push_subscriptions = db.push_subscriptions.filter((row) => !gameIds.has(row.game_id));
      db.push_reminders = db.push_reminders.filter((id) => !gameIds.has(id));
      for (const row of removed) notify('games', row);
    }
    if (table === 'players' && removed.length) {
      const ids = new Set(removed.map((row) => row.id));
      db.votes = db.votes.filter((row) => !ids.has(row.player_id));
      db.locations = db.locations.filter((row) => !ids.has(row.player_id));
      db.push_subscriptions = db.push_subscriptions.filter((row) => !ids.has(row.player_id));
      for (const row of db.messages) if (ids.has(row.player_id)) row.player_id = null;
    }
    if (removed.length) {
      saveDb(db);
      if (table !== 'games') removed.forEach((row) => notify(table, row));
    }
    response.writeHead(204);
    return response.end();
  }
  return json(response, 405, { error: 'Method not allowed' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/') {
      const query = new URLSearchParams(url.searchParams);
      let removedMode = false;
      for (const mode of ['local', 'mock', 'supabase']) {
        if (query.has(mode)) { query.delete(mode); removedMode = true; }
      }
      if (removedMode) {
        const suffix = query.toString();
        response.writeHead(302, { location: `/${suffix ? `?${suffix}` : ''}` });
        return response.end();
      }
    }
    if (url.pathname.startsWith('/api/')) {
      if (MODE !== 'local') return json(response, 404, { error: 'Local data APIs are disabled in this serve mode.' });
      return await handleApi(request, response, url);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed' });
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(WEB, `.${relative}`);
    if (file !== WEB && !file.startsWith(`${WEB}${sep}`)) return json(response, 403, { error: 'Forbidden' });
    if (!existsSync(file) || !statSync(file).isFile()) return json(response, 404, { error: 'Not found. Run npm run build first.' });
    let body = readFileSync(file);
    if (extname(file).toLowerCase() === '.html') {
      const html = body.toString('utf8').replace('</head>', `<script>window.LOCKOUT_MODE=${JSON.stringify(MODE)};</script>\n</head>`);
      body = Buffer.from(html);
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (!response.headersSent) json(response, error.status || 500, { error: error.message || 'Internal server error' });
    else response.destroy(error);
  }
});

server.listen(PORT, HOST, () => {
  const address = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`Lockout serve mode: ${MODE}\nOpen ${address}${MODE === 'local' ? `\nData: ${DATA}` : ''}`);
});

if (MODE === 'local') {
  const reminderTimer = setInterval(() => {
    try {
      const db = readDb();
      const now = Date.now();
      const due = db.games.filter((game) => {
        const remaining = Date.parse(game.ends_at) - now;
        const duration = Date.parse(game.ends_at) - Date.parse(game.started_at);
        return game.status === 'active' && game.ends_at && Number.isFinite(duration) && duration >= 5 * 60_000 && remaining > 0 && remaining <= 5 * 60_000 && !db.push_reminders.includes(game.id);
      });
      if (!due.length) return;
      for (const game of due) db.push_reminders.push(game.id);
      saveDb(db);
      for (const game of due) void sendGamePush(game.id, { title: '5 minutes left', body: `Game ${game.code} ends in 5 minutes.`, url: `/#/g/${game.code}` });
    } catch (error) { console.warn('Push reminder check failed:', error.message); }
  }, 15_000);
  reminderTimer.unref();
}
