/**
 * =====================================================================
 * STREET TRAINING DASHBOARD — UX IMPROVEMENTS PATCH  v1.0
 * =====================================================================
 * Drop this file alongside your dashboard HTML and add ONE line just
 * before the closing </body> tag (after til-patch.js if present):
 *
 *   <script src="ux-improvements.js"></script>
 *
 * Improvements included:
 *   #1  Login          — "Not you?" shortcut + last-login timestamp
 *   #2  Notifications  — only mark read when visible for 1.5 s
 *   #3  Booking        — unified conflict summary card with calendar link
 *   #7  Calendar feeds — persistent banner + booking warning when feeds down
 *   #9  Actions        — "Open Record" toast button + 8-second undo on cancel
 *  #10  Role clarity   — placeholder cards for hidden dashboard sections
 * =====================================================================
 */
(function () {
  'use strict';

  // ─── bootstrap ────────────────────────────────────────────────────
  // Wait for the main dashboard functions to be defined before patching.
  var _attempts = 0;
  function bootstrap() {
    _attempts++;
    var ready = typeof window.renderTrainerWorkload === 'function'
             && typeof window.enterDashboard       === 'function'
             && typeof window.applyPermVisibility  === 'function'
             && typeof window.checkBookingWarnings === 'function';
    if (!ready && _attempts < 80) { setTimeout(bootstrap, 150); return; }
    try {
      patch_login();
      patch_notifications();
      patch_bookingConflicts();
      patch_calendarFeeds();
      patch_reversibleActions();
      patch_roleClarity();
      inject_styles();
      console.log('[UxPatch] Loaded after', _attempts, 'attempt(s).');
    } catch (e) {
      console.error('[UxPatch] Bootstrap error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }


  // ══════════════════════════════════════════════════════════════════
  // #1  LOGIN — "Not you?" link + last-login timestamp
  // ══════════════════════════════════════════════════════════════════
  function patch_login() {

    // Wrap loginNext to inject extras into the PIN screen after it renders.
    var _origNext = window.loginNext;
    window.loginNext = function () {
      _origNext.apply(this, arguments);

      var uid = window.loginSelectedUserId;
      var u   = uid && window.trainers && window.trainers.find(function (t) { return t.id === uid; });
      if (!u) return;

      // "Not you? Change user" button — inject once below the subtitle.
      var subEl = document.getElementById('pinSubtitle');
      if (subEl && !document.getElementById('pinNotYouBtn')) {
        var notYouBtn = document.createElement('button');
        notYouBtn.id          = 'pinNotYouBtn';
        notYouBtn.textContent = '↩ Not you? Change user';
        notYouBtn.style.cssText = [
          'display:block', 'margin:8px auto 0', 'background:none', 'border:none',
          'color:var(--accent--blue--300)', 'font-size:11px', 'cursor:pointer',
          'font-family:Arial,sans-serif', 'text-decoration:underline'
        ].join(';');
        notYouBtn.onclick = function () {
          if (typeof window.loginBackToSearch === 'function') window.loginBackToSearch();
        };
        subEl.insertAdjacentElement('afterend', notYouBtn);
      }

      // Last-login timestamp — stored per user-id in localStorage.
      var lastLogin = localStorage.getItem('ux_lastLogin_' + uid);
      var stampId   = 'pinLastLoginStamp';
      var existing  = document.getElementById(stampId);
      if (!existing) {
        var stamp = document.createElement('div');
        stamp.id             = stampId;
        stamp.style.cssText  = 'text-align:center;font-size:10px;color:var(--text--dark--20);margin-top:10px;';
        var notYouEl = document.getElementById('pinNotYouBtn');
        var insertAfter = notYouEl || document.getElementById('pinSubtitle');
        if (insertAfter) insertAfter.insertAdjacentElement('afterend', stamp);
      }
      var stampEl = document.getElementById(stampId);
      if (stampEl) {
        stampEl.textContent = lastLogin
          ? 'Last login: ' + lastLogin
          : 'First login on this device';
      }
    };

    // Record timestamp on successful dashboard entry.
    var _origEnter = window.enterDashboard;
    window.enterDashboard = function () {
      _origEnter.apply(this, arguments);
      if (window.currentUser) {
        var now = new Date().toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        localStorage.setItem('ux_lastLogin_' + window.currentUser.id, now);
      }
    };
  }


  // ══════════════════════════════════════════════════════════════════
  // #2  NOTIFICATIONS — mark read only after 1.5 s in viewport
  //     Replaces the "mark read on panel open" pattern.
  // ══════════════════════════════════════════════════════════════════
  var _notifObserver = null;

  function patch_notifications() {
    // Re-attach IntersectionObserver after every render of the feed.
    var _origRender = window.renderNotifPanel;
    window.renderNotifPanel = function () {
      _origRender.apply(this, arguments);
      _scheduleNotifObserver();
    };

    var _origOpen = window.openNotifPanel;
    window.openNotifPanel = function () {
      _origOpen.apply(this, arguments);
      setTimeout(_scheduleNotifObserver, 120);
    };
  }

  function _scheduleNotifObserver() {
    if (_notifObserver) { _notifObserver.disconnect(); _notifObserver = null; }
    var panel = document.getElementById('notifPanel');
    if (!panel || !panel.classList.contains('open')) return;
    if (!('IntersectionObserver' in window)) return;

    var feedBody = document.getElementById('notifFeedBody');
    if (!feedBody) return;

    var seenTimers = {};

    _notifObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.dataset.uxNotifId;
        if (!id) return;
        if (entry.isIntersecting) {
          if (!seenTimers[id]) {
            seenTimers[id] = setTimeout(function () {
              delete seenTimers[id];
              if (typeof window.markNotifRead === 'function') window.markNotifRead(id);
            }, 1500);
          }
        } else {
          clearTimeout(seenTimers[id]);
          delete seenTimers[id];
        }
      });
    }, { root: feedBody, threshold: 0.75 });

    // Observe every unread notification entry currently in the DOM.
    var unreadEls = feedBody.querySelectorAll('.notif-entry.unread[id]');
    unreadEls.forEach(function (el) {
      var id = el.id.replace('notif_', '');
      el.dataset.uxNotifId = id;
      _notifObserver.observe(el);
    });
  }


  // ══════════════════════════════════════════════════════════════════
  // #3  BOOKING CONFLICTS — unified conflict summary card
  //     Wraps existing warning HTML in a labelled card with a
  //     "View Calendar →" link that dismisses the modal first.
  // ══════════════════════════════════════════════════════════════════
  function patch_bookingConflicts() {
    var _origCheck     = window.checkBookingWarnings;
    var _origEditCheck = window.checkEditWarnings;

    window.checkBookingWarnings = function () {
      _origCheck.apply(this, arguments);
      _wrapWarningsInCard('bookWarnings');
      _prependFeedDownWarning('bookWarnings');   // #7 combined here
    };

    window.checkEditWarnings = function () {
      _origEditCheck.apply(this, arguments);
      _wrapWarningsInCard('editBookingWarnings');
      _prependFeedDownWarning('editBookingWarnings'); // #7 combined here
    };
  }

  function _wrapWarningsInCard(containerId) {
    var el = document.getElementById(containerId);
    if (!el || !el.innerHTML.trim()) return;
    if (el.querySelector('.ux-conflict-card')) return; // already wrapped

    // Count actual blocking warnings (warn-class boxes)
    var warnCount = (el.innerHTML.match(/warning-box warn/g) || []).length;
    if (!warnCount) return; // info-only messages don't need the summary header

    var inner = el.innerHTML;
    el.innerHTML =
      '<div class="ux-conflict-card" style="'
      + 'border:2px solid #fca5a5;border-radius:8px;overflow:hidden;margin-bottom:10px;'
      + '">'
      + '<div style="'
      + 'background:#fee2e2;padding:9px 14px;display:flex;align-items:center;'
      + 'justify-content:space-between;gap:8px;'
      + '">'
      + '<span style="font-size:12px;font-weight:700;color:#991b1b;display:flex;align-items:center;gap:6px;">'
      + '&#9888;&#65039; '
      + warnCount + ' scheduling conflict' + (warnCount > 1 ? 's' : '') + ' detected'
      + '</span>'
      + '<button class="ux-conflict-cal-btn" style="'
      + 'background:none;border:none;font-size:11px;font-weight:700;color:#991b1b;'
      + 'cursor:pointer;font-family:Arial,sans-serif;text-decoration:underline;white-space:nowrap;'
      + '" onclick="'
      // Close open modals then scroll to calendar
      + 'document.querySelectorAll(\'.modal-overlay.open\').forEach(function(m){m.classList.remove(\'open\')});'
      + 'var cal=document.getElementById(\'calendarSection\');if(cal)cal.scrollIntoView({behavior:\'smooth\'});'
      + '">'
      + 'View Calendar &#8599;'
      + '</button>'
      + '</div>'
      + '<div style="padding:10px 14px;">' + inner + '</div>'
      + '</div>';
  }


  // ══════════════════════════════════════════════════════════════════
  // #7  CALENDAR FEEDS — persistent banner + booking-modal warning
  // ══════════════════════════════════════════════════════════════════
  var _uxFeedsDown = false;

  function patch_calendarFeeds() {
    var _origUpdate = window.updateIcsStatusBar;

    window.updateIcsStatusBar = function (holResult, leaveResult) {
      // Track failure state BEFORE calling original (which may throw on the
      // stale `bar` reference that exists in some versions of the dashboard).
      _uxFeedsDown = !!(holResult   && holResult.status   === 'rejected')
                  || !!(leaveResult && leaveResult.status === 'rejected');

      // Call original, swallowing any ReferenceError from the `bar` variable.
      try {
        _origUpdate.apply(this, arguments);
      } catch (e) {
        // Fallback: update the status bar ourselves
        var bar = document.getElementById('icsStatusBar');
        if (bar) {
          var parts = [];
          if (holResult) {
            parts.push(
              holResult.status === 'fulfilled' && window.calIcsEvents && window.calIcsEvents.length
                ? '<span class="ics-status"><span class="ics-dot ok"></span>' + window.calIcsEvents.length + ' holidays loaded</span>'
                : '<span class="ics-status" title="' + _safeMsg(holResult) + '"><span class="ics-dot error"></span>Holiday feed error</span>'
            );
          }
          if (leaveResult) {
            parts.push(
              leaveResult.status === 'fulfilled' && window.calLeaveEvents && window.calLeaveEvents.length
                ? '<span class="ics-status"><span class="ics-dot ok"></span>' + window.calLeaveEvents.length + ' leave events loaded</span>'
                : '<span class="ics-status" title="' + _safeMsg(leaveResult) + '"><span class="ics-dot error"></span>Leave feed error</span>'
            );
          }
          bar.innerHTML = parts.join('<span style="color:var(--text--dark--20);margin:0 4px;">|</span>');
        }
      }

      _refreshFeedBanner();
    };
  }

  function _safeMsg(result) {
    if (!result || !result.reason) return 'Unknown error';
    return String(result.reason.message || result.reason).slice(0, 120).replace(/"/g, '&quot;');
  }

  function _refreshFeedBanner() {
    var existing = document.getElementById('ux-feed-banner');

    if (!_uxFeedsDown) {
      // Feeds OK — record last successful sync time and remove banner.
      var now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      localStorage.setItem('ux_lastFeedSync', now);
      if (existing) existing.remove();
      return;
    }

    // Feeds down — show or update banner.
    var lastSync = localStorage.getItem('ux_lastFeedSync') || 'unknown';

    if (existing) {
      // Just update the sync time if the banner is already visible.
      var timeEl = existing.querySelector('.ux-feed-banner-time');
      if (timeEl) timeEl.textContent = lastSync;
      return;
    }

    var banner = document.createElement('div');
    banner.id           = 'ux-feed-banner';
    banner.style.cssText = [
      'background:#fef3c7', 'border-bottom:2px solid #fde68a',
      'padding:8px 20px', 'display:flex', 'align-items:center', 'gap:10px',
      'font-size:12px', 'font-weight:600', 'color:#92400e',
      'position:sticky', 'top:52px', 'z-index:98', 'animation:slideIn 0.2s ease'
    ].join(';');
    banner.innerHTML =
      '<span style="font-size:15px;">&#128683;</span>'
      + '<span style="flex:1;">'
      + 'Calendar feeds unavailable — trainer availability may be outdated. '
      + 'Last sync: <span class="ux-feed-banner-time">' + lastSync + '</span>'
      + '</span>'
      + '<button onclick="window.loadIcsData && window.loadIcsData()" style="'
      + 'background:#92400e;color:#fff;border:none;border-radius:4px;'
      + 'padding:4px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;'
      + '">Retry &#8635;</button>'
      + '<button onclick="document.getElementById(\'ux-feed-banner\').remove()" style="'
      + 'background:none;border:none;font-size:17px;cursor:pointer;color:#92400e;padding:0 2px;line-height:1;'
      + '" title="Dismiss">&#10005;</button>';

    var main = document.getElementById('mainContent');
    if (main) main.insertAdjacentElement('beforebegin', banner);
  }

  // Inject a non-blocking warning into booking/edit modals when feeds are down.
  function _prependFeedDownWarning(containerId) {
    if (!_uxFeedsDown) return;
    var el = document.getElementById(containerId);
    if (!el) return;
    if (el.querySelector('.ux-feed-warn')) return;
    var div = document.createElement('div');
    div.className = 'ux-feed-warn warning-box warn';
    div.style.cssText = 'background:#fff8e1;border-color:#ffc107;margin-bottom:8px;';
    div.innerHTML =
      '<span>&#128267;</span>'
      + '<span>Leave data is currently unavailable. Trainer availability cannot be verified. '
      + 'Consider retrying the calendar sync before confirming.</span>';
    el.prepend(div);
  }


  // ══════════════════════════════════════════════════════════════════
  // #9  REVERSIBLE ACTIONS
  //     • Every success toast gains an "Open Record →" button.
  //     • Cancel gets an additional "↩ Undo (8s)" button that writes
  //       the previous status back to the sheet.
  // ══════════════════════════════════════════════════════════════════
  function patch_reversibleActions() {
    _patchConfirmBook();
    _patchConfirmCancel();
    _patchConfirmEditBooking();
  }

  /** Show a toast with one or more action buttons and an animated progress bar. */
  function _actionToast(msg, type, durationMs, actions) {
    var c = document.getElementById('toastContainer');
    if (!c) return;

    var t        = document.createElement('div');
    t.className  = 'toast ' + (type || 'success');
    t.style.cssText = 'position:relative;overflow:hidden;display:flex;align-items:center;gap:8px;padding:10px 14px;min-width:240px;max-width:380px;';

    var msgSpan      = document.createElement('span');
    msgSpan.style.flex = '1';
    msgSpan.textContent = msg;
    t.appendChild(msgSpan);

    (actions || []).forEach(function (act) {
      var btn = document.createElement('button');
      btn.textContent = act.label;
      btn.style.cssText = [
        'background:rgba(255,255,255,0.18)', 'border:1px solid rgba(255,255,255,0.4)',
        'color:#fff', 'padding:3px 9px', 'border-radius:4px',
        'font-size:11px', 'font-weight:700', 'cursor:pointer',
        'font-family:Arial,sans-serif', 'white-space:nowrap', 'flex-shrink:0'
      ].join(';');
      btn.onclick = function () {
        clearTimeout(autoClose);
        act.fn();
        _fadeOut(t);
      };
      t.appendChild(btn);
    });

    // Progress bar
    var bar       = document.createElement('div');
    bar.style.cssText = 'position:absolute;bottom:0;left:0;height:3px;background:rgba(255,255,255,0.35);width:100%;';
    t.appendChild(bar);
    c.appendChild(t);

    // Animate bar to 0 over durationMs
    requestAnimationFrame(function () {
      bar.style.transition = 'width ' + (durationMs / 1000) + 's linear';
      bar.style.width = '0';
    });

    var autoClose = setTimeout(function () { _fadeOut(t); }, durationMs);

    // Pause countdown on hover so user can read
    t.addEventListener('mouseenter', function () {
      clearTimeout(autoClose);
      bar.style.transition = 'none';
    });
    t.addEventListener('mouseleave', function () {
      var remainPct = parseFloat(bar.style.width) || 0;
      var remainMs  = durationMs * (remainPct / 100);
      bar.style.transition = 'width ' + (remainMs / 1000) + 's linear';
      bar.style.width = '0';
      autoClose = setTimeout(function () { _fadeOut(t); }, remainMs);
    });
  }

  function _fadeOut(el) {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity    = '0';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }

  // ── Confirm Booking ──────────────────────────────────────────────
  function _patchConfirmBook() {
    var _orig = window.confirmBook;
    window.confirmBook = async function () {
      var row    = window.currentBookRow;
      var rowIdx = row ? row._idx : null;
      await _orig.apply(this, arguments);
      // Find the last success toast (added by the original) and replace it.
      _replaceLastSuccessToast('Booking confirmed', rowIdx, null, null, null, 5000);
    };
  }

  // ── Confirm Edit Booking ─────────────────────────────────────────
  function _patchConfirmEditBooking() {
    var _orig = window.confirmEditBooking;
    window.confirmEditBooking = async function () {
      var row    = window.currentEditRow;
      var rowIdx = row ? row._idx : null;
      await _orig.apply(this, arguments);
      _replaceLastSuccessToast('Booking updated', rowIdx, null, null, null, 5000);
    };
  }

  // ── Confirm Cancel ───────────────────────────────────────────────
  function _patchConfirmCancel() {
    var _orig = window.confirmCancel;
    window.confirmCancel = async function () {
      // Capture all state BEFORE the write — currentCancelRow becomes null after close.
      var row        = window.currentCancelRow;
      var rowIdx     = row ? row._idx    : null;
      var rowNum     = row ? row._rowNum : null;
      var prevStatus = row ? row.status  : null;
      var prevTrainer= row ? row.trainer : '';
      var company    = row && typeof window.getCompanyName === 'function'
                       ? window.getCompanyName(row) : (row ? (row.company || '') : '');

      await _orig.apply(this, arguments);

      _replaceLastSuccessToast(
        'Enquiry cancelled — ' + company,
        rowIdx,
        rowNum,
        prevStatus,
        prevTrainer,
        8000
      );
    };
  }

  /**
   * After the original function shows a success toast, we want to replace/enhance
   * it with our action-button version.  The original calls showToast which appends
   * to #toastContainer; we grab the most recent .toast.success and swap it.
   */
  function _replaceLastSuccessToast(msgPrefix, rowIdx, rowNum, prevStatus, prevTrainer, duration) {
    // Small delay so the original toast is already in the DOM.
    setTimeout(function () {
      var c       = document.getElementById('toastContainer');
      if (!c) return;
      var toasts  = c.querySelectorAll('.toast.success');
      var last    = toasts[toasts.length - 1];
      if (!last || !last.textContent.includes(msgPrefix.split(' ')[0])) return;
      // Remove the plain toast.
      if (last.parentNode) last.parentNode.removeChild(last);

      var actions = [];

      if (rowIdx !== null) {
        actions.push({
          label: 'Open Record →',
          fn: function () {
            if (typeof window.openProfileSidebar === 'function') {
              window.openProfileSidebar(rowIdx);
            }
          }
        });
      }

      // Undo is only offered for cancellations (we have a previous status to revert to).
      if (rowNum && prevStatus && prevStatus !== 'Cancelled') {
        actions.push({
          label: '↩ Undo',
          fn: function () { _undoCancel(rowNum, prevStatus, prevTrainer, company); }
        });
      }

      _actionToast(msgPrefix, 'success', duration, actions);
    }, 80);
  }

  /** Revert a cancellation by writing the previous status back to the sheet. */
  async function _undoCancel(rowNum, prevStatus, prevTrainer, company) {
    if (!rowNum || !window.SCRIPT_URL) return;
    try {
      var params = new URLSearchParams({
        action:  'assign',
        row:     rowNum,
        status:  prevStatus,
        trainer: prevTrainer || ''
      });
      await fetch(window.SCRIPT_URL + '?' + params.toString(), { method: 'GET', redirect: 'follow' });
      if (typeof window.showToast === 'function') {
        window.showToast('Cancellation undone — ' + company + ' restored to ' + prevStatus, 'success');
      }
      if (typeof window.loadData === 'function') window.loadData();
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Undo failed: ' + err.message, 'error');
      }
    }
  }


  // ══════════════════════════════════════════════════════════════════
  // #10  ROLE CLARITY — placeholder cards for hidden sections
  //      Shows a subtle dashed card where a widget is hidden, so
  //      users know the feature exists but isn't available for their role.
  // ══════════════════════════════════════════════════════════════════
  var SECTION_META = {
    kpiSection:                 { icon: '📊', label: 'Performance Overview',    desc: 'Revenue, KPI cards, and training-day charts' },
    unassignedSection:          { icon: '🔔', label: 'Unassigned Requests',     desc: 'New training requests awaiting a trainer' },
    actionSection:              { icon: '⚠️', label: 'Needs Action — Pending', desc: 'Pending bookings awaiting confirmation' },
    allBookingsSection:         { icon: '📋', label: 'All Bookings',            desc: 'Full list of upcoming and completed sessions' },
    referralLeaderboardSection: { icon: '🏆', label: 'Referral Leaderboard',   desc: 'Referral stats and team rankings' },
    trainerWorkloadSection:     { icon: '👤', label: 'Trainer Workload',        desc: 'Trainer availability and capacity cards' }
  };

  function patch_roleClarity() {
    var _orig = window.applyPermVisibility;
    window.applyPermVisibility = function () {
      _orig.apply(this, arguments);
      _refreshPlaceholders();
    };
  }

  function _refreshPlaceholders() {
    if (!window.currentUser) return;
    var role = window.currentUser.role || 'viewer';

    Object.keys(SECTION_META).forEach(function (id) {
      var meta    = SECTION_META[id];
      var section = document.getElementById(id);
      if (!section) return;

      var phId  = 'ux_ph_' + id;
      var ph    = document.getElementById(phId);
      var hidden = section.style.display === 'none';

      if (hidden) {
        if (!ph) {
          ph          = document.createElement('div');
          ph.id       = phId;
          ph.style.cssText = [
            'border:1.5px dashed #dfe0ec', 'border-radius:8px', 'padding:14px 20px',
            'margin-bottom:24px', 'display:flex', 'align-items:center', 'gap:14px',
            'background:#fafafa', 'opacity:0.85'
          ].join(';');
          ph.innerHTML =
            '<span style="font-size:22px;opacity:0.4;">' + meta.icon + '</span>'
            + '<div style="flex:1;">'
            + '<div style="font-size:12px;font-weight:700;color:var(--text--dark--30);">'
            + meta.label
            + '</div>'
            + '<div style="font-size:11px;color:var(--text--light--40);margin-top:2px;">'
            + meta.desc + ' — not available for the <strong>' + _esc(role) + '</strong> role.'
            + '</div>'
            + '</div>'
            + '<span style="font-size:11px;color:var(--text--dark--20);white-space:nowrap;flex-shrink:0;">'
            + 'Ask an Admin to enable'
            + '</span>';
          // Insert immediately after the hidden section so it sits in the same flow position.
          section.insertAdjacentElement('afterend', ph);
        }
      } else {
        // Section is visible — remove placeholder if present.
        if (ph) ph.remove();
      }
    });
  }


  // ══════════════════════════════════════════════════════════════════
  // Shared utilities
  // ══════════════════════════════════════════════════════════════════
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inject_styles() {
    var s = document.createElement('style');
    s.id  = 'ux-patch-styles';
    s.textContent = [
      /* Conflict card: remove excess margins on inner warning boxes */
      '.ux-conflict-card .warning-box { margin-bottom:6px !important; }',
      '.ux-conflict-card .warning-box:last-child { margin-bottom:0 !important; }',
      /* Feed banner slide-in */
      '#ux-feed-banner { animation: slideIn 0.25s ease; }',
      /* Role placeholder cards */
      '[id^="ux_ph_"] strong { font-weight:700; }',
      /* Toast buttons */
      '.toast button:hover { background:rgba(255,255,255,0.32) !important; }'
    ].join('\n');
    document.head.appendChild(s);
  }

})();
