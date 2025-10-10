#!/usr/bin/env node
// Explicitly load .env from backend-api directory to avoid cwd issues
const path = require('path');
require('dotenv').config({ path: path.join(__dirname,'..','.env') });
const { initPg, query, schemaSql } = require('../db');
const fs = require('fs');
// path already required above
(async () => {
  try {
    const init = await initPg();
    if (!init.enabled) {
      console.log('DATABASE_URL not set. Skipping Postgres migration.');
      process.exit(0);
    }
    // Ensure baseline schema (idempotent)
    console.log('Ensuring baseline schema...');
    await query(schemaSql);
    console.log('Baseline ensured.');

    // Migration versioning table
    await query(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
    const appliedRows = await query('SELECT id FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map(r=>r.id));
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (fs.existsSync(migrationsDir)){
      const files = fs.readdirSync(migrationsDir).filter(f=>/^[0-9]{3}_.+\.sql$/.test(f)).sort();
      for (const file of files){
        const id = file.split('_')[0];
        if (applied.has(id)) continue;
        const sql = fs.readFileSync(path.join(migrationsDir,file),'utf8');
        if (!sql.trim()){ console.log(`Skipping empty migration ${file}`); continue; }
        console.log(`Applying migration ${file}...`);
        await query('BEGIN');
        try {
          await query(sql);
          await query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
          await query('COMMIT');
          console.log(`Migration ${file} applied.`);
        } catch (e){
          await query('ROLLBACK');
          console.error(`Migration ${file} failed:`, e.message);
          throw e;
        }
      }
      // Quick diagnostic: warn if email column still missing (edge case)
      const { rows: chk } = await query(`SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email'`);
      if (!chk.length) console.warn('WARNING: email column still missing from users table.');
    }

    // Seed strains table from JSON if empty
    const { rows } = await query('SELECT COUNT(*)::int AS count FROM strains');
    if (rows[0].count === 0) {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', 'data', 'strains.json');
      if (fs.existsSync(file)) {
        const list = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(`Seeding ${list.length} strains...`);
        for (const s of list) {
          await query(`INSERT INTO strains (id, name, type, thc, cbd, effects, flavors, aroma, medical_uses, recommended_use, image, grow)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (id) DO NOTHING`, [
              s.id,
              s.name,
              s.type,
              s.thc,
              s.cbd,
              s.effects || null,
              JSON.stringify(s.flavors || []),
              JSON.stringify(s.aroma || []),
              JSON.stringify(s.medicalUses || []),
              s.recommendedUse || null,
              s.image || null,
              JSON.stringify(s.grow || null)
            ]);
        }
        console.log('Strains seeded.');
      }
    }
    console.log('Migration complete.');
    process.exit(0);
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  }
})();
