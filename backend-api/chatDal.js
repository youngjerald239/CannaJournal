// Chat Data Access Layer
const { query } = require('./db');
const s3 = (()=>{ try { return require('./s3'); } catch(_) { return null; } })();
const { randomUUID } = require('crypto');

async function createDirectConversation(a, b) {
  if (a === b) throw new Error('cannot-self');
  const users = [a, b].sort();
  const existing = await query(`SELECT c.id FROM conversations c
    JOIN conversation_participants p1 ON p1.conversation_id=c.id AND p1.username=$1
    JOIN conversation_participants p2 ON p2.conversation_id=c.id AND p2.username=$2
    WHERE c.type='direct' LIMIT 1`, users);
  if (existing.rows.length) return existing.rows[0].id;
  const { rows } = await query('INSERT INTO conversations (type) VALUES ($1) RETURNING id', ['direct']);
  const id = rows[0].id;
  await query('INSERT INTO conversation_participants (conversation_id, username) VALUES ($1,$2),($1,$3)', [id, users[0], users[1]]);
  return id;
}

async function createGroupConversation(title, creator, members) {
  const { rows } = await query('INSERT INTO conversations (type, title) VALUES ($1,$2) RETURNING id', ['group', title || null]);
  const id = rows[0].id;
  const participants = Array.from(new Set([creator, ...(members||[])]));
  const params = [id];
  const values = [];
  let p = 2;
  for (const u of participants) {
    params.push(u);
    params.push(u === creator ? 'owner' : 'member');
    values.push(`($1,$${p},$${p+1})`);
    p += 2;
  }
  await query(`INSERT INTO conversation_participants (conversation_id, username, role) VALUES ${values.join(',')}`, params);
  return id;
}

async function createGeneralConversation(){
  const { rows } = await query("INSERT INTO conversations (type, title) VALUES ('general','General Chat') RETURNING id");
  return rows[0].id;
}

async function findGeneralConversation(){
  const { rows } = await query("SELECT id FROM conversations WHERE type='general' LIMIT 1");
  return rows[0]?.id || null;
}

async function listUserConversations(username){
  const { rows } = await query(`
    SELECT c.id, c.type, c.title, c.created_at,
      (SELECT json_agg(p.username) FROM conversation_participants p WHERE p.conversation_id=c.id) as participants,
      (
        SELECT m.content_text FROM messages m
        WHERE m.conversation_id=c.id AND NOT m.deleted
        ORDER BY m.created_at DESC LIMIT 1
      ) AS last_message_text,
      (
        SELECT m.created_at FROM messages m
        WHERE m.conversation_id=c.id
        ORDER BY m.created_at DESC LIMIT 1
      ) AS last_message_at,
      (
        SELECT COUNT(*) FROM messages m
        LEFT JOIN message_reads mr ON mr.message_id=m.id AND mr.username=$1
        WHERE m.conversation_id=c.id
          AND mr.message_id IS NULL
          AND (m.sender_username IS NULL OR m.sender_username <> $1)
      ) AS unread_count
    FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id=c.id AND cp.username=$1
    ORDER BY COALESCE(
      (SELECT m2.created_at FROM messages m2 WHERE m2.conversation_id=c.id ORDER BY m2.created_at DESC LIMIT 1), c.created_at
    ) DESC
  `,[username]);
  return rows;
}

async function addParticipant(conversationId, username){
  await query('INSERT INTO conversation_participants (conversation_id, username) VALUES ($1,$2) ON CONFLICT DO NOTHING',[conversationId, username]);
}
async function removeParticipant(conversationId, username){
  await query('DELETE FROM conversation_participants WHERE conversation_id=$1 AND username=$2',[conversationId, username]);
}

