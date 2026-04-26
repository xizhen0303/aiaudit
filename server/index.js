/**
 * server/index.js
 * Express application entry point — production-ready configuration.
 */

'use strict';

const path = require('path');

// Load .env from project root before anything else
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs      = require('fs');
const express = require('express');
const morgan  = require('morgan');
const session = require('express-session');

const { helmetMiddleware, globalLimiter, loginLimiter, participantLoginLimiter, emailRegisterLimiter, emailVerifyLimiter, signupLimiter, uploadLimiter } =
  require('./middleware/security');

// ── Bootstrap DB (runs schema + creates file if missing) ─────
require('./db');

const app        = express();
const PORT       = parseInt(process.env.PORT, 10) || 3000;
const STATIC_DIR = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(STATIC_DIR, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Security headers (helmet) ─────────────────────────────────
app.use(helmetMiddleware);

// ── Request logging ───────────────────────────────────────────
// 'dev' in development; switch to 'combined' when behind a reverse proxy
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Body parsers ──────────────────────────────────────────────
// Limit JSON body size to prevent large payload DoS
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ── Sessions ──────────────────────────────────────────────────
const usingDevSecret = !process.env.SESSION_SECRET ||
                        process.env.SESSION_SECRET === 'dev-secret-change-in-production';
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  name:              'rct.sid',          // don't expose default 'connect.sid'
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',  // HTTPS-only in prod
    maxAge:   8 * 60 * 60 * 1000
  }
}));

// ── Static files (entire frontend — unchanged) ────────────────
app.use(express.static(STATIC_DIR, {
  dotfiles: 'deny',
  index:    'index.html'
}));

// ── Global rate limit (API/admin endpoints only) ──────────────
app.use('/api', globalLimiter);
app.use('/admin', globalLimiter);

// ── Health check (no auth, no rate-limit applied twice) ───────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── API routes ────────────────────────────────────────────────
app.use('/api/participant/login', participantLoginLimiter);
app.use('/api/participant/register-email', emailRegisterLimiter);
app.use('/api/participant/verify-email-code', emailVerifyLimiter);
app.use('/api/participant/signup-request', signupLimiter);
app.use('/api', require('./routes/participant'));

app.use('/api/upload', uploadLimiter);
app.use('/api', require('./routes/upload'));

app.use('/admin/login', loginLimiter);                         // Phase 5 — brute-force guard
app.use('/admin', require('./routes/admin'));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, _next) => {   // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  // Never leak stack traces to clients
  console.error(`[ERROR] ${req.method} ${req.path} ${status}:`, err.message);
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
  res.status(status).send('Server error');
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  RCT Research Platform`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`  Admin:   http://localhost:${PORT}/admin/login.html`);
  console.log(`  DB:      server/data/research.db`);
  console.log(`  Uploads: uploads/`);
  if (usingDevSecret) {
    console.log(`  ⚠  SESSION_SECRET not set — using insecure default`);
    console.log(`     Set SESSION_SECRET in .env before deploying!`);
  } else {
    console.log(`  ✓  SESSION_SECRET configured`);
  }
  console.log();
});
