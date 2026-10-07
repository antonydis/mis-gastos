CREATE TABLE IF NOT EXISTS user_links (
  telegram_user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  google_refresh_token TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NIO',
  timezone TEXT NOT NULL DEFAULT 'America/Managua',
  linked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  link_code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending (
  telegram_user_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
