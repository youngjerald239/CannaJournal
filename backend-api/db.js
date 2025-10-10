// Lightweight Postgres adapter with fallback to JSON in-memory structures.
// Exports DAO-like functions used by server.js. If DATABASE_URL absent, functions
// delegate to JSON arrays passed in during init.

const { Pool } = require('pg');
let pool = null;
let enabled = false;

/**
 * Initialize Postgres connection if DATABASE_URL provided.
 */
async function initPg() {
  const url = process.env.DATABASE_URL;
  if (!url) return { enabled: false };
  pool = new Pool({ connectionString: url, max: 10, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false });
  await pool.query('SELECT 1');
  enabled = true;
  return { enabled: true };
}

async function query(q, params) {
  if (!enabled) throw new Error('PG not enabled');
  return pool.query(q, params);
}

// --- Schema helpers (used by migration script) ---
const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  salt TEXT,
  hash TEXT,
  role TEXT DEFAULT 'user',
  oauth BOOLEAN DEFAULT false,
  provider TEXT,
  display_name TEXT,
  bio TEXT,
  avatar_file TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Backfill migration: ensure email column exists if table predates this addition
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS strains (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  thc NUMERIC,
  cbd NUMERIC,
  effects TEXT,
  flavors JSONB,
  aroma JSONB,
  medical_uses JSONB,
  recommended_use TEXT,
  image TEXT,
  grow JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  strain_id INTEGER REFERENCES strains(id),
  strain_name TEXT,
  timestamp TIMESTAMPTZ,
  rating NUMERIC,
  effect_scores JSONB,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS favorites (
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  strain_id INTEGER NOT NULL REFERENCES strains(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (username, strain_id)
);

-- Chat / Messaging tables
CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('direct','group','general')),
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
  username TEXT REFERENCES users(username) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (conversation_id, username)
);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  uploader_username TEXT REFERENCES users(username) ON DELETE SET NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT,
  storage_path TEXT NOT NULL,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
  sender_username TEXT REFERENCES users(username) ON DELETE SET NULL,
  parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  content_text TEXT,
  content_type TEXT NOT NULL DEFAULT 'text',
  attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  username TEXT REFERENCES users(username) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, username)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_username TEXT REFERENCES users(username) ON DELETE CASCADE,
  blocked_username TEXT REFERENCES users(username) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (blocker_username, blocked_username)
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  username TEXT REFERENCES users(username) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, username)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='parent_message_id';
  IF FOUND THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_parent_created ON messages(parent_message_id, created_at DESC)';
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON user_blocks(blocker_username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- Social baseline (idempotent; migrations may also create)
CREATE TABLE IF NOT EXISTS user_follows (
  follower_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  followed_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_username, followed_username)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_username);

CREATE TABLE IF NOT EXISTS message_reports (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed BOOLEAN NOT NULL DEFAULT false,
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_message_reports_message ON message_reports(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reports_reviewed ON message_reports(reviewed, created_at DESC);
`;

module.exports = { initPg, query, schemaSql };
