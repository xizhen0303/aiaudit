/**
 * server/routes/admin.js
 *
 * POST /admin/login               — authenticate admin
 * POST /admin/logout              — destroy session
 * GET  /admin/api/submissions     — list with filters
 * GET  /admin/api/submissions/:id — single submission + files
 * PATCH /admin/api/submissions/:id/status — update status
 * GET  /admin/api/submissions/:id/download        — zip all files
 * GET  /admin/api/files/:fileId/download          — single file
 *
 * GET  /admin/api/signup-requests               — list signup requests
 * GET  /admin/api/signup-requests/:id           — signup request detail
 * PATCH /admin/api/signup-requests/:id          — approve/reject signup request
 */

'use strict';

const express       = require('express');
const router        = express.Router();
const path          = require('path');
const fs            = require('fs');
const crypto        = require('crypto');
const bcrypt        = require('bcryptjs');
const db            = require('../db');
const requireAdmin  = require('../middleware/requireAdmin');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

// ── Prepared statements ───────────────────────────────────────
const findAdmin = db.prepare('SELECT id, password_hash FROM admin_users WHERE username = ?');

// ── Filter query builder ──────────────────────────────────────
// LIMIT/OFFSET must be integer literals in node:sqlite — build
// per-request rather than using a shared prepared statement.
const FILTER_WHERE = `
  FROM submissions s
  JOIN participants p ON p.id = s.participant_id
  LEFT JOIN submission_files sf ON sf.submission_id = s.id
  WHERE
    (@participant IS NULL OR p.participant_code LIKE @participant)
    AND (@group_code IS NULL OR p.group_code  = @group_code)
    AND (@route     IS NULL OR s.route        = @route)
    AND (@status    IS NULL OR s.status       = @status)
    AND (@date_from IS NULL OR s.trip_date   >= @date_from)
    AND (@date_to   IS NULL OR s.trip_date   <= @date_to)
`;

const COUNT_SQL = `SELECT COUNT(DISTINCT s.id) AS total ${FILTER_WHERE}`;

function querySubmissions(filters, limit, offset) {
  const listSql = `
    SELECT
      s.id, s.reference_number, s.status, s.submitted_at,
      s.trip_date, s.trip_end_time, s.start_point, s.destination,
      s.timeslot, s.route, s.device,
      p.participant_code, p.name AS participant_name, p.group_code,
      COUNT(sf.id) AS file_count
    ${FILTER_WHERE}
    GROUP BY s.id
    ORDER BY s.submitted_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return {
    rows:  db.prepare(listSql).all(filters),
    total: db.prepare(COUNT_SQL).get(filters).total
  };
}

const getSubmission = db.prepare(`
  SELECT
    s.*,
    p.participant_code, p.name AS participant_name,
    p.group_code, p.timeslot AS participant_timeslot
  FROM submissions s
  JOIN participants p ON p.id = s.participant_id
  WHERE s.id = ?
`);

const getFiles = db.prepare(`
  SELECT * FROM submission_files WHERE submission_id = ? ORDER BY uploaded_at
`);

const getFile = db.prepare('SELECT * FROM submission_files WHERE id = ?');

const updateStatus = db.prepare(`
  UPDATE submissions SET status = ? WHERE id = ?
`);

const createInvite = db.prepare(`
  INSERT INTO participant_invites
    (invite_code_hash, label, default_group_code, default_route, default_timeslot,
     max_uses, is_active, expires_at, created_by_admin_id)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
`);

const signupCountSql = `
  SELECT COUNT(*) AS total
  FROM participant_signup_requests sr
  WHERE
    (@status IS NULL OR sr.status = @status)
    AND (@participant IS NULL OR sr.participant_code LIKE @participant)
`;

function querySignupRequests(filters, limit, offset) {
  const listSql = `
    SELECT
      sr.id,
      sr.participant_code,
      sr.name,
      sr.status,
      sr.created_at,
      sr.reviewed_at,
      sr.rejection_reason,
      sr.requested_group_code,
      sr.requested_route,
      sr.requested_timeslot,
      i.label AS invite_label
    FROM participant_signup_requests sr
    JOIN participant_invites i ON i.id = sr.invite_id
    WHERE
      (@status IS NULL OR sr.status = @status)
      AND (@participant IS NULL OR sr.participant_code LIKE @participant)
    ORDER BY sr.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return {
    rows:  db.prepare(listSql).all(filters),
    total: db.prepare(signupCountSql).get(filters).total
  };
}

