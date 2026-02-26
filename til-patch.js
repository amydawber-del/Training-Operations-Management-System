/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — TIL TRACKER INTEGRATION PATCH  v1.1
 * =====================================================================
 * Changes in v1.1:
 *   - Robust balance field resolution: tries every plausible column-name
 *     variant returned by Google Sheets / Apps Script.
 *   - Falls back to calculating balance from entry types if no balance
 *     column is found at all.
 *   - Logs the raw first entry to console (once) so field names are
 *     visible if further debugging is needed.
 * =====================================================================
 */

(function () {
  'use strict';

  var tilData = {};

  // ── 1. Inject Nav Link ─────────────────────────────────────────────
  function injectNavLink() {
    var links = document.querySelectorAll('.nav-item');
    var refLink = null;
    links.forEach(function (el) {
      if (el.textContent.includes('Training Request Form')) refLink = el;
    });
    if (!refLink) return;
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

  // ── 2. Resolve balance from an entry ─────────────────────────────
  // Google Sheets / Apps Script can return column headers in many formats.
  // We try every plausible variant before falling back to calculation.
  var BALANCE_FIELDS = [
    'balance',
    'Balance',
    'remainingBalance',
    'Remaining Balance',
    'remaining_balance',
    'RemainingBalance',
    'balanceAfterEntry',
    'Balance After Entry',
    'Remaining Balance After Entry',
    'remaining balance after entry',
    'remainingBalanceAfterEntry',
    'currentBalance',
    'Current Balance',
    'tilBalance',
    'TIL Balance',
    'til_balance',
    'hoursBalance',
    'Hours Balance',
    'running_balance',
    'Running Balance',
  ];

  function resolveBalance(entry) {
    for (var i = 0; i < BALANCE_FIELDS.length; i++) {
      var v = entry[BALANCE_FIELDS[i]];
      if (v !== undefined && v !== null && v !== '') {
        var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
        if (!isNaN(n)) return n;
      }
    }
    return null;   // not found — will calculate below
  }

  // ── 3. Calculate balance from scratch if no balance column exists ─
  // Sums hours for each entry using the type/direction column.
  var ACCRUAL_FIELDS  = ['type', 'Type', 'entryType', 'Entry Type', 'direction', 'Direction', 'category', 'Category'];
  var HOURS_FIELDS    = ['hours', 'Hours', 'hoursAdded', 'hoursDeducted', 'tilHours', 'TIL Hours', 'amount', 'Amount', 'duration', 'Duration'];
  var ACCRUAL_KEYWORDS = ['accrued', 'accrual', 'earned', 'added', 'credit', 'in', 'add'];

  function resolveHours(entry) {
    for (var i = 0; i < HOURS_FIELDS.length; i++) {
      var v = entry[HOURS_FIELDS[i]];
      if (v !== undefined && v !== null && v !== '') {
        var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
        if (!isNaN(n)) return n;
      }
    }
    return 0;
  }

  function isAccrual(entry) {
    for (var i = 0; i < ACCRUAL_FIELDS.length; i++) {
      var v = String(entry[ACCRUAL_FIELDS[i]] || '').toLowerCase();
      if (!v) continue;
      for (var j = 0; j < ACCRUAL_KEYWORDS.length; j++) {
        if (v.includes(ACCRUAL_KEYWORDS[j])) return true;
      }
    }
    // No type field — assume positive hours = accrual
    return resolveHours(entry) >= 0;
  }

  function calculateBalance(entries) {
    var total = 0;
    entries.forEach(function (e) {
      var hrs = Math.abs(resolveHours(e));
      if (isAccrual(e)) { total += hrs; } else { total -= hrs; }
    });
    return Math.round(total * 10) / 10;
  }

  // ── 4. Load TiL Data ───────────────────────────────────────────────
  async function loadTilData() {
    if (typeof SCRIPT_URL === 'undefined' || !SCRIPT_URL) return;
    try {
      var res  = await fetch(SCRIPT_URL + '?action=getTilLog&t=' + Date.now(),
                             { method: 'GET', redirect: 'follow' });
      var json = await res.json();
      if (!json.success || !Array.isArray(json.entries)) {
        console.warn('[TilPatch] getTilLog response:', json);
        return;
      }

      // Log first entry once so field names are visible in the console
      // for debugging — remove once balance is confirmed correct.
      if (json.entries.length > 0) {
        console.log('[TilPatch] First entry fields:', Object.keys(json.entries[0]));
        console.log('[TilPatch] First entry sample:', json.entries[0]);
      }

      tilData = {};
      json.entries.forEach(function (entry) {
        var name = (entry.trainer || entry.Trainer || entry.name || entry.Name || '').trim();
        if (!name) return;
        if (!tilData[name]) tilData[name] = { entries: [] };
        tilData[name].entries.push(entry);
      });

      Object.keys(tilData).forEach(function (name) {
        var entries = tilData[name].entries;

        tilData[name].pending = entries.filter(function (e) {
          var status = (
            e.approvalStatus || e['Approval Status'] || e.approval_status ||
            e.status || e.Status || ''
          ).toLowerCase();
          return status === 'pending';
        }).length;

        // Sort by date ascending to find most recent entry
        var DATE_FIELDS = ['date', 'Date', 'entryDate', 'Entry Date', 'createdAt', 'Created At'];
        var sorted = entries.filter(function (e) {
          for (var i = 0; i < DATE_FIELDS.length; i++) {
            if (e[DATE_FIELDS[i]]) return true;
          }
          return false;
        }).sort(function (a, b) {
          var da = '', db = '';
          for (var i = 0; i < DATE_FIELDS.length; i++) {
            if (a[DATE_FIELDS[i]]) { da = a[DATE_FIELDS[i]]; break; }
            if (b[DATE_FIELDS[i]]) { db = b[DATE_FIELDS[i]]; break; }
          }
          return da < db ? -1 : 1;
        });

        var last = sorted[sorted.length - 1];

        if (last) {
          var bal = resolveBalance(last);
          if (bal !== null) {
            tilData[name].balance = bal;
            tilData[name].balanceSource = 'sheet';
          } else {
            // No balance column — calculate from all entries
            tilData[name].balance = calculateBalance(entries);
            tilData[name].balanceSource = 'calculated';
            console.warn('[TilPatch] No balance column found for', name,
              '— calculated from entries:', tilData[name].balance);
          }
        } else {
          tilData[name].balance = 0;
          tilData[name].balanceSource = 'none';
        }
      });

      if (typeof renderTrainerWorkload === 'function') renderTrainerWorkload();

    } catch (err) {
      console.warn('[TilPatch] loadTilData failed:', err.message);
    }
  }

  // ── 5. Patch renderTrainerWorkload ────────────────────────────────
  function patchRenderTrainerWorkload() {
    if (typeof window.renderTrainerWorkload !== 'function') return;
    var _orig = window.renderTrainerWorkload;

    window.renderTrainerWorkload = function () {
      _orig.apply(this, arguments);

      var cards = document.querySelectorAll('#trainerGrid .trainer-card');
      cards.forEach(function (card) {
        var nameEl = card.querySelector('.trainer-name');
        if (!nameEl) return;
        var trainerName = nameEl.textContent
          .replace(/\s*(admin|trainer|viewer|manager)\s*/gi, '').trim();

        var existing = card.querySelector('.til-panel');
        if (existing) existing.remove();

        var info = tilData[trainerName] || null;

        var balStr   = info ? info.balance.toFixed(1) + ' hrs' : '— hrs';
        var balColor = !info           ? 'var(--text--dark--20)'
                     : info.balance > 0 ? '#22a06b'
                     : info.balance < 0 ? '#c0303d'
                     : 'var(--text--dark--40)';

        // Show source hint when balance was calculated rather than read from sheet
        var sourceHint = (info && info.balanceSource === 'calculated')
          ? '<div style="font-size:9px;color:#f59e0b;margin-top:3px;">⚠ calculated — check sheet</div>'
          : '';

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
          + sourceHint
          + pendingHtml;

        card.appendChild(panel);
      });
    };
  }

  // ── 6. Hook into enterDashboard ───────────────────────────────────
  function patchEnterDashboard() {
    if (typeof window.enterDashboard !== 'function') return;
    var _orig = window.enterDashboard;

    window.enterDashboard = function () {
      _orig.apply(this, arguments);
      setTimeout(loadTilData, 2000);
      setInterval(loadTilData, 10 * 60 * 1000);
    };
  }

  // ── Bootstrap ─────────────────────────────────────────────────────
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

}());
