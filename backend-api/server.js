require('dotenv').config();
// Environment validation (will exit process if critical vars are weak/missing)
try { require('./scripts/check-env'); } catch (e) { console.error('Env validation failed:', e.message); process.exit(1); }
const express = require('express');
const cors = require('cors');

const fs = require('fs');
const path = require('path');

const cookie = require('cookie');
const crypto = require('crypto');
const app = express();
// Simplified permissive CORS for local development (echo request origin if present)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// simple in-memory state store for OAuth 'state' validation (with expiry)
const oauthStates = new Map(); // state -> { action, provider, created }
const OAUTH_STATE_TTL = 1000 * 60 * 5; // 5 minutes

// sessions store: sid -> { username, role, expires }
const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

function cleanupStores() {
  const now = Date.now();
  for (const [s, v] of oauthStates) if (now - v.created > OAUTH_STATE_TTL) oauthStates.delete(s);
  for (const [sid, v] of sessions) if (v.expires < now) sessions.delete(sid);
}
setInterval(cleanupStores, 1000 * 60);

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJWT(payload, secret, expiresInSec = SESSION_TTL / 1000) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + Math.floor(expiresInSec);
  const pl = Object.assign({}, payload, { exp });
  const s = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(pl));
  const sig = crypto.createHmac('sha256', secret).update(s).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return s + '.' + sig;
}

function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const data = h + '.' + p;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const STRAINS_FILE = path.join(DATA_DIR, 'strains.json');
const JOURNAL_FILE = path.join(DATA_DIR, 'journal.json');
const MAPPINGS_FILE = path.join(DATA_DIR, 'mappings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load', file, e.message);
  }
  return fallback;
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save', file, e.message);
  }
}

let strains = loadJson(STRAINS_FILE, []);
let journalEntries = loadJson(JOURNAL_FILE, []);
let users = loadJson(USERS_FILE, []);

// Migration: ensure each user has a favorites array (as objects {id, addedAt})
for (const u of users) {
  if (!Array.isArray(u.favorites)) {
    u.favorites = [];
  } else if (u.favorites.length && typeof u.favorites[0] === 'string') {
    // convert legacy string IDs to objects
    u.favorites = u.favorites.map(id => ({ id: String(id), addedAt: new Date().toISOString() }));
  } else if (u.favorites.length && typeof u.favorites[0] === 'object') {
    // ensure structure
    u.favorites = u.favorites.map(f => ({ id: String(f.id), addedAt: f.addedAt || new Date().toISOString() }));
  }
}

// Ensure user objects can hold profile information: displayName, bio, avatarFile (filename under uploads)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR); } catch (e) { console.error('Could not create uploads dir', e.message); }

function findUser(username) {
  return users.find(u => u.username === username);
}

app.get('/strains', (req, res) => {
  // Enrich strains with derived cannabinoid object & placeholder terpene data if missing
  // Determine favorites if user is authenticated (optional cookie inspection)
  let favSet = null;
  try {
    const token = parseSessionCookie(req);
    if (token) {
      const payload = verifyJWT(token, JWT_SECRET);
      if (payload) {
        const sess = sessions.get(payload.sid);
        if (sess) {
          const u = findUser(sess.username);
          if (u && Array.isArray(u.favorites)) favSet = new Set(u.favorites.map(x=> String(x.id || x)));
        }
      }
    }
  } catch (e) { /* ignore */ }

  const enriched = strains.map(s => {
    const copy = { ...s };
    if (!copy.cannabinoids) {
      copy.cannabinoids = { thc: copy.thc ?? null, cbd: copy.cbd ?? null };
    }
    if (!copy.terpenes) {
      // lightweight deterministic placeholder based on id hash so values stay stable
      const seed = (typeof copy.id === 'number' ? copy.id : 1) * 9301 % 233280;
      function rand(f) { return ((seed * (f+1)) % 97) / 300; }
      copy.terpenes = {
        myrcene: +rand(1).toFixed(2),
        limonene: +rand(2).toFixed(2),
        caryophyllene: +rand(3).toFixed(2),
        pinene: +rand(4).toFixed(2),
        linalool: +rand(5).toFixed(2)
      };
    }
    if (favSet) copy.favorite = favSet.has(String(copy.id));
    return copy;
  });
  res.json(enriched);
});

