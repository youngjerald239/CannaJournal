#!/usr/bin/env node
// One-off (idempotent) migration: copy users, favorites, and journal entries from JSON files into Postgres.
// Safe to re-run; it skips rows that already exist (based on primary/unique keys).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { initPg, query } = require('../db');

(async () => {
  try {
    const init = await initPg();
    if (!init.enabled) {
      console.log('Postgres disabled (DATABASE_URL missing). Abort.');
      process.exit(0);
    }
    const dataDir = path.join(__dirname, '..', 'data');
    const usersFile = path.join(dataDir, 'users.json');
    const journalFile = path.join(dataDir, 'journal.json');

    let users = [];
    if (fs.existsSync(usersFile)) {
      try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) { console.warn('Failed parsing users.json', e.message); }
    }

    // Upsert users
    for (const u of users) {
      // If already exists, skip insert; then update profile fields if missing.
      await query(`INSERT INTO users (username, salt, hash, role, oauth, provider, display_name, bio, avatar_file)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                   ON CONFLICT (username) DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name), bio = COALESCE(users.bio, EXCLUDED.bio), avatar_file = COALESCE(users.avatar_file, EXCLUDED.avatar_file)`,
        [u.username, u.salt || null, u.hash || null, u.role || 'user', !!u.oauth, u.provider || null, u.displayName || u.username, u.bio || '', u.avatarFile || null]);

      // Favorites: each favorite object { id, addedAt }
      if (Array.isArray(u.favorites)) {
        for (const f of u.favorites) {
          const sid = Number(f.id || f);
          if (!sid || Number.isNaN(sid)) continue;
          await query(`INSERT INTO favorites (username, strain_id, added_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [u.username, sid, f.addedAt || new Date().toISOString()]);
        }
      }
    }
    console.log(`Upserted ${users.length} users (+ favorites).`);

    // Journal entries (if any)
    if (fs.existsSync(journalFile)) {
      let journal = [];
      try { journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')); } catch (e) { console.warn('Failed parsing journal.json', e.message); }
      let inserted = 0;
      for (const j of journal) {
        if (!j.id) continue; // need stable id
        await query(`INSERT INTO journal_entries (id, owner, strain_id, strain_name, timestamp, rating, effect_scores, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                     ON CONFLICT (id) DO NOTHING`, [
          j.id,
          j.owner || j.username || null,
          j.strainId || null,
          j.strainName || null,
          j.timestamp || new Date().toISOString(),
          (typeof j.rating === 'number') ? j.rating : null,
          j.effectScores ? JSON.stringify(j.effectScores) : null,
          j.notes || null
        ]);
        inserted++;
      }
      console.log(`Inserted (or skipped existing) ${inserted} journal entries.`);
    }

    console.log('JSON -> Postgres migration complete.');
    process.exit(0);
  } catch (e) {
    console.error('Migration error:', e);
    process.exit(1);
  }
})();
