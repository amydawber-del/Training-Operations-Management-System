/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — HOLIDAY ICS FIX PATCH  v2.0
 * =====================================================================
 * The Humaans public-holidays ICS URL returns 404.
 * This patch:
 *   1. Intercepts window.fetchIcs to silently block the dead URL
 *      (no network request, no 404, no console error).
 *   2. After loadIcsData runs, synthesises calIcsEvents from the
 *      GOV.UK bank-holidays API (browser-cached, same source the
 *      dashboard already uses for isBankHoliday checks).
 *   3. Clears the dead URL from localStorage on load.
 *   4. Fixes the retry button promise so it never throws unhandled
 *      rejections.
 * =====================================================================
 */
(function () {
  'use strict';

  var DEAD_FRAGMENT = 'app.humaans.io/api/public-holidays/ical/';
  var GOV_UK_API    = 'https://www.gov.uk/bank-holidays.json';

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

  // 1. Intercept fetchIcs — return empty string immediately for the dead URL
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

  // 2. After loadIcsData runs with empty calIcsEvents, backfill from GOV.UK
  function patch_loadIcsData() {
    var _orig = window.loadIcsData;
    window.loadIcsData = async function () {
      await _orig.apply(this, arguments);
      if (window.calIcsEvents && window.calIcsEvents.length > 0) {
        _log('Holiday ICS feed returned data — no backfill needed.');
        _dismissFeedBanner();
        return;
      }
      await _backfill();
    };
  }

  async function _backfill() {
    try {
      var res    = await fetch(GOV_UK_API);
      var data   = await res.json();
      var events = (data['england-wales'] && data['england-wales'].events) || [];
      if (!events.length) { _log('GOV.UK returned no events.'); return; }

      window.calIcsEvents = events.map(function (ev) {
        var start = new Date(ev.date + 'T00:00:00');
        var end   = new Date(ev.date + 'T00:00:00');
        end.setDate(end.getDate() + 1);
        return { summary: ev.title, start: start, end: end, type: 'holiday' };
      });

      _log('Backfilled ' + window.calIcsEvents.length + ' bank holidays from GOV.UK.');
      _updateStatusBar();
      _dismissFeedBanner();
      if (typeof window.renderCalendar === 'function') window.renderCalendar();
    } catch (e) {
      _log('GOV.UK backfill failed: ' + e.message);
    }
  }

  // 3. Update Cal Settings modal — clear dead URL, update hint
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

  // 4. Fix retry button unhandled-promise warnings via MutationObserver
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