async function insertMessage({ conversationId, sender, contentText, contentType='text', attachmentId=null, parentMessageId=null }){
  const id = randomUUID();
  await query(`INSERT INTO messages (id, conversation_id, sender_username, content_text, content_type, attachment_id, parent_message_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,[id, conversationId, sender, contentText||null, contentType, attachmentId, parentMessageId]);
  const { rows } = await query(`SELECT m.*, a.storage_path, a.mime_type FROM messages m
    LEFT JOIN attachments a ON a.id = m.attachment_id
    WHERE m.id=$1`,[id]);
  const row = rows[0];
  if (row && row.storage_path) row.attachment_url = (s3 && s3.isEnabled()) ? s3.getPublicUrl(row.storage_path) : ('/uploads/chat/' + row.storage_path);
  return row;
}

async function insertSystemMessage(conversationId, text){
  return insertMessage({ conversationId, sender: null, contentText: text, contentType: 'system', attachmentId: null });
}

async function getConversation(id){
  const { rows } = await query('SELECT * FROM conversations WHERE id=$1',[id]);
  return rows[0] || null;
}

async function listParticipants(conversationId){
  const { rows } = await query('SELECT username, role FROM conversation_participants WHERE conversation_id=$1',[conversationId]);
  return rows;
}

async function isParticipant(conversationId, username){
  const { rows } = await query('SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND username=$2 LIMIT 1',[conversationId, username]);
  return rows.length>0;
}

async function getMessage(messageId){
  const { rows } = await query('SELECT * FROM messages WHERE id=$1',[messageId]);
  return rows[0] || null;
}

async function listMessages(conversationId, { before=null, limit=30 }={}){
  limit = limit|0 || 30;
  let sql = `SELECT m.*, a.storage_path, a.mime_type FROM messages m
    LEFT JOIN attachments a ON a.id = m.attachment_id
    WHERE m.conversation_id=$1`;
  const params = [conversationId];
  if (before) { params.push(before); sql += ` AND m.created_at < $${params.length}`; }
  sql += ' ORDER BY m.created_at DESC LIMIT ' + (limit+1);
  const { rows } = await query(sql, params);
  const hasMore = rows.length > limit;
  const slice = rows.slice(0, limit).reverse().map(r=> ({
    ...r,
    attachment_url: r.storage_path ? ((s3 && s3.isEnabled()) ? s3.getPublicUrl(r.storage_path) : ('/uploads/chat/' + r.storage_path)) : null
  }));
  return { messages: slice, hasMore };
}

async function upsertReaction(messageId, username, reaction){
  await query(`INSERT INTO message_reactions (message_id, username, reaction)
    VALUES ($1,$2,$3)
    ON CONFLICT (message_id, username) DO UPDATE SET reaction=EXCLUDED.reaction, created_at=now()`,[messageId, username, reaction]);
  return true;
}

async function reactionsForMessages(messageIds){
  if (!messageIds.length) return {};
  const { rows } = await query(`SELECT message_id, reaction, COUNT(*)::int as count
     FROM message_reactions WHERE message_id = ANY($1::uuid[]) GROUP BY message_id, reaction`, [messageIds]);
  const map = {};
  for (const r of rows){
    if (!map[r.message_id]) map[r.message_id] = {};
    map[r.message_id][r.reaction] = Number(r.count);
  }
  return map;
}

// Feed listing (general conversation) with cursor pagination & optional hashtag filter
async function listFeed({ generalId, before=null, limit=30, hashtag=null }={}){
  limit = Math.min(Math.max(limit|0, 1), 100);
  const params = [generalId];
    // NOTE: use single quotes for string literal 'system'; previous version used double quotes causing invalid identifier and 500 errors
    let where = 'm.conversation_id=$1 AND m.deleted=false AND m.content_type <> \'system\'';
  if (before){ params.push(before); where += ` AND m.created_at < $${params.length}`; }
  if (hashtag){
    // allow user to pass with or without leading #; we search case-insensitive
    const tag = hashtag.startsWith('#')? hashtag.toLowerCase(): '#'+hashtag.toLowerCase();
    params.push('%'+tag+'%');
    where += ` AND lower(m.content_text) LIKE $${params.length}`;
  }
  const sql = `SELECT m.id, m.content_text, m.sender_username, m.created_at, m.content_type, m.parent_message_id,
      m.attachment_id, a.storage_path, a.mime_type,
      (SELECT COUNT(*) FROM messages cm WHERE cm.parent_message_id = m.id AND cm.deleted=false) AS reply_count
    FROM messages m
    LEFT JOIN attachments a ON a.id = m.attachment_id
    WHERE ${where}
    ORDER BY m.created_at DESC
    LIMIT ${limit+1}`;
  const { rows } = await query(sql, params);
  const hasMore = rows.length > limit;
  const slice = rows.slice(0, limit);
  const reactions = await reactionsForMessages(slice.map(r=>r.id));

  // Collect media token IDs (UUIDs) referenced in content_text for multi-attachment posts
  const tokenIdSet = new Set();
  const uuidRe = /\[media:([0-9a-fA-F-]{36})\]/g; // UUID v4 pattern length check
  for (const r of slice){
    let m; while((m = uuidRe.exec(r.content_text||''))){ tokenIdSet.add(m[1]); }
  }
  // Remove any id already captured by attachment join
  for (const r of slice){ if (r.attachment_id) tokenIdSet.delete(r.attachment_id); }
  let tokenAttMap = new Map();
  if (tokenIdSet.size){
    try {
      const ids = Array.from(tokenIdSet);
      const { rows: atts } = await query(`SELECT id, mime_type, storage_path, size_bytes FROM attachments WHERE id = ANY($1::uuid[])`, [ids]);
      atts.forEach(a => { tokenAttMap.set(a.id, { id: a.id, url: (s3 && s3.isEnabled()) ? s3.getPublicUrl(a.storage_path) : ('/uploads/feed/' + a.storage_path), mime: a.mime_type, size: a.size_bytes }); });
    } catch (e){ /* ignore hydration errors */ }
  }

  const messages = slice.map(r => {
    const base = {
      id: r.id,
      content_text: r.content_text,
      sender_username: r.sender_username,
      created_at: r.created_at,
      content_type: r.content_type,
      parent_message_id: r.parent_message_id,
      reply_count: r.reply_count,
      reactions: reactions[r.id] || {}
    };
    const attachments = [];
    if (r.storage_path && r.attachment_id){
      attachments.push({ id: r.attachment_id, url: (s3 && s3.isEnabled()) ? s3.getPublicUrl(r.storage_path) : ('/uploads/feed/' + r.storage_path), mime: r.mime_type });
    }
    // Parse tokens in order of appearance so front-end keeps layout order
    const orderedTokens = [];
    let m; uuidRe.lastIndex = 0;
    while((m = uuidRe.exec(r.content_text||''))){ orderedTokens.push(m[1]); }
    for (const id of orderedTokens){ if (tokenAttMap.has(id) && !attachments.find(a=>a.id===id)) attachments.push(tokenAttMap.get(id)); }
    return { ...base, attachments };
  });
  return { messages, nextCursor: hasMore? slice[slice.length-1].created_at : null };
}

async function getThread(messageId){
  const { rows } = await query(`SELECT m.*, a.storage_path, a.mime_type,
      (SELECT COUNT(*) FROM messages ch WHERE ch.parent_message_id=m.id AND ch.deleted=false) AS reply_count
    FROM messages m
    LEFT JOIN attachments a ON a.id=m.attachment_id
    WHERE m.id=$1`,[messageId]);
  const root = rows[0];
  if (!root) return null;
  const replies = await listThreadReplies(messageId);
  return { root, replies };
}

async function listThreadReplies(messageId){
  const { rows } = await query(`SELECT m.*, a.storage_path, a.mime_type
    FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id
    WHERE m.parent_message_id=$1 AND m.deleted=false
    ORDER BY m.created_at ASC LIMIT 200`,[messageId]);
  const reactions = await reactionsForMessages(rows.map(r=>r.id));
  return rows.map(r => ({
    id: r.id,
    content_text: r.content_text,
    sender_username: r.sender_username,
    created_at: r.created_at,
    content_type: r.content_type,
    parent_message_id: r.parent_message_id,
    reply_count: r.reply_count,
    reactions: reactions[r.id] || {},
    // Provide both legacy attachment_url and new attachments[] for feed-style rendering
    attachment_url: r.storage_path? ((s3 && s3.isEnabled()) ? s3.getPublicUrl(r.storage_path) : ('/uploads/chat/' + r.storage_path)) : null,
    attachments: r.storage_path ? [{ id: r.attachment_id, url: (s3 && s3.isEnabled()) ? s3.getPublicUrl(r.storage_path) : ((r.conversation_id ? '/uploads/chat/' : '/uploads/feed/') + r.storage_path), mime: r.mime_type }] : []
  }));
}

// Social graph operations
async function followUser(follower, target){
  if (follower === target) return false;
  await query(`INSERT INTO user_follows (follower_username, followed_username) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[follower, target]);
  return true;
}
async function unfollowUser(follower, target){
  await query(`DELETE FROM user_follows WHERE follower_username=$1 AND followed_username=$2`,[follower, target]);
  return true;
}
async function listFollowing(username){
  const { rows } = await query(`SELECT followed_username FROM user_follows WHERE follower_username=$1 ORDER BY followed_username`,[username]);
  return rows.map(r=>r.followed_username);
}
async function listFollowers(username){
  const { rows } = await query(`SELECT follower_username FROM user_follows WHERE followed_username=$1 ORDER BY follower_username`,[username]);
  return rows.map(r=>r.follower_username);
}
async function suggestedFollows(username, limit=8){
  // naive: users who appear in most recent general messages excluding already followed + self
  const generalId = await findGeneralConversation();
  if (!generalId) return [];
  const { rows } = await query(`WITH recent AS (
    SELECT DISTINCT sender_username FROM messages WHERE conversation_id=$1 AND sender_username IS NOT NULL ORDER BY created_at DESC LIMIT 200
  ) SELECT r.sender_username AS username FROM recent r
  WHERE r.sender_username <> $2 AND r.sender_username NOT IN (
    SELECT followed_username FROM user_follows WHERE follower_username=$2
  )
  LIMIT $3`,[generalId, username, limit]);
  return rows.map(r=>r.username);
}

