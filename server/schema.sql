-- ================================================================
-- RCT Research Platform — SQLite Schema
-- Run automatically by server/db.js on first startup.
-- ================================================================

-- Stores one row per study participant.
CREATE TABLE IF NOT EXISTS participants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_code TEXT    NOT NULL UNIQUE,           -- e.g. P-2024-042
  name             TEXT,
  email            TEXT UNIQUE,
  group_code       TEXT    NOT NULL CHECK(group_code IN ('A','B','C')),
  route            INTEGER NOT NULL CHECK(route      IN (1,2,3)),
  timeslot         INTEGER NOT NULL CHECK(timeslot   IN (1,2,3,4,5)),
  status           TEXT    NOT NULL DEFAULT 'active'
                           CHECK(status IN ('active','inactive','completed')),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Maps participant access codes (stored as tokens) to participants.
-- Login flow uses participant_code + access_code via /login.html and session auth.
CREATE TABLE IF NOT EXISTS upload_tokens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT    NOT NULL UNIQUE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  expires_at     TEXT,                               -- NULL = no expiry
  is_active      INTEGER NOT NULL DEFAULT 1,         -- 0 = revoked
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Password credentials for participants approved through controlled signup.
CREATE TABLE IF NOT EXISTS participant_credentials (
  participant_id INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  password_hash  TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Pending email verification records for automatic signup approval.
CREATE TABLE IF NOT EXISTS participant_email_verifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT    NOT NULL,
  participant_code  TEXT    NOT NULL,
  name              TEXT,
  password_hash     TEXT    NOT NULL,
  code_hash         TEXT    NOT NULL,
  expires_at        TEXT    NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 5,
  status            TEXT    NOT NULL DEFAULT 'pending'
                             CHECK(status IN ('pending','verified','expired','locked')),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  verified_at       TEXT
);

-- Admin-created invite codes used to gate participant signup requests.
CREATE TABLE IF NOT EXISTS participant_invites (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_code_hash    TEXT    NOT NULL UNIQUE,
  label               TEXT,
  default_group_code  TEXT    CHECK(default_group_code IN ('A','B','C')),
  default_route       INTEGER CHECK(default_route      IN (1,2,3)),
  default_timeslot    INTEGER CHECK(default_timeslot   IN (1,2,3,4,5)),
  max_uses            INTEGER NOT NULL DEFAULT 1 CHECK(max_uses >= 1),
  used_count          INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
  is_active           INTEGER NOT NULL DEFAULT 1,
  expires_at          TEXT,
  created_by_admin_id INTEGER REFERENCES admin_users(id),
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Participant signup requests waiting for admin review.
CREATE TABLE IF NOT EXISTS participant_signup_requests (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_id             INTEGER NOT NULL REFERENCES participant_invites(id),
  participant_code      TEXT    NOT NULL,
  name                  TEXT,
  password_hash         TEXT    NOT NULL,
  requested_group_code  TEXT    CHECK(requested_group_code IN ('A','B','C')),
  requested_route       INTEGER CHECK(requested_route      IN (1,2,3)),
  requested_timeslot    INTEGER CHECK(requested_timeslot   IN (1,2,3,4,5)),
  status                TEXT    NOT NULL DEFAULT 'pending'
                               CHECK(status IN ('pending','approved','rejected')),
  reviewed_by_admin_id  INTEGER REFERENCES admin_users(id),
  reviewed_at           TEXT,
  rejection_reason      TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per upload session submitted by a participant.
CREATE TABLE IF NOT EXISTS submissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_number TEXT    NOT NULL UNIQUE,           -- e.g. SUB-1710000000000
  participant_id   INTEGER NOT NULL REFERENCES participants(id),
  trip_date        TEXT,
  trip_end_time    TEXT,
  start_point      TEXT,
  destination      TEXT,
  timeslot         INTEGER,
  route            INTEGER,
  device           TEXT,
  notes            TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending','reviewed','flagged')),
  submitted_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per file attached to a submission.
CREATE TABLE IF NOT EXISTS submission_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  stored_path   TEXT    NOT NULL,                    -- relative to uploads/
  uploaded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Internal admin accounts (not participant-facing).
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,                    -- bcryptjs hash
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tokens_token
  ON upload_tokens(token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_email
  ON participants(email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_verifications_email_status
  ON participant_email_verifications(email, status);

CREATE INDEX IF NOT EXISTS idx_email_verifications_expires_at
  ON participant_email_verifications(expires_at);

CREATE INDEX IF NOT EXISTS idx_invites_hash
  ON participant_invites(invite_code_hash);

CREATE INDEX IF NOT EXISTS idx_signup_requests_status
  ON participant_signup_requests(status);

CREATE INDEX IF NOT EXISTS idx_signup_requests_participant
  ON participant_signup_requests(participant_code);

CREATE INDEX IF NOT EXISTS idx_submissions_participant
  ON submissions(participant_id);

CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions(status);

CREATE INDEX IF NOT EXISTS idx_files_submission
  ON submission_files(submission_id);
