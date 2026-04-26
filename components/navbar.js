/* components/navbar.js
   Self-injecting shared navbar — works with file:// and http://
   User: BarryXI (BX) · Nav: Home Training Resources Community Help | RCT Only ▼
*/
(function () {
  'use strict';

  var NAV_HTML = [
    '<nav class="navbar" id="main-navbar" role="navigation" aria-label="Main navigation">',
    '  <a href="home.html" class="nav-logo" aria-label="BarryXI Research Home">',
    '    <div class="nav-logo-icon" aria-hidden="true">BX</div>',
    '    <span>AI Algorithm Auditing Research</span>',
    '  </a>',
    '  <div class="nav-links" role="menubar">',
    '    <a href="home.html"     class="nav-link" data-page="home.html"     role="menuitem">Home</a>',
    '    <a href="training.html"  class="nav-link" data-page="training.html"  role="menuitem">Training</a>',
    '    <a href="resources.html" class="nav-link" data-page="resources.html" role="menuitem">Resources</a>',
    '    <a href="community.html" class="nav-link" data-page="community.html" role="menuitem">Community</a>',
    '    <a href="help.html"      class="nav-link" data-page="help.html"      role="menuitem">Help</a>',
    '    <div class="nav-dropdown" id="rct-dropdown" role="none">',
    '      <button class="nav-dropdown-btn" aria-haspopup="true" aria-expanded="false"',
    '              aria-controls="rct-menu" id="rct-btn">',
    '        RCT Only',
    '        <svg class="nav-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none"',
    '             stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"',
    '             aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
    '      </button>',
    '      <div class="nav-dropdown-menu" id="rct-menu" role="menu" aria-labelledby="rct-btn">',
    '        <a href="dashboard.html" class="nav-dropdown-item" data-page="dashboard.html" role="menuitem">',
    '          <span style="margin-right:8px">📊</span>Dashboard',
    '        </a>',
    '        <a href="schedule.html"  class="nav-dropdown-item" data-page="schedule.html"  role="menuitem">',
    '          <span style="margin-right:8px">🗓️</span>Schedule',
    '        </a>',
    '        <a href="upload.html"    class="nav-dropdown-item" data-page="upload.html"    role="menuitem">',
    '          <span style="margin-right:8px">☁️</span>Upload',
    '        </a>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="nav-right">',
    '    <div class="nav-user" id="nav-user" title="BarryXI" aria-label="User: BarryXI">',
    '      <div class="nav-avatar" aria-hidden="true">BX</div>',
    '      <span class="nav-username">BarryXI</span>',
    '    </div>',
    '    <button class="nav-hamburger" id="nav-hamburger-btn" aria-label="Toggle navigation menu"',
    '            aria-expanded="false" aria-controls="nav-mobile-menu">',
    '      <span></span><span></span><span></span>',
    '    </button>',
    '  </div>',
    '</nav>',
    '<div class="nav-mobile-menu" id="nav-mobile-menu" role="navigation" aria-label="Mobile navigation">',
    '  <a href="home.html"     class="nav-mobile-link" data-page="home.html">Home</a>',
    '  <a href="training.html"  class="nav-mobile-link" data-page="training.html">Training</a>',
    '  <a href="resources.html" class="nav-mobile-link" data-page="resources.html">Resources</a>',
    '  <a href="community.html" class="nav-mobile-link" data-page="community.html">Community</a>',
    '  <a href="help.html"      class="nav-mobile-link" data-page="help.html">Help</a>',
    '  <div class="nav-mobile-divider"></div>',
    '  <div class="nav-mobile-section">RCT Only</div>',
    '  <a href="dashboard.html" class="nav-mobile-link" data-page="dashboard.html">📊 Dashboard</a>',
    '  <a href="schedule.html"  class="nav-mobile-link" data-page="schedule.html">🗓️ Schedule</a>',
    '  <a href="upload.html"    class="nav-mobile-link" data-page="upload.html">☁️ Upload</a>',
    '</div>'
  ].join('\n');

  function inject() {
    var ph = document.getElementById('navbar-placeholder');
    if (ph) {
      ph.outerHTML = NAV_HTML;
    } else {
      document.body.insertAdjacentHTML('afterbegin', NAV_HTML);
    }
    highlightActive();
    bindEvents();
  }

  function highlightActive() {
    var raw = window.location.pathname.split('/').pop();
    var page = raw || 'home.html';

    document.querySelectorAll('[data-page]').forEach(function (el) {
      if (el.dataset.page === page) {
        if (el.classList.contains('nav-link') || el.classList.contains('nav-mobile-link')) {
          el.classList.add('active');
        }
        if (el.classList.contains('nav-dropdown-item')) {
          var dropdown = el.closest('.nav-dropdown');
          if (dropdown) {
            var btn = dropdown.querySelector('.nav-dropdown-btn');
            if (btn) btn.classList.add('active');
          }
        }
      }
    });
  }

  function bindEvents() {
    // Dropdown toggle
    var rctBtn = document.getElementById('rct-btn');
    var rctDropdown = document.getElementById('rct-dropdown');
    if (rctBtn && rctDropdown) {
      rctBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = rctDropdown.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) {
          rctDropdown.classList.add('open');
          rctBtn.setAttribute('aria-expanded', 'true');
        }
      });
    }

    // Mobile hamburger
    var hamburger = document.getElementById('nav-hamburger-btn');
    var mobileMenu = document.getElementById('nav-mobile-menu');
    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', function () {
        var isOpen = mobileMenu.classList.contains('open');
        mobileMenu.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', String(!isOpen));
        var spans = hamburger.querySelectorAll('span');
        if (!isOpen) {
          spans[0].style.transform = 'translateY(7px) rotate(45deg)';
          spans[1].style.opacity = '0';
          spans[2].style.transform = 'translateY(-7px) rotate(-45deg)';
        } else {
          spans[0].style.transform = '';
          spans[1].style.opacity = '';
          spans[2].style.transform = '';
        }
      });
    }

    // Close dropdown on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-dropdown') && !e.target.closest('#nav-hamburger-btn')) {
        closeAllDropdowns();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllDropdowns();
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.nav-dropdown.open').forEach(function (d) {
      d.classList.remove('open');
      var btn = d.querySelector('.nav-dropdown-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
