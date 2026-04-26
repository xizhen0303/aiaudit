/**
 * server/middleware/requireParticipant.js
 * Guards participant routes — checks req.session.participantId.
 * Attaches req.participant on success.
 * Responds with 401 JSON for API routes, redirects HTML routes to /login.html.
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
    p.status
  FROM participants p
  WHERE p.id = ?
`);

module.exports = function requireParticipant(req, res, next) {
  var accept = req.headers.accept || '';
  var contentType = req.headers['content-type'] || '';
  var isApi = req.originalUrl.startsWith('/api/')
           || accept.includes('application/json')
           || contentType.includes('application/json')
           || req.xhr;

  if (!req.session || !req.session.participantId) {
    if (isApi) {
      return res.status(401).json({ error: 'Participant authentication required' });
    }
    return res.redirect('/login.html');
  }

  const row = QUERY.get(req.session.participantId);
  if (!row) {
    req.session.destroy(() => {});
    if (isApi) {
      return res.status(401).json({ error: 'Participant authentication required' });
    }
    return res.redirect('/login.html');
  }

  req.participant = {
    id:              row.id,
    participantCode: row.participant_code,
    name:            row.name || row.participant_code,
    group:           row.group_code,
    route:           row.route,
    timeslot:        row.timeslot,
    status:          row.status
  };

  next();
};
