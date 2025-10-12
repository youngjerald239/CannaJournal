require('dotenv').config();
// Environment validation (skip in test mode)
if (process.env.NODE_ENV !== 'test') {
  try { require('./scripts/check-env'); } catch (e) { console.error('Env validation failed:', e.message); process.exit(1); }
}
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const fs = require('fs');
const path = require('path');
const s3 = (()=>{ try { return require('./s3'); } catch(_) { return null; } })();

const cookie = require('cookie');
const crypto = require('crypto');
const app = express();
// Attempt to load Data Access Layer (DAL) which wraps Postgres operations.
let dal = null;
try { dal = require('./dal'); } catch (e) { console.warn('DAL not loaded:', e.message); }
// Simplified permissive CORS for local development (echo request origin if present)
app.set('trust proxy', 1); // in case deployed behind proxy
// Configurable allowed origins (comma separated) or fallback permissive for dev
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o=>o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // non-browser / same-origin
    if (!ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked')); },
  credentials: true
}));
// Security headers (minimal CSP allowing self & images from https)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Allow http for local MinIO and local development
      "img-src": ["'self'", 'data:', 'https:', 'http:', 'blob:'],
      "connect-src": ["'self'", 'https:', 'http:'],
    }
  }
}));
// Compression for faster responses
app.use(compression());
// Basic request logging (skip noisy health checks)
app.use(morgan('tiny', { skip: (req)=> req.path === '/health' }));
// JSON parsing
app.use(express.json({ limit: '1mb' }));
// Global rate limiter (broad protection)
app.use(rateLimit({ windowMs: 5*60*1000, max: 600, standardHeaders: true, legacyHeaders: false }));
// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({ windowMs: 10*60*1000, max: 50, message: { error: 'Too many auth attempts, please try later.' }});
app.use(['/auth','/auth/signup'], authLimiter);

// OAuth removed: previously oauthStates map & TTL

// sessions store: sid -> { username, role, expires }
const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

// Uploads directory (for avatar files)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR); } catch (e) { console.error('Could not create uploads dir', e.message); }
const GUIDES_UPLOAD_DIR = path.join(UPLOADS_DIR, 'guides');
try { if (!fs.existsSync(GUIDES_UPLOAD_DIR)) fs.mkdirSync(GUIDES_UPLOAD_DIR); } catch (e) { /* ignore */ }