app.get('/strains/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = strains.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

app.post('/strains', (req, res) => {
  const body = req.body || {};
  const id = strains.length ? Math.max(...strains.map((s) => s.id)) + 1 : 1;
  const entry = { id, ...body };
  strains.push(entry);
  saveJson(STRAINS_FILE, strains);
  res.status(201).json(entry);
});

app.delete('/strains/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = strains.findIndex((s) => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = strains.splice(idx, 1)[0];
  saveJson(STRAINS_FILE, strains);
  res.json({ deleted: removed.id });
});

app.get('/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const results = strains.filter((s) => s.name.toLowerCase().includes(q) || (s.effects || '').toLowerCase().includes(q));
  res.json(results);
});

// Hardened auth: require Authorization header with exact token configured by JOURNAL_TOKEN
const JOURNAL_TOKEN = process.env.JOURNAL_TOKEN || 'dev-token';
function parseSessionCookie(req) {
  const header = req.headers.cookie || '';
  if (!header) return null;
  try {
    const c = cookie.parse(header || '');
    return c['session'] || null;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  let token = null;
  if (auth && auth.startsWith('Bearer ')) token = auth.slice('Bearer '.length).trim();
  if (!token) token = parseSessionCookie(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyJWT(token, JWT_SECRET);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const sid = payload.sid;
  const sess = sessions.get(sid);
  if (!sess || sess.expires < Date.now()) return res.status(401).json({ error: 'Unauthorized' });
  // attach user
  req.user = { username: sess.username, role: sess.role };
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Simple username/password auth endpoint. Returns the journal token when credentials match env vars.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
app.post('/auth', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  // admin backdoor
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    // create session for admin
    const sid = crypto.randomBytes(12).toString('hex');
    const role = 'admin';
    const expires = Date.now() + SESSION_TTL;
    sessions.set(sid, { username: ADMIN_USER, role, expires });
    const jwt = signJWT({ sid, username: ADMIN_USER, role }, JWT_SECRET);
    res.setHeader('Set-Cookie', cookie.serialize('session', jwt, { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: SESSION_TTL / 1000 }));
    return res.json({ user: { username: ADMIN_USER, role } });
  }
  // check users.json
  const u = users.find((x) => x.username === username);
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });
  // verify password using pbkdf2
  try {
    const crypto = require('crypto');
    const hash = crypto.pbkdf2Sync(String(password), Buffer.from(u.salt, 'hex'), 100000, 64, 'sha512').toString('hex');
    if (hash === u.hash) {
      // create normal user session cookie (role default 'user' unless stored)
      const sid = crypto.randomBytes(12).toString('hex');
      const role = u.role || 'user';
      const expires = Date.now() + SESSION_TTL;
      sessions.set(sid, { username: u.username, role, expires });
      const jwt = signJWT({ sid, username: u.username, role }, JWT_SECRET);
      res.setHeader('Set-Cookie', cookie.serialize('session', jwt, { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: SESSION_TTL / 1000 }));
      return res.json({ user: { username: u.username, role } });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    console.error('Auth error (signin)', err);
    return res.status(500).json({ error: 'Auth failure' });
  }
});

