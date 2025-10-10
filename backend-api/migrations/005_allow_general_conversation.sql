-- 005_allow_general_conversation.sql
-- Ensure the conversations.type check constraint includes 'general'
-- and seed a general conversation row if it does not yet exist.

BEGIN;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_type_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_type_check CHECK (type IN ('direct','group','general'));

-- Seed the general conversation if missing
INSERT INTO conversations (type, title)
SELECT 'general','General Chat'
WHERE NOT EXISTS (SELECT 1 FROM conversations WHERE type='general');
COMMIT;