const getSignupRequest = db.prepare(`
  SELECT
    sr.*,
    i.label AS invite_label,
    i.default_group_code,
    i.default_route,
    i.default_timeslot,
    i.max_uses,
    i.used_count,
    i.is_active AS invite_is_active
  FROM participant_signup_requests sr
  JOIN participant_invites i ON i.id = sr.invite_id
  WHERE sr.id = ?
`);

const participantByCode = db.prepare(`
  SELECT id FROM participants WHERE participant_code = ? LIMIT 1
`);

const insertParticipant = db.prepare(`
  INSERT INTO participants (participant_code, name, group_code, route, timeslot, status)
  VALUES (?, ?, ?, ?, ?, 'active')
`);

const insertParticipantCredential = db.prepare(`
  INSERT INTO participant_credentials (participant_id, password_hash)
  VALUES (?, ?)
`);

const markSignupApproved = db.prepare(`
  UPDATE participant_signup_requests
  SET status = 'approved', reviewed_by_admin_id = ?, reviewed_at = datetime('now'), rejection_reason = NULL
  WHERE id = ?
`);

const markSignupRejected = db.prepare(`
  UPDATE participant_signup_requests
  SET status = 'rejected', reviewed_by_admin_id = ?, reviewed_at = datetime('now'), rejection_reason = ?
  WHERE id = ?
`);

const incrementInviteUsage = db.prepare(`
  UPDATE participant_invites
  SET used_count = used_count + 1,
      is_active = CASE WHEN used_count + 1 >= max_uses THEN 0 ELSE is_active END
  WHERE id = ?
`);

const setInviteActiveState = db.prepare(`
  UPDATE participant_invites SET is_active = ? WHERE id = ?
`);

function hashInviteCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function parseOptInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

// ── POST /admin/login ─────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const admin = findAdmin.get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.adminId = admin.id;
    req.session.username = username;
    res.json({ ok: true, redirect: '/admin/signup-requests.html' });
  });
});

// ── POST /admin/logout ────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── GET /admin/api/submissions ────────────────────────────────
router.get('/api/submissions', requireAdmin, (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page, 10)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const offset = (page - 1) * limit;

  const filters = {
    participant: req.query.participant ? `%${req.query.participant}%` : null,
    group_code:  req.query.group   || null,
    route:       req.query.route   ? parseInt(req.query.route, 10) : null,
    status:      req.query.status  || null,
    date_from:   req.query.date_from || null,
    date_to:     req.query.date_to   || null
  };

  const { rows, total } = querySubmissions(filters, limit, offset);

  res.json({
    submissions: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

// ── GET /admin/api/submissions/:id ────────────────────────────
router.get('/api/submissions/:id', requireAdmin, (req, res) => {
  const sub = getSubmission.get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });

  const files = getFiles.all(sub.id);
  res.json({ submission: sub, files });
});

// ── PATCH /admin/api/submissions/:id/status ───────────────────
router.patch('/api/submissions/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const allowed    = ['pending', 'reviewed', 'flagged'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
  }

  const result = updateStatus.run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Submission not found' });

  console.log(`[ADMIN] Submission ${req.params.id} status → ${status} (by ${req.session.username})`);
  res.json({ ok: true, status });
});

// ── GET /admin/api/files/:fileId/download ─────────────────────
router.get('/api/files/:fileId/download', requireAdmin, (req, res) => {
  const file = getFile.get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const absPath = path.join(UPLOAD_ROOT, file.stored_path);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'File not on disk' });

  res.download(absPath, file.original_name);
});

// ── GET /admin/api/submissions/:id/download (zip all files) ───
router.get('/api/submissions/:id/download', requireAdmin, (req, res) => {
  const sub = getSubmission.get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found' });

  const files = getFiles.all(sub.id);
  if (files.length === 0) return res.status(404).json({ error: 'No files in this submission' });

  res.json({
    message: 'Individual file download — use the file download endpoint for each file.',
    files: files.map(f => ({
      id: f.id,
      name: f.original_name,
      url: `/admin/api/files/${f.id}/download`
    }))
  });
});