// Signup endpoint: stores a new user with a salted pbkdf2 hash
app.post('/auth/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (users.find((x) => x.username === username)) return res.status(409).json({ error: 'User exists' });
  try {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
    const rec = { username, salt: salt.toString('hex'), hash, displayName: username, bio: '', avatarFile: null };
    rec.favorites = [];
    users.push(rec);
    try { saveJson(USERS_FILE, users); } catch (e) { /* ignore */ }
    // create session
    const sid = crypto.randomBytes(12).toString('hex');
    const role = 'user';
    const expires = Date.now() + SESSION_TTL;
    sessions.set(sid, { username, role, expires });
    const jwt = signJWT({ sid, username, role }, JWT_SECRET);
    res.setHeader('Set-Cookie', cookie.serialize('session', jwt, { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: SESSION_TTL / 1000 }));
    return res.json({ user: { username, role } });
  } catch (err) {
    console.error('Auth error (signup)', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// OAuth helpers and routes (Google + LinkedIn)
const APP_URL = process.env.APP_URL || 'http://localhost:3001';
const SERVER_BASE = process.env.SERVER_BASE || `http://localhost:${process.env.PORT || 5002}`;

// Providers discovery: let frontend know which buttons to show
app.get('/auth/providers', (req, res) => {
  const google = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const linkedin = Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
  res.json({ google, linkedin });
});

function jsonOrRedirect(req, res, url) {
  // If client expects JSON, return {url}, otherwise redirect
  const accept = String(req.headers.accept || '');
  if (accept.includes('application/json')) return res.json({ url });
  return res.redirect(url);
}

// Start OAuth flow: returns redirect URL or redirects directly
app.get('/auth/:provider/start', (req, res) => {
  const p = String(req.params.provider || '').toLowerCase();
  if (p === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirect = `${SERVER_BASE}/auth/google/callback`;
    const scope = encodeURIComponent('openid email profile');
    const action = req.query.action === 'signup' ? 'signup' : 'signin';
    const state = crypto.randomBytes(12).toString('hex');
    oauthStates.set(state, { action, provider: 'google', created: Date.now() });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${scope}&access_type=online&prompt=select_account&state=${state}`;
    return jsonOrRedirect(req, res, url);
  }
  if (p === 'linkedin') {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const redirect = `${SERVER_BASE}/auth/linkedin/callback`;
    const scope = encodeURIComponent('r_liteprofile r_emailaddress');
    const action = req.query.action === 'signup' ? 'signup' : 'signin';
    const state = crypto.randomBytes(12).toString('hex');
    oauthStates.set(state, { action, provider: 'linkedin', created: Date.now() });
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&scope=${scope}&state=${state}`;
    return jsonOrRedirect(req, res, url);
  }
  return res.status(404).json({ error: 'Unsupported provider' });
});

async function fetchJson(url, init) {
  if (typeof fetch !== 'undefined') {
    const r = await fetch(url, init);
    return r.json();
  }
  // fallback to simple https request if global fetch not available
  return new Promise((resolve, reject) => {
    const https = require('https');
    const u = require('url').parse(url);
    const opts = {
      method: init?.method || 'GET',
      headers: init?.headers || {},
    };
    const body = init?.body;
    const req = https.request({ hostname: u.hostname, path: u.path, port: u.port || 443, method: opts.method, headers: opts.headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Helper to send a small HTML response that writes the journal token to localStorage and redirects to the app
function sendTokenAndRedirect(res, token) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing in…</title></head><body><script>
    try { localStorage.setItem('journal.token', ${JSON.stringify(token)}); } catch(e){}
    try { window.location.replace(${JSON.stringify(APP_URL + '/journal')}); } catch(e) { document.body.innerText = 'Signed in'; }
  </script></body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

// Callback for Google
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code || !state) return res.status(400).send('Missing code/state');
  const stateRec = oauthStates.get(String(state));
  if (!stateRec) return res.status(400).send('Invalid state');
  oauthStates.delete(String(state));
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams();
  params.append('code', code);
  params.append('client_id', process.env.GOOGLE_CLIENT_ID || '');
  params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET || '');
  params.append('redirect_uri', `${SERVER_BASE}/auth/google/callback`);
  params.append('grant_type', 'authorization_code');
  try {
    const tokenResp = await fetchJson(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const accessToken = tokenResp.access_token;
    const profile = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    // profile contains email and sub
    const email = profile.email || profile.sub;
    if (!email) return res.status(400).send('No email');
    // create user if signup or ensure user exists
    let u = users.find((x) => x.username === email);
    if (!u && stateRec.action === 'signup') {
      // create simple user record without password
      u = { username: email, oauth: true, provider: 'google', role: 'user' };
      users.push(u);
      saveJson(USERS_FILE, users);
    }
    if (!u && stateRec.action === 'signin') return res.status(403).send('User not found');
    // create session and JWT cookie
    const sid = crypto.randomBytes(12).toString('hex');
    const role = u.role || 'user';
    const expires = Date.now() + SESSION_TTL;
    sessions.set(sid, { username: u.username, role, expires });
    const jwt = signJWT({ sid, username: u.username, role }, JWT_SECRET);
    res.setHeader('Set-Cookie', cookie.serialize('session', jwt, { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: SESSION_TTL / 1000 }));
    return res.redirect(`${APP_URL}/journal`);
  } catch (err) {
    console.error('Google callback error', err);
    return res.status(500).send('Auth failed');
  }
});

// Callback for LinkedIn
app.get('/auth/linkedin/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  if (!code || !state) return res.status(400).send('Missing code/state');
  const stateRec = oauthStates.get(String(state));
  if (!stateRec) return res.status(400).send('Invalid state');
  oauthStates.delete(String(state));
  const tokenUrl = `https://www.linkedin.com/oauth/v2/accessToken`;
  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', `${SERVER_BASE}/auth/linkedin/callback`);
  params.append('client_id', process.env.LINKEDIN_CLIENT_ID || '');
  params.append('client_secret', process.env.LINKEDIN_CLIENT_SECRET || '');
  try {
    const tokenResp = await fetchJson(tokenUrl + '?' + params.toString(), { method: 'POST' });
    const accessToken = tokenResp.access_token;
    const profile = await fetchJson('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', { headers: { Authorization: `Bearer ${accessToken}` } });
    const email = profile?.elements?.[0]?.['handle~']?.emailAddress;
    if (!email) return res.status(400).send('No email');
    let u = users.find((x) => x.username === email);
    if (!u && stateRec.action === 'signup') {
      u = { username: email, oauth: true, provider: 'linkedin', role: 'user' };
      users.push(u);
      saveJson(USERS_FILE, users);
    }
    if (!u && stateRec.action === 'signin') return res.status(403).send('User not found');
    const sid = crypto.randomBytes(12).toString('hex');
    const role = u.role || 'user';
    const expires = Date.now() + SESSION_TTL;
    sessions.set(sid, { username: u.username, role, expires });
    const jwt = signJWT({ sid, username: u.username, role }, JWT_SECRET);
    res.setHeader('Set-Cookie', cookie.serialize('session', jwt, { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: SESSION_TTL / 1000 }));
    return res.redirect(`${APP_URL}/journal`);
  } catch (err) {
    console.error('LinkedIn callback error', err);
    return res.status(500).send('Auth failed');
  }
});

// Auth status and logout
app.get('/auth/me', (req, res) => {
  // Read session cookie and validate JWT + in-memory session
  const token = parseSessionCookie(req);
  if (!token) return res.status(401).json({ authenticated: false });
  const payload = verifyJWT(token, JWT_SECRET);
  if (!payload) return res.status(401).json({ authenticated: false });
  const sid = payload.sid;
  const sess = sessions.get(sid);
  if (!sess || sess.expires < Date.now()) return res.status(401).json({ authenticated: false });
  const u = findUser(sess.username) || { displayName: sess.username, bio: '', avatarFile: null };
  return res.json({ authenticated: true, user: { username: sess.username, role: sess.role, displayName: u.displayName || sess.username, bio: u.bio || '', avatar: u.avatarFile ? `/uploads/${u.avatarFile}` : null } });
});

app.post('/auth/logout', (req, res) => {
  // Clear the session cookie
  res.setHeader('Set-Cookie', cookie.serialize('session', '', { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: 0 }));
  return res.json({ ok: true });
});

// Admin-only: list users (do not expose hashes)
app.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  const list = users.map((u) => ({ username: u.username, oauth: u.oauth || false, provider: u.provider || null }));
  res.json(list);
});

// Admin-only: delete user
app.delete('/auth/users/:username', requireAuth, requireRole('admin'), (req, res) => {
  const username = String(req.params.username || '');
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  users.splice(idx, 1);
  try { saveJson(USERS_FILE, users); } catch (e) {}
  res.json({ ok: true });
});

// Profile endpoints
app.get('/profile', requireAuth, (req, res) => {
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ username: u.username, displayName: u.displayName || u.username, bio: u.bio || '', avatar: u.avatarFile ? `/uploads/${u.avatarFile}` : null });
});

