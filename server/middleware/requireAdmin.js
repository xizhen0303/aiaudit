/**
 * server/middleware/requireAdmin.js
 * Guards admin routes — checks req.session.adminId.
 * Responds with 401 JSON for API routes, redirects HTML routes to /admin/login.html.
 */

'use strict';

module.exports = function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();

  const isApi = req.path.startsWith('/api') || req.headers.accept === 'application/json';
  if (isApi) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  res.redirect('/admin/login.html');
};
