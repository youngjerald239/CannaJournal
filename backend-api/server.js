const express = require('express');
const cors = require('cors');

const fs = require('fs');
const path = require('path');

const cookie = require('cookie');
const crypto = require('crypto');
const app = express();
app.use(cors({ origin: process.env.APP_URL || 'http://localhost:3001', credentials: true }));
app.use(express.json());

// simple in-memory state store for OAuth 'state' validation
const oauthStates = new Map(); // state -> { action, provider, created }

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

app.get('/strains', (req, res) => {
  res.json(strains);
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
function parseCookieToken(req) {
  const header = req.headers.cookie || '';
  if (!header) return null;
  try {
    const c = cookie.parse(header || '');
    return c['journal_token'] || null;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  let token = null;
  if (auth && auth.startsWith('Bearer ')) token = auth.slice('Bearer '.length).trim();
  if (!token) token = parseCookieToken(req);
  if (!token || token !== JOURNAL_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Simple username/password auth endpoint. Returns the journal token when credentials match env vars.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
app.post('/auth', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  // admin backdoor
  if (username === ADMIN_USER && password === ADMIN_PASS) return res.json({ token: JOURNAL_TOKEN });
  // check users.json
  const u = users.find((x) => x.username === username);
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });
  // verify password using pbkdf2
  try {
    const crypto = require('crypto');
    const hash = crypto.pbkdf2Sync(String(password), Buffer.from(u.salt, 'hex'), 100000, 64, 'sha512').toString('hex');
    if (hash === u.hash) return res.json({ token: JOURNAL_TOKEN });
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
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
    const rec = { username, salt: salt.toString('hex'), hash };
    users.push(rec);
    try { saveJson(USERS_FILE, users); } catch (e) { /* ignore */ }
    return res.json({ token: JOURNAL_TOKEN });
  } catch (err) {
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// OAuth helpers and routes (Google + LinkedIn)
const APP_URL = process.env.APP_URL || 'http://localhost:3001';
const SERVER_BASE = process.env.SERVER_BASE || `http://localhost:${process.env.PORT || 5002}`;

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
      u = { username: email, oauth: true, provider: 'google' };
      users.push(u);
      saveJson(USERS_FILE, users);
    }
    if (!u && stateRec.action === 'signin') return res.status(403).send('User not found');
    // set httpOnly cookie
    res.setHeader('Set-Cookie', cookie.serialize('journal_token', String(JOURNAL_TOKEN), { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 7 }));
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
      u = { username: email, oauth: true, provider: 'linkedin' };
      users.push(u);
      saveJson(USERS_FILE, users);
    }
    if (!u && stateRec.action === 'signin') return res.status(403).send('User not found');
    res.setHeader('Set-Cookie', cookie.serialize('journal_token', String(JOURNAL_TOKEN), { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 7 }));
    return res.redirect(`${APP_URL}/journal`);
  } catch (err) {
    console.error('LinkedIn callback error', err);
    return res.status(500).send('Auth failed');
  }
});

// Auth status and logout
app.get('/auth/me', (req, res) => {
  const token = parseCookieToken(req);
  if (!token || token !== JOURNAL_TOKEN) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true });
});

app.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', cookie.serialize('journal_token', '', { httpOnly: true, secure: false, path: '/', sameSite: 'lax', maxAge: 0 }));
  return res.json({ ok: true });
});

// Admin-only: list users (do not expose hashes)
app.get('/users', requireAuth, (req, res) => {
  const list = users.map((u) => ({ username: u.username, oauth: u.oauth || false, provider: u.provider || null }));
  res.json(list);
});

// Admin-only: delete user
app.delete('/auth/users/:username', requireAuth, (req, res) => {
  const username = String(req.params.username || '');
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  users.splice(idx, 1);
  try { saveJson(USERS_FILE, users); } catch (e) {}
  res.json({ ok: true });
});

// Journal endpoints for client sync
app.get('/journal', requireAuth, (req, res) => {
  res.json(journalEntries);
});

// Accept either a single entry or an array of entries
app.post('/journal', requireAuth, (req, res) => {
  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Missing body' });
  const items = Array.isArray(body) ? body : [body];
  for (const it of items) {
    // avoid duplicate ids
    const exists = journalEntries.findIndex((e) => e.id === it.id);
    if (exists !== -1) {
      journalEntries[exists] = it;
    } else {
      journalEntries.push(it);
    }
  }
  saveJson(JOURNAL_FILE, journalEntries);
  res.json({ ok: true, count: journalEntries.length });
});

// Mappings endpoints for manual disambiguation
// mappings functionality removed

const port = process.env.PORT || 5002;
app.listen(port, () => console.log(`Backend API listening on http://localhost:${port}`));
