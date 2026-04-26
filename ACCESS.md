# RCT Research Platform — Access Instructions

## Prerequisites

- Node.js 22.5 or later installed
- Terminal / Command Prompt open

---

## Step 1 — Start the Server

Open a terminal, navigate to the project folder, and run:

```bash
cd C:\Users\25019142r\experiment-website
npm start
```

You should see:

```
  RCT Research Platform
  ─────────────────────────────────────────
  Local:   http://localhost:3000
  Health:  http://localhost:3000/health
  Admin:   http://localhost:3000/admin/login.html
  DB:      server/data/research.db
  Uploads: uploads/
```

**Keep this terminal window open.** The server must be running to use the platform.

---

## Step 2 — Open the Platform in Your Browser

### Landing + Public Page

| Page | URL |
|------|-----|
| Login (default) | http://localhost:3000 |
| Participant Login | http://localhost:3000/login.html |
| Email Signup | http://localhost:3000/signup.html |
| Public Home | http://localhost:3000/home.html |
| Help | http://localhost:3000/help.html |

---

### Participant Login (session-based)

Participants sign in with:

- **Email or Participant ID**
- **Password** (new verified accounts) **or** **Access Code** (legacy compatibility)

Seeded test credentials (legacy access code mode):

| Participant | Participant ID | Access Code |
|-------------|----------------|-------------|
| **BarryXI** | P-2024-042 | b70e90f7-46e9-4ace-8456-ff4ee8d0189c |
| Test Participant 001 | P-2024-001 | e8110052-cb4d-4c41-aed9-ac10f446da15 |
| Test Participant 099 | P-2024-099 | 3aa414e4-2920-4d03-b798-644bd6fc2080 |

After login, participants can access these pages with clean URLs:

| Page | URL |
|------|-----|
| Dashboard | http://localhost:3000/dashboard.html |
| Training | http://localhost:3000/training.html |
| Upload | http://localhost:3000/upload.html |
| Schedule | http://localhost:3000/schedule.html |
| Resources | http://localhost:3000/resources.html |
| Community | http://localhost:3000/community.html |

If a participant is not logged in and opens a protected page directly, they are redirected to:

`/login.html?next=<requested-page>`

---

### Email Signup + Verification

1. Open `http://localhost:3000/signup.html`
2. Enter email, participant ID, and password
3. Submit to request a verification code
4. In local development, the server terminal prints the verification code and the page also displays it
5. Enter the 6-digit code
6. If correct, the account is activated automatically and the participant is logged in immediately

---

### Admin Panel

| Step | Detail |
|------|--------|
| URL | http://localhost:3000/admin/login.html |
| Username | `admin` |
| Password | `admin123` |

**Admin capabilities:**
- View all submissions
- Filter by participant, group, route, status, date
- View submission detail and metadata
- Download individual uploaded files
- Update submission status: `pending` → `reviewed` → `flagged`
- Legacy invite / signup-request management remains available if needed

---

## Step 3 — Upload a Test Submission

1. Go to `http://localhost:3000/login.html`
2. Sign in with BarryXI credentials above
3. Navigate to **Upload** from the navbar
4. Drag and drop any `.png`, `.jpg`, or `.mp4` file
5. Fill in: Trip End Time, Starting Point, Destination, Device
6. Click **Submit Evidence Package**
7. Note the reference number
8. Go to the Admin panel to see the submission appear

---

## Refresh Seed Data

```bash
node server/seed.js
```

This is safe to re-run — it skips existing participant records and prints seeded participant IDs and access codes.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Redirected to login from a protected page | You are not signed in. Log in at `/login.html` |
| Login fails with invalid credentials | Check email/participant ID + password/access code |
| Verification code fails | Ensure the code is current and has not expired; in local dev, read the newest code from the server terminal |
| Too many verification attempts | Wait for the rate limit or request a new code |
| Files not uploading | Check the terminal for error messages. Ensure file is `.png`, `.jpg`, or `.mp4` |
| Admin login fails | Credentials are `admin` / `admin123` |
