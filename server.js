import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT) || 3000;
// The master password creates events and lists all of them. Invite links need no password.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme-admin';

if (!process.env.ADMIN_PASSWORD) console.warn('! ADMIN_PASSWORD is not set, using "changeme-admin".');

// ---------------------------------------------------------------- storage

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  : { secret: null, events: {} };
db.secret ||= crypto.randomBytes(32).toString('hex');

let saving = Promise.resolve();
function save() {
  // Serialize writes; each one snapshots the current state atomically.
  saving = saving
    .then(async () => {
      const tmp = DB_FILE + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(db, null, 1));
      await fsp.rename(tmp, DB_FILE);
    })
    .catch((err) => console.error('Failed to save database:', err));
}
save();

const events = () => Object.values(db.events);
const byCode = (code) => events().find((e) => e.code === code);
const byAdmin = (t) => events().find((e) => e.adminToken === t);
function byInvite(t) {
  for (const ev of events()) {
    const person = ev.people.find((p) => p.token === t);
    if (person) return { ev, person };
  }
  return {};
}

// ---------------------------------------------------------------- ids

// No vowels, no look-alikes: short codes can't spell words or be misread.
const ALPHABET = 'bcdfghjkmnpqrstvwxz23456789';
// 10 chars of a 27-letter alphabet ≈ 47 bits: short enough to share, too many to guess.
function shortCode(len = 10) {
  for (;;) {
    const code = [...crypto.randomBytes(len)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
    if (!byCode(code)) return code;
  }
}
const token = (bytes) => crypto.randomBytes(bytes).toString('base64url');

// ---------------------------------------------------------------- auth

const ADMIN_COOKIE = 'ep_admin';
// Cookie values derive from the password, so changing a password logs everyone out.
const sign = (role, pw) => crypto.createHmac('sha256', db.secret).update(`${role}:${pw}`).digest('base64url');
const adminValue = sign('admin', ADMIN_PASSWORD);

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }),
  );
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
const isMaster = (req) => safeEqual(cookies(req)[ADMIN_COOKIE] || '', adminValue);
const cookie = (name, value, maxAge = 31536000) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;

// ---------------------------------------------------------------- validation

