/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — HOLIDAY ICS FIX PATCH  v2.2
 * =====================================================================
 *
 * Changes vs v2.1
 * ---------------
 *  • DEAD_FRAGMENT updated to cover BOTH dead Humaans URL shapes:
 *      - app.humaans.io/api/public-holidays/ical/  (old)
 *      - app.humaans.io/calendar-feeds/            (new — also CORS-blocked)
 *    All three proxy attempts (direct, corsproxy.io, allorigins) for both
 *    URLs were returning 403/408. The patch now intercepts both silently.
 *
 *  • Leave feed (calLeaveEvents) also blocked — after loadIcsData the
 *    patch no longer waits for a leave result before dismissing the banner.
 *
 *  • localStorage cleanup covers both URL shapes.
 *
 *  • getBookingDates / clusterDates crash fix (inline patch):
 *    Some Sheets rows return a bookedOn value that produces an invalid
 *    Date object — likely a blank cell or a non-ISO string from the
 *    Apps Script response. The crash manifests as:
 *      RangeError: Invalid time value at Date.toISOString
 *      at clusterDates / getBookingDates / renderCalendar
 *    This patch wraps window.getBookingDates with an isValid guard so
 *    a bad bookedOn row is skipped instead of throwing.
 * =====================================================================
 */
(function () {
  'use strict';

  // Both Humaans URL shapes are dead / CORS-blocked
  var DEAD_FRAGMENTS = [
    'app.humaans.io/api/public-holidays/ical/',
    'app.humaans.io/calendar-feeds/',
  ];

  function _isDead(url) {
    if (typeof url !== 'string') return false;
    return DEAD_FRAGMENTS.some(function (f) { return url.includes(f); });
  }

  // Synchronously wipe dead URLs from localStorage
  (function () {
    try {
      ['calHolidayIcs', 'calLeaveIcs'].forEach(function (key) {
        var val = localStorage.getItem(key) || '';
        if (_isDead(val)) {
          localStorage.removeItem(key);
          _log('Removed dead Humaans URL from localStorage (' + key + ').');
        }
      });
    } catch (e) {}
  }());

  var _attempts = 0;
  function bootstrap() {
    _attempts++;
    var ready = typeof window.fetchIcs       === 'function'
             && typeof window.loadIcsData    === 'function'
             && typeof window.renderCalendar === 'function';
    if (!ready && _attempts < 80) { setTimeout(bootstrap, 150); return; }
    patch_fetchIcs();
    patch_loadIcsData();
    patch_getBookingDates();
    patch_calSettings();
    inject_retryFix();
    _log('Loaded after ' + _attempts + ' attempt(s).');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // ── 1. Intercept fetchIcs — return empty string for any dead URL ──
  function patch_fetchIcs() {
    var _orig = window.fetchIcs;
    window.fetchIcs = async function (url) {
      if (_isDead(url)) {
        _log('Blocked dead Humaans URL — no network request made: ' + url);
        return '';
      }
      return _orig.apply(this, arguments);
    };
  }

  // ── 2. After loadIcsData, backfill holidays from bankHolidayMap ───
  function patch_loadIcsData() {
    var _orig = window.loadIcsData;
    window.loadIcsData = async function () {
      await _orig.apply(this, arguments);
      if (window.calIcsEvents && window.calIcsEvents.length > 0) {
        _log('Holiday ICS feed returned data — no backfill needed.');
        _dismissFeedBanner();
        return;
      }
      _backfill();
    };
  }

  // ── _backfill: read bankHolidayMap (no extra network request) ─────
  //
  // bankHolidayMap: { 'YYYY-MM-DD': 'Holiday Name' }
  // Date construction uses multi-argument form to avoid BST/UTC shifts.
  function _backfill(attempt) {
    attempt = attempt || 0;
    var map  = window.bankHolidayMap;
    var keys = map ? Object.keys(map) : [];

    if (!keys.length) {
      if (attempt < 20) {
        _log('bankHolidayMap not ready — retrying in 500 ms (attempt ' + (attempt + 1) + ').');
        setTimeout(function () { _backfill(attempt + 1); }, 500);
      } else {
        _log('bankHolidayMap still empty after retries — giving up.');
      }
      return;
    }

    window.calIcsEvents = keys.map(function (dateStr) {
      var parts = dateStr.split('-');
      var y = parseInt(parts[0], 10);
      var m = parseInt(parts[1], 10) - 1; // 0-based month
      var d = parseInt(parts[2], 10);
      var start = new Date(y, m, d);      // local midnight, BST-safe
      var end   = new Date(y, m, d + 1);  // next local midnight (exclusive)
      return { summary: map[dateStr], start: start, end: end, type: 'holiday' };
    });

    _log('Synthesised ' + window.calIcsEvents.length
      + ' bank holidays from bankHolidayMap (no extra network request).');

    _updateStatusBar();
    _dismissFeedBanner();
    if (typeof window.renderCalendar === 'function') window.renderCalendar();
  }

  // ── 3. Guard getBookingDates against invalid Date objects ─────────
  //
  // Some Sheets rows have a bookedOn value that new Date() can't parse
  // (blank cell, non-ISO string, etc.) — this produces an Invalid Date
  // object whose .toISOString() throws "RangeError: Invalid time value",
  // crashing clusterDates → renderCalendar / renderTrainerWorkload.
  //
  // The patch wraps window.getBookingDates: if bookedOn is invalid, the
  // row is treated as having no dates (returns []) rather than throwing.
  function patch_getBookingDates() {
    if (typeof window.getBookingDates !== 'function') {
      _log('getBookingDates not found — skipping guard patch (will retry on next bootstrap).');
      return;
    }
    var _orig = window.getBookingDates;
    window.getBookingDates = function (r) {
      // Guard: if bookedOn is set but invalid, bail early
      if (r && r.bookedOn) {
        var t = r.bookedOn instanceof Date ? r.bookedOn.getTime() : NaN;
        if (isNaN(t)) {
          _log('Skipping row with invalid bookedOn: ' + JSON.stringify(r.bookedOn));
          return [];
        }
      }
      return _orig.apply(this, arguments);
    };
  }

  // ── 4. Update Cal Settings modal ─────────────────────────────────
  function patch_calSettings() {
    var _origOpen = window.openCalSettings;
    if (typeof _origOpen !== 'function') return;
    window.openCalSettings = function () {
      _origOpen.apply(this, arguments);
      ['calHolidayIcsInput', 'calLeaveIcsInput'].forEach(function (id) {
        var input = document.getElementById(id);
        if (!input) return;
        if (_isDead(input.value)) input.value = '';
      });
      var input = document.getElementById('calHolidayIcsInput');
      if (input) {
        var hint = input.nextElementSibling;
        if (hint && hint.classList.contains('form-hint')) {
          hint.innerHTML =
            'Leave blank — public holidays load automatically from GOV.UK '
            + '(England &amp; Wales). Only fill in if you have a working ICS URL.';
        }
      }
    };
  }

  // ── 5. Fix retry button unhandled-promise warnings ────────────────
  function inject_retryFix() {
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1 || node.id !== 'ux-feed-banner') return;
          var btns = node.querySelectorAll('button');
          btns.forEach(function (btn) {
            if (btn.textContent.includes('Retry')) {
              btn.onclick = function () {
                window.loadIcsData().catch(function (e) {
                  _log('Retry error: ' + (e && e.message));
                });
              };
            }
          });
        });
      });
    });
    obs.observe(document.body, { childList: true });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function _updateStatusBar() {
    var bar = document.getElementById('icsStatusBar');
    if (!bar) return;
    var n    = window.calIcsEvents ? window.calIcsEvents.length : 0;
    var pill = '<span class="ics-status"><span class="ics-dot ok"></span>'
             + n + ' holidays (GOV.UK)</span>';
    var sep  = '<span style="color:var(--text--dark--20);margin:0 4px;">|</span>';
    if (bar.innerHTML.includes('Holiday feed error') || bar.innerHTML.includes('holidays loaded')) {
      bar.innerHTML = bar.innerHTML.replace(
        /<span class="ics-status">[^<]*(?:Holiday feed error|holidays loaded)[^<]*<\/span>/, pill
      );
    } else {
      bar.innerHTML = pill + (bar.innerHTML.trim() ? sep + bar.innerHTML : '');
    }
  }

  function _dismissFeedBanner() {
    // Don't block banner dismissal waiting for the leave feed — it's also dead
    var banner = document.getElementById('ux-feed-banner');
    if (!banner) return;
    banner.style.transition = 'opacity 0.4s';
    banner.style.opacity    = '0';
    setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 420);
  }

  function _log(msg) { console.log('[HolidayFix] ' + msg); }

}());
