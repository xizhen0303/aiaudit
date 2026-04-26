/**
 * server/db.js
 * Opens (or creates) the SQLite database and applies the schema.
 * Returns the same singleton connection on every require().
 *
 * Uses node:sqlite — built into Node.js 22.5+ (stable in Node 24).
 * No native compilation required.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// node:sqlite is a built-in module — no npm package needed
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR   = path.join(__dirname, 'data');
const DB_PATH    = path.join(DATA_DIR, 'research.db');
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// Ensure data directory exists before opening the file
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// WAL mode: better concurrent read performance, safe on crash
db.exec('PRAGMA journal_mode = WAL');

// Enforce FK constraints (SQLite disables them by default)
db.exec('PRAGMA foreign_keys = ON');

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function hasColumn(table, column) {
  return tableColumns(table).includes(column);
}

function runIfMissingTable(table, sql) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  if (!row) db.exec(sql);
}

// ── Minimal startup migrations for existing local DBs ─────────
if (!hasColumn('participants', 'email')) {
  db.exec('ALTER TABLE participants ADD COLUMN email TEXT');
}

runIfMissingTable('participant_credentials', `
  CREATE TABLE participant_credentials (
    participant_id INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    password_hash  TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

runIfMissingTable('participant_email_verifications', `
  CREATE TABLE participant_email_verifications (
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
  )
`);

runIfMissingTable('participant_invites', `
  CREATE TABLE participant_invites (
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
  )
`);

runIfMissingTable('participant_signup_requests', `
  CREATE TABLE participant_signup_requests (
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
  )
`);

// Apply schema after compatibility migrations
// All statements use IF NOT EXISTS, safe to re-run
// Index creation also happens here.
db.exec(SCHEMA_SQL);

module.exports = db;
