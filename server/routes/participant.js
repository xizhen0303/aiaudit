/**
 * server/routes/participant.js
 * Participant-facing API routes.
 *
 * POST /api/participant/register-email   — start email verification signup
 * POST /api/participant/verify-email-code — verify code and auto-approve account
 * POST /api/participant/signup-request   — legacy invite-gated signup request
 * POST /api/participant/login            — authenticate with email/participant ID and password or legacy access code
 * GET  /api/participant/me               — return current participant (requires session)
 * POST /api/participant/logout           — destroy participant session
 *
 * GET  /api/me                           — backward-compatible token endpoint
 */

'use strict';

const crypto       = require('crypto');
const bcrypt       = require('bcryptjs');
const express      = require('express');
const router       = express.Router();
const db           = require('../db');
const requireToken = require('../middleware/requireToken');

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;

// ── Prepared statements ───────────────────────────────────────
const findParticipantByIdentifier = db.prepare(`
  SELECT
    p.id,
    p.participant_code,
    p.name,
    p.email,
    p.group_code,
    p.route,
    p.timeslot,
    p.status,
    pc.password_hash
  FROM participants p
  LEFT JOIN participant_credentials pc ON pc.participant_id = p.id
  WHERE p.participant_code = ? OR lower(p.email) = ?
  LIMIT 1
`);

const findParticipantByToken = db.prepare(`
  SELECT p.id
  FROM participants p
  JOIN upload_tokens t ON t.participant_id = p.id
  WHERE p.participant_code = ?
    AND t.token = ?
    AND t.is_active = 1
  LIMIT 1
`);

const getParticipantById = db.prepare(`
  SELECT
    id,
    participant_code,
    name,
    email,
    group_code,
    route,
    timeslot,
    status
  FROM participants
  WHERE id = ?
`);

const findInviteByHash = db.prepare(`
  SELECT
    id,
    default_group_code,
    default_route,
    default_timeslot,
    max_uses,
    used_count,
    is_active,
    expires_at
  FROM participant_invites
  WHERE invite_code_hash = ?
  LIMIT 1
`);

const existingParticipantByCode = db.prepare(`
  SELECT id FROM participants WHERE participant_code = ? LIMIT 1
`);

const existingParticipantByEmail = db.prepare(`
  SELECT id FROM participants WHERE lower(email) = ? LIMIT 1
`);

const existingPendingRequestByCode = db.prepare(`
  SELECT id
  FROM participant_signup_requests
  WHERE participant_code = ?
    AND status = 'pending'
  LIMIT 1
`);