const STATUSES = ['pending', 'yes', 'no', 'later'];
const RESPONSES = ['yes', 'no', 'later'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const text = (v, max) => String(v ?? '').trim().slice(0, max);

function eventFields(body, partial = false) {
  const out = {};
  if (!partial || 'title' in body) {
    out.title = text(body.title, 120);
    if (!out.title) throw new HttpError(400, 'Give the event a name.');
  }
  if (!partial || 'when' in body) {
    out.when = text(body.when, 16);
    if (out.when && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(out.when)) throw new HttpError(400, 'Invalid date.');
  }
  if (!partial || 'end' in body) {
    out.end = text(body.end, 16);
    if (out.end && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(out.end)) throw new HttpError(400, 'Invalid end date.');
  }
  if (!partial || 'where' in body) out.where = text(body.where, 200);
  if (!partial || 'description' in body) out.description = text(body.description, 2000);
  if (!partial || 'min' in body) {
    out.min = Number.parseInt(body.min, 10);
    if (!(out.min >= 1 && out.min <= 200)) throw new HttpError(400, 'Minimum must be between 1 and 200.');
  }
  if (!partial || 'max' in body) {
    out.max = body.max === '' || body.max == null ? null : Number.parseInt(body.max, 10);
    if (out.max !== null && !(out.max >= 1 && out.max <= 200)) throw new HttpError(400, 'Maximum must be between 1 and 200.');
  }
  return out;
}

function checkRange(ev) {
  if (ev.end && !ev.when) throw new HttpError(400, 'Set a start time before the end.');
  if (ev.end && ev.end <= ev.when) throw new HttpError(400, 'The end must be after the start.');
  if (ev.max != null && ev.max < ev.min) throw new HttpError(400, 'Maximum can’t be lower than the minimum.');
}

const goingCount = (ev) => ev.people.filter((p) => p.status === 'yes').length;

/** Guests can't join a full event; the organizer can still override. */
function ensureRoom(ev, person) {
  if (ev.max != null && person?.status !== 'yes' && goingCount(ev) >= ev.max) {
    throw new HttpError(409, 'Sorry, it’s full.');
  }
}

function personName(v) {
  const name = text(v, 60);
  if (!name) throw new HttpError(400, 'A name is needed.');
  return name;
}

// ---------------------------------------------------------------- views

function publicEvent(ev, me) {
  const going = ev.people
    .filter((p) => p.status === 'yes')
    .sort((a, b) => a.respondedAt.localeCompare(b.respondedAt))
    .map((p) => p.name);
  return {
    title: ev.title,
    when: ev.when,
    end: ev.end,
    where: ev.where,
    description: ev.description,
    min: ev.min,
    max: ev.max,
    code: ev.code,
    going,
    me: me ? { name: me.name, status: me.status, token: me.token } : null,
  };
}

const adminEvent = (ev) => ({ ...ev, people: ev.people });

function newPerson(name, status, source) {
  const now = new Date().toISOString();
  return { id: token(6), token: token(8), name, status, source, createdAt: now, respondedAt: now };
}

function setStatus(person, status) {
  if (person.status !== status) person.respondedAt = new Date().toISOString();
  person.status = status;
}

// ---------------------------------------------------------------- http helpers

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) {
    throw new HttpError(415, 'Expected JSON.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new HttpError(413, 'Too much data.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function sendFile(res, file) {
  try {
    const body = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}
const page = (res, name) => sendFile(res, path.join(PUBLIC, `${name}.html`));

// ---------------------------------------------------------------- routes

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

function requireMaster(req) {
  if (!isMaster(req)) throw new HttpError(401, 'Organizer password required.');
}
function adminEventOr404(t) {
  const ev = byAdmin(t);
  if (!ev) throw new HttpError(404, 'Event not found.');
  return ev;
}

// Pages
route('GET', /^\/$/, (req, res) => page(res, isMaster(req) ? 'create' : 'login'));
route('GET', /^\/a\/([\w-]+)$/, (req, res) => page(res, 'admin'));
route('GET', /^\/i\/([\w-]+)$/, (req, res) => page(res, 'invite'));
route('GET', new RegExp(`^/([${ALPHABET}]{10})$`), (req, res, code) => page(res, byCode(code) ? 'invite' : 'notfound'));
route('GET', /^\/static\/([\w.-]+)$/, (req, res, file) => sendFile(res, path.join(PUBLIC, file)));
route('GET', /^\/favicon\.ico$/, (req, res) => sendFile(res, path.join(PUBLIC, 'favicon.svg')));

// Auth
route('POST', /^\/api\/login$/, async (req, res) => {
  const { password } = await readJson(req);
  if (!safeEqual(password ?? '', ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    throw new HttpError(401, 'That’s not it.');
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': cookie(ADMIN_COOKIE, adminValue) });
});

route('POST', /^\/api\/logout$/, (req, res) => {
  send(res, 200, { ok: true }, { 'Set-Cookie': cookie(ADMIN_COOKIE, '', 0) });
});

// All events (master password)
route('GET', /^\/api\/events$/, (req, res) => {
  requireMaster(req);
  const list = events().map((ev) => ({
    title: ev.title,
    when: ev.when,
    end: ev.end,
    min: ev.min,
    max: ev.max,
    going: goingCount(ev),
    adminToken: ev.adminToken,
    createdAt: ev.createdAt,
  }));
  send(res, 200, list);
});

// Create
route('POST', /^\/api\/events$/, async (req, res) => {
  requireMaster(req);
  const fields = eventFields(await readJson(req));
  checkRange(fields);
  const ev = {
    id: token(6),
    code: shortCode(),
    adminToken: token(18),
    ...fields,
    people: [],
    createdAt: new Date().toISOString(),
  };
  db.events[ev.id] = ev;
  save();
  send(res, 201, { adminToken: ev.adminToken, code: ev.code });
});

// Admin
route('GET', /^\/api\/admin\/([\w-]+)$/, (req, res, t) => send(res, 200, adminEvent(adminEventOr404(t))));

route('PATCH', /^\/api\/admin\/([\w-]+)$/, async (req, res, t) => {
  const ev = adminEventOr404(t);
  const next = { ...ev, ...eventFields(await readJson(req), true) };
  checkRange(next);
  Object.assign(ev, next);
  save();
  send(res, 200, adminEvent(ev));
});

route('DELETE', /^\/api\/admin\/([\w-]+)$/, (req, res, t) => {
  const ev = adminEventOr404(t);
  delete db.events[ev.id];
  save();
  send(res, 200, { ok: true });
});

route('POST', /^\/api\/admin\/([\w-]+)\/people$/, async (req, res, t) => {
  const ev = adminEventOr404(t);
  const body = await readJson(req);
  const status = body.status === 'yes' ? 'yes' : 'pending';
  const person = newPerson(personName(body.name), status, status === 'yes' ? 'manual' : 'invite');
  ev.people.push(person);
  save();
  send(res, 201, adminEvent(ev));
});

route('PATCH', /^\/api\/admin\/([\w-]+)\/people\/([\w-]+)$/, async (req, res, t, id) => {
  const ev = adminEventOr404(t);
  const person = ev.people.find((p) => p.id === id);
  if (!person) throw new HttpError(404, 'Person not found.');
  const body = await readJson(req);
  if ('name' in body) {
    const name = personName(body.name);
    // The shared link matches answers by name, so two people can't share one.
    if (ev.people.some((p) => p !== person && p.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, `${name} is already on the list.`);
    }
    person.name = name;
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Invalid status.');
    setStatus(person, body.status);
  }
  save();
  send(res, 200, adminEvent(ev));
});

route('DELETE', /^\/api\/admin\/([\w-]+)\/people\/([\w-]+)$/, (req, res, t, id) => {
  const ev = adminEventOr404(t);
  ev.people = ev.people.filter((p) => p.id !== id);
  save();
  send(res, 200, adminEvent(ev));
});

// Generic link (password protected)
route('GET', /^\/api\/e\/(\w+)$/, (req, res, code) => {
  const ev = byCode(code);
  if (!ev) throw new HttpError(404, 'Event not found.');
  send(res, 200, publicEvent(ev));
});

route('POST', /^\/api\/e\/(\w+)\/respond$/, async (req, res, code) => {
  const ev = byCode(code);
  if (!ev) throw new HttpError(404, 'Event not found.');
  const body = await readJson(req);
  if (body.website) throw new HttpError(400, 'Invalid response.'); // hidden field only bots fill in
  if (!RESPONSES.includes(body.status)) throw new HttpError(400, 'Invalid response.');
  const name = personName(body.name);
  // Same name answers again → treat as the same person instead of a duplicate.
  let person = ev.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (body.status === 'yes') ensureRoom(ev, person);
  if (person) setStatus(person, body.status);
  else ev.people.push((person = newPerson(name, body.status, 'link')));
  save();
  send(res, 200, publicEvent(ev, person));
});

// Personal link (the token itself is the key)
route('GET', /^\/api\/i\/([\w-]+)$/, (req, res, t) => {
  const { ev, person } = byInvite(t);
  if (!ev) throw new HttpError(404, 'Invite not found.');
  send(res, 200, publicEvent(ev, person));
});

route('POST', /^\/api\/i\/([\w-]+)\/respond$/, async (req, res, t) => {
  const { ev, person } = byInvite(t);
  if (!ev) throw new HttpError(404, 'Invite not found.');
  const { status } = await readJson(req);
  if (!RESPONSES.includes(status)) throw new HttpError(400, 'Invalid response.');
  if (status === 'yes') ensureRoom(ev, person);
  setStatus(person, status);
  save();
  send(res, 200, publicEvent(ev, person));
});

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    for (const { method, pattern, handler } of routes) {
      if (method !== req.method) continue;
      const m = pathname.match(pattern);
      if (m) return await handler(req, res, ...m.slice(1));
    }
    if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
    return page(res, 'notfound');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error.' });
  }
});

server.listen(PORT, () => console.log(`Event planner on http://localhost:${PORT}`));
