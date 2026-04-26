/**
 * server/seed.js
 * Populates the database with:
 *  - 1 admin account    (admin / admin123)
 *  - 3 test participants
 *  - 1 active access code per participant
 *  - 1 starter invite code for controlled signup
 *
 * Safe to re-run: INSERT OR IGNORE skips existing rows.
 *
 * Usage:
 *   node server/seed.js
 */

'use strict';

const { randomUUID, createHash } = require('crypto');
const bcrypt         = require('bcryptjs');
const db             = require('./db');

function hashInviteCode(code) {
  return createHash('sha256').update(code).digest('hex');
}

// ── Admin user ────────────────────────────────────────────────
const adminHash = bcrypt.hashSync('admin123', 10);
db.prepare(`
  INSERT OR IGNORE INTO admin_users (username, password_hash)
  VALUES (?, ?)
`).run('admin', adminHash);

console.log('✓ Admin user: admin / admin123');

// ── Participants ──────────────────────────────────────────────
const participants = [
  { code: 'P-2024-001', name: 'Test Participant 001', group: 'A', route: 1, timeslot: 1 },
  { code: 'P-2024-042', name: 'BarryXI',              group: 'A', route: 3, timeslot: 2 },
  { code: 'P-2024-099', name: 'Test Participant 099', group: 'B', route: 2, timeslot: 4 },
];

const insertParticipant = db.prepare(`
  INSERT OR IGNORE INTO participants (participant_code, name, group_code, route, timeslot)
  VALUES (@code, @name, @group, @route, @timeslot)
`);

const insertToken = db.prepare(`
  INSERT INTO upload_tokens (token, participant_id)
  VALUES (?, ?)
`);

const getParticipant = db.prepare(`
  SELECT id FROM participants WHERE participant_code = ?
`);

const existingToken = db.prepare(`
  SELECT token FROM upload_tokens WHERE participant_id = ? LIMIT 1
`);

console.log('\n  Participant credentials (ID + Access Code):');
console.log('  ────────────────────────────────────────────────────────────');

participants.forEach(p => {
  insertParticipant.run(p);

  const { id } = getParticipant.get(p.code);

  // Only create a new token if none exists
  let { token } = existingToken.get(id) || {};
  if (!token) {
    token = randomUUID();
    insertToken.run(token, id);
  }

  const port = process.env.PORT || 3000;
  console.log(`  ${p.code} (${p.name})`);
  console.log(`  Participant ID: ${p.code}`);
  console.log(`  Access Code:    ${token}`);
  console.log(`  Login URL:      http://localhost:${port}/login.html`);
  console.log();
});

// ── Starter invite for controlled signup ──────────────────────
const defaultInviteCode = 'RCT-INVITE-001';
const inviteExists = db.prepare('SELECT id FROM participant_invites WHERE invite_code_hash = ? LIMIT 1');
const insertInvite = db.prepare(`
  INSERT INTO participant_invites
    (invite_code_hash, label, default_group_code, default_route, default_timeslot, max_uses, is_active, created_by_admin_id)
  VALUES (?, ?, ?, ?, ?, ?, 1, (SELECT id FROM admin_users WHERE username='admin' LIMIT 1))
`);

const inviteHash = hashInviteCode(defaultInviteCode);
if (!inviteExists.get(inviteHash)) {
  insertInvite.run(inviteHash, 'Seed Default Invite', 'A', 1, 1, 50);
}

console.log('  Starter invite for signup:');
console.log(`  Invite Code: ${defaultInviteCode}`);
console.log();

console.log('  Admin panel:');
const port = process.env.PORT || 3000;
console.log(`  http://localhost:${port}/admin/login.html`);
console.log(`  http://localhost:${port}/admin/signup-requests.html`);
console.log();