// -------------------- Data Layer (JSON Fallback) --------------------
const DATA_DIR = path.join(__dirname, 'data');
const STRAINS_FILE = path.join(DATA_DIR, 'strains.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const JOURNAL_FILE = path.join(DATA_DIR, 'journal.json');

function loadJson(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch(_) { return fallback; } }
function saveJson(file, data){ try { fs.writeFileSync(file, JSON.stringify(data,null,2)); } catch(_) { /* ignore */ } }

let strains = loadJson(STRAINS_FILE, []);
let users = loadJson(USERS_FILE, []);
let journalEntries = loadJson(JOURNAL_FILE, []);

function findUser(username){ return users.find(u => u.username === username); }

let strainsETag = null;
function updateStrainsETag(){
  try {
    strainsETag = 'W/"' + crypto.createHash('sha1').update(String(strains.length)+JSON.stringify(strains.map(s=>s.id))).digest('hex').slice(0,16) + '"';
  } catch(_) { strainsETag = null; }
}
updateStrainsETag();

// -------------------- Postgres Init (if enabled) --------------------
let pgEnabled = false;
(async function initPgIfReady(){
  if (process.env.NODE_ENV === 'test') return; // skip async init in tests
  if (!dal || !process.env.DATABASE_URL) return;
  try {
    const { initPg } = require('./db');
    const { enabled } = await initPg();
    pgEnabled = enabled;
    if (pgEnabled) {
      try { strains = await dal.getAllStrains(); updateStrainsETag(); } catch(_) {}
      // Ensure a single general conversation exists for feed features
      try {
        const { findGeneralConversation, createGeneralConversation } = require('./chatDal');
        const existing = await findGeneralConversation();
        if (!existing) {
          await createGeneralConversation();
          console.log('[feed] created general conversation');
        }
      } catch(e){ console.warn('[feed] could not ensure general conversation:', e.message); }
      // Apply missing migration for conversations type constraint if necessary
      try {
        const { query } = require('./db');
        // Detect if constraint missing 'general'
        const { rows } = await query(`SELECT conname FROM pg_constraint WHERE conname='conversations_type_check'`);
        if (rows.length){
          // Check if any 'general' row exists, if not attempt insert; will error if constraint wrong
          const test = await query(`SELECT 1 FROM conversations WHERE type='general' LIMIT 1`);
          if (!test.rows.length){
            // Try insert; if it fails due to constraint, run migration 005
            let needMigration = false;
            try { await query(`INSERT INTO conversations (type,title) VALUES ('general','General Chat') RETURNING id`); }
            catch(err){ needMigration = /conversations_type_check/.test(err.message); }
            if (needMigration){
              console.log('[migrate] applying inline 005_allow_general_conversation');
              await query(`ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_type_check;`);
              await query(`ALTER TABLE conversations ADD CONSTRAINT conversations_type_check CHECK (type IN ('direct','group','general'));`);
              await query(`INSERT INTO conversations (type,title) SELECT 'general','General Chat' WHERE NOT EXISTS (SELECT 1 FROM conversations WHERE type='general');`);
              console.log('[migrate] general conversation ensured');
            }
          }
        }
      } catch(e){ console.warn('[migrate] inline general conversation check failed:', e.message); }
      // Backfill media tokens for legacy attachment messages (once)
      try {
        const { query } = require('./db');
        const { rows: need } = await query(`SELECT COUNT(*)::int AS c FROM messages WHERE attachment_id IS NOT NULL AND (content_text IS NULL OR content_text NOT LIKE ('%[media:' || attachment_id || ']%'))`);
        if (need[0].c > 0){
          console.log(`[backfill] adding media tokens to ${need[0].c} messages`);
          await query(`UPDATE messages SET content_text = COALESCE(NULLIF(content_text,''),'') || (CASE WHEN content_text ~ ('\\n$') THEN '' ELSE '\n' END) || '[media:' || attachment_id || ']' WHERE attachment_id IS NOT NULL AND (content_text IS NULL OR content_text NOT LIKE ('%[media:' || attachment_id || ']%'))`);
          console.log('[backfill] media tokens applied');
        }
      } catch(e){ console.warn('[backfill] media token update failed:', e.message); }
    }
  } catch (e) {
    console.warn('Postgres init failed (fallback to JSON):', e.message);
  }
})();

function cleanupStores() {
  const now = Date.now();
  // OAuth cleanup removed
  for (const [sid, v] of sessions) if (v.expires < now) sessions.delete(sid);
}
if (process.env.NODE_ENV !== 'test') {
  setInterval(cleanupStores, 1000 * 60);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// -------------------- JWT / Session Helpers --------------------
function signJWT(payload, secret){
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = (obj) => base64url(JSON.stringify(obj));
  const h = enc(header);
  const p = enc({ ...payload, iat: Math.floor(Date.now()/1000) });
  const data = h + '.' + p;
  const sig = base64url(crypto.createHmac('sha256', secret).update(data).digest());
  return data + '.' + sig;
}
function verifyJWT(token, secret){
  try {
    const [h,p,s] = token.split('.');
    if (!h || !p || !s) return null;
    const expected = base64url(crypto.createHmac('sha256', secret).update(h + '.' + p).digest());
    if (expected !== s) return null;
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
  } catch(_) { return null; }
}
function setSessionCookie(res, token, maxAgeSeconds){
  const isProd = process.env.NODE_ENV === 'production';
  // In cross-origin deployments (Netlify frontend -> Render backend), cookies must be SameSite=None; Secure
  const sameSite = isProd ? 'none' : 'lax';
  const secure = isProd ? true : false;
  res.setHeader('Set-Cookie', cookie.serialize('session', token, {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    maxAge: maxAgeSeconds
  }));
}
function clearSessionCookie(res){
  const isProd = process.env.NODE_ENV === 'production';
  const sameSite = isProd ? 'none' : 'lax';
  const secure = isProd ? true : false;
  res.setHeader('Set-Cookie', cookie.serialize('session', '', {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    maxAge: 0
  }));
}

// OAuth routes removed; only local auth remains.

app.get('/strains', async (req, res) => {
  if (strainsETag && req.headers['if-none-match'] === strainsETag) {
    return res.status(304).end();
  }
  if (pgEnabled && dal && !strains.length) {
    try { strains = await dal.getAllStrains(); updateStrainsETag(); } catch (e) { /* ignore */ }
  }
  let favSet = null;
  try {
    const token = parseSessionCookie(req);
    if (token) {
      const payload = verifyJWT(token, JWT_SECRET);
      if (payload) {
        const sess = sessions.get(payload.sid);
        if (sess) {
          if (pgEnabled && dal) {
            const favs = await dal.listFavorites(sess.username).catch(()=>[]);
            favSet = new Set(favs.map(f=> String(f.id)));
          } else {
            const u = findUser(sess.username);
            if (u && Array.isArray(u.favorites)) favSet = new Set(u.favorites.map(x=> String(x.id || x)));
          }
        }
      }
    }
  } catch (e) { /* ignore */ }
  const enriched = strains.map(s => {
    const copy = { ...s };
    if (!copy.cannabinoids) copy.cannabinoids = { thc: copy.thc ?? null, cbd: copy.cbd ?? null };
    if (!copy.terpenes) {
      const seed = (typeof copy.id === 'number' ? copy.id : 1) * 9301 % 233280;
      function rand(f) { return ((seed * (f+1)) % 97) / 300; }
      copy.terpenes = { myrcene: +rand(1).toFixed(2), limonene: +rand(2).toFixed(2), caryophyllene: +rand(3).toFixed(2), pinene: +rand(4).toFixed(2), linalool: +rand(5).toFixed(2) };
    }
    if (favSet) copy.favorite = favSet.has(String(copy.id));
    return copy;
  });
  if (strainsETag) {
    res.setHeader('ETag', strainsETag);
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  }
  res.json(enriched);
});

app.get('/strains/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = strains.find((x) => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

app.post('/strains', async (req, res) => {
  const body = req.body || {};
  if (pgEnabled && dal) {
    try {
      const created = await dal.insertStrain(body);
      strains = await dal.getAllStrains();
      updateStrainsETag();
      const entry = strains.find(s => s.id === created.id) || { id: created.id, ...body };
      return res.status(201).json(entry);
    } catch (e) {
      console.error('Insert strain failed', e);
      return res.status(500).json({ error: 'Failed to insert strain' });
    }
  }
  const id = strains.length ? Math.max(...strains.map((s) => s.id)) + 1 : 1;
  const entry = { id, ...body };
  strains.push(entry);
  try { saveJson(STRAINS_FILE, strains); } catch (e) {}
  updateStrainsETag();
  res.status(201).json(entry);
});

app.delete('/strains/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (pgEnabled && dal) {
    try { await dal.deleteStrain(id); } catch (e) { return res.status(500).json({ error: 'Delete failed' }); }
    strains = strains.filter(s => s.id !== id);
    updateStrainsETag();
    return res.json({ deleted: id });
  }
  const idx = strains.findIndex((s) => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = strains.splice(idx, 1)[0];
  try { saveJson(STRAINS_FILE, strains); } catch (e) {}
  updateStrainsETag();
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

// Return current authenticated user metadata
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    if (pgEnabled && dal) {
      const u = await dal.findUser(req.user.username);
      if (!u) return res.status(404).json({ error: 'Not found' });
      const avatar = generateAvatarMeta(u.username);
      return res.json({ authenticated: true, user: { username: u.username, role: u.role, email: u.email || null, displayName: u.display_name || u.username, avatar } });
    }
    // JSON fallback
    const u = users.find(x=> x.username === req.user.username);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const avatar = generateAvatarMeta(u.username);
    return res.json({ authenticated: true, user: { username: u.username, role: u.role || 'user', email: null, displayName: u.displayName || u.username, avatar } });
  } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

function generateAvatarMeta(username){
  // Deterministic color & initials
  const colors = ['#059669','#047857','#065f46','#064e3b','#10b981','#0d9488','#0369a1'];
  let hash = 0; for (let i=0;i<username.length;i++) hash = (hash*31 + username.charCodeAt(i)) >>> 0;
  const color = colors[hash % colors.length];
  const text = username.slice(0,2).toUpperCase();
  return { color, text };
}

// Simple username/password auth endpoint. Returns the journal token when credentials match env vars.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
// Simple ephemeral rate limiter (IP + route): window 10m
const signupHits = new Map(); // key -> { count, reset }
function rateLimitSignup(ip){
  const now = Date.now();
  const rec = signupHits.get(ip) || { count:0, reset: now + 10*60*1000 };
  if (now > rec.reset){ rec.count = 0; rec.reset = now + 10*60*1000; }
  rec.count++;
  signupHits.set(ip, rec);
  return rec.count <= 30; // allow 30 per 10 minutes per IP
}
app.post('/auth', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  // Admin login: treat provided identifier as username
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const sid = crypto.randomBytes(12).toString('hex');
    const role = 'admin';
    const expires = Date.now() + SESSION_TTL;
    sessions.set(sid, { username: ADMIN_USER, role, expires });
    const jwt = signJWT({ sid, username: ADMIN_USER, role }, JWT_SECRET);
    setSessionCookie(res, jwt, SESSION_TTL / 1000);
    return res.json({ user: { username: ADMIN_USER, role } });
  }
  let u = null;
  if (pgEnabled && dal) {
    try {
      // Accept either raw username or email identifier
      u = await dal.findUser(username);
      if (!u && /@/.test(username)) {
        u = await dal.findUserByEmail(username);
      }
    } catch (e) { return res.status(500).json({ error: 'Auth failure' }); }
  } else {
    u = users.find((x) => x.username === username);
  }
  if (!u || !u.salt || !u.hash) return res.status(401).json({ error: 'Invalid credentials' });
  try {
    const hash = crypto.pbkdf2Sync(String(password), Buffer.from(u.salt, 'hex'), 100000, 64, 'sha512').toString('hex');
    if (hash !== u.hash) return res.status(401).json({ error: 'Invalid credentials' });
    const sid = crypto.randomBytes(12).toString('hex');
    const role = u.role || 'user';
    const expires = Date.now() + SESSION_TTL;
    sessions.set(sid, { username: u.username, role, expires });
    const jwt = signJWT({ sid, username: u.username, role }, JWT_SECRET);
    setSessionCookie(res, jwt, SESSION_TTL / 1000);
    return res.json({ user: { username: u.username, role } });
  } catch (err) {
    console.error('Auth error (signin)', err);
    return res.status(500).json({ error: 'Auth failure' });
  }
});

// Signup endpoint: stores a new user with a salted pbkdf2 hash
app.post('/auth/signup', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (!rateLimitSignup(ip)) return res.status(429).json({ error: 'Too many signups from this IP, please wait.' });
  const { username, password, email } = req.body || {};
  if (!username || !password || !email) return res.status(400).json({ error: 'username, email and password required' });
  if (!/^[-_a-zA-Z0-9]{3,20}$/.test(username)) return res.status(400).json({ error: 'Invalid username (3-20 chars alnum/_-)' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (pgEnabled && dal) {
    try {
      const existing = await dal.findUser(username);
      if (existing) return res.status(409).json({ error: 'User exists' });
      // Also check email uniqueness
      const { query } = require('./db');
      const { rows: emailRows } = await query('SELECT 1 FROM users WHERE email=$1 LIMIT 1',[email]);
      if (emailRows.length) return res.status(409).json({ error: 'Email in use' });
      const salt = crypto.randomBytes(16);
      const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
      await dal.createLocalUser({ username, saltHex: salt.toString('hex'), hashHex: hash, email });
      const sid = crypto.randomBytes(12).toString('hex');
      const role = 'user';
      const expires = Date.now() + SESSION_TTL;
      sessions.set(sid, { username, role, expires });
      const jwt = signJWT({ sid, username, role }, JWT_SECRET);
      setSessionCookie(res, jwt, SESSION_TTL / 1000);
      return res.json({ user: { username, role } });
    } catch (err) {
      console.error('Auth error (signup, pg)', err);
      return res.status(500).json({ error: 'Signup failed' });
    }
  }
  if (users.find((x) => x.username === username)) return res.status(409).json({ error: 'User exists' });
  try {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
    const rec = { username, salt: salt.toString('hex'), hash, displayName: username, bio: '', avatarFile: null };
    rec.favorites = [];
    users.push(rec);
    try { saveJson(USERS_FILE, users); } catch (e) { /* ignore */ }
    const sid = crypto.randomBytes(12).toString('hex');
    const role = 'user';
    const expires = Date.now() + SESSION_TTL;
    sessions.set(sid, { username, role, expires });
    const jwt = signJWT({ sid, username, role }, JWT_SECRET);
    setSessionCookie(res, jwt, SESSION_TTL / 1000);
    return res.json({ user: { username, role } });
  } catch (err) {
    console.error('Auth error (signup)', err);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// (OAuth code removed)

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


// Auth status and logout
app.get('/auth/me', async (req, res) => {
  const token = parseSessionCookie(req);
  if (!token) return res.status(401).json({ authenticated: false });
  const payload = verifyJWT(token, JWT_SECRET);
  if (!payload) return res.status(401).json({ authenticated: false });
  const sid = payload.sid;
  const sess = sessions.get(sid);
  if (!sess || sess.expires < Date.now()) return res.status(401).json({ authenticated: false });
  let u = null;
  if (pgEnabled && dal) { try { u = await dal.findUser(sess.username); } catch (e) { /* ignore */ } }
  if (!u) u = findUser(sess.username) || { displayName: sess.username, bio: '', avatarFile: null };
  return res.json({ authenticated: true, user: { username: sess.username, role: sess.role, displayName: u.displayName || u.display_name || sess.username, bio: u.bio || '', avatar: (u.avatarFile || u.avatar_file) ? `/uploads/${u.avatarFile || u.avatar_file}` : null } });
});

app.post('/auth/logout', (req, res) => { clearSessionCookie(res); return res.json({ ok: true }); });

// Admin-only: list users (do not expose hashes)
app.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  if (pgEnabled && dal) {
    try { const { query } = require('./db'); const { rows } = await query('SELECT username, oauth, provider FROM users ORDER BY username'); return res.json(rows.map(r=>({ username: r.username, oauth: r.oauth || false, provider: r.provider || null }))); } catch (e) { return res.status(500).json({ error: 'Failed' }); }
  }
  const list = users.map((u) => ({ username: u.username, oauth: u.oauth || false, provider: u.provider || null }));
  res.json(list);
});

// Admin-only: delete user
app.delete('/auth/users/:username', requireAuth, requireRole('admin'), async (req, res) => {
  const username = String(req.params.username || '');
  if (pgEnabled && dal) { try { await dal.deleteUser(username); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ error: 'Delete failed' }); } }
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  users.splice(idx, 1);
  try { saveJson(USERS_FILE, users); } catch (e) {}
  res.json({ ok: true });
});

// Guides images: list and admin upload
app.get('/guides/images', async (req, res) => {
  try {
    if (s3 && s3.isEnabled()){
      const keys = await s3.listKeys('guides/');
      return res.json(keys.map(k => ({ file: path.basename(k), url: s3.getPublicUrl(k) })));
    }
    const files = fs.readdirSync(GUIDES_UPLOAD_DIR).filter(f => /\.(png|jpe?g|gif|webp|avif)$/i.test(f));
    const list = files.map(f => ({ file: f, url: `/uploads/guides/${encodeURIComponent(f)}` }));
    res.json(list);
  } catch (e) { res.json([]); }
});

try {
  const multer = require('multer');
  const guidesUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 20 }, fileFilter: (req, file, cb)=>{
    if (/image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only images allowed'));
  }});
  app.post('/guides/upload', requireAuth, requireRole('admin'), guidesUpload.array('files', 20), async (req, res) => {
    try {
      const out = [];
      if (s3 && s3.isEnabled()){
        for (const f of (req.files||[])){
          const safe = String(f.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g,'_');
          const ext = (path.extname(safe) || '.dat').toLowerCase();
          const base = path.basename(safe, ext);
          const key = `guides/${base}-${Date.now()}${ext}`;
          const url = await s3.putObject({ key, body: f.buffer, contentType: f.mimetype });
          out.push({ file: path.basename(key), url });
        }
      } else {
        // Fallback to local disk
        for (const f of (req.files||[])){
          const safe = String(f.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g,'_');
          const ext = (path.extname(safe) || '.dat').toLowerCase();
          const base = path.basename(safe, ext);
          const name = `${base}-${Date.now()}${ext}`;
          fs.writeFileSync(path.join(GUIDES_UPLOAD_DIR, name), f.buffer);
          out.push({ file: name, url: `/uploads/guides/${encodeURIComponent(name)}` });
        }
      }
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: 'Upload failed' });
    }
  });
} catch (e) { /* multer not installed */ }