app.put('/profile', requireAuth, (req, res) => {
  const { displayName, bio } = req.body || {};
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (typeof displayName === 'string' && displayName.trim()) u.displayName = displayName.trim().slice(0, 60);
  if (typeof bio === 'string') u.bio = bio.slice(0, 500);
  try { saveJson(USERS_FILE, users); } catch (e) {}
  res.json({ ok: true, profile: { username: u.username, displayName: u.displayName, bio: u.bio, avatar: u.avatarFile ? `/uploads/${u.avatarFile}` : null } });
});

// Basic avatar upload (base64 or multipart). We'll accept JSON { dataUrl: "data:image/..." }
app.post('/profile/avatar', requireAuth, express.json({ limit: '2mb' }), (req, res) => {
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    return res.status(400).json({ error: 'Invalid image' });
  }
  try {
    const comma = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, comma);
  const extMatch = /data:image\/(png|jpeg|jpg|webp)/.exec(meta);
  const ext = (extMatch && extMatch[1]) || 'png';
    const base64 = dataUrl.slice(comma + 1);
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 1024 * 1024 * 2) return res.status(413).json({ error: 'Too large' });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    u.avatarFile = name;
    saveJson(USERS_FILE, users);
    res.json({ ok: true, avatar: `/uploads/${name}` });
  } catch (err) {
    console.error('Avatar upload error', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Serve uploaded avatars statically
app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false }));

