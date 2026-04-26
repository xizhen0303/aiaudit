/**
 * server/routes/upload.js
 * POST /api/upload
 *
 * Accepts multipart/form-data (participant session required).
 * Validates file types + sizes, stores files under uploads/, writes
 * submission + submission_files rows to SQLite, returns reference number.
 */

'use strict';

const express      = require('express');
const router       = express.Router();
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const multer       = require('multer');
const db           = require('../db');
const requireParticipant = require('../middleware/requireParticipant');

// ── Config ────────────────────────────────────────────────────
const MAX_BYTES   = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 500) * 1024 * 1024;
const MAX_FILES   = 20;
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_EXT  = new Set(['.png', '.jpg', '.jpeg', '.mp4']);
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'video/mp4']);

// ── Multer storage — structured directories ───────────────────
// Layout: uploads/{GROUP}/{PARTICIPANT_CODE}/{YYYYMMDD}/{uuid}.{ext}
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const p    = req.participant;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const dir  = path.join(UPLOAD_ROOT, p.group, p.participantCode, date);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    // uuid-based name prevents path traversal and collisions
    cb(null, crypto.randomUUID() + ext);
  }
});

function fileFilter(_req, file, cb) {
  const ext  = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;
  if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(mime)) {
    return cb(Object.assign(new Error(`File type not permitted: ${mime}`), { status: 415 }));
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_BYTES, files: MAX_FILES } });

// ── Prepared statements ───────────────────────────────────────
const insertSubmission = db.prepare(`
  INSERT INTO submissions
    (reference_number, participant_id, trip_date, trip_end_time,
     start_point, destination, timeslot, route, device, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFile = db.prepare(`
  INSERT INTO submission_files
    (submission_id, original_name, stored_name, mime_type, size_bytes, stored_path)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// ── POST /api/upload ──────────────────────────────────────────
router.post('/upload', requireParticipant, (req, res, next) => {
  // Wrap multer so its errors reach Express's error handler
  upload.array('files')(req, res, (err) => {
    if (err) return next(err);

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files received' });
    }

    const { trip_date, trip_end_time, start_point, destination, device, notes, step_number } = req.body;

    // Validate required metadata
    const missing = [];
    if (!trip_date)     missing.push('trip_date');
    if (!trip_end_time) missing.push('trip_end_time');
    if (!start_point)   missing.push('start_point');
    if (!destination)   missing.push('destination');
    if (!device)        missing.push('device');

    if (missing.length) {
      // Clean up — files were already written; remove them
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const p         = req.participant;
    const reference = 'SUB-' + Date.now();

    // Write submission + files atomically
    let submissionId, fileRecords;
    try {
      db.exec('BEGIN');

      const result = insertSubmission.run(
        reference, p.id,
        trip_date, trip_end_time, start_point, destination,
        p.timeslot, p.route, device, notes || null
      );
      submissionId = result.lastInsertRowid;

      fileRecords = files.map(f => {
        const relPath = path.relative(UPLOAD_ROOT, f.path).replace(/\\/g, '/');
        insertFile.run(submissionId, f.originalname, f.filename, f.mimetype, f.size, relPath);
        return { name: f.originalname, size: f.size, type: f.mimetype, storedAs: f.filename };
      });

      db.exec('COMMIT');
    } catch (dbErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      // Remove files that were already written
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
      return next(dbErr);
    }

    console.log(`[UPLOAD] ${reference} | ${p.participantCode} | ${files.length} file(s) | ${step_number || '—'}`);

    res.status(201).json({
      referenceNumber: reference,
      submissionId,
      participant:     p.participantCode,
      group:           p.group,
      route:           p.route,
      timeslot:        p.timeslot,
      fileCount:       files.length,
      files:           fileRecords
    });
  });
});

// ── Multer / validation error handler ────────────────────────
// Must be defined in this router (not just app-level) to catch multer errors.
router.use((err, _req, res, next) => {
  if (!err) return next();

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `File too large. Maximum allowed is ${process.env.MAX_FILE_SIZE_MB || 500} MB per file.`
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: `Too many files. Maximum is ${MAX_FILES} per submission.` });
  }
  if (err.status === 415 || err.message.startsWith('File type not permitted')) {
    return res.status(415).json({ error: err.message });
  }

  next(err);
});

module.exports = router;