async function unreadCount(conversationId, username){
  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM messages m
    LEFT JOIN message_reads mr ON mr.message_id=m.id AND mr.username=$2
    WHERE m.conversation_id=$1 AND mr.message_id IS NULL AND (m.sender_username IS NULL OR m.sender_username<>$2)`,[conversationId, username]);
  return rows[0]?.c || 0;
}

async function reportMessage(messageId, reporter, reason){
  await query(`INSERT INTO message_reports (message_id, reporter_username, reason) VALUES ($1,$2,$3)`,[messageId, reporter, reason?.slice(0,400) || null]);
  return true;
}
async function listReports(limit=100){
  const { rows } = await query(`SELECT r.id, r.message_id, r.reporter_username, r.reason, r.created_at, r.reviewed, m.content_text, m.sender_username
    FROM message_reports r LEFT JOIN messages m ON m.id=r.message_id
    ORDER BY r.created_at DESC LIMIT $1`,[limit]);
  return rows;
}
async function resolveReport(id){
  await query(`UPDATE message_reports SET reviewed=true, reviewed_at=now() WHERE id=$1`,[id]);
  return true;
}

async function blockUser(blocker, blocked){
  await query('INSERT INTO user_blocks (blocker_username, blocked_username) VALUES ($1,$2) ON CONFLICT DO NOTHING',[blocker, blocked]);
}
async function unblockUser(blocker, blocked){
  await query('DELETE FROM user_blocks WHERE blocker_username=$1 AND blocked_username=$2',[blocker, blocked]);
}
async function listBlocked(blocker){
  const { rows } = await query('SELECT blocked_username FROM user_blocks WHERE blocker_username=$1',[blocker]);
  return rows.map(r=>r.blocked_username);
}

module.exports = {
  createDirectConversation,
  createGroupConversation,
  createGeneralConversation,
  findGeneralConversation,
  listUserConversations,
  addParticipant,
  removeParticipant,
  insertMessage,
  insertSystemMessage,
  listMessages,
  getConversation,
  listParticipants,
  isParticipant,
  getMessage,
  upsertReaction,
  reactionsForMessages,
  listFeed,
  getThread,
  listThreadReplies,
  followUser,
  unfollowUser,
  listFollowing,
  listFollowers,
  suggestedFollows,
  unreadCount,
  reportMessage,
  listReports,
  resolveReport,
  blockUser,
  unblockUser,
  listBlocked
};