// Delete current user account (self-service). Removes user, their journal entries, active sessions, and clears cookie.
app.delete('/profile', requireAuth, (req, res) => {
  const username = req.user.username;
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  // Remove user
  const removed = users.splice(idx, 1)[0];
  // Remove journal entries owned by user
  journalEntries = journalEntries.filter(e => String(e.owner || '') !== String(username));
  // Clear sessions associated with user
  for (const [sid, sess] of sessions) if (sess.username === username) sessions.delete(sid);
  // Persist changes
  try { saveJson(USERS_FILE, users); } catch (e) {}
  try { saveJson(JOURNAL_FILE, journalEntries); } catch (e) {}
  // Clear cookie
  res.setHeader('Set-Cookie', cookie.serialize('session', '', { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: 0 }));
  res.json({ ok: true, deleted: true });
});

// Journal endpoints for client sync
app.get('/journal', requireAuth, (req, res) => {
  const username = req.user?.username;
  const own = journalEntries.filter((e) => String(e.owner || '') === String(username));
  res.json(own);
});

// Accept either a single entry or an array of entries
app.post('/journal', requireAuth, (req, res) => {
  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Missing body' });
  const items = Array.isArray(body) ? body : [body];
  const username = req.user?.username;
  for (const it of items) {
    const copy = Object.assign({}, it, { owner: username });
    const exists = journalEntries.findIndex((e) => e.id === it.id && String(e.owner || '') === String(username));
    if (exists !== -1) {
      journalEntries[exists] = copy;
    } else {
      journalEntries.push(copy);
    }
  }
  saveJson(JOURNAL_FILE, journalEntries);
  const count = journalEntries.filter((e) => String(e.owner || '') === String(username)).length;
  res.json({ ok: true, count });
});

// ----- Phase 1: Effect aggregation & recommendations -----
const EFFECT_KEYS = ['relaxation','energy','focus','euphoria','body','head'];

function aggregateEffectsForStrain(strainId) {
  const relevant = journalEntries.filter(e => e.strainId && String(e.strainId) === String(strainId) && e.effectScores);
  if (!relevant.length) return { count: 0, averages: Object.fromEntries(EFFECT_KEYS.map(k=>[k,0])) };
  const sums = Object.fromEntries(EFFECT_KEYS.map(k => [k,0]));
  for (const e of relevant) {
    for (const k of EFFECT_KEYS) {
      if (e.effectScores && typeof e.effectScores[k] === 'number') sums[k] += e.effectScores[k];
    }
  }
  const averages = Object.fromEntries(EFFECT_KEYS.map(k => [k, +(sums[k] / relevant.length).toFixed(2)]));
  return { count: relevant.length, averages };
}

