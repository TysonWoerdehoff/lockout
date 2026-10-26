import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(ROOT, process.env.WEB_ROOT || 'docs');
const DATA = resolve(ROOT, process.env.DATA_DIR || 'data/local');
const DB_FILE = join(DATA, 'db.json');
const CLIPS = join(DATA, 'clips');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const TABLES = new Set(['games', 'players', 'submissions', 'contests', 'votes']);
const MAX_BODY = 50 * 1024 * 1024;
const listeners = new Set();
let writeNumber = 0;

mkdirSync(CLIPS, { recursive: true });
if (!existsSync(DB_FILE)) saveDb(emptyDb());

function emptyDb() {
  return { games: [], players: [], submissions: [], contests: [], votes: [] };
}

function readDb() {
  try {
    const db = JSON.parse(readFileSync(DB_FILE, 'utf8'));
    for (const table of TABLES) db[table] ||= [];
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
    games: { status: 'lobby', settings: {}, challenges: [], team_names: [], board: null, pending_winner: null, winner: null },
    players: { team: null },
    submissions: { status: 'active', lockout: true, video_path: null, thumb_path: null },
    contests: { status: 'open' },
    votes: {},
  }[table];
}

function checkRefs(table, row, db) {
  const has = (name, id) => db[name].some((item) => item.id === id);
  if (table !== 'games' && row.game_id && !has('games', row.game_id)) return 'Game does not exist';
  if (table === 'submissions' && row.player_id && !has('players', row.player_id)) return 'Player does not exist';
  if (table === 'contests' && !has('submissions', row.submission_id)) return 'Submission does not exist';
  if (table === 'votes' && (!has('contests', row.contest_id) || !has('players', row.player_id))) return 'Contest or player does not exist';
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

  if (request.method === 'GET') return json(response, 200, db[table].filter((row) => matches(row, match)));
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
      for (const row of removed) notify('games', row);
    }
    if (table === 'players' && removed.length) {
      const ids = new Set(removed.map((row) => row.id));
      db.votes = db.votes.filter((row) => !ids.has(row.player_id));
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
    if (url.pathname === '/' && !['local', 'mock', 'supabase'].some((mode) => url.searchParams.has(mode))) {
      const query = new URLSearchParams(url.searchParams);
      query.set('local', '');
      response.writeHead(302, { location: `/?${query.toString()}` });
      return response.end();
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed' });
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(WEB, `.${relative}`);
    if (file !== WEB && !file.startsWith(`${WEB}${sep}`)) return json(response, 403, { error: 'Forbidden' });
    if (!existsSync(file) || !statSync(file).isFile()) return json(response, 404, { error: 'Not found. Run npm run build first.' });
    const body = request.method === 'HEAD' ? null : readFileSync(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': statSync(file).size, 'cache-control': 'no-cache' });
    response.end(body);
  } catch (error) {
    if (!response.headersSent) json(response, error.status || 500, { error: error.message || 'Internal server error' });
    else response.destroy(error);
  }
});

server.listen(PORT, HOST, () => console.log(`Lockout local server: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\nData: ${DATA}\nOpen http://localhost:${PORT}/?local`));