// Profile endpoints
app.get('/profile', requireAuth, async (req, res) => {
  if (pgEnabled && dal) { try { const u = await dal.findUser(req.user.username); if (!u) return res.status(404).json({ error: 'Not found' }); const avatar = u.avatar_file ? (s3 && s3.isEnabled() ? s3.getPublicUrl(u.avatar_file) : `/uploads/${u.avatar_file}`) : null; return res.json({ username: u.username, displayName: u.display_name || u.displayName || u.username, bio: u.bio || '', avatar }); } catch (e) { return res.status(500).json({ error: 'Failed' }); } }
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ username: u.username, displayName: u.displayName || u.username, bio: u.bio || '', avatar: u.avatarFile ? ((s3 && s3.isEnabled()) ? s3.getPublicUrl(u.avatarFile) : `/uploads/${u.avatarFile}`) : null });
});

app.put('/profile', requireAuth, async (req, res) => {
  const { displayName, bio } = req.body || {};
  if (pgEnabled && dal) { try { const upd = await dal.updateProfile(req.user.username, { displayName: (displayName||'').trim().slice(0,60), bio: (bio||'').slice(0,500) }); const avatar = upd.avatar_file ? ((s3 && s3.isEnabled()) ? s3.getPublicUrl(upd.avatar_file) : `/uploads/${upd.avatar_file}`) : null; return res.json({ ok: true, profile: { username: upd.username, displayName: upd.display_name || upd.displayName || upd.username, bio: upd.bio || '', avatar } }); } catch (e) { return res.status(500).json({ error: 'Update failed' }); } }
  const u = findUser(req.user.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (typeof displayName === 'string' && displayName.trim()) u.displayName = displayName.trim().slice(0, 60);
  if (typeof bio === 'string') u.bio = bio.slice(0, 500);
  try { saveJson(USERS_FILE, users); } catch (e) {}
  res.json({ ok: true, profile: { username: u.username, displayName: u.displayName, bio: u.bio, avatar: u.avatarFile ? ((s3 && s3.isEnabled()) ? s3.getPublicUrl(u.avatarFile) : `/uploads/${u.avatarFile}`) : null } });
});

// Basic avatar upload (base64 or multipart). We'll accept JSON { dataUrl: "data:image/..." }
app.post('/profile/avatar', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  let u = null;
  if (pgEnabled && dal) { try { u = await dal.findUser(req.user.username); } catch (e) {} }
  if (!u) u = findUser(req.user.username);
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
    let url = null;
    if (s3 && s3.isEnabled()){
      const key = `avatars/${name}`;
      url = await s3.putObject({ key, body: buf, contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
      if (pgEnabled && dal) { try { await dal.updateAvatar(req.user.username, key); } catch (e) { console.error('Avatar db update failed', e); } }
      else { u.avatarFile = key; try { saveJson(USERS_FILE, users); } catch (e) {} }
    } else {
      fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
      url = `/uploads/${name}`;
      if (pgEnabled && dal) { try { await dal.updateAvatar(req.user.username, name); } catch (e) { console.error('Avatar db update failed', e); } }
      else { u.avatarFile = name; try { saveJson(USERS_FILE, users); } catch (e) {} }
    }
    res.json({ ok: true, avatar: url });
  } catch (err) {
    console.error('Avatar upload error', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Serve uploaded avatars statically
if (!(s3 && s3.isEnabled())){
  app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false }));
}

// Delete current user account (self-service). Removes user, their journal entries, active sessions, and clears cookie.
app.delete('/profile', requireAuth, async (req, res) => {
  const username = req.user.username;
  if (pgEnabled && dal) {
    try { await dal.deleteUser(username); } catch (e) { return res.status(500).json({ error: 'Delete failed' }); }
    for (const [sid, sess] of sessions) if (sess.username === username) sessions.delete(sid);
    clearSessionCookie(res);
    return res.json({ ok: true, deleted: true });
  }
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  users.splice(idx, 1);
  journalEntries = journalEntries.filter(e => String(e.owner || '') !== String(username));
  for (const [sid, sess] of sessions) if (sess.username === username) sessions.delete(sid);
  try { saveJson(USERS_FILE, users); } catch (e) {}
  try { saveJson(JOURNAL_FILE, journalEntries); } catch (e) {}
  clearSessionCookie(res);
  res.json({ ok: true, deleted: true });
});

// Journal endpoints for client sync
app.get('/journal', requireAuth, async (req, res) => {
  const username = req.user?.username;
  if (pgEnabled && dal) { try { const rows = await dal.listJournal(username); return res.json(rows); } catch (e) { return res.status(500).json({ error: 'Failed' }); } }
  const own = journalEntries.filter((e) => String(e.owner || '') === String(username));
  res.json(own);
});

// Accept either a single entry or an array of entries
app.post('/journal', requireAuth, async (req, res) => {
  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Missing body' });
  const items = Array.isArray(body) ? body : [body];
  const username = req.user?.username;
  if (pgEnabled && dal) { try { await dal.upsertJournalEntries(username, items); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ error: 'Failed' }); } }
  for (const it of items) { const copy = Object.assign({}, it, { owner: username }); const exists = journalEntries.findIndex((e) => e.id === it.id && String(e.owner || '') === String(username)); if (exists !== -1) { journalEntries[exists] = copy; } else { journalEntries.push(copy); } if (it.strainId) invalidateEffectAgg(it.strainId); }
  try { saveJson(JOURNAL_FILE, journalEntries); } catch (e) {}
  const count = journalEntries.filter((e) => String(e.owner || '') === String(username)).length;
  res.json({ ok: true, count });
});