app.get('/strains/:id/aggregate-effects', (req, res) => {
  const { id } = req.params;
  const agg = aggregateEffectsForStrain(id);
  res.json(agg);
});

app.get('/recommendations', requireAuth, (req, res) => {
  const username = req.user.username;
  const userEntries = journalEntries.filter(e => e.owner === username && e.effectScores);
  const rated = userEntries.filter(e => typeof e.rating === 'number');
  if (!userEntries.length) return res.json([]);
  // Build user preference vector (average of effectScores weighted by rating >=4 extra weight)
  const weightVec = Object.fromEntries(EFFECT_KEYS.map(k => [k,0]));
  let totalW = 0;
  for (const e of rated) {
    const w = e.rating >= 4 ? 1.5 : 1.0;
    totalW += w;
    for (const k of EFFECT_KEYS) {
      const v = e.effectScores?.[k];
      if (typeof v === 'number') weightVec[k] += v * w;
    }
  }
  const userVec = Object.fromEntries(EFFECT_KEYS.map(k => [k, totalW ? weightVec[k] / totalW : 0]));
  function cosine(a,b){
    let dot=0, na=0, nb=0; for (const k of EFFECT_KEYS){ const av=a[k]||0, bv=b[k]||0; dot+=av*bv; na+=av*av; nb+=bv*bv; }
    if (!na || !nb) return 0; return dot / (Math.sqrt(na)*Math.sqrt(nb));
  }
  const userStrainIds = new Set(userEntries.map(e => String(e.strainId)));
  // Favorite-based boost: compute similarity to favorite strains' aggregated effect vectors
  const userRec = findUser(username);
  let favoriteEffectVectors = [];
  if (userRec && Array.isArray(userRec.favorites) && userRec.favorites.length) {
    for (const fav of userRec.favorites) {
      const id = String(fav.id || fav);
      const agg = aggregateEffectsForStrain(id);
      if (agg.count) favoriteEffectVectors.push(agg.averages);
    }
  }
  function favoriteSimilarity(effects) {
    if (!favoriteEffectVectors.length) return 0;
    let best = 0;
    for (const fv of favoriteEffectVectors) {
      let dot=0, na=0, nb=0; for (const k of EFFECT_KEYS){ const av=fv[k]||0, bv=effects[k]||0; dot+=av*bv; na+=av*av; nb+=bv*bv; }
      if (na && nb) { const sim = dot / (Math.sqrt(na)*Math.sqrt(nb)); if (sim > best) best = sim; }
    }
    return best;
  }
  const candidates = strains.filter(s => s.id && !userStrainIds.has(String(s.id)));
  const recs = candidates.map(s => {
    const agg = aggregateEffectsForStrain(s.id);
    if (!agg.count) return null;
    const sim = cosine(userVec, agg.averages);
    const favSim = favoriteSimilarity(agg.averages);
    const score = sim * 0.8 + favSim * 0.2; // blend
    return { strainId: s.id, name: s.name, similarity: +sim.toFixed(3), favoriteSimilarity: +favSim.toFixed(3), score: +score.toFixed(3), sampleSize: agg.count, effects: agg.averages };
  }).filter(Boolean).sort((a,b)=> b.score - a.score).slice(0,5);
  res.json(recs);
});

