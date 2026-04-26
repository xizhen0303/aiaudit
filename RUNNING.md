# RCT Research Platform — Run Instructions

## Requirements

- Node.js 22.5 or later (tested on Node 24)
- npm 8+

## First-time setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and configure
cp .env.example .env
# Open .env and set SESSION_SECRET to a strong random string:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Seed the database (creates admin + 3 test participants + starter invite)
npm run seed
```

The seed script prints participant IDs with their access codes, a starter legacy signup invite code, and the admin URL.

## Running the server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

Server starts at **http://localhost:3000** (or the PORT in your .env).

## URLs

| URL | Purpose |
|-----|---------|
| `http://localhost:3000` | Redirects to participant login |
| `http://localhost:3000/login.html` | Participant login page |
| `http://localhost:3000/signup.html` | Email registration + verification page |
| `http://localhost:3000/home.html` | Public landing page |
| `http://localhost:3000/dashboard.html` | Participant portal (requires login) |
| `http://localhost:3000/admin/login.html` | Admin panel |
| `http://localhost:3000/admin/signup-requests.html` | Legacy admin signup request review |
| `http://localhost:3000/health` | Health check |

## Participant access

### Existing participants (legacy compatibility)
1. Visit `http://localhost:3000/login.html`
2. Enter **Participant ID** + **Access Code**
3. Access dashboard/training/upload/schedule/resources/community normally.

### New participants (email verification)
1. Visit `http://localhost:3000/signup.html`
2. Enter **Email**, **Participant ID**, and **Password**
3. Submit the form to receive a verification code
4. In development, the server prints the code in the terminal and also returns it to the page
5. Enter the code to verify your email
6. The account is activated automatically and you are logged in immediately
7. Future logins use **Email or Participant ID + Password**

## Admin access

1. Visit `http://localhost:3000/admin/login.html`
2. Use admin credentials.
3. Admin approvals are now legacy/optional; new email signups auto-approve after correct verification.

## Default credentials

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |

**Change the admin password before deploying.**

## Directory layout

```
experiment-website/
├── server/              Backend (Express + node:sqlite)
│   ├── data/            SQLite database file (auto-created)
│   ├── middleware/      requireToken, requireParticipant, requireAdmin, security
│   └── routes/          participant, upload, admin
├── uploads/             Uploaded files — {group}/{pid}/{date}/{uuid}.ext
├── admin/               Admin HTML pages
├── components/          Shared JS (navbar.js, auth.js)
├── *.html               Participant-facing pages
└── style.css            Shared stylesheet
```

## Adding a participant manually

```bash
node -e "
const db = require('./server/db');
const bcrypt = require('bcryptjs');

const result = db.prepare('INSERT INTO participants (participant_code, name, email, group_code, route, timeslot) VALUES (?,?,?,?,?,?)')
  .run('P-2024-100', 'New Participant', 'new@example.com', 'B', 2, 3);

db.prepare('INSERT INTO participant_credentials (participant_id, password_hash) VALUES (?,?)')
  .run(result.lastInsertRowid, bcrypt.hashSync('ChangeMe123!', 10));

console.log('Participant created: P-2024-100 / new@example.com');
"
```

## Revoking an access code

```bash
node -e "
const db = require('./server/db');
db.prepare('UPDATE upload_tokens SET is_active=0 WHERE token=?').run('TOKEN_HERE');
console.log('Access code revoked');
"
```

## Production checklist

- [ ] Set a strong `SESSION_SECRET` in `.env`
- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Change the default admin password
- [ ] Replace dev verification-code fallback with real email delivery
- [ ] Put the server behind a reverse proxy (nginx/caddy) with HTTPS
- [ ] Set `secure: true` on cookies (happens automatically when `NODE_ENV=production`)
- [ ] Configure regular database backups (`server/data/research.db`)
- [ ] Configure regular uploads backup (`uploads/`)
