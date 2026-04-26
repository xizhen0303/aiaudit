/**
 * server/middleware/security.js
 * Assembles and exports all security-related middleware in one place.
 * Import once in server/index.js: app.use(require('./middleware/security'));
 */

'use strict';

const rateLimit = require('express-rate-limit');
const helmet    = require('helmet');

// ── Helmet (HTTP security headers) ───────────────────────────
// Configured to allow inline scripts used by the static frontend pages.
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'", "'unsafe-hashes'", 'fonts.googleapis.com'],
      scriptSrcAttr:  ["'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc:        ["'self'", 'fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:', 'blob:'],
      connectSrc:     ["'self'"],
      mediaSrc:       ["'self'", 'blob:'],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  strictTransportSecurity: false
});

const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — please slow down.' }
});

const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts — please try again later.' }
});

const participantLoginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many participant login attempts — please try again later.' }
});

const emailRegisterLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many registration attempts — please try again later.' }
});

const emailVerifyLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many verification attempts — please try again later.' }
});

const signupLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many signup attempts — please try again later.' }
});

const uploadLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Upload limit reached — please try again in an hour.' }
});

module.exports = {
  helmetMiddleware,
  globalLimiter,
  loginLimiter,
  participantLoginLimiter,
  emailRegisterLimiter,
  emailVerifyLimiter,
  signupLimiter,
  uploadLimiter
};
