/**
 * server/middleware/requireToken.js
 * Validates a participant access token from ?token= or X-Participant-Token header.
 * Attaches req.participant on success; returns 401/403 JSON on failure.
 */

'use strict';

const db = require('../db');

const QUERY = db.prepare(`
  SELECT
    p.id,
    p.participant_code,
    p.name,
    p.group_code,
    p.route,
    p.timeslot,
    p.status,
    t.is_active,
    t.expires_at
  FROM upload_tokens t
  JOIN participants p ON p.id = t.participant_id
  WHERE t.token = ?
`);

module.exports = function requireToken(req, res, next) {
  const token = req.query.token
             || req.headers['x-participant-token']
             || (req.body && req.body.token);

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  const row = QUERY.get(token);

  if (!row) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (!row.is_active) {
    return res.status(403).json({ error: 'Token has been revoked' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Token has expired' });
  }

  // Attach a clean participant object — never expose raw DB row to handlers
  req.participant = {
    id:              row.id,
    participantCode: row.participant_code,
    name:            row.name   || row.participant_code,
    group:           row.group_code,
    route:           row.route,
    timeslot:        row.timeslot,
    status:          row.status
  };

  next();
};
