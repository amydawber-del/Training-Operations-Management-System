/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — HOLIDAY ICS FIX PATCH  v2.1
 * =====================================================================
 * The Humaans public-holidays ICS URL returns 404.
 * This patch:
 *   1. Intercepts window.fetchIcs to silently block the dead URL
 *      (no network request, no 404, no console error).
 *   2. After loadIcsData runs with empty calIcsEvents, synthesises
 *      them directly from window.bankHolidayMap — the map already
 *      populated by the main dashboard's own loadBankHolidays() call
 *      (GOV.UK live data merged with the hardcoded fallback list).
 *      No second GOV.UK network request is needed.
 *   3. Clears the dead URL from localStorage on load.
 *   4. Fixes the retry button promise so it never throws unhandled
 *      rejections.
 *
 * v2.1 fixes vs v2.0
 * ------------------
 *  • _backfill() no longer re-fetches GOV.UK.
 *    The previous fetch was racing against proxy/CORS and returning an
 *    empty events array, logging "GOV.UK returned no events."
 *    bankHolidayMap is already populated — we just read it.
 *
 *  • Date objects are now built with new Date(y, m-1, d) instead of
 *    new Date(dateStr + 'T00:00:00').
 *    In BST (UTC+1) the old form parsed as local midnight, but
 *    end.setDate(end.getDate() + 1) then operated on the UTC internal
 *    value, advancing the end boundary by one extra day.  The ICS
 *    render loop (d < evEnd) therefore fired for Monday *and* Tuesday,
 *    placing Easter Monday on Tuesday.
 *    The multi-argument Date constructor always creates a pure local
 *    midnight and is immune to BST/UTC-offset shifts.
 * =====================================================================
 */
(function () {
  'use strict';

  var DEAD_FRAGMENT = 'app.humaans.io/api/public-holidays/ical/';

  // Immediately wipe dead URL from localStorage synchronously
  (function () {
    try {
      if ((localStorage.getItem('calHolidayIcs') || '').includes(DEAD_FRAGMENT)) {
        localStorage.removeItem('calHolidayIcs');
        _log('Removed dead Humaans URL from localStorage.');
      }
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
    patch_calSettings();
    inject_retryFix();
    _log('Loaded after ' + _attempts + ' attempt(s).');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // ── 1. Intercept fetchIcs — return empty string for the dead URL ──
  function patch_fetchIcs() {
    var _orig = window.fetchIcs;
    window.fetchIcs = async function (url) {
      if (typeof url === 'string' && url.includes(DEAD_FRAGMENT)) {
        _log('Blocked dead holiday URL — no network request made.');
        return '';
      }
      return _orig.apply(this, arguments);
    };
  }

  // ── 2. After loadIcsData, backfill from bankHolidayMap if empty ───
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
  // bankHolidayMap is keyed 'YYYY-MM-DD' → 'Holiday Name' and is
  // populated by the main dashboard's loadBankHolidays() which merges
  // the hardcoded fallback list with a live GOV.UK fetch.
  //
  // If for some reason it isn't ready yet (very early call), we retry
  // once after a short delay.
  //
  // Date construction: new Date(year, monthIndex, day)
  //   • Creates LOCAL midnight — identical to how the calendar creates
  //     its own day cells: new Date(year, month, d)
  //   • Immune to BST/UTC-offset issues that affected the old
  //     new Date(dateStr + 'T00:00:00') + setDate(+1) pattern.
  function _backfill(attempt) {
    attempt = attempt || 0;

    var map = window.bankHolidayMap;
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
      var m = parseInt(parts[1], 10) - 1;   // 0-based month
      var d = parseInt(parts[2], 10);
      var start = new Date(y, m, d);         // local midnight
      var end   = new Date(y, m, d + 1);     // next local midnight (exclusive)
      return { summary: map[dateStr], start: start, end: end, type: 'holiday' };
    });

    _log('Synthesised ' + window.calIcsEvents.length
      + ' bank holidays from bankHolidayMap (no extra network request).');

    _updateStatusBar();
    _dismissFeedBanner();
    if (typeof window.renderCalendar === 'function') window.renderCalendar();
  }

  // ── 3. Update Cal Settings modal ─────────────────────────────────
  function patch_calSettings() {
    var _origOpen = window.openCalSettings;
    if (typeof _origOpen !== 'function') return;
    window.openCalSettings = function () {
      _origOpen.apply(this, arguments);
      var input = document.getElementById('calHolidayIcsInput');
      if (!input) return;
      if (input.value.includes(DEAD_FRAGMENT)) input.value = '';
      var hint = input.nextElementSibling;
      if (hint && hint.classList.contains('form-hint')) {
        hint.innerHTML =
          'Leave blank — public holidays load automatically from GOV.UK '
          + '(England &amp; Wales). Only fill in if you have a new working Humaans ICS URL.';
      }
    };
  }

  // ── 4. Fix retry button unhandled-promise warnings ────────────────
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
    var leaveOk = !window.calLeaveEvents || window.calLeaveEvents.length > 0;
    if (!leaveOk) return;
    var banner = document.getElementById('ux-feed-banner');
    if (!banner) return;
    banner.style.transition = 'opacity 0.4s';
    banner.style.opacity    = '0';
    setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 420);
  }

  function _log(msg) { console.log('[HolidayFix] ' + msg); }

}());