// ----- Achievements (Phase 1 + tiers persisted server-side) -----
// Simple runtime calculation; for scale move to cached structure later.
// Tiers: bronze, silver, gold, platinum
// Icons chosen for quick visual scan (can be replaced with SVGs later)
const ACHIEVEMENTS = [
  // Unique strain explorer path
  { id: 'explorer_5',   name: 'Explorer I',   desc: 'Log 5 unique strains',   type: 'uniqueStrains', target: 5,   tier: 'bronze',   icon: '🥉' },
  { id: 'explorer_10',  name: 'Explorer II',  desc: 'Log 10 unique strains',  type: 'uniqueStrains', target: 10,  tier: 'silver',   icon: '🥈' },
  { id: 'explorer_20',  name: 'Explorer III', desc: 'Log 20 unique strains',  type: 'uniqueStrains', target: 20,  tier: 'gold',     icon: '🥇' },
  { id: 'explorer_40',  name: 'Explorer IV',  desc: 'Log 40 unique strains',  type: 'uniqueStrains', target: 40,  tier: 'platinum', icon: '💎' },
  // Streak path
  { id: 'streak_3',     name: 'Consistency I',  desc: '3 day logging streak',  type: 'streak', target: 3,   tier: 'bronze',   icon: '🥉' },
  { id: 'streak_7',     name: 'Consistency II', desc: '7 day logging streak',  type: 'streak', target: 7,   tier: 'silver',   icon: '🥈' },
  { id: 'streak_14',    name: 'Consistency III',desc: '14 day logging streak', type: 'streak', target: 14,  tier: 'gold',     icon: '🥇' },
  { id: 'streak_30',    name: 'Consistency IV', desc: '30 day logging streak', type: 'streak', target: 30,  tier: 'platinum', icon: '💎' }
];

function computeAchievements(username) {
  const entries = journalEntries
    .filter(e => e.owner === username)
    .sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));

  // Unique strains (exclude blank/undefined)
  const uniqueStrainSet = new Set(entries.map(e => e.strainId ? String(e.strainId) : '').filter(s => s));
  const uniqueStrains = uniqueStrainSet.size;

  // Streak: consecutive days counting back from the most recent entry date
  let streak = 0;
  if (entries.length) {
    let prevDate = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const d = new Date(entries[i].timestamp);
      if (isNaN(d)) continue; // skip malformed dates
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (!prevDate) { streak = 1; prevDate = day; continue; }
      const diffDays = Math.round((prevDate - day) / 86400000);
      if (diffDays === 1) { streak++; prevDate = day; }
      else if (diffDays === 0) { continue; }
      else { break; }
    }
  }

  return ACHIEVEMENTS.map(a => {
    let progress = 0;
    if (a.type === 'uniqueStrains') progress = uniqueStrains;
    if (a.type === 'streak') progress = streak;
    return {
      id: a.id,
      name: a.name,
      description: a.desc,
      unlocked: progress >= a.target,
      progress,
      target: a.target,
      tier: a.tier,
      icon: a.icon
    };
  });
}

app.get('/achievements', requireAuth, (req, res) => {
  const list = computeAchievements(req.user.username);
  res.json(list);
});

// ----- Favorites Endpoints -----
app.get('/favorites', requireAuth, (req, res) => {
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (!Array.isArray(u.favorites)) u.favorites = [];
  res.json(u.favorites);
});

app.post('/favorites/:id', requireAuth, (req, res) => {
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (!Array.isArray(u.favorites)) u.favorites = [];
  const id = String(req.params.id);
  if (!u.favorites.find(f => String(f.id || f) === id)) {
    u.favorites.push({ id, addedAt: new Date().toISOString() });
  }
  try { saveJson(USERS_FILE, users); } catch (e) {}
  res.json({ ok: true, favorites: u.favorites });
});

app.delete('/favorites/:id', requireAuth, (req, res) => {
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (!Array.isArray(u.favorites)) u.favorites = [];
  const id = String(req.params.id);
  u.favorites = u.favorites.filter(f => String(f.id || f) !== id);
  try { saveJson(USERS_FILE, users); } catch (e) {}
  res.json({ ok: true, favorites: u.favorites });
});