// ── POST /admin/api/invites ───────────────────────────────────
router.post('/api/invites', requireAdmin, (req, res) => {
  const inviteCode = String(req.body.invite_code || '').trim();
  const label = req.body.label ? String(req.body.label).trim() : null;
  const group = req.body.default_group_code ? String(req.body.default_group_code).trim().toUpperCase() : null;
  const route = parseOptInt(req.body.default_route);
  const slot  = parseOptInt(req.body.default_timeslot);
  const maxUses = Math.max(1, parseInt(req.body.max_uses, 10) || 1);
  const expiresAt = req.body.expires_at ? String(req.body.expires_at).trim() : null;

  if (!inviteCode || inviteCode.length < 8) {
    return res.status(400).json({ error: 'Invite code must be at least 8 characters.' });
  }

  if (group && !['A', 'B', 'C'].includes(group)) {
    return res.status(400).json({ error: 'default_group_code must be A, B, or C.' });
  }

  if (route !== null && ![1, 2, 3].includes(route)) {
    return res.status(400).json({ error: 'default_route must be 1, 2, or 3.' });
  }

  if (slot !== null && ![1, 2, 3, 4, 5].includes(slot)) {
    return res.status(400).json({ error: 'default_timeslot must be 1-5.' });
  }

  try {
    createInvite.run(
      hashInviteCode(inviteCode),
      label,
      group,
      route,
      slot,
      maxUses,
      expiresAt,
      req.session.adminId
    );
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Invite code already exists.' });
    }
    throw err;
  }

  res.status(201).json({ ok: true });
});

// ── GET /admin/api/signup-requests ────────────────────────────
router.get('/api/signup-requests', requireAdmin, (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const offset = (page - 1) * limit;

  const filters = {
    status: req.query.status || null,
    participant: req.query.participant ? `%${req.query.participant}%` : null
  };

  const { rows, total } = querySignupRequests(filters, limit, offset);

  res.json({
    requests: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

// ── GET /admin/api/signup-requests/:id ────────────────────────
router.get('/api/signup-requests/:id', requireAdmin, (req, res) => {
  const row = getSignupRequest.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Signup request not found' });
  res.json({ request: row });
});

// ── PATCH /admin/api/signup-requests/:id ──────────────────────
router.patch('/api/signup-requests/:id', requireAdmin, (req, res) => {
  const action = String(req.body.action || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Action must be approve or reject.' });
  }

  const signup = getSignupRequest.get(req.params.id);
  if (!signup) {
    return res.status(404).json({ error: 'Signup request not found' });
  }

  if (signup.status !== 'pending') {
    return res.status(409).json({ error: 'Signup request is not pending.' });
  }

  if (action === 'reject') {
    const reason = req.body.rejection_reason ? String(req.body.rejection_reason).trim() : null;
    markSignupRejected.run(req.session.adminId, reason, signup.id);
    return res.json({ ok: true, status: 'rejected' });
  }

  const group = (req.body.group_code ? String(req.body.group_code).trim().toUpperCase() : null)
             || signup.requested_group_code
             || signup.default_group_code;

  const route = parseOptInt(req.body.route)
             || signup.requested_route
             || signup.default_route;

  const slot  = parseOptInt(req.body.timeslot)
             || signup.requested_timeslot
             || signup.default_timeslot;

  if (!group || !['A', 'B', 'C'].includes(group)) {
    return res.status(400).json({ error: 'Approval requires a valid group_code (A/B/C).' });
  }

  if (!route || ![1, 2, 3].includes(route)) {
    return res.status(400).json({ error: 'Approval requires a valid route (1-3).' });
  }

  if (!slot || ![1, 2, 3, 4, 5].includes(slot)) {
    return res.status(400).json({ error: 'Approval requires a valid timeslot (1-5).' });
  }

  if (participantByCode.get(signup.participant_code)) {
    return res.status(409).json({ error: 'Participant ID already exists.' });
  }

  try {
    db.exec('BEGIN');

    const result = insertParticipant.run(
      signup.participant_code,
      signup.name,
      group,
      route,
      slot
    );

    insertParticipantCredential.run(result.lastInsertRowid, signup.password_hash);
    markSignupApproved.run(req.session.adminId, signup.id);
    incrementInviteUsage.run(signup.invite_id);

    const updated = getSignupRequest.get(signup.id);
    if (updated && updated.used_count >= updated.max_uses) {
      setInviteActiveState.run(0, signup.invite_id);
    }

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }

  res.json({ ok: true, status: 'approved' });
});

// ── GET /admin/api/me ─────────────────────────────────────────
router.get('/api/me', requireAdmin, (req, res) => {
  res.json({ username: req.session.username });
});

module.exports = router;
