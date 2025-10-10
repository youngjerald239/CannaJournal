#!/usr/bin/env node
// Migrates local uploads to S3 and rewrites DB storage paths to keys.
// Safe to re-run; skips keys that already exist by using deterministic keys for known ids.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initPg, query } = require('../db');
const s3 = require('../s3');

async function fileExists(p){ try { await fs.promises.access(p, fs.constants.R_OK); return true; } catch { return false; } }

async function migrateAttachments(){
  console.log('[migrate] attachments → S3');
  const { rows } = await query(`SELECT id, storage_path, mime_type FROM attachments`);
  let moved = 0, skipped = 0, missing = 0;
  for (const r of rows){
    if (!r.storage_path) { skipped++; continue; }
    // If already looks like an S3 key with folder prefix, skip
    if (r.storage_path.includes('/') && !await fileExists(path.join(__dirname,'..','uploads','feed', r.storage_path))) { skipped++; continue; }
    const localFeed = path.join(__dirname, '..', 'uploads', 'feed', r.storage_path);
    const localChat = path.join(__dirname, '..', 'uploads', 'chat', r.storage_path);
    let src = null;
    if (await fileExists(localFeed)) src = localFeed;
    else if (await fileExists(localChat)) src = localChat;
    if (!src){ missing++; continue; }
    const key = `feed/${r.id}${path.extname(r.storage_path||'').toLowerCase()}`;
    const body = await fs.promises.readFile(src);
    await s3.putObject({ key, body, contentType: r.mime_type || 'application/octet-stream' });
    await query('UPDATE attachments SET storage_path=$2 WHERE id=$1', [r.id, key]);
    moved++;
  }
  console.log(`[migrate] attachments moved: ${moved}, skipped: ${skipped}, missing: ${missing}`);
}

async function migrateAvatars(){
  console.log('[migrate] avatars → S3');
  const { rows } = await query(`SELECT username, avatar_file FROM users WHERE avatar_file IS NOT NULL`);
  let moved = 0, skipped = 0, missing = 0;
  for (const u of rows){
    const cur = u.avatar_file;
    if (!cur) continue;
    if (cur.includes('/')) { skipped++; continue; } // already a key
    const local = path.join(__dirname,'..','uploads', cur);
    if (!await fileExists(local)){ missing++; continue; }
    const key = `avatars/${cur}`;
    const body = await fs.promises.readFile(local);
    const ext = path.extname(cur).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
    await s3.putObject({ key, body, contentType: mime });
    await query('UPDATE users SET avatar_file=$2 WHERE username=$1',[u.username, key]);
    moved++;
  }
  console.log(`[migrate] avatars moved: ${moved}, skipped: ${skipped}, missing: ${missing}`);
}

(async () => {
  console.log(`[migrate] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);
  if (!s3.isEnabled()){
    console.error('S3 not configured. Set S3_* env vars. Aborting.');
    process.exit(1);
  }
  try {
    const { enabled } = await initPg();
    if (!enabled){
      console.error('Postgres not enabled. Ensure DATABASE_URL points to the db service.');
      process.exit(1);
    }
    await migrateAttachments();
    await migrateAvatars();
    console.log('[migrate] done');
    process.exit(0);
  } catch (e) {
    console.error('[migrate] failed', e);
    process.exit(2);
  }
})();
