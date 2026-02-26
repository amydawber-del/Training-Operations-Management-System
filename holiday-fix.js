/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — HOLIDAY ICS FIX PATCH  v1.0
 * =====================================================================
 * The Humaans public-holidays ICS URL has expired (returns 404).
 * This patch synthesises calIcsEvents directly from the bank holidays
 * the dashboard already loads from api.gov.uk — so the calendar
 * continues to show bank holiday pills with zero extra network requests.
 *
 * Drop alongside your HTML and add ONE line just before </body>
 * (after ux-improvements.js if present):
 *
 *   <script src="holiday-fix.js"></script>
 * =====================================================================
 */
(function () {
  'use strict';

  var _attempts = 0;

  function bootstrap() {
    _attempts++;
    var ready = typeof window.loadIcsData      === 'function'
             && typeof window.bankHolidays     !== 'undefined'
             && typeof window.calIcsEvents     !== 'undefined'
             && typeof window.renderCalendar   === 'function';

    if (!ready && _attempts < 80) { setTimeout(bootstrap, 150); return; }

    // Purge the dead URL from localStorage immediately so it is never
    // read back into calSettingsHolidayIcs on the next page load.
    var _DEAD = 'app.humaans.io/api/public-holidays/ical/';
    if ((localStorage.getItem('calHolidayIcs') || '').includes(_DEAD)) {
      localStorage.removeItem('calHolidayIcs');
      _log('Removed dead holiday URL from localStorage.');
    }

    patch_loadIcsData();
    patch_calSettings();
    console.log('[HolidayFix] Loaded after', _attempts, 'attempt(s).');
  }

  // ── 1.  Patch loadIcsData ─────────────────────────────────────────
  // After the original runs (and potentially fails the holiday feed),
  // we backfill calIcsEvents from window.bankHolidays so the calendar
  // always has bank holiday markers — even if the ICS URL is dead.
  var DEAD_URL_FRAGMENT = 'app.humaans.io/api/public-holidays/ical/';

  function patch_loadIcsData() {
    var _orig = window.loadIcsData;

    window.loadIcsData = async function () {
      // ── Silence the dead URL before the original even tries it ──
      // calSettingsHolidayIcs is the runtime variable the dashboard reads.
      // If it still points at the dead Humaans endpoint, blank it so the
      // original skips that fetch entirely (no 404, no console warning).
      if (typeof window.calSettingsHolidayIcs === 'string'
          && window.calSettingsHolidayIcs.includes(DEAD_URL_FRAGMENT)) {
        window.calSettingsHolidayIcs = '';
        _log('Cleared dead Humaans holiday URL — will backfill from GOV.UK.');
      }

      await _orig.apply(this, arguments);

      // If a working ICS URL was configured and returned data, leave it alone.
      if (window.calIcsEvents && window.calIcsEvents.length > 0) {
        _log('Holiday ICS feed OK — no backfill needed.');
        return;
      }

      // Backfill from the gov.uk bank holidays already stored in bankHolidays[].
      _backfillFromBankHolidays();
    };

    // Fix the retry button onclick so the promise is handled cleanly
    // (prevents "unhandled promise rejection" warnings in the console).
    var _origRefreshBanner = null;
    if (typeof window._refreshFeedBanner === 'function') {
      _origRefreshBanner = window._refreshFeedBanner;
    }
    // Patch the retry button at DOM level whenever the banner is injected.
    var _bannerObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.id === 'ux-feed-banner') {
            var retryBtn = node.querySelector('button');
            if (retryBtn && retryBtn.textContent.includes('Retry')) {
              retryBtn.onclick = function () {
                window.loadIcsData().catch(function (e) {
                  console.warn('[HolidayFix] Retry failed:', e && e.message);
                });
              };
            }
          }
        });
      });
    });
    _bannerObserver.observe(document.body, { childList: true });
  }

  function _backfillFromBankHolidays() {
    var bh = window.bankHolidays;
    if (!bh || !bh.length) {
      // bankHolidays may still be loading — retry once after a short delay.
      setTimeout(function () {
        if (window.bankHolidays && window.bankHolidays.length) {
          _backfillFromBankHolidays();
          _reRenderIfVisible();
        }
      }, 1500);
      return;
    }

    var synthesised = bh.map(function (iso) {
      // Each entry in bankHolidays[] is a 'YYYY-MM-DD' string.
      var start = new Date(iso + 'T00:00:00');
      var end   = new Date(iso + 'T00:00:00');
      end.setDate(end.getDate() + 1);           // DTEND is exclusive (all-day)

      // Friendly name lookup from the gov.uk data if available, else generic.
      var name = _bhNameFor(iso) || 'Bank Holiday';

      return { summary: name, start: start, end: end, type: 'holiday' };
    });

    window.calIcsEvents = synthesised;
    _log('Backfilled ' + synthesised.length + ' bank holiday events from gov.uk data.');

    // Fix up the status bar to show a healthy state.
    _updateStatusBar();
    _reRenderIfVisible();
    // Clear the feed-down banner if ux-improvements.js added one.
    _dismissFeedBanner();
  }

  // ── 2.  Patch calSettings to remove the dead default URL ─────────
  // Clear the stale Humaans holiday URL so new installs don't
  // repeatedly hit a 404.  The leave URL is untouched.
  function patch_calSettings() {
    var DEAD_URL = 'https://app.humaans.io/api/public-holidays/ical/';

    // Clear from localStorage if the dead URL is cached there.
    var stored = localStorage.getItem('calHolidayIcs') || '';
    if (stored.includes(DEAD_URL)) {
      localStorage.removeItem('calHolidayIcs');
      _log('Removed dead holiday ICS URL from localStorage.');
    }

    // Patch openCalSettings to show a helpful hint in the holiday URL field.
    var _origOpen = window.openCalSettings;
    if (typeof _origOpen !== 'function') return;

    window.openCalSettings = function () {
      _origOpen.apply(this, arguments);
      var input = document.getElementById('calHolidayIcsInput');
      if (!input) return;
      // If field contains the dead URL, blank it and update the hint.
      if (input.value.includes(DEAD_URL)) {
        input.value = '';
      }
      // Update hint text to explain the fallback.
      var hint = input.nextElementSibling;
      if (hint && hint.classList.contains('form-hint')) {
        hint.innerHTML =
          'Leave blank to use the GOV.UK bank holidays feed (England &amp; Wales) automatically. '
          + 'Only fill in if you have a working Humaans ICS URL.';
      }
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  // Attempt to resolve a friendly name for a given ISO date from
  // the raw gov.uk API data cached in _govUkData (populated lazily).
  var _govUkNames = null;   // { 'YYYY-MM-DD': 'Name', … }

  function _bhNameFor(iso) {
    if (_govUkNames) return _govUkNames[iso] || null;

    // Try to extract from the already-fetched gov.uk response.
    // The dashboard fetches it in loadBankHolidays() but doesn't cache the names.
    // We do a lightweight one-off fetch here (it's the same request, cached by
    // the browser from loadBankHolidays()), building the name map.
    _govUkNames = {};     // mark as attempted so we don't loop
    fetch('https://www.gov.uk/bank-holidays.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var events = (data['england-wales'] && data['england-wales'].events) || [];
        events.forEach(function (ev) { _govUkNames[ev.date] = ev.title; });
        // Now patch up any already-synthesised events with real names.
        if (window.calIcsEvents) {
          window.calIcsEvents.forEach(function (ev) {
            var iso2 = ev.start ? ev.start.toISOString().split('T')[0] : null;
            if (iso2 && _govUkNames[iso2]) ev.summary = _govUkNames[iso2];
          });
          _reRenderIfVisible();
        }
      })
      .catch(function () { /* gov.uk unreachable — generic "Bank Holiday" names stand */ });

    return null;  // name will be patched in asynchronously above
  }

  function _updateStatusBar() {
    var bar = document.getElementById('icsStatusBar');
    if (!bar) return;
    var n = window.calIcsEvents ? window.calIcsEvents.length : 0;
    // Only update the holiday portion — leave existing leave-feed text intact.
    var existing = bar.innerHTML;
    var holPart  =
      '<span class="ics-status">'
      + '<span class="ics-dot ok"></span>'
      + n + ' holidays (GOV.UK)'
      + '</span>';

    // Replace an existing "Holiday feed error" span, or prepend.
    if (existing.includes('Holiday feed error') || existing.includes('holidays loaded')) {
      bar.innerHTML = existing
        .replace(/<span class="ics-status">[^<]*(?:Holiday feed error|holidays loaded)[^<]*<\/span>/, holPart);
    } else {
      var sep = existing.trim() ? '<span style="color:var(--text--dark--20);margin:0 4px;">|</span>' : '';
      bar.innerHTML = holPart + sep + existing;
    }
  }

  function _reRenderIfVisible() {
    var calSection = document.getElementById('calendarSection');
    if (!calSection || calSection.style.display === 'none') return;
    if (typeof window.renderCalendar === 'function') window.renderCalendar();
  }

  function _dismissFeedBanner() {
    // Dismiss the amber "feeds unavailable" banner injected by ux-improvements.js
    // if no other feeds are actually down.
    var leaveOk = window.calLeaveEvents && window.calLeaveEvents.length > 0;
    if (leaveOk) {
      var banner = document.getElementById('ux-feed-banner');
      if (banner) {
        banner.style.transition = 'opacity 0.4s';
        banner.style.opacity    = '0';
        setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 420);
      }
    }
  }

  function _log(msg) { console.log('[HolidayFix] ' + msg); }

  // ── Boot ─────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