// ----- User Weekly Summary Stats -----
function computeUserSummary(username) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // today 00:00
  const start7 = new Date(start.getTime() - 6 * 86400000); // include today -> 7 days window
  const entries = journalEntries.filter(e => e.owner === username);
  const last7 = entries.filter(e => {
    const d = new Date(e.timestamp);
    if (isNaN(d)) return false;
    return d >= start7 && d <= now;
  });

  // Activity by day map
  const activityMap = new Map();
  for (let i=0;i<7;i++) {
    const day = new Date(start7.getFullYear(), start7.getMonth(), start7.getDate() + i);
    const key = day.toISOString().slice(0,10);
    activityMap.set(key, 0);
  }
  for (const e of last7) {
    const d = new Date(e.timestamp);
    if (isNaN(d)) continue;
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
    if (activityMap.has(key)) activityMap.set(key, activityMap.get(key)+1);
  }
  const activityByDay = Array.from(activityMap.entries()).map(([date,count])=>({date,count}));

  // Unique strains
  const uniqueAll = new Set(entries.map(e => e.strainId ? String(e.strainId) : '').filter(Boolean));
  const unique7 = new Set(last7.map(e => e.strainId ? String(e.strainId) : '').filter(Boolean));

  // Rating averages
  function avg(list, accessor) {
    const vals = list.map(accessor).filter(v => typeof v === 'number');
    if (!vals.length) return 0;
    return +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
  }
  const ratingAverageLast7 = avg(last7, e => e.rating);
  const ratingAverageAllTime = avg(entries, e => e.rating);

  // Effect averages (last 7)
  const effectSums = Object.fromEntries(EFFECT_KEYS.map(k=>[k,0]));
  let effectCount = 0;
  for (const e of last7) {
    if (!e.effectScores) continue;
    let contributed = false;
    for (const k of EFFECT_KEYS) {
      const v = e.effectScores[k];
      if (typeof v === 'number') { effectSums[k]+=v; contributed = true; }
    }
    if (contributed) effectCount++;
  }
  const effectAveragesLast7 = Object.fromEntries(EFFECT_KEYS.map(k => [k, effectCount? +(effectSums[k]/effectCount).toFixed(2):0]));

  // Top strains last 7 (by count then avg rating) limit 3
  const strainStats = new Map();
  for (const e of last7) {
    if (!e.strainId) continue;
    const key = String(e.strainId);
    if (!strainStats.has(key)) strainStats.set(key, { count:0, ratings:[], name: e.strainName || '' });
    const rec = strainStats.get(key);
    rec.count++;
    if (typeof e.rating === 'number') rec.ratings.push(e.rating);
    if (!rec.name && e.strainName) rec.name = e.strainName;
  }
  const topStrainsLast7 = Array.from(strainStats.entries()).map(([id,rec])=>({
    strainId: id,
    name: rec.name || (strains.find(s=>String(s.id)===id)?.name || 'Unknown'),
    count: rec.count,
    avgRating: rec.ratings.length ? +(rec.ratings.reduce((a,b)=>a+b,0)/rec.ratings.length).toFixed(2) : 0
  })).sort((a,b)=> b.count - a.count || b.avgRating - a.avgRating).slice(0,3);

  // Streak reuse (mirror logic in computeAchievements but without duplication). We'll compute fresh.
  let streak = 0;
  const sorted = entries.slice().sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
  if (sorted.length) {
    let prevDate = null;
    for (let i = sorted.length -1; i>=0; i--) {
      const d = new Date(sorted[i].timestamp);
      if (isNaN(d)) continue;
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (!prevDate) { streak = 1; prevDate = day; continue; }
      const diffDays = Math.round((prevDate - day)/86400000);
      if (diffDays === 1) { streak++; prevDate = day; }
      else if (diffDays === 0) { continue; }
      else { break; }
    }
  }

  return {
    period: { start: start7.toISOString().slice(0,10), end: start.toISOString().slice(0,10) },
    counts: {
      last7: last7.length,
      allTime: entries.length,
      uniqueStrainsLast7: unique7.size,
      uniqueStrainsAllTime: uniqueAll.size
    },
    streak,
    ratingAverageLast7,
    ratingAverageAllTime,
    effectAveragesLast7,
    topStrainsLast7,
    activityByDay
  };
}

app.get('/stats/summary', requireAuth, (req, res) => {
  try {
    const summary = computeUserSummary(req.user.username);
    res.json(summary);
  } catch (e) {
    console.error('Summary error', e);
    res.status(500).json({ error: 'Failed to compute summary' });
  }
});

// Mappings endpoints for manual disambiguation
// mappings functionality removed

const port = process.env.PORT || 5002;
// Basic health endpoint for quick diagnostics
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), users: users.length, strains: strains.length });
});
app.listen(port, () => console.log(`Backend API listening on http://localhost:${port}`));
