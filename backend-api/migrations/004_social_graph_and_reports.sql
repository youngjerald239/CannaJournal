-- Social graph (follows)
CREATE TABLE IF NOT EXISTS user_follows (
  follower_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  followed_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_username, followed_username)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_username);

-- Message reports for moderation
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