const insertSignupRequest = db.prepare(`
  INSERT INTO participant_signup_requests
    (invite_id, participant_code, name, password_hash,
     requested_group_code, requested_route, requested_timeslot)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const expireEmailVerifications = db.prepare(`
  UPDATE participant_email_verifications
  SET status = 'expired'
  WHERE email = ?
    AND status = 'pending'
`);

const insertEmailVerification = db.prepare(`
  INSERT INTO participant_email_verifications
    (email, participant_code, name, password_hash, code_hash, expires_at, max_attempts, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
`);

const getLatestPendingVerification = db.prepare(`
  SELECT *
  FROM participant_email_verifications
  WHERE email = ?
    AND status = 'pending'
  ORDER BY id DESC
  LIMIT 1
`);

const markVerificationVerified = db.prepare(`
  UPDATE participant_email_verifications
  SET status = 'verified', verified_at = datetime('now')
  WHERE id = ?
`);

const incrementVerificationAttempt = db.prepare(`
  UPDATE participant_email_verifications
  SET attempt_count = attempt_count + 1
  WHERE id = ?
`);

const lockVerification = db.prepare(`
  UPDATE participant_email_verifications
  SET status = 'locked'
  WHERE id = ?
`);

const expireVerificationById = db.prepare(`
  UPDATE participant_email_verifications
  SET status = 'expired'
  WHERE id = ?
`);

const insertParticipant = db.prepare(`
  INSERT INTO participants (participant_code, name, email, group_code, route, timeslot, status)
  VALUES (?, ?, ?, ?, ?, ?, 'active')
`);

const insertParticipantCredential = db.prepare(`
  INSERT INTO participant_credentials (participant_id, password_hash)
  VALUES (?, ?)
`);

function hashInviteCode(inviteCode) {
  return crypto.createHash('sha256').update(inviteCode).digest('hex');
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function normalizeParticipantCode(code) {
  return String(code || '').trim().toUpperCase();
}

function normalizeName(name) {
  return String(name || '').trim();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function parseRoute(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function verificationExpiryString() {
  return new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
}

function sendVerificationCode(email, code) {
  console.log(`[VERIFY CODE] ${email} -> ${code}`);
  if (process.env.NODE_ENV !== 'production') {
    return { delivery: 'dev-log', verification_code: code };
  }
  return { delivery: 'log-only' };
}

function participantPayload(row) {
  return {
    id:              row.id,
    participantCode: row.participant_code,
    name:            row.name || row.participant_code,
    email:           row.email || null,
    group:           row.group_code,
    route:           row.route,
    timeslot:        row.timeslot,
    status:          row.status
  };
}

// ── POST /api/participant/register-email ──────────────────────
router.post('/participant/register-email', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const participantCode = normalizeParticipantCode(req.body.participant_code);
  const name = normalizeName(req.body.name);
  const password = String(req.body.password || '').trim();

  if (!email || !participantCode || !password) {
    return res.status(400).json({ error: 'Email, participant ID, and password are required.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email format is invalid.' });
  }

  if (participantCode.length < 4 || participantCode.length > 64) {
    return res.status(400).json({ error: 'Participant ID format is invalid.' });
  }

  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }

  if (existingParticipantByCode.get(participantCode)) {
    return res.status(409).json({ error: 'Participant ID already exists.' });
  }

  if (existingParticipantByEmail.get(email)) {
    return res.status(409).json({ error: 'Email is already registered.' });
  }

  const code = generateVerificationCode();
  const passwordHash = bcrypt.hashSync(password, 10);
  const expiry = verificationExpiryString();

  expireEmailVerifications.run(email);
  insertEmailVerification.run(
    email,
    participantCode,
    name || null,
    passwordHash,
    hashVerificationCode(code),
    expiry,
    CODE_MAX_ATTEMPTS
  );

  const delivery = sendVerificationCode(email, code);
  const response = {
    ok: true,
    message: 'Verification code sent if the email is valid.',
    expiresInMinutes: CODE_TTL_MINUTES
  };

  if (delivery.verification_code) {
    response.verification_code = delivery.verification_code;
  }

  res.status(201).json(response);
});

// ── POST /api/participant/verify-email-code ───────────────────
router.post('/participant/verify-email-code', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || '').trim();

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  const verification = getLatestPendingVerification.get(email);
  if (!verification) {
    return res.status(401).json({ error: 'Invalid or expired verification code.' });
  }

  if (new Date(verification.expires_at) < new Date()) {
    expireVerificationById.run(verification.id);
    return res.status(401).json({ error: 'Verification code has expired.' });
  }

  if (verification.attempt_count >= verification.max_attempts) {
    lockVerification.run(verification.id);
    return res.status(429).json({ error: 'Too many incorrect verification attempts.' });
  }

  if (verification.code_hash !== hashVerificationCode(code)) {
    incrementVerificationAttempt.run(verification.id);
    const updated = getLatestPendingVerification.get(email);
    if (updated && updated.attempt_count >= updated.max_attempts) {
      lockVerification.run(updated.id);
      return res.status(429).json({ error: 'Too many incorrect verification attempts.' });
    }
    return res.status(401).json({ error: 'Invalid verification code.' });
  }

  if (existingParticipantByCode.get(verification.participant_code)) {
    expireVerificationById.run(verification.id);
    return res.status(409).json({ error: 'Participant ID already exists.' });
  }

  if (existingParticipantByEmail.get(email)) {
    expireVerificationById.run(verification.id);
    return res.status(409).json({ error: 'Email is already registered.' });
  }

  let participantId;
  try {
    db.exec('BEGIN');
    const result = insertParticipant.run(
      verification.participant_code,
      verification.name,
      email,
      'A',
      1,
      1
    );
    participantId = result.lastInsertRowid;
    insertParticipantCredential.run(participantId, verification.password_hash);
    markVerificationVerified.run(verification.id);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.participantId = participantId;
    req.session.participantCode = verification.participant_code;
    res.json({ ok: true, redirect: '/dashboard.html' });
  });
});

// ── POST /api/participant/signup-request (legacy) ─────────────
router.post('/participant/signup-request', (req, res) => {
  const inviteCode      = String(req.body.invite_code || '').trim();
  const participantCode = normalizeParticipantCode(req.body.participant_code);
  const name            = normalizeName(req.body.name);
  const password        = String(req.body.password || '').trim();

  const requestedGroup  = req.body.group_code ? String(req.body.group_code).trim().toUpperCase() : null;
  const requestedRoute  = parseRoute(req.body.route);
  const requestedSlot   = parseRoute(req.body.timeslot);

  if (!inviteCode || !participantCode || !password) {
    return res.status(400).json({ error: 'Invite code, participant ID, and password are required.' });
  }

  if (participantCode.length < 4 || participantCode.length > 64) {
    return res.status(400).json({ error: 'Participant ID format is invalid.' });
  }

  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }

  if (requestedGroup && !['A', 'B', 'C'].includes(requestedGroup)) {
    return res.status(400).json({ error: 'Group must be A, B, or C.' });
  }

  if (requestedRoute !== null && ![1, 2, 3].includes(requestedRoute)) {
    return res.status(400).json({ error: 'Route must be 1, 2, or 3.' });
  }

  if (requestedSlot !== null && ![1, 2, 3, 4, 5].includes(requestedSlot)) {
    return res.status(400).json({ error: 'Timeslot must be 1-5.' });
  }

  if (existingParticipantByCode.get(participantCode)) {
    return res.status(409).json({ error: 'Participant ID already exists.' });
  }

  if (existingPendingRequestByCode.get(participantCode)) {
    return res.status(409).json({ error: 'A pending signup request already exists for this participant ID.' });
  }

  const invite = findInviteByHash.get(hashInviteCode(inviteCode));
  if (!invite) {
    return res.status(401).json({ error: 'Invalid invite code.' });
  }

  if (!invite.is_active) {
    return res.status(401).json({ error: 'Invite code is inactive.' });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invite code has expired.' });
  }

  if (invite.used_count >= invite.max_uses) {
    return res.status(401).json({ error: 'Invite code has reached its usage limit.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  insertSignupRequest.run(
    invite.id,
    participantCode,
    name || null,
    passwordHash,
    requestedGroup,
    requestedRoute,
    requestedSlot
  );

  res.status(201).json({ ok: true, status: 'pending' });
});

// ── POST /api/participant/login ───────────────────────────────
router.post('/participant/login', (req, res) => {
  const identifier = String(req.body.participant_code || '').trim();
  const normalizedCode = normalizeParticipantCode(identifier);
  const normalizedEmail = normalizeEmail(identifier);
  const secret = String(req.body.password || req.body.access_code || '').trim();

  if (!identifier || !secret) {
    return res.status(400).json({ error: 'Participant ID/email and password/access code required' });
  }

  const participant = findParticipantByIdentifier.get(normalizedCode, normalizedEmail);
  if (!participant) {
    return res.status(401).json({ error: 'Invalid login credentials.' });
  }

  let valid = false;

  if (participant.password_hash) {
    valid = bcrypt.compareSync(secret, participant.password_hash);
  } else {
    valid = !!findParticipantByToken.get(participant.participant_code, secret);
  }

  if (!valid) {
    return res.status(401).json({ error: 'Invalid login credentials.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.participantId = participant.id;
    req.session.participantCode = participant.participant_code;
    res.json({ ok: true, redirect: '/dashboard.html' });
  });
});

// ── GET /api/participant/me ───────────────────────────────────
router.get('/participant/me', (req, res) => {
  if (!req.session || !req.session.participantId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const row = getParticipantById.get(req.session.participantId);
  if (!row) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({ participant: participantPayload(row) });
});

// ── POST /api/participant/logout ──────────────────────────────
router.post('/participant/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── GET /api/me (backward-compatible token endpoint) ──────────
router.get('/me', requireToken, (req, res) => {
  res.json(req.participant);
});

module.exports = router;
