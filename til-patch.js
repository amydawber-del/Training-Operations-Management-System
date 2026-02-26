/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — TIL TRACKER INTEGRATION PATCH  v1.2
 * =====================================================================
 * Compatible with the Apps Script code.js getTilLog action.
 *
 * Balance calculation fix (v1.2):
 *   The Apps Script reads "Remaining Balance After Entry" (col U) which
 *   is only populated when entries are saved via the TiL Tracker app.
 *   If col U is blank the Apps Script returns balance: 0 for every row.
 *
 *   This patch ignores the balance field entirely and recalculates from
 *   the fields that are always present:
 *     • tilEarned  (col O — Total TiL Earned hrs)
 *     • hrsUsed    (col T — TiL Used hrs)
 *
 *   Net balance = Σ tilEarned (approved entries)
 *              − Σ hrsUsed   (entries where tilTaken = "Y")
 *
 * Pending count = entries where approvalStatus = "Pending"
 * =====================================================================
 */
(function () {
  'use strict';

  var TRACKER_URL = 'https://amydawber-del.github.io/TilTracker/';
  var tilData     = {};  // keyed by trainer name

  // ── 1.  Inject nav link ──────────────────────────────────────────
  function injectNavLink() {
    if (document.getElementById('navTilLink')) return;
    var links   = document.querySelectorAll('.nav-item');
    var refLink = null;
    links.forEach(function (el) {
      if (el.textContent.includes('Training Request Form')) refLink = el;
    });
    if (!refLink) return;

    var a = document.createElement('a');
    a.id        = 'navTilLink';
    a.className = 'nav-item';
    a.href      = TRACKER_URL;
    a.target    = '_blank';
    a.rel       = 'noopener';
    a.onclick   = function () { if (typeof closeNav === 'function') closeNav(); };
    a.innerHTML = '<span class="nav-item-icon">&#9201;</span> Time in Lieu Tracker';
    refLink.insertAdjacentElement('afterend', a);
  }

  // ── 2.  Calculate balance from tilEarned / hrsUsed ───────────────
  // The Apps Script maps:
  //   tilEarned  ← col O  "Total TiL Earned (hrs)"
  //   hrsUsed    ← col T  "TiL Used (hrs)"
  //   tilTaken   ← col R  "TiL Taken (Y/N)"
  //   approvalStatus ← col Q "Approval Status"
  //
  // We sum earned for entries that are Approved (or have no status set),
  // and sum used for entries marked TiL Taken = Y.
  function _calcBalance(entries) {
    var earned = 0;
    var used   = 0;

    entries.forEach(function (e) {
      var status = String(e.approvalStatus || '').trim().toLowerCase();
      var taken  = String(e.tilTaken       || '').trim().toUpperCase();

      // Count TiL earned: approved entries (or entries with no status — treat as approved)
      if (status === 'approved' || status === '' || status === 'n/a') {
        earned += (parseFloat(e.tilEarned) || 0);
      }

      // Count TiL used: any entry where TiL Taken = Y
      if (taken === 'Y') {
        used += (parseFloat(e.hrsUsed) || 0);
      }
    });

    return Math.round((earned - used) * 10) / 10;
  }

  function _calcPending(entries) {
    return entries.filter(function (e) {
      return String(e.approvalStatus || '').trim().toLowerCase() === 'pending';
    }).length;
  }

  // ── 3.  Load TiL data ────────────────────────────────────────────
  async function loadTilData() {
    if (typeof SCRIPT_URL === 'undefined' || !SCRIPT_URL) return;

    try {
      var url = SCRIPT_URL + '?action=getTilLog&t=' + Date.now();
      var res = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      var json = await res.json();

      if (!json.success) {
        console.warn('[TilPatch] getTilLog error:', json.error);
        return;
      }

      if (!Array.isArray(json.entries)) {
        console.warn('[TilPatch] Unexpected response shape:', json);
        return;
      }

      // Debug: log first entry so field names are visible
      if (json.entries.length > 0) {
        var s = json.entries[0];
        console.log('[TilPatch] Sample entry — tilEarned:', s.tilEarned,
          '| hrsUsed:', s.hrsUsed, '| approvalStatus:', s.approvalStatus,
          '| tilTaken:', s.tilTaken, '| trainer:', s.trainer);
      } else {
        console.log('[TilPatch] getTilLog returned 0 entries.');
      }

      // Group by trainer
      tilData = {};
      json.entries.forEach(function (entry) {
        var name = String(entry.trainer || '').trim();
        if (!name) return;
        if (!tilData[name]) tilData[name] = [];
        tilData[name].push(entry);
      });

      // Calculate balance and pending count per trainer
      Object.keys(tilData).forEach(function (name) {
        var entries = tilData[name];
        tilData[name] = {
          entries : entries,
          balance : _calcBalance(entries),
          pending : _calcPending(entries),
        };
        console.log('[TilPatch]', name,
          '→ balance:', tilData[name].balance,
          '| pending:', tilData[name].pending,
          '| entries:', entries.length);
      });

      if (typeof renderTrainerWorkload === 'function') renderTrainerWorkload();

    } catch (err) {
      console.warn('[TilPatch] loadTilData error:', err.message);
    }
  }

  // ── 4.  Patch renderTrainerWorkload ──────────────────────────────
  function patchRenderTrainerWorkload() {
    if (typeof window.renderTrainerWorkload !== 'function') return;
    var _orig = window.renderTrainerWorkload;

    window.renderTrainerWorkload = function () {
      _orig.apply(this, arguments);

      var cards = document.querySelectorAll('#trainerGrid .trainer-card');
      cards.forEach(function (card) {
        var nameEl = card.querySelector('.trainer-name');
        if (!nameEl) return;

        // Strip role label that may be appended to the name in the DOM
        var trainerName = nameEl.textContent
          .replace(/\s*(admin|trainer|viewer|manager)\s*/gi, '').trim();

        // Remove any existing TiL panel
        var existing = card.querySelector('.til-panel');
        if (existing) existing.remove();

        var info    = tilData[trainerName] || null;
        var bal     = info ? info.balance : null;
        var pending = info ? info.pending : 0;

        var balStr, balColor;
        if (bal === null) {
          balStr   = '— hrs';
          balColor = 'var(--text--dark--20)';
        } else if (bal > 0) {
          balStr   = '+' + bal.toFixed(1) + ' hrs';
          balColor = '#22a06b';
        } else if (bal < 0) {
          balStr   = bal.toFixed(1) + ' hrs';
          balColor = '#c0303d';
        } else {
          balStr   = '0.0 hrs';
          balColor = 'var(--text--dark--40)';
        }

        var pendingHtml = '';
        if (pending > 0) {
          pendingHtml =
            '<div style="margin-top:6px;background:#fef3c7;border:1px solid #fde68a;'
            + 'border-radius:4px;padding:4px 8px;font-size:10px;font-weight:700;'
            + 'color:#92400e;display:flex;align-items:center;gap:4px;cursor:pointer;" '
            + 'onclick="window.open(\'' + TRACKER_URL + '\',\'_blank\')">'
            + '&#9203; ' + pending + ' pending TiL approval'
            + '</div>';
        }

        var panel = document.createElement('div');
        panel.className = 'til-panel';
        panel.style.cssText = [
          'margin-top:8px', 'padding:8px 10px',
          'background:#f4f4f8', 'border-radius:5px',
          'border:1px solid var(--ui--underline--light-grey)'
        ].join(';');
        panel.innerHTML =
          '<div style="display:flex;justify-content:space-between;'
          + 'align-items:center;font-size:11px;">'
          + '<span style="color:var(--text--dark--30);font-weight:600;">TiL Balance</span>'
          + '<span style="font-weight:700;color:' + balColor + ';">' + balStr + '</span>'
          + '</div>'
          + pendingHtml;

        card.appendChild(panel);
      });
    };
  }

  // ── 5.  Hook into enterDashboard ──────────────────────────────────
  function patchEnterDashboard() {
    if (typeof window.enterDashboard !== 'function') return;
    var _orig = window.enterDashboard;
    window.enterDashboard = function () {
      _orig.apply(this, arguments);
      setTimeout(loadTilData, 1500);
      setInterval(loadTilData, 10 * 60 * 1000);
    };
  }

  // ── Bootstrap ─────────────────────────────────────────────────────
  var _attempts = 0;
  function bootstrap() {
    _attempts++;
    var ready = typeof window.renderTrainerWorkload === 'function'
             && typeof window.enterDashboard        === 'function';

    if (!ready && _attempts < 50) { setTimeout(bootstrap, 200); return; }

    injectNavLink();
    patchRenderTrainerWorkload();
    patchEnterDashboard();

    // If already logged in (e.g. page reload), load immediately
    if (typeof currentUser !== 'undefined' && currentUser) {
      loadTilData();
    }

    console.log('[TilPatch] Initialised after', _attempts, 'attempt(s)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

}());
