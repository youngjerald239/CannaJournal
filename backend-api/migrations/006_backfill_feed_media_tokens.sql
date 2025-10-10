-- 006_backfill_feed_media_tokens.sql
-- For messages that have an attachment_id but whose content_text lacks a media token, append one.
-- Idempotent: only updates rows missing token.

UPDATE messages m
SET content_text = COALESCE(NULLIF(content_text,''),'') || (CASE WHEN content_text ~ ('\\n$') THEN '' ELSE '\n' END) || '[media:' || m.attachment_id || ']'
WHERE m.attachment_id IS NOT NULL
  AND (m.content_text IS NULL OR m.content_text NOT LIKE '%[media:' || m.attachment_id || ']%');