// ----- Phase 1: Effect aggregation & recommendations -----
const EFFECT_KEYS = (dal && dal.EFFECT_KEYS) || ['relaxation','energy','focus','euphoria','body','head'];
// Cache aggregated effects per strain for short interval to avoid recomputation storms
const EFFECT_CACHE_TTL = 30 * 1000; // 30 seconds
const effectAggCache = new Map(); // strainId -> { agg, ts }

function getCachedAggregate(strainId){
  const key = String(strainId);
  const now = Date.now();
  const cached = effectAggCache.get(key);
  if (cached && (now - cached.ts) < EFFECT_CACHE_TTL) return cached.agg;
  const agg = aggregateEffectsForStrain(strainId);
  effectAggCache.set(key, { agg, ts: now });
  return agg;
}
function invalidateEffectAgg(strainId){ effectAggCache.delete(String(strainId)); }

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

app.get('/strains/:id/aggregate-effects', async (req, res) => {
  const { id } = req.params;
  if (pgEnabled && dal) { try { const agg = await dal.aggregateEffects(id); return res.json(agg); } catch (e) { return res.status(500).json({ error: 'Failed' }); } }
  const agg = getCachedAggregate(id); res.json(agg);
});

app.get('/recommendations', requireAuth, async (req, res) => {
  if (pgEnabled && dal) {
    try {
      const username = req.user.username;
      const rows = await dal.userEffectVectors(username);
      const userEntries = rows.filter(r => r.effect_scores);
      if (!userEntries.length) return res.json([]);
      const rated = userEntries.filter(e => typeof e.rating === 'number');
      const weightVec = Object.fromEntries(EFFECT_KEYS.map(k=>[k,0]));
      let totalW=0;
      for (const e of rated){ const w = e.rating >=4 ? 1.5 : 1.0; totalW+=w; for (const k of EFFECT_KEYS){ const v = e.effect_scores?.[k]; if (typeof v === 'number') weightVec[k]+= v * w; } }
      const userVec = Object.fromEntries(EFFECT_KEYS.map(k=>[k, totalW? weightVec[k]/totalW : 0]));
      function cosine(a,b){ let dot=0, na=0, nb=0; for (const k of EFFECT_KEYS){ const av=a[k]||0, bv=b[k]||0; dot+=av*bv; na+=av*av; nb+=bv*bv; } if(!na||!nb) return 0; return dot/(Math.sqrt(na)*Math.sqrt(nb)); }
      const favs = await dal.listFavorites(username);
      let favoriteEffectVectors = [];
      for (const f of favs){ const agg = await dal.aggregateEffects(f.id); if (agg.count) favoriteEffectVectors.push(agg.averages); }
      function favoriteSimilarity(effects){ if (!favoriteEffectVectors.length) return 0; let best=0; for (const fv of favoriteEffectVectors){ let dot=0,na=0,nb=0; for (const k of EFFECT_KEYS){ const av=fv[k]||0,bv=effects[k]||0; dot+=av*bv; na+=av*av; nb+=bv*bv;} if(na&&nb){ const sim=dot/(Math.sqrt(na)*Math.sqrt(nb)); if (sim>best) best=sim; } } return best; }
      if (!strains.length) { strains = await dal.getAllStrains(); }
      const userStrainIds = new Set(rows.filter(r=> r.strain_id).map(r=> String(r.strain_id)));
      const candidates = strains.filter(s=> s.id && !userStrainIds.has(String(s.id)));
      const recs=[];
      for (const s of candidates){ const agg = await dal.aggregateEffects(s.id); if (!agg.count) continue; const sim = cosine(userVec, agg.averages); const favSim = favoriteSimilarity(agg.averages); const score = sim*0.8 + favSim*0.2; recs.push({ strainId: s.id, name: s.name, similarity:+sim.toFixed(3), favoriteSimilarity:+favSim.toFixed(3), score:+score.toFixed(3), sampleSize: agg.count, effects: agg.averages }); }
      recs.sort((a,b)=> b.score - a.score);
      return res.json(recs.slice(0,5));
    } catch (e) { console.error('Recommendations failed', e); return res.status(500).json({ error: 'Failed' }); }
  }
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

async function computeAchievements(username) {
  let entries = [];
  if (pgEnabled && dal) { try { entries = await dal.listJournal(username); } catch (e) { entries = []; } }
  else { entries = journalEntries.filter(e => e.owner === username); }
  entries = entries.sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));

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

app.get('/achievements', requireAuth, async (req, res) => {
  try { const list = await computeAchievements(req.user.username); res.json(list); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ----- Favorites Endpoints -----
app.get('/favorites', requireAuth, async (req, res) => {
  if (pgEnabled && dal) { try { const list = await dal.listFavorites(req.user.username); return res.json(list); } catch (e) { return res.status(500).json({ error: 'Failed' }); } }
  const u = findUser(req.user.username); if (!u) return res.status(404).json({ error: 'Not found' }); if (!Array.isArray(u.favorites)) u.favorites = []; res.json(u.favorites);
});

app.post('/favorites/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  if (pgEnabled && dal) { try { await dal.addFavorite(req.user.username, id); const list = await dal.listFavorites(req.user.username); return res.json({ ok: true, favorites: list }); } catch (e) { return res.status(500).json({ error: 'Failed' }); } }
  const u = findUser(req.user.username); if (!u) return res.status(404).json({ error: 'Not found' }); if (!Array.isArray(u.favorites)) u.favorites = []; if (!u.favorites.find(f => String(f.id || f) === id)) u.favorites.push({ id, addedAt: new Date().toISOString() }); try { saveJson(USERS_FILE, users); } catch (e) {} res.json({ ok: true, favorites: u.favorites });
});

app.delete('/favorites/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  if (pgEnabled && dal) { try { await dal.removeFavorite(req.user.username, id); const list = await dal.listFavorites(req.user.username); return res.json({ ok: true, favorites: list }); } catch (e) { return res.status(500).json({ error: 'Failed' }); } }
  const u = findUser(req.user.username); if (!u) return res.status(404).json({ error: 'Not found' }); if (!Array.isArray(u.favorites)) u.favorites = []; u.favorites = u.favorites.filter(f => String(f.id || f) !== id); try { saveJson(USERS_FILE, users); } catch (e) {} res.json({ ok: true, favorites: u.favorites });
});

// ----- User Weekly Summary Stats -----
async function computeUserSummary(username) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // today 00:00
  const start7 = new Date(start.getTime() - 6 * 86400000); // include today -> 7 days window
  let entries = [];
  if (pgEnabled && dal) { try { entries = await dal.listJournal(username); } catch (e) { entries = []; } }
  else { entries = journalEntries.filter(e => e.owner === username); }
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

app.get('/stats/summary', requireAuth, async (req, res) => {
  try { const summary = await computeUserSummary(req.user.username); res.json(summary); }
  catch (e) { console.error('Summary error', e); res.status(500).json({ error: 'Failed to compute summary' }); }
});

// Mappings endpoints for manual disambiguation
// mappings functionality removed

const port = process.env.PORT || 5002;
// Basic health endpoint for quick diagnostics
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), users: users.length, strains: strains.length });
});

