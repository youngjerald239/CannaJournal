// Data Access Layer for Postgres-backed operations.
// Each function assumes DATABASE_URL has been set and pool initialized via db.js.

const { query } = require('./db');

const EFFECT_KEYS = ['relaxation','energy','focus','euphoria','body','head'];

// ---------- Strains ----------
async function getAllStrains() {
  const sql = `SELECT id,name,type,thc,cbd,effects,flavors,aroma,medical_uses AS "medicalUses",recommended_use AS "recommendedUse",image,grow
               FROM strains ORDER BY id`; 
  const { rows } = await query(sql);
  return rows.map(r => ({ ...r, flavors: r.flavors || [], aroma: r.aroma || [], medicalUses: r.medicalUses || [], grow: r.grow || {} }));
}

async function insertStrain(data){
  const fields = ['name','type','thc','cbd','effects','flavors','aroma','medical_uses','recommended_use','image','grow'];
  const payload = {
    name: data.name || 'Unnamed',
    type: data.type || null,
    thc: data.thc ?? null,
    cbd: data.cbd ?? null,
    effects: data.effects || null,
    flavors: data.flavors || [],
    aroma: data.aroma || [],
    medical_uses: data.medicalUses || [],
    recommended_use: data.recommendedUse || null,
    image: data.image || null,
    grow: data.grow || null
  };
  const placeholders = fields.map((_,i)=>`$${i+1}`);
  const values = fields.map(f=> payload[f]);
  const sql = `INSERT INTO strains (${fields.join(',')}) VALUES (${placeholders.join(',')}) RETURNING id`;
  const { rows } = await query(sql, values);
  return rows[0];
}

async function deleteStrain(id){
  await query('DELETE FROM strains WHERE id=$1', [id]);
}

// ---------- Users & Auth ----------
async function findUser(username){
  const { rows } = await query('SELECT username, salt, hash, role, oauth, provider, display_name, bio, avatar_file, email FROM users WHERE username=$1',[username]);
  return rows[0] || null;
}

async function findUserByEmail(email){
  const { rows } = await query('SELECT username, salt, hash, role, oauth, provider, display_name, bio, avatar_file, email FROM users WHERE LOWER(email)=LOWER($1)',[email]);
  return rows[0] || null;
}

async function createLocalUser({ username, saltHex, hashHex, role='user', email=null }){
  const { rows } = await query('INSERT INTO users (username, email, salt, hash, role, oauth) VALUES ($1,$2,$3,$4,$5,false) RETURNING username, role',[username,email,saltHex,hashHex,role]);
  return rows[0];
}

async function upsertOAuthUser({ username, provider }){
  const { rows } = await query(`INSERT INTO users (username, oauth, provider, role)
      VALUES ($1,true,$2,'user')
      ON CONFLICT (username) DO UPDATE SET provider=EXCLUDED.provider
      RETURNING username, role`,[username, provider]);
  return rows[0];
}

async function updateProfile(username, { displayName, bio }){
  const { rows } = await query('UPDATE users SET display_name=$2, bio=$3 WHERE username=$1 RETURNING username, display_name, bio, avatar_file',[username, displayName, bio]);
  return rows[0];
}

async function updateAvatar(username, avatarFile){
  await query('UPDATE users SET avatar_file=$2 WHERE username=$1',[username, avatarFile]);
}

async function deleteUser(username){
  await query('DELETE FROM users WHERE username=$1',[username]);
}

// ---------- Favorites ----------
async function listFavorites(username){
  const { rows } = await query('SELECT strain_id AS id, added_at FROM favorites WHERE username=$1 ORDER BY added_at DESC',[username]);
  return rows.map(r=>({ id: String(r.id), addedAt: r.added_at }));
}

async function addFavorite(username, strainId){
  await query('INSERT INTO favorites (username, strain_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[username, strainId]);
}

async function removeFavorite(username, strainId){
  await query('DELETE FROM favorites WHERE username=$1 AND strain_id=$2',[username, strainId]);
}

// ---------- Journal ----------
async function listJournal(username){
  const { rows } = await query('SELECT id, owner, strain_id AS "strainId", strain_name AS "strainName", timestamp, rating, effect_scores AS "effectScores", notes FROM journal_entries WHERE owner=$1',[username]);
  return rows;
}

async function upsertJournalEntries(username, entries){
  if (!entries.length) return;
  const sql = `INSERT INTO journal_entries (id, owner, strain_id, strain_name, timestamp, rating, effect_scores, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (id) DO UPDATE SET owner=EXCLUDED.owner, strain_id=EXCLUDED.strain_id, strain_name=EXCLUDED.strain_name, timestamp=EXCLUDED.timestamp, rating=EXCLUDED.rating, effect_scores=EXCLUDED.effect_scores, notes=EXCLUDED.notes`;
  for (const e of entries){
    await query(sql,[e.id, username, e.strainId || null, e.strainName || null, e.timestamp || new Date().toISOString(), e.rating ?? null, e.effectScores || null, e.notes || null]);
  }
}

// ---------- Aggregations ----------
async function aggregateEffects(strainId){
  const cols = EFFECT_KEYS.map(k=>`AVG( (effect_scores->>'${k}')::numeric ) AS ${k}`).join(',');
  const { rows } = await query(`SELECT COUNT(*)::int AS count, ${cols} FROM journal_entries WHERE strain_id=$1 AND effect_scores IS NOT NULL`,[strainId]);
  const row = rows[0];
  if (!row.count){
    return { count:0, averages: Object.fromEntries(EFFECT_KEYS.map(k=>[k,0])) };
  }
  const averages = Object.fromEntries(EFFECT_KEYS.map(k=>[k, row[k] ? +(+row[k]).toFixed(2) : 0]));
  return { count: row.count, averages };
}

async function userEffectVectors(username){
  const { rows } = await query('SELECT strain_id, effect_scores, rating FROM journal_entries WHERE owner=$1 AND effect_scores IS NOT NULL',[username]);
  return rows;
}

module.exports = {
  EFFECT_KEYS,
  getAllStrains, insertStrain, deleteStrain,
  findUser, findUserByEmail, createLocalUser, upsertOAuthUser, updateProfile, updateAvatar, deleteUser,
  listFavorites, addFavorite, removeFavorite,
  listJournal, upsertJournalEntries,
  aggregateEffects, userEffectVectors
};
