/**
 * components/auth.js
 * Client-side participant authentication helper (session-based).
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Every protected page calls RCT.init(callback) which fetches
 *    /api/participant/me with credentials included.
 * 2. On 401 the user is redirected to /login.html?next=current-path.
 * 3. On success the participant object is passed to the callback.
 *
 * USAGE (on every protected page, before page scripts)
 * ─────────────────────────────────────────────────────
 *   <script src="components/auth.js"></script>
 *   <script>
 *     RCT.init(function(p) {
 *       document.getElementById('p-name').textContent = p.name;
 *       // …
 *     });
 *   </script>
 *
 * PUBLIC API
 * ───────────
 *   window.RCT.participant  — populated after init() resolves
 *   window.RCT.SLOT_TIMES   — { 1: '08:00 – 10:00 AM', … }
 *   window.RCT.ROUTES       — { 1: { name, path, km, time }, … }
 *   window.RCT.init(cb)     — fetch participant, call cb(participant)
 *   window.RCT.logout()     — POST to /api/participant/logout and reload
 */

(function () {
  'use strict';

  // ── Shared lookup tables (used by dashboard, schedule, upload) ─
  var SLOT_TIMES = {
    1: '08:00 – 10:00 AM',
    2: '10:00 AM – 12:00 PM',
    3: '12:00 – 02:00 PM',
    4: '02:00 – 04:00 PM',
    5: '04:00 – 06:00 PM'
  };

  var ROUTES = {
    1: { name: 'Northern District', path: 'University → Central Station', km: '~12 km', time: '~25 min' },
    2: { name: 'Eastern Corridor',  path: 'Tech Park → Waterfront',        km: '~9 km',  time: '~20 min' },
    3: { name: 'City Centre Loop',  path: 'Market Square → Old Town',      km: '~7 km',  time: '~18 min' }
  };

  // ── Error renderer (for server errors only) ──────────────────
  function showError(title, body) {
    var html =
      '<div class="bg-scene" aria-hidden="true">' +
        '<div class="bg-orb bg-orb-1"></div>' +
        '<div class="bg-orb bg-orb-2"></div>' +
        '<div class="bg-grid"></div>' +
      '</div>' +
      '<div style="display:grid;place-items:center;min-height:100vh;' +
           'position:relative;z-index:1;' +
           'font-family:Inter,system-ui,sans-serif;color:#e2e8f0;padding:24px;">' +
        '<div style="text-align:center;max-width:480px;">' +
          '<div style="font-size:52px;margin-bottom:20px;">🔒</div>' +
          '<h2 style="font-size:1.5rem;font-weight:700;margin-bottom:12px;' +
               'letter-spacing:-.01em;">' + title + '</h2>' +
          '<p style="color:#94a3b8;line-height:1.75;margin-bottom:28px;">' + body + '</p>' +
          '<a href="login.html" ' +
             'style="display:inline-flex;align-items:center;gap:8px;' +
                    'padding:11px 22px;border-radius:10px;' +
                    'background:linear-gradient(135deg,#6366f1,#06b6d4);' +
                    'color:#fff;font-weight:600;font-size:14px;text-decoration:none;">' +
            '← Back to Login' +
          '</a>' +
        '</div>' +
      '</div>';

    function render() { document.body.innerHTML = html; }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', render);
    } else {
      render();
    }
  }

  // ── Update navbar with participant info ─────────────────────
  function updateNavbar(p) {
    var userEl = document.getElementById('nav-user');
    if (!userEl || !p) return;

    var initials = (p.name || p.participantCode)
      .split(/\s+/).map(function (w) { return w[0] || ''; })
      .join('').slice(0, 2).toUpperCase();

    userEl.textContent = '';

    var avatar = document.createElement('div');
    avatar.className = 'nav-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials;

    var username = document.createElement('span');
    username.className = 'nav-username';
    username.textContent = p.name || p.participantCode;

    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-danger btn-xs';
    logoutBtn.style.marginLeft = '10px';
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', function () { window.RCT.logout(); });

    userEl.appendChild(avatar);
    userEl.appendChild(username);
    userEl.appendChild(logoutBtn);
  }

  // ── Public API ────────────────────────────────────────────────
  window.RCT = {
    participant: null,
    SLOT_TIMES:  SLOT_TIMES,
    ROUTES:      ROUTES,

    /**
     * Fetches /api/participant/me with credentials included.
     * Calls cb(participant) on success.
     * Redirects to /login.html on 401.
     * Replaces the page with an error screen on server errors.
     */
    init: function (cb) {
      fetch('/api/participant/me', { credentials: 'include' })
        .then(function (r) {
          if (r.status === 401) {
            var next = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.replace('/login.html?next=' + next);
            return null;
          }
          if (!r.ok) throw { code: 'server' };
          return r.json();
        })
        .then(function (data) {
          if (!data) return; // redirect in progress
          var p = data.participant;
          window.RCT.participant = p;
          updateNavbar(p);
          if (typeof cb === 'function') cb(p);
        })
        .catch(function () {
          showError(
            'Server Error',
            'Unable to load your session. Please try again later.'
          );
        });
    },

    /**
     * Sends a logout request and reloads the page.
     */
    logout: function () {
      fetch('/api/participant/logout', {
        method: 'POST',
        credentials: 'include'
      }).then(function () {
        window.location.href = '/login.html';
      }).catch(function () {
        window.location.href = '/login.html';
      });
    }
  };
})();
