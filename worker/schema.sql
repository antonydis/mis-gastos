CREATE TABLE IF NOT EXISTS user_links (
  telegram_user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  google_refresh_token TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
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


CREATE TABLE IF NOT EXISTS user_preferences (
  telegram_user_id TEXT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT 'es'
);


CREATE TABLE IF NOT EXISTS reminder_settings (
 telegram_user_id TEXT PRIMARY KEY,
 enabled INTEGER NOT NULL DEFAULT 0,
 local_time TEXT NOT NULL DEFAULT '20:30',
 reviewed_day TEXT NOT NULL DEFAULT '',
 last_activity_at INTEGER NOT NULL DEFAULT 0,
 last_sent_day TEXT NOT NULL DEFAULT '',
 snooze_until INTEGER NOT NULL DEFAULT 0
);

-- Pilot-only contacts, separate from personal expense sheets.
CREATE TABLE IF NOT EXISTS pilot_waitlist (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified_at INTEGER
);

-- One confirmation email per subscribed address; failed sends remain queued for retry.
CREATE TABLE IF NOT EXISTS pilot_confirmation_queue (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  sent_at INTEGER
);
