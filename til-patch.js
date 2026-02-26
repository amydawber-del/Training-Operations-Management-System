/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — TIL TRACKER INTEGRATION PATCH
 * =====================================================================
 * Drop this file next to your dashboard HTML and add ONE line at the
 * very end of the <body> (just before </body>):
 *
 *   <script src="til-patch.js"></script>
 *
 * That's it. No other changes needed.
 * =====================================================================
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  // tilData is keyed by trainer name and holds:
  //   .pending  – count of entries where Approval Status = "Pending"
  //   .balance  – Remaining Balance After Entry from the latest row
  //   .entries  – raw array of all entries from the sheet
  var tilData = {};

  // ── 1. Inject Nav Link ─────────────────────────────────────────────
  // Adds "Time in Lieu Tracker" to the side-drawer Resources section
  // as soon as the DOM is ready (or immediately if it's already ready).
  function injectNavLink() {
    // Find the Training Request Form link in the nav drawer
    var links = document.querySelectorAll('.nav-item');
    var refLink = null;
    links.forEach(function (el) {
      if (el.textContent.includes('Training Request Form')) refLink = el;
    });
    if (!refLink) return; // drawer not rendered yet – retry below

    // Only inject once
    if (document.getElementById('navTilLink')) return;

    var a = document.createElement('a');
    a.id        = 'navTilLink';
    a.className = 'nav-item';
    a.href      = 'https://amydawber-del.github.io/TilTracker/';
    a.target    = '_blank';
    a.rel       = 'noopener';
    a.onclick   = function () { if (typeof closeNav === 'function') closeNav(); };
    a.innerHTML = '<span class="nav-item-icon">&#9201;</span> Time in Lieu Tracker';
    refLink.insertAdjacentElement('afterend', a);
  }

  // ── 2. Load TiL Data ───────────────────────────────────────────────
  // Fetches all entries from the "Time in Lieu Log" sheet and groups
  // them by trainer, calculating pending count and current balance.
  async function loadTilData() {
    // SCRIPT_URL is defined in the main dashboard JS
    if (typeof SCRIPT_URL === 'undefined' || !SCRIPT_URL) return;
    try {
      var res  = await fetch(SCRIPT_URL + '?action=getTilLog&t=' + Date.now(),
                             { method: 'GET', redirect: 'follow' });
      var json = await res.json();
      if (!json.success || !Array.isArray(json.entries)) return;

      tilData = {};
      json.entries.forEach(function (entry) {
        var name = (entry.trainer || '').trim();
        if (!name) return;
        if (!tilData[name]) tilData[name] = { entries: [] };
        tilData[name].entries.push(entry);
      });

      Object.keys(tilData).forEach(function (name) {
        var entries = tilData[name].entries;

        // Count entries awaiting manager approval
        tilData[name].pending = entries.filter(function (e) {
          return (e.approvalStatus || '').toLowerCase() === 'pending';
        }).length;

        // Current balance = Remaining Balance After Entry on the most recent row
        var sorted = entries
          .filter(function (e) { return e.date; })
          .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        var last = sorted[sorted.length - 1];
        tilData[name].balance = last ? (parseFloat(last.balance) || 0) : 0;
      });

      // Refresh the workload cards so TiL data appears
      if (typeof renderTrainerWorkload === 'function') renderTrainerWorkload();

    } catch (err) {
      console.warn('[TilPatch] loadTilData failed:', err.message);
    }
  }

  // ── 3. Patch renderTrainerWorkload ────────────────────────────────
  // Wraps the original function so after it runs we enhance each
  // trainer card in-place with a TiL summary panel.
  function patchRenderTrainerWorkload() {
    if (typeof window.renderTrainerWorkload !== 'function') return;
    var _orig = window.renderTrainerWorkload;

    window.renderTrainerWorkload = function () {
      // Run original rendering first
      _orig.apply(this, arguments);

      // Now enhance every trainer card with TiL data
      var cards = document.querySelectorAll('#trainerGrid .trainer-card');
      cards.forEach(function (card) {
        // Identify trainer name from the first .trainer-name element
        var nameEl = card.querySelector('.trainer-name');
        if (!nameEl) return;
        var trainerName = nameEl.textContent.replace(/\s*(admin|trainer|viewer|manager)\s*/gi, '').trim();

        // Remove any existing TiL panel (prevents duplicates on re-render)
        var existing = card.querySelector('.til-panel');
        if (existing) existing.remove();

        var info = tilData[trainerName] || null;

        // Build TiL panel HTML
        var balStr    = info ? info.balance.toFixed(1) + ' hrs' : '— hrs';
        var balColor  = !info       ? 'var(--text--dark--20)'
                      : info.balance > 0  ? '#22a06b'
                      : info.balance < 0  ? '#c0303d'
                      : 'var(--text--dark--40)';

        var pendingHtml = '';
        if (info && info.pending > 0) {
          pendingHtml = '<div style="margin-top:6px;background:#fef3c7;border:1px solid #fde68a;'
            + 'border-radius:4px;padding:4px 8px;font-size:10px;font-weight:700;color:#92400e;'
            + 'display:flex;align-items:center;gap:4px;cursor:pointer;" '
            + 'onclick="window.open(\'https://amydawber-del.github.io/TilTracker/\',\'_blank\')">'
            + '&#9203; ' + info.pending + ' pending TiL approval'
            + '</div>';
        }

        var panel = document.createElement('div');
        panel.className = 'til-panel';
        panel.style.cssText = 'margin-top:8px;padding:8px 10px;background:#f4f4f8;'
          + 'border-radius:5px;border:1px solid var(--ui--underline--light-grey);';
        panel.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">'
          + '<span style="color:var(--text--dark--30);font-weight:600;">TiL Balance</span>'
          + '<span style="font-weight:700;color:' + balColor + ';">' + balStr + '</span>'
          + '</div>'
          + pendingHtml;

        card.appendChild(panel);
      });
    };
  }

  // ── 4. Hook into enterDashboard ───────────────────────────────────
  // The dashboard calls enterDashboard() after login. We wrap it to
  // trigger the initial TiL load and set up a refresh interval.
  function patchEnterDashboard() {
    if (typeof window.enterDashboard !== 'function') return;
    var _orig = window.enterDashboard;

    window.enterDashboard = function () {
      _orig.apply(this, arguments);
      // Load TiL data shortly after main data is fetched
      setTimeout(loadTilData, 2000);
      // Refresh every 10 minutes
      setInterval(loadTilData, 10 * 60 * 1000);
    };
  }

  // ── Bootstrap ─────────────────────────────────────────────────────
  // Apply patches once the page is ready. We use a small polling loop
  // because the main dashboard functions are defined inside its own
  // DOMContentLoaded handler and may not exist yet at script parse time.
  var _patchAttempts = 0;
  function bootstrap() {
    _patchAttempts++;
    var ready = (typeof window.renderTrainerWorkload === 'function')
             && (typeof window.enterDashboard === 'function');

    if (!ready && _patchAttempts < 50) {
      setTimeout(bootstrap, 200);
      return;
    }

    injectNavLink();
    patchRenderTrainerWorkload();
    patchEnterDashboard();

    // If the user is already logged in when the patch loads, pull TiL data now
    if (typeof currentUser !== 'undefined' && currentUser) {
      loadTilData();
    }

    console.log('[TilPatch] Initialised after', _patchAttempts, 'attempt(s)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