// -------------------- Chat REST Endpoints (PG mode only) --------------------
app.post('/chat/direct', requireAuth, async (req, res) => {
  if (!pgEnabled || !chatDal) return res.status(400).json({ error: 'Chat requires Postgres mode' });
  const { username: other } = req.body || {};
  if (!other || other === req.user.username) return res.status(400).json({ error: 'Invalid target' });
  try {
    const id = await chatDal.createDirectConversation(req.user.username, other);
    return res.json({ conversationId: id });
  } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

app.post('/chat/group', requireAuth, async (req, res) => {
  if (!pgEnabled || !chatDal) return res.status(400).json({ error: 'Chat requires Postgres mode' });
  const { title, members } = req.body || {};
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'Title required' });
  try {
    const id = await chatDal.createGroupConversation(title.slice(0,80), req.user.username, Array.isArray(members)? members.filter(m=>m && m!==req.user.username).slice(0,49): []);
    return res.json({ conversationId: id });
  } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

app.get('/chat/conversations', requireAuth, async (req, res) => {
  if (!pgEnabled || !chatDal) return res.json([]);
  try { const list = await chatDal.listUserConversations(req.user.username); return res.json(list); } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

// Add participant to group conversation
app.post('/chat/conversations/:id/participants', requireAuth, async (req,res) => {
  if (!pgEnabled || !chatDal) return res.status(400).json({ error: 'Chat requires Postgres mode' });
  const id = Number(req.params.id); const { username: target } = req.body || {};
  if (!id || !target) return res.status(400).json({ error: 'Bad request' });
  try {
    const conv = await chatDal.getConversation(id);
    if (!conv || conv.type !== 'group') return res.status(404).json({ error: 'Not found' });
    if (!(await chatDal.isParticipant(id, req.user.username))) return res.status(403).json({ error: 'Not member' });
    await chatDal.addParticipant(id, target);
    const sys = await chatDal.insertSystemMessage(id, `${target} was added to the conversation by ${req.user.username}`);
    io.to('c:'+id).emit('message_new', { message: sys });
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

// --- Public Feed Style Endpoints (reuse general conversation as timeline) ---
let trendingCache = { data: [], ts: 0 };
// In-memory fallback feed (used only if Postgres/chatDal not enabled) – non-persistent
let memoryFeed = [];
let memoryFeedId = 1;
// ----------- External Cannabis News Aggregation (RSS) -----------
// Simple in-memory cache of news items (non-persistent). Each item: { id, title, link, source, published, summary }
let newsCache = { items: [], ts: 0 };
let lastNewsFetch = 0;
const NEWS_REFRESH_MS = 15 * 60 * 1000; // refresh every 15 minutes
const NEWS_ENABLED = (process.env.FEED_NEWS_ENABLED || 'true').toLowerCase() !== 'false';
const NEWS_SOURCES = [
  { url: 'https://www.marijuanamoment.net/feed/', source: 'MarijuanaMoment' },
  { url: 'https://www.highlycapitalized.com/feed/', source: 'HighlyCapitalized' },
  { url: 'https://www.hempindustrydaily.com/feed/', source: 'HempIndustryDaily' }
];
let rssParser = null;
async function ensureRss(){ if (!rssParser){ try { rssParser = new (require('rss-parser'))({ timeout: 10000 }); } catch(e){ console.warn('rss-parser not installed or failed:', e.message); } } }
async function fetchNewsIfStale(){
  if (!NEWS_ENABLED) return;
  const now = Date.now();
  if (now - lastNewsFetch < NEWS_REFRESH_MS) return;
  lastNewsFetch = now;
  await ensureRss(); if (!rssParser) return;
  const items = [];
  let failures = 0;
  await Promise.all(NEWS_SOURCES.map(async (src) => {
    try {
      const feed = await rssParser.parseURL(src.url);
      (feed.items||[]).slice(0,10).forEach(it => {
        const id = crypto.createHash('sha1').update((it.link||it.guid||it.title||'')+src.source).digest('hex').slice(0,16);
        items.push({
          id: 'news_'+id,
            title: it.title || 'Untitled',
            link: it.link || it.guid || null,
            source: src.source,
            published: it.isoDate || it.pubDate || null,
            summary: (it.contentSnippet || it.content || '').replace(/\s+/g,' ').trim().slice(0,280)
        });
      });
    } catch(e){ failures++; console.warn('[news] fetch failed', src.url, e.message); }
  }));
  // Deduplicate by id and sort by published desc
  const map = new Map();
  items.forEach(i => { if (!map.has(i.id)) map.set(i.id, i); });
  const merged = Array.from(map.values()).sort((a,b)=> new Date(b.published||0) - new Date(a.published||0));
  newsCache = { items: merged.slice(0,50), ts: now, failures, sources: NEWS_SOURCES.length };
  console.log(`[news] refreshed: ${newsCache.items.length} items from ${NEWS_SOURCES.length-failures}/${NEWS_SOURCES.length} sources`);
}

// Public endpoint for news (no auth). Triggers refresh if stale.
app.get('/feed/news', async (req,res)=>{
  try {
    const force = String(req.query.force||'').toLowerCase()==='true';
    if (force) { lastNewsFetch = 0; }
    await fetchNewsIfStale();
    // If somehow a proxy or upstream turned this into HTML, guard
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.json({ items: newsCache.items, fetchedAt: newsCache.ts, enabled: NEWS_ENABLED, sourcesTried: (newsCache && newsCache.sources)||0, forced: force });
  }
  catch(e){
    console.error('[news] endpoint error', e);
    // Return graceful empty list so frontend shows 'No news' instead of hard error
    return res.json({ items: [], error: 'unavailable', message: e.message, enabled: NEWS_ENABLED });
  }
});
// Public feed fetch (auth optional)
app.get('/feed', async (req,res) => {
  // Fallback mode (no Postgres)
  if (!pgEnabled || !chatDal) {
    const { cursor, limit } = req.query;
    const pageLimit = Math.min(Number(limit)||30, 100);
    let list = memoryFeed.slice().sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
    if (cursor) list = list.filter(m => new Date(m.created_at) < new Date(cursor));
    const page = list.slice(0,pageLimit);
    const nextCursor = page.length === pageLimit ? page[page.length-1].created_at : null;
    return res.json({ messages: page, nextCursor });
  }
  try {
    const generalId = await chatDal.findGeneralConversation();
    if (!generalId) return res.json({ messages:[], nextCursor:null });
    const { cursor, limit, hashtag } = req.query;
    const { messages, nextCursor } = await chatDal.listFeed({ generalId, before: cursor || null, limit: Number(limit)||30, hashtag: hashtag||null });
    // Optionally interleave top news headline every ~10 items on first page when no hashtag filter & first page only
    if (!hashtag && !cursor) {
      try { await fetchNewsIfStale(); } catch(_){}
      if (newsCache.items.length){
        const clone = [...messages];
        // Insert up to 3 news items near top positions (after first real message)
        const newsToShow = newsCache.items.slice(0,3).map(n=> ({
          id: n.id,
          content_text: `[NEWS] ${n.title} — ${n.source}`,
          content_type: 'news',
          created_at: n.published || new Date().toISOString(),
          sender_username: null,
          reply_count: 0,
          reactions: {},
          metadata: { link: n.link, summary: n.summary, source: n.source }
        }));
        // Place news after the first 1-2 user posts
        let insertPos = Math.min(2, clone.length);
        clone.splice(insertPos, 0, ...newsToShow);
        return res.json({ messages: clone, nextCursor });
      }
    }
    return res.json({ messages, nextCursor });
  } catch(e){ return res.status(500).json({ error:'Failed' }); }
});

// Public trending hashtags
app.get('/feed/trending', async (req,res) => {
  if (!pgEnabled || !chatDal) {
    // Simple in-memory hashtag count
    const tagCounts = {};
    for (const m of memoryFeed) {
      const matches = (m.content_text||'').toLowerCase().match(/#[a-z0-9_]+/g) || [];
      matches.forEach(t => { tagCounts[t.slice(1)] = (tagCounts[t.slice(1)]||0)+1; });
    }
    const rows = Object.entries(tagCounts).sort((a,b)=> b[1]-a[1]).slice(0,15).map(([hashtag,count])=> ({ hashtag, count }));
    return res.json(rows);
  }
  const now = Date.now();
  if (now - trendingCache.ts < 30_000) return res.json(trendingCache.data);
  try {
    const generalId = await chatDal.findGeneralConversation();
    if (!generalId) return res.json([]);
    const { query } = require('./db');
    const { rows } = await query(`
      WITH recent AS (
        SELECT content_text FROM messages WHERE conversation_id=$1 AND created_at > now() - interval '24 hours' AND deleted=false AND content_text IS NOT NULL
      ), tokens AS (
        SELECT regexp_matches(lower(content_text), '#[a-z0-9_]+','g') AS tag FROM recent
      )
      SELECT tag[1] AS hashtag, COUNT(*)::int AS count
      FROM tokens
      GROUP BY tag[1]
      ORDER BY COUNT(*) DESC
      LIMIT 15`,[generalId]);
    trendingCache = { data: rows, ts: now };
    return res.json(rows);
  } catch(e){ return res.status(500).json({ error:'Failed' }); }
});

// Post to feed
app.post('/feed/post', requireAuth, async (req,res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error:'Text required' });
  const cleaned = text.trim().slice(0,1200);
  if (!pgEnabled || !chatDal) {
    const now = new Date().toISOString();
    const msg = { id: memoryFeedId++, content_text: cleaned, content_type: 'text', created_at: now, sender_username: req.user.username, reply_count:0, reactions:{} };
    memoryFeed.push(msg);
    return res.json({ ok:true, message: msg, fallback:true });
  }
  try {
    let generalId = await chatDal.findGeneralConversation();
    if (!generalId){
      // Attempt auto-create once
      try {
        const { createGeneralConversation } = require('./chatDal');
        generalId = await createGeneralConversation();
        console.log('[feed] auto-created missing general conversation');
      } catch(e){
        console.error('[feed] failed to auto-create general conversation', e.message);
      }
    }
    if (!generalId) return res.status(500).json({ error:'Feed unavailable' });
    const msg = await chatDal.insertMessage({ conversationId: generalId, sender: req.user.username, contentText: cleaned });
    io.to('c:'+generalId).emit('message_new', { message: msg });
    trendingCache.ts = 0; // bust cache
    return res.json({ ok:true, message: msg });
  } catch(e){
    console.error('[feed] post failed', e);
    return res.status(500).json({ error:'Post failed'});
  }
});

// Development-only endpoint to force ensure general conversation (not exposed in production)
if (process.env.NODE_ENV !== 'production'){
  app.post('/dev/feed/ensure-general', async (req,res)=>{
    if (!pgEnabled) return res.status(400).json({ error:'PG disabled' });
    try {
      const { findGeneralConversation, createGeneralConversation } = require('./chatDal');
      let id = await findGeneralConversation();
      if (!id) { id = await createGeneralConversation(); }
      return res.json({ ok:true, id });
    } catch(e){ return res.status(500).json({ error:e.message }); }
  });
}

// Public status endpoint (no secrets) summarizing mode and basic counts
app.get('/status/feed', async (req,res)=>{
  try {
    if (!pgEnabled || !chatDal){
      return res.json({ mode:'memory', count: memoryFeed.length, news: newsCache.items.length, pg:false });
    }
    const { query } = require('./db');
    const [{ count: msgCount }] = (await query(`SELECT COUNT(*)::int AS count FROM messages`)).rows;
    const [{ count: attCount }] = (await query(`SELECT COUNT(*)::int AS count FROM attachments`)).rows;
    const generalId = await chatDal.findGeneralConversation();
    return res.json({ mode:'postgres', pg:true, messages: msgCount, attachments: attCount, hasGeneral: !!generalId, news: newsCache.items.length });
  } catch(e){ return res.status(500).json({ error:'status_failed', message:e.message }); }
});

// Media (image/video) post to feed (multipart/form-data: file + optional text)
let feedUpload = null;
try {
  const multer = require('multer');
  const { randomUUID } = require('crypto');
  const FEED_UPLOAD_DIR = path.join(UPLOADS_DIR, 'feed');
  if (!fs.existsSync(FEED_UPLOAD_DIR)) fs.mkdirSync(FEED_UPLOAD_DIR, { recursive: true });
  const allowed = new Set(['image/png','image/jpeg','image/webp','video/mp4']);
  // Use memory storage so we can putObject to S3 if enabled
  feedUpload = multer({ storage: multer.memoryStorage(), limits:{ fileSize: 25*1024*1024, files: 5 }, fileFilter:(req,file,cb)=>{
    if (!allowed.has(file.mimetype)) return cb(new Error('Unsupported type'));
    cb(null,true);
  }});
  if (!(s3 && s3.isEnabled())){
    app.use('/uploads/feed', express.static(FEED_UPLOAD_DIR));
  }
  app.post('/feed/post/media', requireAuth, feedUpload.fields([{ name:'files', maxCount:5 }, { name:'file', maxCount:5 }]), async (req,res)=>{
    // Normalize files from either 'files' (multi) or legacy 'file'
    const files = [
      ...((req.files && req.files['files']) || []),
      ...((req.files && req.files['file']) || [])
    ];
    if (!files.length) return res.status(400).json({ error:'File required' });
    const caption = (req.body?.text || '').toString().slice(0,1000);
    // Collect optional width/height arrays (parallel order)
    function normList(v){ return Array.isArray(v)? v : (v!=null? [v] : []); }
    const widths = normList(req.body.widths).map(x=> parseInt(x)||null);
    const heights = normList(req.body.heights).map(x=> parseInt(x)||null);
    if (!pgEnabled || !chatDal) {
      const now = new Date().toISOString();
      const uploads = [];
      for (const f of files){
        if (s3 && s3.isEnabled()){
          const ext = path.extname(f.originalname||'').toLowerCase() || '.dat';
          const key = `feed/${randomUUID()}${ext}`;
          const url = await s3.putObject({ key, body: f.buffer, contentType: f.mimetype });
          uploads.push({ storage_path: key, url, mimetype: f.mimetype, size: f.size });
        } else {
          const name = `${randomUUID()}${path.extname(f.originalname||'').toLowerCase()}`;
          fs.writeFileSync(path.join(FEED_UPLOAD_DIR, name), f.buffer);
          uploads.push({ storage_path: name, url: `/uploads/feed/${name}`, mimetype: f.mimetype, size: f.size });
        }
      }
      const tokens = uploads.map(u=> `[media:${path.basename(u.storage_path)}]`).join('\n');
      const msg = { id: memoryFeedId++, content_text: (caption? caption+'\n':'') + tokens, content_type:'text', created_at: now, sender_username: req.user.username, reply_count:0, reactions:{}, attachments: uploads.map(u=> ({ id: path.basename(u.storage_path), url: u.url, mime: u.mimetype, size: u.size })) };
      memoryFeed.push(msg);
      return res.json({ ok:true, message: msg, fallback:true });
    }
    try {
      let generalId = await chatDal.findGeneralConversation();
      if (!generalId){
        try { const { createGeneralConversation } = require('./chatDal'); generalId = await createGeneralConversation(); console.log('[feed] auto-created general conversation (media)'); } catch(e){ console.error('[feed] media create general failed', e.message); }
      }
      if (!generalId) return res.status(500).json({ error:'Feed unavailable' });
      const { query } = require('./db');
      const attachments = [];
      for (let i=0;i<files.length;i++){
        const f = files[i];
        const attId = randomUUID();
        const w = widths[i] || null; const h = heights[i] || null;
        let storagePath, publicUrl;
        if (s3 && s3.isEnabled()){
          const ext = path.extname(f.originalname||'').toLowerCase() || '.dat';
          const key = `feed/${attId}${ext}`;
          publicUrl = await s3.putObject({ key, body: f.buffer, contentType: f.mimetype });
          storagePath = key;
        } else {
          const name = `${attId}${path.extname(f.originalname||'').toLowerCase()}`;
          fs.writeFileSync(path.join(FEED_UPLOAD_DIR, name), f.buffer);
          storagePath = name; publicUrl = `/uploads/feed/${name}`;
        }
        await query(`INSERT INTO attachments (id, uploader_username, mime_type, original_filename, storage_path, size_bytes, width, height)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [attId, req.user.username, f.mimetype, f.originalname, storagePath, f.size, w, h]);
        attachments.push({ id: attId, url: publicUrl, mime: f.mimetype, size: f.size, width: w, height: h });
      }
      const tokens = attachments.map(a=> `[media:${a.id}]`).join('\n');
      const content = caption + (caption ? '\n' : '') + tokens;
      // message stores tokens only (attachment_id NULL)
      const msg = await chatDal.insertMessage({ conversationId: generalId, sender: req.user.username, contentText: content });
      msg.attachments = attachments;
      io.to('c:'+generalId).emit('message_new', { message: msg });
      trendingCache.ts = 0;
      return res.json({ ok:true, message: msg });
    } catch(e){ console.error('Feed media post failed', e); return res.status(500).json({ error:'Media post failed'}); }
  });

  // Delete a feed post (soft delete). Only author or admin creds (basic admin user) allowed.
  app.delete('/feed/:id', requireAuth, async (req,res)=>{
    if (!pgEnabled || !chatDal) {
      // Memory mode: remove from memoryFeed
      const id = req.params.id;
      const idx = memoryFeed.findIndex(m=> String(m.id) === String(id));
      if (idx === -1) return res.status(404).json({ error:'Not found' });
      const msg = memoryFeed[idx];
      if (msg.sender_username !== req.user.username && req.user.username !== process.env.ADMIN_USER) return res.status(403).json({ error:'Forbidden' });
      memoryFeed.splice(idx,1);
      return res.json({ ok:true, deleted:true });
    }
    try {
      const { query } = require('./db');
      const id = req.params.id;
      const { rows } = await query('SELECT id, sender_username, conversation_id FROM messages WHERE id=$1 AND deleted=false',[id]);
      if (!rows.length) return res.status(404).json({ error:'Not found' });
      const msg = rows[0];
      if (msg.sender_username !== req.user.username && req.user.username !== process.env.ADMIN_USER){
        return res.status(403).json({ error:'Forbidden' });
      }
      await query('UPDATE messages SET deleted=true, content_text=NULL WHERE id=$1',[id]);
      io.to('c:'+msg.conversation_id).emit('message_deleted', { messageId: id });
      return res.json({ ok:true, deleted:true });
    } catch (e){ console.error('delete feed post failed', e); return res.status(500).json({ error:'Delete failed' }); }
  });
} catch(e){ /* multer not available */ }

// Thread reply
app.post('/threads/:id/replies', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.status(400).json({ error:'Requires PG'});
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error:'Text required' });
  try {
    const parent = await chatDal.getMessage(req.params.id);
    if (!parent) return res.status(404).json({ error:'Parent missing' });
    const msg = await chatDal.insertMessage({ conversationId: parent.conversation_id, sender: req.user.username, contentText: text.trim().slice(0,1000), parentMessageId: parent.id });
    io.to('c:'+parent.conversation_id).emit('message_new', { message: msg });
    trendingCache.ts = 0;
    return res.json({ ok:true, message: msg });
  } catch(e){ return res.status(500).json({ error:'Failed'}); }
});

app.get('/chat/conversations/:id/messages', requireAuth, async (req, res) => {
  if (!pgEnabled || !chatDal) return res.json([]);
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    if (!(await chatDal.isParticipant(id, req.user.username))) return res.status(403).json({ error: 'Not member' });
    const before = req.query.before ? new Date(req.query.before).toISOString() : null;
    const { messages, hasMore } = await chatDal.listMessages(id, { before, limit: Math.min(Number(req.query.limit)||30, 100) });
    const reactions = await chatDal.reactionsForMessages(messages.map(m=>m.id));
    return res.json({ messages: messages.map(m=> ({ ...m, reactions: reactions[m.id] || {} })), hasMore });
  } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

// Thread endpoints
app.get('/threads/:id', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.status(400).json({ error:'Requires PG'});
  try { const data = await chatDal.getThread(req.params.id); if (!data) return res.status(404).json({ error:'Not found'}); return res.json(data); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});
app.get('/threads/:id/replies', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.status(400).json({ error:'Requires PG'});
  try { const list = await chatDal.listThreadReplies(req.params.id); return res.json(list); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});

// Follow system
app.post('/social/follow/:username', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.status(400).json({ error:'Requires PG'});
  try { await chatDal.followUser(req.user.username, req.params.username); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});
app.delete('/social/follow/:username', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.status(400).json({ error:'Requires PG'});
  try { await chatDal.unfollowUser(req.user.username, req.params.username); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});
app.get('/social/following', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.json([]);
  try { return res.json(await chatDal.listFollowing(req.user.username)); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});
app.get('/social/followers', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.json([]);
  try { return res.json(await chatDal.listFollowers(req.user.username)); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});
app.get('/social/suggested', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.json([]);
  try { return res.json(await chatDal.suggestedFollows(req.user.username, Number(req.query.limit)||8)); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});

// Reporting (rate limited)
const reportLimiter = rateLimit({ windowMs: 60*1000, max: 20 });
app.post('/messages/:id/report', reportLimiter, requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.status(400).json({ error:'Requires PG'});
  try { await chatDal.reportMessage(req.params.id, req.user.username, req.body?.reason); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});
app.get('/admin/reports', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.json([]);
  if (req.user.username !== process.env.ADMIN_USER) return res.status(403).json({ error:'Forbidden'});
  try { return res.json(await chatDal.listReports(Number(req.query.limit)||100)); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});
app.post('/admin/reports/:id/resolve', requireAuth, async (req,res)=>{
  if (!pgEnabled || !chatDal) return res.status(400).json({ error:'Requires PG'});
  if (req.user.username !== process.env.ADMIN_USER) return res.status(403).json({ error:'Forbidden'});
  try { await chatDal.resolveReport(Number(req.params.id)); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ error:'Failed'}); }
});

// User search (rate limited) - used for new chat & follow suggestions
const userSearchLimiter = rateLimit({ windowMs: 30*1000, max: 40 });
app.get('/users/search', userSearchLimiter, requireAuth, async (req,res)=>{
  if (!pgEnabled) return res.json([]);
  const q = (req.query.q||'').toString().trim().toLowerCase();
  if (!q) return res.json([]);
  try {
    const { query } = require('./db');
    const { rows } = await query(`SELECT username FROM users WHERE LOWER(username) LIKE $1 ORDER BY username LIMIT 20`, ['%'+q+'%']);
    return res.json(rows.map(r=>r.username));
  } catch(e){ return res.status(500).json({ error:'Failed'}); }
});

// Read receipts summary for a conversation (last per user)
app.get('/chat/conversations/:id/reads', requireAuth, async (req,res) => {
  if (!pgEnabled || !chatDal) return res.json([]);
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  try {
    if (!(await chatDal.isParticipant(id, req.user.username))) return res.status(403).json({ error: 'Not member' });
    const { query } = require('./db');
    // For each user, report the furthest (latest created_at) message they've read in this conversation
    const { rows } = await query(`
      SELECT mr.username,
             max(mr.read_at) as last_read_at,
             max(m.created_at) as last_message_created_at
      FROM message_reads mr
      JOIN messages m ON m.id = mr.message_id
      WHERE m.conversation_id=$1
      GROUP BY mr.username
    `, [id]);
    return res.json(rows);
  } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

app.post('/chat/messages/:id/react', requireAuth, async (req, res) => {
  if (!pgEnabled || !chatDal) return res.status(400).json({ error: 'Chat requires Postgres mode' });
  const { reaction } = req.body || {};
  if (!reaction) return res.status(400).json({ error: 'reaction required' });
  const messageId = req.params.id;
  try {
    const msg = await chatDal.getMessage(messageId);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (!(await chatDal.isParticipant(msg.conversation_id, req.user.username))) return res.status(403).json({ error: 'Not member' });
    await chatDal.upsertReaction(messageId, req.user.username, reaction);
    const reactions = await chatDal.reactionsForMessages([messageId]);
    return res.json({ ok: true, counts: reactions[messageId] || {} });
  } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});

app.post('/chat/block', requireAuth, async (req, res) => {
  if (!pgEnabled || !chatDal) return res.status(400).json({ error: 'Chat requires Postgres mode' });
  const { username: target } = req.body || {};
  if (!target || target === req.user.username) return res.status(400).json({ error: 'Invalid target' });
  try { await chatDal.blockUser(req.user.username, target); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});
app.post('/chat/unblock', requireAuth, async (req, res) => {
  if (!pgEnabled || !chatDal) return res.status(400).json({ error: 'Chat requires Postgres mode' });
  const { username: target } = req.body || {};
  if (!target) return res.status(400).json({ error: 'Invalid target' });
  try { await chatDal.unblockUser(req.user.username, target); return res.json({ ok: true }); } catch (e) { return res.status(500).json({ error: 'Failed' }); }
});
app.get('/chat/blocks', requireAuth, async (req,res) => {
  if (!pgEnabled || !chatDal) return res.json([]);
  try { const list = await chatDal.listBlocked(req.user.username); return res.json(list); } catch(e){ return res.status(500).json({ error: 'Failed' }); }
});
// -------------------- Socket.IO Chat Integration --------------------
const http = require('http');
const httpServer = http.createServer(app);
let io = null;
try { io = require('socket.io')(httpServer, { cors: { origin: true, credentials: true } }); } catch (e) { console.warn('Socket.IO not installed yet. Run npm i socket.io'); }

// Lazy require chat DAL (PG only) 
let chatDal = null;
try { chatDal = require('./chatDal'); } catch (_) {}

async function isBlocked(a, b){
  if (!pgEnabled || !chatDal) return false; // blocking only enforced in PG mode
  try {
    const { query } = require('./db');
    const { rows } = await query(`SELECT 1 FROM user_blocks WHERE (blocker_username=$1 AND blocked_username=$2) OR (blocker_username=$2 AND blocked_username=$1) LIMIT 1`, [a,b]);
    return rows.length>0;
  } catch (_) { return false; }
}

if (io) {
  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || '';
      let token = null;
      if (raw) { try { token = cookie.parse(raw).session; } catch (_) {} }
      if (!token) return next(new Error('auth'));
      const payload = verifyJWT(token, JWT_SECRET);
      if (!payload) return next(new Error('auth'));
      const sess = sessions.get(payload.sid);
      if (!sess || sess.expires < Date.now()) return next(new Error('auth'));
      socket.user = { username: sess.username };
      next();
    } catch (e) { return next(new Error('auth')); }
  });

  io.on('connection', (socket) => {
    const username = socket.user.username;
    socket.emit('auth_ok', { username });
    socket.join('u:'+username);

    // Simple in-memory rate limiting (messages per minute)
    const msgWindow = [];// timestamps
    function allowMessage(){
      const now = Date.now();
      while (msgWindow.length && now - msgWindow[0] > 60000) msgWindow.shift();
      if (msgWindow.length >= 60) return false;
      msgWindow.push(now);
      return true;
    }

    // Track typing states; broadcast start/stop
    const typingTimers = new Map();
    function broadcastTyping(conversationId, state){
      io.to('c:'+conversationId).emit('typing', { conversationId, username, state });
    }

    socket.on('join_conversation', async ({ conversationId }) => {
      if (!pgEnabled || !chatDal) return socket.emit('error', { code: 'no_pg', message: 'Chat requires Postgres' });
      try {
        // membership check
        const member = await chatDal.isParticipant(conversationId, username);
        if (!member) return socket.emit('error', { code: 'not_member', message: 'Not a participant' });
        socket.join('c:'+conversationId);
        const { messages, hasMore } = await chatDal.listMessages(conversationId, { limit: 30 });
        const reactions = await chatDal.reactionsForMessages(messages.map(m=>m.id));
        socket.emit('conversation_joined', { conversationId, recent: messages.map(m=> ({ ...m, reactions: reactions[m.id] || {} })), hasMore });
      } catch (e) {
        socket.emit('error', { code: 'join_failed', message: e.message });
      }
    });

    socket.on('send_message', async ({ conversationId, text, tempId, attachmentId, contentType }) => {
      if (!pgEnabled || !chatDal) return socket.emit('error', { code: 'no_pg', message: 'Chat requires Postgres' });
      try {
        if (!(await chatDal.isParticipant(conversationId, username))) return socket.emit('error', { code:'not_member', message:'Not a participant' });
        if (!allowMessage()) return socket.emit('error', { code:'rate_limited', message:'Too many messages' });
        const msg = await chatDal.insertMessage({ conversationId, sender: username, contentText: text, contentType: contentType || (attachmentId? 'attachment':'text'), attachmentId: attachmentId||null });
        const { query } = require('./db');
        const { rows: participantsRows } = await query('SELECT username FROM conversation_participants WHERE conversation_id=$1',[conversationId]);
        const participants = participantsRows.map(r=>r.username);
        const { rows: blockRows } = await query(`SELECT blocker_username, blocked_username FROM user_blocks WHERE (blocker_username = ANY($1) OR blocked_username = ANY($1))`, [participants]);
        function hiddenFor(viewer){
          for (const b of blockRows){
            if ((b.blocker_username === viewer && b.blocked_username === username) || (b.blocker_username === username && b.blocked_username === viewer)) return true;
          }
          return false;
        }
        // Emit only to sockets in conversation that aren't hidden
        const room = io.sockets.adapter.rooms.get('c:'+conversationId) || new Set();
        for (const sid of room){
          const s = io.sockets.sockets.get(sid);
            if (!s || !s.user) continue;
            if (hiddenFor(s.user.username)) continue;
            s.emit('message_new', { message: { ...msg, tempId } });
        }
        // Broadcast unread updates to participants except sender
        for (const p of participants){
          if (p === username) continue;
          // push unread count for recipient to avoid full refresh
          try {
            const count = await chatDal.unreadCount(conversationId, p);
            io.to('u:'+p).emit('unread_update', { conversationId, unread: count });
          } catch(_) {
            io.to('u:'+p).emit('unread_update', { conversationId });
          }
        }
      } catch (e) { socket.emit('error', { code: 'send_failed', message: e.message }); }
    });

    socket.on('react_message', async ({ messageId, reaction }) => {
      if (!pgEnabled || !chatDal) return;
      try {
        const msg = await chatDal.getMessage(messageId);
        if (!msg) return;
        if (!(await chatDal.isParticipant(msg.conversation_id, username))) return;
        await chatDal.upsertReaction(messageId, username, reaction);
        const reactions = await chatDal.reactionsForMessages([messageId]);
        io.to('c:'+msg.conversation_id).emit('reactions_update', { messageId, counts: reactions[messageId] || {} });
      } catch (_) {}
    });

    // Edit message
    socket.on('edit_message', async ({ messageId, newText }) => {
      if (!pgEnabled || !chatDal) return;
      try {
        const msg = await chatDal.getMessage(messageId);
        if (!msg || msg.sender_username !== username) return;
        const { query } = require('./db');
        await query('UPDATE messages SET content_text=$1, edited_at=now() WHERE id=$2',[String(newText||'').slice(0,4000), messageId]);
        const updated = await chatDal.getMessage(messageId);
        io.to('c:'+updated.conversation_id).emit('message_update', { message: updated });
      } catch(_){}
    });

    // Delete message (soft)
    socket.on('delete_message', async ({ messageId }) => {
      if (!pgEnabled || !chatDal) return;
      try {
        const msg = await chatDal.getMessage(messageId);
        if (!msg || msg.sender_username !== username) return;
        const { query } = require('./db');
        await query('UPDATE messages SET deleted=true, content_text=NULL WHERE id=$1',[messageId]);
        io.to('c:'+msg.conversation_id).emit('message_deleted', { messageId });
      } catch(_){}
    });

    // Typing indicators
    socket.on('typing_start', async ({ conversationId }) => {
      if (!pgEnabled || !chatDal) return; if (!(await chatDal.isParticipant(conversationId, username))) return;
      broadcastTyping(conversationId, 'start');
      clearTimeout(typingTimers.get(conversationId));
      typingTimers.set(conversationId, setTimeout(()=> broadcastTyping(conversationId,'stop'), 4000));
    });
    socket.on('typing_stop', async ({ conversationId }) => {
      if (!pgEnabled || !chatDal) return; if (!(await chatDal.isParticipant(conversationId, username))) return;
      broadcastTyping(conversationId, 'stop');
      clearTimeout(typingTimers.get(conversationId));
    });

    // Read receipts: client notifies last seen message id
    socket.on('read_up_to', async ({ conversationId, messageId }) => {
      if (!pgEnabled || !chatDal) return; if (!(await chatDal.isParticipant(conversationId, username))) return;
      try {
        const { query } = require('./db');
        // Get the target message (ensure it belongs to conversation)
        const { rows: targetRows } = await query('SELECT id, created_at FROM messages WHERE id=$1 AND conversation_id=$2',[messageId, conversationId]);
        if (!targetRows.length) return;
        const target = targetRows[0];
        // Bulk insert new read rows only for messages newer than the last recorded read for this user in this conversation and up to target
        await query(`
          WITH last AS (
            SELECT max(m.created_at) AS last_created
            FROM message_reads mr
            JOIN messages m ON m.id = mr.message_id
            WHERE mr.username=$2 AND m.conversation_id=$1
          )
          INSERT INTO message_reads (message_id, username)
          SELECT m.id, $2
          FROM messages m
          LEFT JOIN last l ON true
          WHERE m.conversation_id=$1
            AND m.created_at <= $3
            AND (l.last_created IS NULL OR m.created_at > l.last_created);
        `, [conversationId, username, target.created_at]);
        // Broadcast updated read pointer (latest created_at reached)
        io.to('c:'+conversationId).emit('reads_update', { conversationId, username, upToCreatedAt: target.created_at });
        try {
          const count = await chatDal.unreadCount(conversationId, username);
          io.to('u:'+username).emit('unread_update', { conversationId, unread: count });
        } catch(_) {
          io.to('u:'+username).emit('unread_update', { conversationId });
        }
      } catch(_){ }
    });

    socket.on('block_user', async ({ target }) => { if (!pgEnabled || !chatDal) return; try { await chatDal.blockUser(username, target); socket.emit('blocked_users', { list: await chatDal.listBlocked(username) }); } catch(_){} });
    socket.on('unblock_user', async ({ target }) => { if (!pgEnabled || !chatDal) return; try { await chatDal.unblockUser(username, target); socket.emit('blocked_users', { list: await chatDal.listBlocked(username) }); } catch(_){} });

    socket.on('disconnect', () => {});
  });
}

let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = httpServer.listen(port, () => console.log(`Backend API listening on http://localhost:${port}`));
}

// -------------------- Chat Attachment Upload (Postgres mode only) --------------------
try {
  const multer = require('multer');
  const { randomUUID } = require('crypto');
  const CHAT_UPLOAD_DIR = path.join(UPLOADS_DIR, 'chat');
  if (!fs.existsSync(CHAT_UPLOAD_DIR)) fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CHAT_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, randomUUID() + ext);
    }
  });
  const allowed = new Set(['image/png','image/jpeg','image/webp','video/mp4']);
  const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (req, file, cb)=>{
    if (!allowed.has(file.mimetype)) return cb(new Error('Unsupported type'));
    cb(null, true);
  } });
  app.use('/uploads/chat', express.static(CHAT_UPLOAD_DIR));
  app.post('/chat/upload', requireAuth, upload.single('file'), async (req, res) => {
    if (!pgEnabled) return res.status(400).json({ error: 'Chat requires Postgres mode' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
      const { query } = require('./db');
      const id = randomUUID();
      await query(`INSERT INTO attachments (id, uploader_username, mime_type, original_filename, storage_path, size_bytes)
        VALUES ($1,$2,$3,$4,$5,$6)`, [id, req.user.username, req.file.mimetype, req.file.originalname, req.file.filename, req.file.size]);
      res.json({ attachmentId: id, url: `/uploads/chat/${req.file.filename}`, mime: req.file.mimetype, size: req.file.size });
    } catch (e) { console.error('Upload fail', e); res.status(500).json({ error: 'Upload failed' }); }
  });
} catch (e) { /* multer missing */ }

// Graceful shutdown
function shutdown(sig){
  console.log(`\n${sig} received. Shutting down...`);
  if (server) {
    server.close(()=>{ console.log('HTTP server closed.'); process.exit(0); });
    setTimeout(()=> process.exit(1), 8000).unref();
  } else {
    process.exit(0);
  }
}
if (process.env.NODE_ENV !== 'test') {
  ['SIGINT','SIGTERM'].forEach(s=> process.on(s, ()=> shutdown(s)));
}

module.exports = app;
module.exports.httpServer = httpServer;
module.exports.server = server;
