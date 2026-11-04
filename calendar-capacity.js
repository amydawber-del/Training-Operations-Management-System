/* ═══════════════════════════════════════════════════════════════════
 * calendar-capacity.js  ·  v1.0
 *
 *  1. TRAINING CALENDAR — replaces the old month grid with three views:
 *       • Month      – decluttered: training pills per day, travel/admin/
 *                      leave collapsed into small count chips, a "who's
 *                      free" indicator, and a click-through day panel.
 *       • Team week  – one row per trainer, one column per day, so you
 *                      can see at a glance who is where.
 *       • List       – chronological agenda for the month, with search.
 *     Plus show/hide chips per event type (remembered per browser).
 *
 *  2. CAPACITY PLANNER — a day-based capacity calculator (new page).
 *     Uses trainerDay() and blockFits(), the same day rules as the
 *     calendar and Copy availability, so the numbers always agree:
 *       working days − bank holidays − leave − blocked days = available
 *       available − training − travel/admin − provisional    = free
 *     Shows bookings that could still fit, utilisation vs target, and a
 *     week-by-week heatmap. Also adds a "Next 4 weeks" line to each
 *     Trainer Workload card.
 *
 *  Loaded last in index.html. Reads the dashboard's existing globals
 *  (allData, trainers, calLeaveEvents, calGoogleEvents, calBlockedDays,
 *  provisionalDates, currentCalMonth…) and never writes to the sheet.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Small helpers ─────────────────────────────────────────────────
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const esc = s => (typeof escHtml === 'function' ? escHtml(s) : String(s || ''));
  const keyOf = d => {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); x.setHours(0, 0, 0, 0); return x; };
  const todayDate = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
  const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; };
  const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
  const isHol = d => (typeof isBankHoliday === 'function' ? isBankHoliday(d) : false);
  const holName = d => (typeof getBankHolidayName === 'function' ? getBankHolidayName(d) : null);
  const isWork = d => !isWeekend(d) && !isHol(d);
  const isFri = d => d.getDay() === 5;
  const isBookable = d => isWork(d) && !isFri(d);   // Fridays = team admin day
  const company = r => (typeof getCompanyName === 'function' ? getCompanyName(r) : (r.company || r.contact || '(Unknown)'));
  const initials = n => String(n || '?').split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const fmtShort = d => DOW_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MON_SHORT[d.getMonth()];
  const fmtLong = d => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function lsGet(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function calTrainers() {
    try { return (trainers || []).filter(u => u.role === 'trainer' || u.role === 'admin'); } catch (e) { return []; }
  }
  // Not counted as capacity (manager etc.) — list lives in index.html
  const counted = name => (typeof window.isCountedTrainer === 'function' ? window.isCountedTrainer(name) : true);
  function isShadowing(name) {
    try { return !!(typeof getTrainerMeta === 'function' && getTrainerMeta(name).shadowing); } catch (e) { return false; }
  }
  function trainerColour(name) {
    const list = calTrainers();
    const i = list.findIndex(t => t.name === name);
    const pal = (typeof TRAINER_COLORS !== 'undefined' && TRAINER_COLORS) || ['#5B4BE7'];
    if (i < 0) return '#7B80A0';
    return list[i].color || pal[i % pal.length];
  }

  // ── Event types ───────────────────────────────────────────────────
  const TYPES = {
    training:    { label: 'Training',      bg: '#5B4BE7', fg: '#fff' },
    provisional: { label: 'Provisional',   bg: '#fffbeb', fg: '#92400e' },
    travel:      { label: 'Travel & admin',bg: '#fef3c7', fg: '#92400e' },
    leave:       { label: 'Team leave',    bg: '#eef0f3', fg: '#4b5563' },
    google:      { label: 'Google Cal',    bg: '#e0f2fe', fg: '#0369a1' },
    blocked:     { label: 'Blocked',       bg: '#fee2e6', fg: '#be123c' },
    holiday:     { label: 'Bank holidays', bg: '#fef9c3', fg: '#92400e' },
  };

  const prefs = Object.assign(
    { view: 'month', types: { training: true, provisional: true, travel: true, leave: true, google: true, blocked: true, holiday: true } },
    lsGet('calxPrefs_v1', {})
  );
  prefs.types = Object.assign({ training: true, provisional: true, travel: true, leave: true, google: true, blocked: true, holiday: true }, prefs.types || {});
  const savePrefs = () => lsSet('calxPrefs_v1', prefs);
  let weekStart = mondayOf(new Date());
  let listSearch = '';

  // ── Build every event between two dates (inclusive) ───────────────
  // Returns { 'YYYY-MM-DD': [ {type, trainer, label, rowIdx, r, ...} ] }
  // Unfiltered: views apply the trainer / type filters themselves.
  function buildEvents(from, to) {
    const fromK = keyOf(from), toK = keyOf(to);
    const map = {};
    const inRange = k => k >= fromK && k <= toK;
    const add = (k, ev) => { if (!inRange(k)) return; (map[k] = map[k] || []).push(ev); };

    // Bookings → training + travel/admin (same cluster logic as before)
    (typeof allData !== 'undefined' ? allData : []).forEach(r => {
      if (r.status !== 'Booked' || !r.bookedOn) return;
      let dates = [];
      try { dates = getBookingDates(r) || []; } catch (e) { dates = []; }
      dates = dates.filter(Boolean);
      const total = dates.length || 1;
      [...dates].sort().forEach((iso, i) => add(iso, {
        type: 'training', trainer: r.trainer || '', label: company(r), rowIdx: r._idx, r,
        dayNo: i + 1, dayTotal: total,
      }));
      // Travel day (only when the type/location needs one) + admin day (always)
      let buffers = [];
      try { buffers = typeof getBufferDays === 'function' ? getBufferDays(r) : []; } catch (e) { buffers = []; }
      buffers.forEach(b => add(b.iso, {
        type: 'travel', sub: b.kind === 'travel' ? 'Travel' : 'Admin', trainer: r.trainer || '',
        label: (b.kind === 'travel' ? 'Travel – ' : 'Admin – ') + company(r), rowIdx: r._idx, r,
      }));
    });

    // Team leave (trainers and admins only, matched by name in the summary)
    const people = calTrainers();
    (typeof calLeaveEvents !== 'undefined' ? calLeaveEvents : []).forEach(ev => {
      if (!ev.start || !ev.summary) return;
      const s = ev.summary.toLowerCase();
      const who = people.find(u => s.includes(String(u.name).toLowerCase()));
      if (!who) return;
      const st = new Date(ev.start); st.setHours(0, 0, 0, 0);
      const en = ev.end ? new Date(ev.end) : addDays(st, 1); en.setHours(0, 0, 0, 0);
      for (let d = new Date(st); d < en; d.setDate(d.getDate() + 1)) add(keyOf(d), { type: 'leave', trainer: who.name, label: ev.summary });
    });

    // Provisional holds
    Object.values(typeof provisionalDates !== 'undefined' ? provisionalDates : {}).forEach(p => {
      if (!p || !p.date) return;
      add(p.date, { type: 'provisional', trainer: p.trainer || '', label: p.company || 'Provisional' });
    });

    // Google Calendar
    (typeof calGoogleEvents !== 'undefined' ? calGoogleEvents : []).forEach(ev => {
      if (!ev.start) return;
      const s = String(ev.summary || '').toLowerCase();
      const who = people.find(u => s.includes(String(u.name).toLowerCase()));
      const st = new Date(ev.start); st.setHours(0, 0, 0, 0);
      const en = ev.end ? new Date(ev.end) : addDays(st, 1); en.setHours(0, 0, 0, 0);
      if (en <= st) en.setTime(addDays(st, 1).getTime());
      for (let d = new Date(st); d < en; d.setDate(d.getDate() + 1)) add(keyOf(d), { type: 'google', trainer: who ? who.name : '', label: ev.summary || 'Event' });
    });
    return map;
  }

  // Is a given day blocked for this trainer? ('' = for the whole team)
  function blockFor(k, trainer) {
    const b = (typeof calBlockedDays !== 'undefined' ? calBlockedDays : {})[k];
    if (!b) return null;
    if (!b.scope || b.scope === 'all') return b;
    if (b.scope === 'select') {
      if (!trainer) return b;                       // team view shows partial blocks too
      return (b.trainers || []).includes(trainer) ? b : null;
    }
    return null;
  }
  const blockLabel = b => (b.fullReason || b.reason || 'Blocked') +
    (b.scope === 'select' && b.trainers && b.trainers.length ? ' (' + b.trainers.join(', ') + ')' : '');

  // ── ONE shared answer to "what is this trainer doing on this day?" ──
  // Used by the month/week calendar, Copy availability AND the Capacity
  // Planner, so all three always agree. Reads the same data: bookings,
  // provisional holds, Humaans leave, Google Calendar and blocked days.
  //   'off'      weekend or bank holiday
  //   'fri'      Friday team admin day (can host travel/admin, never training)
  //   'blocked'  blocked day (whole team, or this trainer)
  //   'leave'    Humaans leave
  //   'training' booked training
  //   'buffer'   only travel/admin for a booking (can double up as another
  //              booking's travel or admin day, never a training day)
  //   'held'     provisional hold
  //   'google'   something in their Google Calendar
  //   'free'     nothing on
  function trainerDay(name, d, evMap) {
    if (!isWork(d)) return 'off';
    if (isFri(d)) return 'fri';
    const k = keyOf(d);
    if (blockFor(k, name)) return 'blocked';
    const mine = (evMap[k] || []).filter(e => e.trainer === name);
    if (!mine.length) return 'free';
    if (mine.some(e => e.type === 'leave')) return 'leave';
    if (mine.some(e => e.type === 'training')) return 'training';
    if (mine.every(e => e.type === 'travel')) return 'buffer';
    if (mine.some(e => e.type === 'provisional')) return 'held';
    return 'google';
  }
  // Trainers counted for capacity/availability: not shadowing, not the manager
  const availPool = () => calTrainers().filter(t => !isShadowing(t.name) && counted(t.name));

  // Who is busy / free on a day, for the calendar's "x free" chips and day panel
  function dayAvailability(k, evs) {
    const date = fromKey(k);
    if (isFri(date)) return { free: [], busy: [], held: [], total: 0, friday: true };
    const pool = availPool();
    const evMap = { [k]: evs };
    const free = [], busy = [], held = [];
    pool.forEach(t => {
      const st = trainerDay(t.name, date, evMap);
      if (st === 'free') free.push(t.name);
      else if (st === 'held') held.push(t.name);
      else busy.push(t.name);
    });
    return { free, busy, held, total: pool.length };
  }

  // ── Styles ────────────────────────────────────────────────────────
  const css = `
  .calx-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
  .calx-nav{display:flex;align-items:center;gap:6px;}
  .calx-nav .cal-month-title{margin-left:6px;min-width:150px;color:#fff;}
  .calx-today{font-size:12px !important;padding:4px 10px !important;}
  .calx-seg{display:inline-flex;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:2px;}
  .calx-seg button{background:none;border:0;color:rgba(255,255,255,.7);font:600 12px 'DM Sans',sans-serif;padding:5px 12px;border-radius:6px;cursor:pointer;}
  .calx-seg button[aria-pressed="true"]{background:#fff;color:var(--s-navy);}
  .calx-seg button:focus-visible,.calx-chip:focus-visible,.calx-day:focus-visible{outline:2px solid var(--s-purple);outline-offset:2px;}
  .calx-right{display:flex;align-items:center;gap:8px;}
  .calx-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
  .calx-filters-label{font:700 10px 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.6px;color:var(--s-text-muted);margin-right:2px;}
  .calx-chip{display:inline-flex;align-items:center;gap:6px;font:600 11px 'DM Sans',sans-serif;padding:4px 10px;border-radius:100px;border:1px solid var(--s-border-mid);background:#fff;color:var(--s-text-secondary);cursor:pointer;}
  .calx-chip i{width:9px;height:9px;border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,.08);}
  .calx-chip[aria-pressed="false"]{opacity:.5;text-decoration:line-through;background:var(--s-surface);}
  .calx-hint{margin-left:auto;font:500 11px 'DM Sans',sans-serif;color:var(--s-text-muted);}

  /* Month */
  .cal-days .calx-day{min-height:108px !important;padding:5px 5px 4px !important;cursor:pointer;display:flex;flex-direction:column;gap:2px;overflow:hidden;}
  .calx-day-head{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:2px;}
  .calx-num{font:700 12px 'DM Sans',sans-serif;color:var(--s-text-secondary);min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;}
  .cal-day-today .calx-num{background:var(--s-purple);color:#fff;}
  .calx-free{font:700 9.5px 'DM Sans',sans-serif;padding:1px 6px;border-radius:100px;white-space:nowrap;}
  .calx-free.ok{background:#E8F9F3;color:#047857;}
  .calx-free.low{background:#FEF3CD;color:#92400e;}
  .calx-free.none{background:#FDEAED;color:#b91c3c;}
  .calx-free.admin{background:#E4E7FF;color:#3730a3;}
  .cal-days .calx-day.calx-fri{background:#fafaff !important;}
  .calx-week td.fri{background:#f6f7ff;}
  .calx-admincell{display:block;font:600 10.5px 'DM Sans',sans-serif;color:#4338ca;opacity:.75;padding:4px 6px;}
  .calx-pill{display:flex;align-items:center;gap:5px;font:600 10.5px/1.25 'DM Sans',sans-serif;padding:3px 6px;border-radius:5px;background:color-mix(in srgb,var(--c) 12%,#fff);color:var(--s-text-primary);border-left:3px solid var(--c);white-space:nowrap;overflow:hidden;cursor:pointer;}
  .calx-pill:hover{background:color-mix(in srgb,var(--c) 22%,#fff);}
  .calx-pill span{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;}
  .calx-pill b{font:800 9px 'DM Sans',sans-serif;color:#fff;background:var(--c);border-radius:4px;padding:1px 4px;flex-shrink:0;}
  .calx-pill.prov{background:#fffbeb;border:1px dashed #f59e0b;border-left:3px dashed #f59e0b;color:#92400e;}
  .calx-pill.block{background:#fee2e6;border-left-color:#e11d48;color:#9f1239;}
  .calx-sumrow{display:flex;flex-wrap:wrap;gap:3px;margin-top:auto;padding-top:2px;}
  .calx-sum{font:700 9.5px 'DM Sans',sans-serif;padding:1px 5px;border-radius:4px;white-space:nowrap;}
  .calx-more{font:700 10px 'DM Sans',sans-serif;color:var(--s-purple);padding:1px 2px;}
  .calx-bh{font:700 9.5px 'DM Sans',sans-serif;color:#92400e;background:#fef9c3;border-radius:4px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cal-day-past.calx-day{opacity:.6;}

  /* Team week */
  .calx-week{overflow-x:auto;}
  .calx-week table{border-collapse:separate;border-spacing:0;width:100%;min-width:720px;font-family:'DM Sans',sans-serif;}
  .calx-week th{position:sticky;top:0;background:var(--s-surface);font:700 11px 'DM Sans',sans-serif;color:var(--s-text-secondary);padding:8px 6px;border-bottom:1px solid var(--s-border);text-align:left;}
  .calx-week th.today{color:var(--s-purple);}
  .calx-week th small{display:block;font-weight:600;color:var(--s-text-muted);font-size:10px;}
  .calx-week td{vertical-align:top;border-bottom:1px solid var(--s-border);border-left:1px solid var(--s-border);padding:4px;height:58px;width:17%;}
  .calx-week td.who{position:sticky;left:0;background:#fff;border-left:0;width:150px;min-width:130px;font:700 12px 'DM Sans',sans-serif;color:var(--s-text-primary);padding:8px 10px;}
  .calx-week td.who i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle;}
  .calx-week td.who small{display:block;font-weight:600;color:var(--s-text-muted);font-size:10px;margin-top:2px;}
  .calx-week td.off{background:repeating-linear-gradient(-45deg,#fafafb,#fafafb 6px,#f3f4f7 6px,#f3f4f7 7px);}
  .calx-week td.todaycol{background:#f7f6ff;}
  .calx-blk{display:block;font:600 11px/1.3 'DM Sans',sans-serif;padding:4px 7px;border-radius:6px;margin-bottom:3px;cursor:default;}
  .calx-blk.click{cursor:pointer;}
  .calx-blk small{display:block;font-weight:600;font-size:10px;opacity:.75;}
  .calx-freecell{display:block;font:600 10.5px 'DM Sans',sans-serif;color:#047857;opacity:.7;padding:4px 6px;}
  .calx-teamrow td{background:var(--s-surface);height:auto;}

  /* List */
  .calx-list{padding:6px 14px 14px;}
  .calx-list-top{display:flex;gap:8px;align-items:center;padding:8px 0 4px;}
  .calx-list-top input{flex:1;max-width:320px;border:1px solid var(--s-border-mid);border-radius:6px;padding:7px 10px;font:13px 'DM Sans',sans-serif;}
  .calx-list-day{margin-top:12px;}
  .calx-list-date{font:700 12px 'DM Sans',sans-serif;color:var(--s-text-primary);padding:4px 0;border-bottom:1px solid var(--s-border);display:flex;justify-content:space-between;}
  .calx-list-date.today{color:var(--s-purple);}
  .calx-list-item{display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid #f3f4f6;font:13px 'DM Sans',sans-serif;}
  .calx-list-item.click{cursor:pointer;}
  .calx-list-item.click:hover{background:var(--s-surface);}
  .calx-list-item .bar{width:4px;align-self:stretch;border-radius:2px;flex-shrink:0;}
  .calx-list-item .calx-main{flex:1;min-width:0;}
  .calx-list-item .calx-main strong{font-weight:650;color:var(--s-text-primary);}
  .calx-list-item .calx-main div{font-size:11px;color:var(--s-text-muted);}
  .calx-empty{padding:30px;text-align:center;color:var(--s-text-muted);font:13px 'DM Sans',sans-serif;}

  /* Upcoming card groups */
  .calx-up-group{font:700 10px 'DM Sans',sans-serif;text-transform:uppercase;letter-spacing:.6px;color:var(--s-text-muted);padding:10px 14px 4px;background:#fff;position:sticky;top:0;}
  .cal-upcoming-item.click{cursor:pointer;}
  .cal-upcoming-item.click:hover{background:var(--s-surface);}

  /* Day panel */
  .calx-overlay{position:fixed;inset:0;z-index:4800;background:rgba(18,21,42,.5);display:none;align-items:center;justify-content:center;padding:16px;}
  .calx-overlay.open{display:flex;}
  .calx-panel{background:#fff;border-radius:14px;width:520px;max-width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:var(--s-shadow-lg);overflow:hidden;font-family:'DM Sans',sans-serif;}
  .calx-panel-head{background:var(--s-navy);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}
  .calx-panel-head h3{margin:0;font-size:15px;font-weight:700;}
  .calx-panel-head div div{font-size:12px;color:rgba(255,255,255,.65);margin-top:3px;}
  .calx-x{background:rgba(255,255,255,.1);border:0;color:#fff;border-radius:6px;padding:4px 9px;cursor:pointer;font-size:14px;}
  .calx-panel-body{padding:14px 18px;overflow-y:auto;}
  .calx-sec{margin-bottom:14px;}
  .calx-sec h4{margin:0 0 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--s-text-muted);}
  .calx-namechips{display:flex;flex-wrap:wrap;gap:5px;}
  .calx-toprow{display:grid;grid-template-columns:1.7fr 1fr;gap:20px;margin-bottom:4px;align-items:start;}
  @media (max-width:560px){.calx-toprow{grid-template-columns:1fr;}}
  .calx-freeitem{padding:8px 0;border-bottom:1px solid #f3f4f6;}
  .calx-freeitem:first-of-type{padding-top:2px;}
  .calx-freeitem:last-of-type{border-bottom:0;}
  .calx-freeitem .nm{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:100px;background:#E8F9F3;color:#047857;margin-bottom:5px;}
  .calx-freeitem.no .nm{background:#f3f4f6;color:#6b7280;}
  .calx-freeitem .what{font-size:12.5px;line-height:1.4;color:var(--s-text-primary);padding-left:2px;}
  .calx-freeitem .what small{display:block;font-size:11.5px;color:var(--s-text-muted);margin-top:2px;}
  .calx-notice{font-size:11px;color:#92400e;background:#FEF3CD;border-radius:6px;padding:5px 8px;margin-top:6px;}
  .calx-namechips span{font-size:11px;font-weight:600;padding:3px 9px;border-radius:100px;}
  .calx-panel-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--s-border);background:var(--s-surface);}

  /* Copy availability */
  .calx-avail-warn{background:#FEF3CD;border:1px solid #FDE68A;color:#92400e;border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.5;margin-bottom:12px;}
  .calx-avail-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;}
  .calx-avail-controls label{display:flex;flex-direction:column;gap:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--s-text-muted);}
  .calx-avail-controls label.chk{flex-direction:row;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:12.5px;font-weight:500;color:var(--s-text-secondary);}
  .calx-avail-controls select{border:1.5px solid var(--s-border-mid);border-radius:6px;padding:6px 9px;font:13px 'DM Sans',sans-serif;}
  .calx-avail-confirm{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;font-weight:600;color:var(--s-text-primary);cursor:pointer;}
  #calxAvailCopyBtn:disabled{opacity:.45;cursor:not-allowed;}
  .calx-avail-tabs{display:inline-flex;background:var(--s-surface);border:1px solid var(--s-border);border-radius:8px;padding:3px;margin-bottom:12px;}
  .calx-avail-tabs.sm{margin-bottom:0;}
  .calx-avail-tabs button{background:none;border:0;font:600 12.5px 'DM Sans',sans-serif;color:var(--s-text-secondary);padding:6px 12px;border-radius:6px;cursor:pointer;}
  .calx-avail-tabs button[aria-pressed="true"]{background:#fff;color:var(--s-purple);box-shadow:var(--s-shadow-sm);}
  .calx-custom{border:1px solid var(--s-border);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;flex-direction:column;gap:12px;}
  .calx-custom-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:var(--s-text-secondary);}
  .calx-custom-row .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--s-text-muted);min-width:150px;}
  .calx-custom-row input[type=number],.calx-custom-row select{border:1.5px solid var(--s-border-mid);border-radius:6px;padding:6px 9px;font:13px 'DM Sans',sans-serif;}
  .calx-custom-row .chk{display:flex;align-items:center;gap:6px;}
  .calx-split{font:600 12px 'DM Sans',sans-serif;padding:5px 11px;border-radius:100px;border:1.5px solid var(--s-border-mid);background:#fff;color:var(--s-text-secondary);cursor:pointer;}
  .calx-split.on{border-color:var(--s-purple);background:var(--s-lavender);color:var(--s-purple);}
  .calx-opts{display:flex;flex-direction:column;gap:6px;}
  .calx-opt{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;font-size:13px;}
  .calx-opt .n{font-weight:700;color:#047857;min-width:62px;}
  .calx-opt .d{flex:1;color:var(--s-text-primary);font-weight:600;}
  .calx-opt .w{font-size:11px;color:var(--s-text-muted);}
  /* Capacity planner */
  #page-capacity .cap-wrap{max-width:1180px;margin:0 auto;font-family:'DM Sans',sans-serif;}
  #page-capacity .cap-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
  #page-capacity .cap-head p{margin:4px 0 0;color:var(--s-text-muted);font-size:13px;max-width:640px;}
  #page-capacity .cap-card{background:#fff;border:1px solid var(--s-border);border-radius:var(--s-r-md);box-shadow:var(--s-shadow-sm);padding:16px 18px;margin-bottom:16px;}
  #page-capacity .cap-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px 16px;align-items:end;}
  #page-capacity label.cap-l{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--s-text-muted);margin-bottom:5px;}
  #page-capacity select,#page-capacity input[type=date],#page-capacity input[type=number]{width:100%;border:1.5px solid var(--s-border-mid);border-radius:6px;padding:8px 10px;font:13px 'DM Sans',sans-serif;color:var(--s-text-primary);background:#fff;}
  #page-capacity .cap-check{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--s-text-secondary);cursor:pointer;}
  #page-capacity .cap-trainers{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--s-border);}
  #page-capacity .cap-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;}
  #page-capacity .cap-kpi{background:#fff;border:1px solid var(--s-border);border-radius:var(--s-r-md);padding:14px 16px;box-shadow:var(--s-shadow-sm);}
  #page-capacity .cap-kpi .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--s-text-muted);}
  #page-capacity .cap-kpi .val{font-size:26px;font-weight:700;color:var(--s-text-primary);margin-top:4px;line-height:1.1;}
  #page-capacity .cap-kpi .sub{font-size:11.5px;color:var(--s-text-muted);margin-top:4px;}
  #page-capacity table.cap-t{width:100%;border-collapse:collapse;font-size:12.5px;}
  #page-capacity .cap-t th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--s-text-muted);padding:8px;border-bottom:1px solid var(--s-border);white-space:nowrap;}
  #page-capacity .cap-t td{padding:9px 8px;border-bottom:1px solid #f1f2f6;color:var(--s-text-secondary);white-space:nowrap;}
  #page-capacity .cap-t td.num{text-align:right;font-variant-numeric:tabular-nums;}
  #page-capacity .cap-t th.num{text-align:right;}
  #page-capacity .cap-t td.name{font-weight:700;color:var(--s-text-primary);}
  #page-capacity .cap-t td.name i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;}
  #page-capacity .cap-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#eef0f4;min-width:160px;}
  #page-capacity .cap-bar span{display:block;height:100%;}
  #page-capacity .cap-badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;}
  #page-capacity .cap-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--s-text-muted);margin-top:10px;}
  #page-capacity .cap-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px;}
  #page-capacity .cap-heat{overflow-x:auto;}
  #page-capacity .cap-heat td.cell{text-align:center;font-weight:700;font-size:11.5px;border-left:2px solid #fff;}
  #page-capacity .cap-heat td.cell span{color:inherit;}
  #page-capacity .cap-note{font-size:12px;color:var(--s-text-muted);background:var(--s-surface);border:1px solid var(--s-border);border-radius:8px;padding:10px 12px;margin-top:12px;line-height:1.5;}
  #page-capacity .cap-warn{font-size:12px;color:#92400e;background:#FEF3CD;border:1px solid #FDE68A;border-radius:8px;padding:9px 12px;margin-bottom:14px;}
  #page-capacity .cap-btn{font:600 12px 'DM Sans',sans-serif;border-radius:6px;padding:9px 14px;cursor:pointer;border:1px solid var(--s-border-mid);background:#fff;color:var(--s-text-secondary);}
  #page-capacity .cap-btn.primary{background:var(--s-purple);color:#fff;border-color:var(--s-purple);}
  .calx-cardcap{margin-top:8px;padding-top:8px;border-top:1px dashed var(--s-border);font-size:11px;color:var(--s-text-muted);cursor:pointer;}
  .calx-cardcap .b{height:5px;border-radius:3px;background:#eef0f4;overflow:hidden;margin-top:4px;}
  .calx-cardcap .b span{display:block;height:100%;}
  @media (max-width:700px){ .cal-days .calx-day{min-height:76px !important;} .calx-pill span{display:none;} .calx-free{display:none;} }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'calx-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ═════════════════════════════════════════════════════════════════
  // 1. CALENDAR
  // ═════════════════════════════════════════════════════════════════
  function trainerFilterVal() { const el = document.getElementById('calFilterTrainer'); return el ? el.value : ''; }
  function matchesTrainer(ev, tf) { return !tf || !ev.trainer || ev.trainer === tf; }
  function visible(ev) { return !!prefs.types[ev.type]; }

  function renderFilterChips() {
    const row = document.getElementById('calTypeFilters');
    if (!row) return;
    const order = ['training', 'provisional', 'travel', 'leave', 'holiday', 'google', 'blocked'];
    row.innerHTML = '<span class="calx-filters-label">Show</span>' + order.map(t => {
      const T = TYPES[t];
      const dot = t === 'provisional' ? 'background:#fffbeb;border:1px dashed #f59e0b' : 'background:' + T.bg;
      return `<button type="button" class="calx-chip" aria-pressed="${prefs.types[t] ? 'true' : 'false'}" onclick="calxToggleType('${t}')"><i style="${dot}"></i>${T.label}</button>`;
    }).join('') + '<span class="calx-hint">Click a day for the full picture</span>';
  }
  window.calxToggleType = function (t) { prefs.types[t] = !prefs.types[t]; savePrefs(); renderCalendarX(); };

  function syncViewButtons() {
    document.querySelectorAll('#calViewSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === prefs.view ? 'true' : 'false'));
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    show('calMonthWrap', prefs.view === 'month');
    show('calWeekWrap', prefs.view === 'week');
    show('calListWrap', prefs.view === 'list');
  }

  window.calSetView = function (v) {
    if (v === 'week' && prefs.view !== 'week') {
      const t = todayDate();
      const m = currentCalMonth;
      weekStart = (t.getFullYear() === m.getFullYear() && t.getMonth() === m.getMonth()) ? mondayOf(t) : mondayOf(new Date(m.getFullYear(), m.getMonth(), 1));
    }
    prefs.view = v; savePrefs(); renderCalendarX();
  };

  window.calChangeMonth = function (dir) {
    if (prefs.view === 'week') {
      weekStart = addDays(weekStart, 7 * dir);
      currentCalMonth = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
    } else {
      currentCalMonth = new Date(currentCalMonth.getFullYear(), currentCalMonth.getMonth() + dir, 1);
    }
    renderCalendarX();
  };
  window.calGoToday = function () {
    const t = todayDate();
    currentCalMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    weekStart = mondayOf(t);
    renderCalendarX();
  };

  function renderCalendarX() {
    if (!document.getElementById('calDays')) return;
    renderFilterChips();
    syncViewButtons();
    const title = document.getElementById('calMonthTitle');
    if (prefs.view === 'week') {
      const end = addDays(weekStart, 4);
      if (title) title.textContent = 'w/c ' + weekStart.getDate() + ' ' + MON_SHORT[weekStart.getMonth()] + ' ' + weekStart.getFullYear();
      renderWeek(weekStart);
      void end;
    } else {
      if (title) title.textContent = MONTHS[currentCalMonth.getMonth()] + ' ' + currentCalMonth.getFullYear();
      if (prefs.view === 'list') renderList(); else renderMonth();
    }
    renderUpcoming();
  }

  // ── Month ─────────────────────────────────────────────────────────
  function renderMonth() {
    const y = currentCalMonth.getFullYear(), m = currentCalMonth.getMonth();
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const startDow = (first.getDay() + 6) % 7;
    const evMap = buildEvents(first, last);
    const tf = trainerFilterVal();
    const today = todayDate();
    let html = '';
    for (let i = 0; i < startDow; i++) html += '<div class="cal-day cal-day-empty"></div>';
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(y, m, d), k = keyOf(date);
      const all = evMap[k] || [];
      const evs = all.filter(e => matchesTrainer(e, tf) && visible(e));
      const block = prefs.types.blocked ? blockFor(k, tf) : null;
      const hol = isHol(date) ? holName(date) : null;
      let cls = 'cal-day calx-day';
      if (isWeekend(date)) cls += ' cal-day-weekend';
      if (isWork(date) && isFri(date)) cls += ' calx-fri';
      if (date.getTime() === today.getTime()) cls += ' cal-day-today';
      if (date < today) cls += ' cal-day-past';
      if (hol) cls += ' cal-day-holiday';
      if (blockFor(k, tf)) cls += ' cal-day-blocked';

      // Free indicator (future working days only)
      let freeHtml = '';
      if (isWork(date) && isFri(date)) {
        freeHtml = '<span class="calx-free admin" title="Fridays are admin days for the whole team">Admin day</span>';
      } else if (date >= today && isBookable(date)) {
        const a = dayAvailability(k, all);
        if (tf) {
          const f = a.free.includes(tf), h = a.held.includes(tf);
          freeHtml = f ? '<span class="calx-free ok">Free</span>' : h ? '<span class="calx-free low">On hold</span>' : (a.busy.includes(tf) ? '<span class="calx-free none">Busy</span>' : '');
        } else if (a.total) {
          const n = a.free.length;
          const c = n === 0 ? 'none' : (n === 1 ? 'low' : 'ok');
          freeHtml = `<span class="calx-free ${c}" title="Free: ${esc(a.free.join(', ') || 'nobody')}">${n === 0 ? 'Fully booked' : n + ' free'}</span>`;
        }
      }

      const pills = [];
      evs.filter(e => e.type === 'training').forEach(e => {
        const c = trainerColour(e.trainer);
        const dayTxt = e.dayTotal > 1 ? ' · day ' + e.dayNo + '/' + e.dayTotal : '';
        pills.push(`<div class="calx-pill" style="--c:${c}" onclick="event.stopPropagation();openCalEventModal(${e.rowIdx})" title="${esc(e.label + ' · ' + (e.trainer || 'TBC') + dayTxt)}"><span>${esc(e.label)}</span><b>${esc(initials(e.trainer))}</b></div>`);
      });
      evs.filter(e => e.type === 'provisional').forEach(e => {
        pills.push(`<div class="calx-pill prov" title="${esc('Provisional: ' + e.label + ' (' + (e.trainer || 'TBC') + ')')}"><span>${esc(e.label)}</span><b style="background:#f59e0b">${esc(initials(e.trainer))}</b></div>`);
      });
      const MAX = 3;
      let body = '';
      if (hol && prefs.types.holiday) body += `<div class="calx-bh" title="${esc(hol)}">🏛 ${esc(hol)}</div>`;
      if (block) body += `<div class="calx-pill block" style="--c:#e11d48" title="${esc(blockLabel(block))}"><span>🔒 ${esc(blockLabel(block))}</span></div>`;
      body += pills.slice(0, MAX).join('');
      const hidden = pills.length - MAX;

      // Summary chips for the noisy types
      const sum = [];
      const cnt = t => evs.filter(e => e.type === t);
      const tr = cnt('travel'), lv = cnt('leave'), gg = cnt('google');
      const names = arr => esc([...new Set(arr.map(e => (e.sub ? e.sub + ': ' : '') + (e.trainer || e.label)))].join(', '));
      if (tr.length) sum.push(`<span class="calx-sum" style="background:${TYPES.travel.bg};color:${TYPES.travel.fg}" title="${names(tr)}">✈ ${tr.length}</span>`);
      if (lv.length) sum.push(`<span class="calx-sum" style="background:${TYPES.leave.bg};color:${TYPES.leave.fg}" title="On leave: ${esc([...new Set(lv.map(e => e.trainer))].join(', '))}">🌴 ${new Set(lv.map(e => e.trainer)).size}</span>`);
      if (gg.length) sum.push(`<span class="calx-sum" style="background:${TYPES.google.bg};color:${TYPES.google.fg}" title="${esc(gg.map(e => e.label).join(' · '))}">🗓 ${gg.length}</span>`);
      if (hidden > 0) sum.push(`<span class="calx-more">+${hidden} more</span>`);

      html += `<div class="${cls}" tabindex="0" role="button" aria-label="${esc(fmtLong(date))}" onclick="calxOpenDay('${k}')" onkeydown="if(event.key==='Enter'){calxOpenDay('${k}')}">
        <div class="calx-day-head"><span class="calx-num">${d}</span>${freeHtml}</div>
        ${body}
        ${sum.length ? '<div class="calx-sumrow">' + sum.join('') + '</div>' : ''}
      </div>`;
    }
    const trailing = (7 - ((startDow + last.getDate()) % 7)) % 7;
    for (let i = 0; i < trailing; i++) html += '<div class="cal-day cal-day-empty"></div>';
    document.getElementById('calDays').innerHTML = html;
  }

  // ── Team week ─────────────────────────────────────────────────────
  function renderWeek(start) {
    const wrap = document.getElementById('calWeekWrap');
    if (!wrap) return;
    const end = addDays(start, 6);
    const evMap = buildEvents(start, end);
    const tf = trainerFilterVal();
    const today = todayDate();
    // Mon–Fri always; Sat/Sun only if something is on
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (i < 5 || (evMap[keyOf(d)] || []).some(e => e.type === 'training' || e.type === 'provisional')) days.push(d);
    }
    let people = calTrainers();
    if (tf) people = people.filter(t => t.name === tf);
    else people = people.filter(t => counted(t.name) || days.some(d => (evMap[keyOf(d)] || []).some(e => e.trainer === t.name && e.type === 'training')));
    if (!people.length) { wrap.innerHTML = '<div class="calx-empty">No trainers to show.</div>'; return; }

    let h = '<div class="calx-week"><table><thead><tr><th>Trainer</th>';
    days.forEach(d => { h += `<th class="${d.getTime() === today.getTime() ? 'today' : ''}">${DOW_SHORT[d.getDay()]} ${d.getDate()}<small>${MON_SHORT[d.getMonth()]}${d.getTime() === today.getTime() ? ' · Today' : ''}${isFri(d) && isWork(d) ? ' · Admin day' : ''}</small></th>`; });
    h += '</tr></thead><tbody>';

    // Team-wide row: bank holidays, whole-team blocks, unmatched Google events
    let teamHas = false;
    let teamRow = '<tr class="calx-teamrow"><td class="who">Whole team</td>';
    days.forEach(d => {
      const k = keyOf(d); let c = '';
      const hol = isHol(d) ? holName(d) : null;
      if (hol && prefs.types.holiday) c += `<span class="calx-blk" style="background:#fef9c3;color:#92400e">🏛 ${esc(hol)}</span>`;
      const b = blockFor(k, '');
      if (b && prefs.types.blocked && (!b.scope || b.scope === 'all')) c += `<span class="calx-blk" style="background:#fee2e6;color:#9f1239">🔒 ${esc(blockLabel(b))}</span>`;
      if (prefs.types.google) (evMap[k] || []).filter(e => e.type === 'google' && !e.trainer).forEach(e => { c += `<span class="calx-blk" style="background:#e0f2fe;color:#0369a1">🗓 ${esc(e.label)}</span>`; });
      if (c) teamHas = true;
      teamRow += `<td>${c}</td>`;
    });
    teamRow += '</tr>';
    if (teamHas) h += teamRow;

    people.forEach(t => {
      const colour = trainerColour(t.name);
      const shadow = isShadowing(t.name);
      let rowBooked = 0;
      let cells = '';
      days.forEach(d => {
        const k = keyOf(d);
        const mine = (evMap[k] || []).filter(e => e.trainer === t.name && visible(e));
        const b = blockFor(k, t.name);
        const off = !isWork(d);
        let c = '';
        if (b && prefs.types.blocked) c += `<span class="calx-blk" style="background:#fee2e6;color:#9f1239">🔒 ${esc(b.reason || 'Blocked')}</span>`;
        const _tr = mine.filter(e => e.type === 'travel' && e.sub === 'Travel'), _ad = mine.filter(e => e.type === 'travel' && e.sub === 'Admin');
        if (_tr.length && _ad.length) {
          c += `<span class="calx-blk click" style="background:#fef3c7;color:#92400e" onclick="openCalEventModal(${_tr[0].rowIdx})">📝 Admin + ✈ Travel<small>${esc(company(_ad[0].r))} → ${esc(company(_tr[0].r))}</small></span>`;
        }
        mine.forEach(e => {
          if (e.type === 'travel' && _tr.length && _ad.length) return;   // shown as one combined block above
          if (e.type === 'training') {
            rowBooked++;
            c += `<span class="calx-blk click" style="background:color-mix(in srgb,${colour} 14%,#fff);border-left:3px solid ${colour};color:var(--s-text-primary)" onclick="openCalEventModal(${e.rowIdx})">${esc(e.label)}<small>${e.dayTotal > 1 ? 'Day ' + e.dayNo + ' of ' + e.dayTotal : 'Training'}${e.r && e.r.trainingOption ? ' · ' + esc(e.r.trainingOption) : ''}</small></span>`;
          } else if (e.type === 'travel') {
            c += `<span class="calx-blk click" style="background:#fef3c7;color:#92400e" onclick="openCalEventModal(${e.rowIdx})">${e.sub === 'Travel' ? '✈ Travel' : '📝 Admin'}<small>${esc(company(e.r))}</small></span>`;
          } else if (e.type === 'leave') {
            c += `<span class="calx-blk" style="background:#eef0f3;color:#4b5563">🌴 On leave</span>`;
          } else if (e.type === 'provisional') {
            c += `<span class="calx-blk" style="background:#fffbeb;border:1px dashed #f59e0b;color:#92400e">Provisional<small>${esc(e.label)}</small></span>`;
          } else if (e.type === 'google') {
            c += `<span class="calx-blk" style="background:#e0f2fe;color:#0369a1">🗓 ${esc(e.label)}</span>`;
          }
        });
        if (!c && !off && isFri(d)) c = '<span class="calx-admincell">Admin day</span>';
        else if (!c && !off && d >= today && !shadow && counted(t.name)) c = '<span class="calx-freecell">Free</span>';
        const tdCls = (off ? 'off ' : (isFri(d) ? 'fri ' : '')) + (d.getTime() === today.getTime() ? 'todaycol' : '');
        cells += `<td class="${tdCls}">${c}</td>`;
      });
      h += `<tr><td class="who"><i style="background:${colour}"></i>${esc(t.name)}<small>${shadow ? 'Shadowing' : rowBooked + ' training day' + (rowBooked === 1 ? '' : 's') + ' this week'}</small></td>${cells}</tr>`;
    });
    h += '</tbody></table></div>';
    wrap.innerHTML = h;
  }

  // ── List ──────────────────────────────────────────────────────────
  function renderList() {
    const wrap = document.getElementById('calListWrap');
    if (!wrap) return;
    const y = currentCalMonth.getFullYear(), m = currentCalMonth.getMonth();
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const evMap = buildEvents(first, last);
    const tf = trainerFilterVal();
    const q = listSearch.trim().toLowerCase();
    const today = todayDate();
    let out = '';
    let count = 0;
    for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
      const k = keyOf(d);
      const items = [];
      const hol = isHol(d) ? holName(d) : null;
      if (hol && prefs.types.holiday) items.push({ colour: '#fde047', html: `<strong>🏛 ${esc(hol)}</strong><div>Bank holiday</div>` , text: hol});
      const b = blockFor(k, tf);
      if (b && prefs.types.blocked) items.push({ colour: '#e11d48', html: `<strong>🔒 ${esc(blockLabel(b))}</strong><div>Blocked by ${esc(b.blockedBy || 'Admin')}</div>`, text: blockLabel(b) });
      const dayEvs = (evMap[k] || []).filter(e => matchesTrainer(e, tf) && visible(e));
      dayEvs.filter(e => e.type === 'training').forEach(e => {
        const r = e.r || {};
        items.push({ colour: trainerColour(e.trainer), click: e.rowIdx, text: e.label + ' ' + e.trainer,
          html: `<strong>${esc(e.label)}</strong><div>${esc(e.trainer || 'TBC')}${e.dayTotal > 1 ? ' · Day ' + e.dayNo + ' of ' + e.dayTotal : ''}${r.trainingOption ? ' · ' + esc(r.trainingOption) : ''}</div>` });
      });
      dayEvs.filter(e => e.type === 'provisional').forEach(e => {
        items.push({ colour: '#f59e0b', text: e.label + ' ' + e.trainer, html: `<strong>Provisional: ${esc(e.label)}</strong><div>${esc(e.trainer || 'TBC')}</div>` });
      });
      // Travel/admin and leave are rolled up into one line each, to keep the list scannable
      const trav = dayEvs.filter(e => e.type === 'travel');
      if (trav.length) {
        const part = sub => { const n = trav.filter(e => e.sub === sub).map(e => e.trainer); return n.length ? (sub === 'Travel' ? '✈ Travel: ' : '📝 Admin: ') + esc(n.join(', ')) : ''; };
        items.push({ colour: '#fbbf24', text: trav.map(e => e.label + ' ' + e.trainer).join(' '), minor: true,
          html: `<div style="color:#92400e;font-size:12px;font-weight:600">${[part('Travel'), part('Admin')].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>` });
      }
      const lv = [...new Set(dayEvs.filter(e => e.type === 'leave').map(e => e.trainer))];
      if (lv.length) items.push({ colour: '#9ca3af', text: lv.join(' ') + ' leave', minor: true, html: `<div style="color:#4b5563;font-size:12px;font-weight:600">🌴 On leave: ${esc(lv.join(', '))}</div>` });
      dayEvs.filter(e => e.type === 'google').forEach(e => {
        items.push({ colour: '#38bdf8', text: e.label, html: `<strong>🗓 ${esc(e.label)}</strong><div>Google Calendar</div>` });
      });
      const shown = q ? items.filter(i => String(i.text || '').toLowerCase().includes(q)) : items;
      if (!shown.length) continue;
      const major = shown.filter(i => !i.minor).length;
      count += major;
      const isT = d.getTime() === today.getTime();
      out += `<div class="calx-list-day"><div class="calx-list-date ${isT ? 'today' : ''}"><span>${fmtShort(d)}${isT ? ' · Today' : ''}</span><span style="font-weight:600;color:var(--s-text-muted);font-size:11px">${major} session${major === 1 ? '' : 's'}</span></div>` +
        shown.map(i => `<div class="calx-list-item ${i.click !== undefined ? 'click' : ''}" ${i.click !== undefined ? `onclick="openCalEventModal(${i.click})"` : ''}><span class="bar" style="background:${i.colour}"></span><div class="calx-main">${i.html}</div></div>`).join('') + '</div>';
    }
    const top = `<div class="calx-list-top"><input type="search" id="calxListSearch" placeholder="Search company or trainer…" value="${esc(listSearch)}" oninput="calxListSearch(this.value)"><span style="font-size:12px;color:var(--s-text-muted)">${count} session${count === 1 ? '' : 's'} &amp; holds in ${MONTHS[m]}</span></div>`;
    wrap.innerHTML = '<div class="calx-list">' + top + (out || '<div class="calx-empty">Nothing matches for this month.</div>') + '</div>';
  }
  window.calxListSearch = function (v) {
    listSearch = v; renderList();
    const el = document.getElementById('calxListSearch');
    if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
  };

  // ── Upcoming sessions card ────────────────────────────────────────
  function renderUpcoming() {
    const body = document.getElementById('calUpcomingBody');
    const countEl = document.getElementById('calUpcomingCount');
    if (!body) return;
    const tf = trainerFilterVal();
    const today = todayDate();
    const thisWk = mondayOf(today), nextWk = addDays(thisWk, 7), after = addDays(thisWk, 14);
    const up = (typeof allData !== 'undefined' ? allData : [])
      .filter(r => r.status === 'Booked' && r.bookedOn && r.bookedOn >= today && (!tf || r.trainer === tf))
      .sort((a, b) => a.bookedOn - b.bookedOn);
    if (countEl) countEl.textContent = up.length + ' booked';
    if (!up.length) { body.innerHTML = '<div class="cal-upcoming-empty">No upcoming booked sessions</div>'; return; }
    const groups = [['This week', r => r.bookedOn < nextWk], ['Next week', r => r.bookedOn >= nextWk && r.bookedOn < after], ['Later', r => r.bookedOn >= after]];
    let html = '';
    let shown = 0;
    groups.forEach(([label, test]) => {
      const rows = up.filter(test).slice(0, Math.max(0, 15 - shown));
      if (!rows.length) return;
      shown += rows.length;
      html += `<div class="calx-up-group">${label}</div>` + rows.map(r => {
        const d = r.bookedOn, c = trainerColour(r.trainer);
        return `<div class="cal-upcoming-item click" onclick="openCalEventModal(${r._idx})">
          <div class="cal-upcoming-date"><div class="cal-upcoming-date-day">${d.getDate()}</div><div class="cal-upcoming-date-mon">${MON_SHORT[d.getMonth()]}</div></div>
          <div class="cal-upcoming-body-text"><div class="cal-upcoming-company">${esc(company(r))}</div>
          <div class="cal-upcoming-meta" style="display:flex;align-items:center;gap:6px;"><span class="trainer-pill" style="background:${c}22;color:${c};font-size:10px;padding:1px 6px;">${esc(r.trainer || 'TBC')}</span>${r.trainingDays || 1} day${(r.trainingDays || 1) !== 1 ? 's' : ''}</div></div></div>`;
      }).join('');
    });
    if (up.length > shown) html += `<div class="cal-upcoming-empty" style="padding:12px">+${up.length - shown} more · switch to List view to see everything</div>`;
    body.innerHTML = html;
  }

  // ── Day panel ─────────────────────────────────────────────────────
  function ensureOverlay() {
    let o = document.getElementById('calxDayOverlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'calxDayOverlay';
    o.className = 'calx-overlay';
    o.innerHTML = '<div class="calx-panel" role="dialog" aria-modal="true" aria-labelledby="calxDayTitle"><div class="calx-panel-head"><div><h3 id="calxDayTitle"></h3><div id="calxDaySub"></div></div><button class="calx-x" onclick="calxCloseDay()" aria-label="Close">✕</button></div><div class="calx-panel-body" id="calxDayBody"></div><div class="calx-panel-foot" id="calxDayFoot"></div></div>';
    o.addEventListener('click', e => { if (e.target === o) window.calxCloseDay(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && o.classList.contains('open')) window.calxCloseDay(); });
    document.body.appendChild(o);
    return o;
  }
  window.calxCloseDay = function () { const o = document.getElementById('calxDayOverlay'); if (o) o.classList.remove('open'); };
  // What can a free trainer actually take on, starting on this day?
  // Same rules as Copy availability (blockFits): back-to-back Mon–Thu,
  // admin day after, travel day before when we go to the client.
  function freeFor(name, date, evMap) {
    const far = addDays(date, 21);
    let hq = 0, away = 0;
    for (let L = 1; L <= maxBlock(false); L++) { if (blockFits(name, date, L, false, evMap, new Map(), far)) hq = L; else break; }
    for (let L = 1; L <= maxBlock(true); L++) { if (blockFits(name, date, L, true, evMap, new Map(), far)) away = L; else break; }
    return { hq, away };
  }
  const daysTxt = n => n === 1 ? '1 day' : '1–' + n + ' days';
  function freeForHtml(name, date, evMap) {
    const f = freeFor(name, date, evMap);
    let what, why = '', ok = true;
    if (!f.hq && !f.away) {
      ok = false;
      what = 'Free, but can’t take a booking starting today';
      why = 'No free day after for the admin day';
    } else if (f.hq && !f.away) {
      what = `<strong>Street HQ training only</strong> · ${daysTxt(f.hq)} (client comes to us)`;
      why = date.getDay() === 1 ? 'Monday is the travel day, so we can’t go to the client' : 'No free day before for travel, so we can’t go to the client';
    } else if (f.hq === f.away) {
      what = `<strong>${daysTxt(f.hq)}</strong> · at Street HQ or at the client`;
    } else {
      what = `<strong>Street HQ: ${daysTxt(f.hq)}</strong> · At the client: ${daysTxt(f.away)}`;
    }
    if (ok && Math.max(f.hq, f.away) === 1 && !why) {
      const nx = addDays(date, 1);
      why = isHol(nx) ? 'Next day is a bank holiday, so 1 day only'
        : isFri(nx) ? 'Next day is Friday (admin), so 1 day only'
        : 'Not free the next day, so 1 day only';
    }
    return `<div class="calx-freeitem${ok ? '' : ' no'}"><span class="nm">${esc(name)}</span><div class="what">${what}${why ? `<small>${why}</small>` : ''}</div></div>`;
  }

  window.calxOpenDay = function (k) {
    const o = ensureOverlay();
    const date = fromKey(k);
    const evMap = buildEvents(addDays(date, -7), addDays(date, 21));
    const all = evMap[k] || [];
    const tf = trainerFilterVal();
    const evs = all.filter(e => matchesTrainer(e, tf));
    const hol = isHol(date) ? holName(date) : null;
    const b = blockFor(k, tf);
    const a = dayAvailability(k, all);
    document.getElementById('calxDayTitle').textContent = fmtLong(date);
    document.getElementById('calxDaySub').textContent = !isWork(date) ? (hol ? 'Bank holiday · ' + hol : 'Weekend') : isFri(date) ? 'Admin day for the whole team · no training bookings' :
      (a.total ? a.free.length + ' of ' + a.total + ' trainers free' + (tf ? ' · filtered to ' + tf : '') : '');

    const sec = (title, inner) => inner ? `<div class="calx-sec"><h4>${title}</h4>${inner}</div>` : '';
    const train = evs.filter(e => e.type === 'training').map(e => {
      const r = e.r || {};
      return `<div class="calx-list-item click" onclick="calxCloseDay();openCalEventModal(${e.rowIdx})"><span class="bar" style="background:${trainerColour(e.trainer)}"></span><div class="calx-main"><strong>${esc(e.label)}</strong><div>${esc(e.trainer || 'TBC')}${e.dayTotal > 1 ? ' · Day ' + e.dayNo + ' of ' + e.dayTotal : ''}${r.trainingOption ? ' · ' + esc(r.trainingOption) : ''}</div></div><span style="color:var(--s-purple);font-size:12px">View →</span></div>`;
    }).join('');
    const prov = evs.filter(e => e.type === 'provisional').map(e => `<div class="calx-list-item"><span class="bar" style="background:#f59e0b"></span><div class="calx-main"><strong>${esc(e.label)}</strong><div>${esc(e.trainer || 'TBC')} · not confirmed</div></div></div>`).join('');
    const trav = evs.filter(e => e.type === 'travel').map(e => `<div class="calx-list-item click" onclick="calxCloseDay();openCalEventModal(${e.rowIdx})"><span class="bar" style="background:#fbbf24"></span><div class="calx-main"><strong>${e.sub === 'Travel' ? '✈ Travel' : '📝 Admin'} – ${esc(e.trainer)}</strong><div>${esc(company(e.r))}</div></div></div>`).join('');
    const chips = (names, bg, fg) => names.length ? '<div class="calx-namechips">' + names.map(n => `<span style="background:${bg};color:${fg}">${esc(n)}</span>`).join('') + '</div>' : '';
    const leaveNames = [...new Set(evs.filter(e => e.type === 'leave').map(e => e.trainer))];
    const goog = evs.filter(e => e.type === 'google').map(e => `<div class="calx-list-item"><span class="bar" style="background:#38bdf8"></span><div class="calx-main"><strong>${esc(e.label)}</strong></div></div>`).join('');

    let body = '';
    if (b) body += sec('Blocked', `<div class="calx-list-item"><span class="bar" style="background:#e11d48"></span><div class="calx-main"><strong>🔒 ${esc(blockLabel(b))}</strong><div>Blocked by ${esc(b.blockedBy || 'Admin')}</div></div></div>`);

    // Top row: who's free (and for what) next to who's on leave
    const leaveHtml = chips(leaveNames, '#eef0f3', '#4b5563');
    let freeHtml = '';
    if (isBookable(date)) {
      const names = tf ? a.free.filter(n => n === tf) : a.free;
      freeHtml = names.length
        ? names.map(n => freeForHtml(n, date, evMap)).join('')
        : '<div style="font-size:12px;color:var(--s-text-muted)">Nobody free</div>';
      const earliest = typeof addWorkingDays === 'function' ? addWorkingDays(todayDate(), 14) : null;
      if (names.length && earliest && date < earliest && date >= todayDate()) freeHtml += '<div class="calx-notice">⏱ Inside the 14 working days’ notice period, so check before offering this date</div>';
    }
    if (freeHtml || leaveHtml) {
      body += `<div class="calx-toprow">${freeHtml ? `<div class="calx-sec"><h4>Free for training</h4>${freeHtml}</div>` : '<div></div>'}<div class="calx-sec"><h4>On leave</h4>${leaveHtml || '<div style="font-size:12px;color:var(--s-text-muted)">Nobody on leave</div>'}</div></div>`;
    }
    if (isBookable(date) && a.held.length) body += sec('On hold (provisional)', chips(a.held, '#FEF3CD', '#92400e'));
    body += sec('Training sessions', train);
    body += sec('Provisional holds', prov);
    body += sec('Travel & admin days', trav);
    body += sec('Google Calendar', goog);
    if (!body) body = '<div class="calx-empty">Nothing on this day.</div>';
    document.getElementById('calxDayBody').innerHTML = body;

    const canBlock = typeof canDo === 'function' && canDo('blockCalendar');
    const rawBlock = (typeof calBlockedDays !== 'undefined' ? calBlockedDays : {})[k];
    document.getElementById('calxDayFoot').innerHTML =
      (canBlock ? `<button class="btn btn-ghost" onclick="calxCloseDay();calDayClick('${k}')">${rawBlock ? '🔓 Manage block' : '🔒 Block this day'}</button>` : '') +
      `<button class="btn btn-primary btn-sm" onclick="calxCloseDay()">Done</button>`;
    o.classList.add('open');
  };

  // ── Install calendar markup + overrides ───────────────────────────
  function installCalendar() {
    window.renderCalendar = renderCalendarX;
    window.renderCalUpcoming = renderUpcoming;
  }

  // ═════════════════════════════════════════════════════════════════
  // 2. CAPACITY PLANNER
  // ═════════════════════════════════════════════════════════════════
  const capState = Object.assign({
    period: 'next4w', from: '', to: '', length: 1, travelAdmin: true, newTravel: true, notice: true, target: 80, includeShadow: false, excluded: [],
  }, lsGet('calxCapPrefs_v1', {}));
  const saveCap = () => lsSet('calxCapPrefs_v1', capState);

  function capRange() {
    const t = todayDate();
    switch (capState.period) {
      case 'thisMonth': return [t, new Date(t.getFullYear(), t.getMonth() + 1, 0)];
      case 'nextMonth': return [new Date(t.getFullYear(), t.getMonth() + 1, 1), new Date(t.getFullYear(), t.getMonth() + 2, 0)];
      case 'next8w': return [t, addDays(t, 55)];
      case 'next3m': return [t, new Date(t.getFullYear(), t.getMonth() + 3, t.getDate() - 1)];
      case 'custom': {
        const f = capState.from ? fromKey(capState.from) : t;
        const to = capState.to ? fromKey(capState.to) : addDays(f, 27);
        return to < f ? [f, f] : [f, to];
      }
      default: return [t, addDays(t, 27)];
    }
  }

  // Earliest day a new booking could start: same rule as Copy availability
  function earliestStart(notice) {
    return notice && typeof addWorkingDays === 'function' ? addWorkingDays(todayDate(), 14) : addDays(todayDate(), 1);
  }

  // Core calculation for one trainer. Day statuses come from trainerDay()
  // and "could still fit" uses blockFits(), exactly like Copy availability.
  function capacityFor(name, from, to, evMap, opts) {
    const o = Object.assign({ travelAdmin: true, newTravel: true, notice: true, length: 1 }, opts || {});
    const earliest = earliestStart(o.notice);
    const res = { name, working: 0, bankHols: 0, fridays: 0, leave: 0, blocked: 0, available: 0, training: 0, travelAdmin: 0, held: 0, other: 0, free: 0, freeBookable: 0, freeTooSoon: 0, fits: 0, fitDates: [], weeks: {} };
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      if (isWeekend(d)) continue;
      const wk = keyOf(mondayOf(d));
      const W = res.weeks[wk] = res.weeks[wk] || { available: 0, committed: 0, leave: 0 };
      const st = trainerDay(name, d, evMap);
      if (st === 'off') { res.bankHols++; continue; }
      res.working++;
      if (st === 'fri') { res.fridays++; continue; }   // team admin day, not training capacity
      if (st === 'blocked') { res.blocked++; continue; }
      if (st === 'leave') { res.leave++; W.leave++; continue; }
      res.available++; W.available++;
      if (st === 'training') { res.training++; W.committed++; }
      else if (st === 'buffer') {
        if (o.travelAdmin) { res.travelAdmin++; W.committed++; } else { res.free++; }
      }
      else if (st === 'held') res.held++;
      else if (st === 'google') res.other++;
      else {
        res.free++;
        if (d >= earliest) res.freeBookable++; else res.freeTooSoon++;
      }
    }
    // How many N-day bookings still fit, using the same rules as Copy
    // availability: N back-to-back Mon–Thu days, an admin day after, a travel
    // day before when we go to the client (never starting on a Monday), and
    // admin/travel days allowed to overlap. Bookings found are pencilled in
    // so the next one can't reuse the same days.
    const L = Math.max(1, o.length);
    if (L <= maxBlock(o.newTravel)) {
      const occ = new Map();
      const scanFrom = earliest > from ? earliest : from;
      for (let d = new Date(scanFrom); d <= to; d = addDays(d, 1)) {
        if (!isBookable(d)) continue;
        const blk = blockFits(name, d, L, o.newTravel, evMap, occ, to);
        if (!blk) continue;
        res.fits++;
        res.fitDates.push(blk.days.length === 1 ? dayTxt(blk.days[0]) : pairTxt(blk.days[0], blk.days[blk.days.length - 1]));
        occupy(occ, blk);
        d = addDays(blk.days[blk.days.length - 1], 0);
      }
    }
    res.committed = res.training + res.travelAdmin;
    res.util = res.available ? Math.round((res.committed / res.available) * 100) : 0;
    res.utilWithHeld = res.available ? Math.round(((res.committed + res.held) / res.available) * 100) : 0;
    return res;
  }
  window.calxCapacityFor = capacityFor;

  function statusFor(util, target) {
    if (util >= Math.min(100, target + 10)) return { label: 'Over target', bg: '#FDEAED', fg: '#b91c3c', bar: '#DC2F4B' };
    if (util >= target - 10) return { label: 'On target', bg: '#E8F9F3', fg: '#047857', bar: '#0FA976' };
    if (util >= target - 35) return { label: 'Room to book', bg: '#EBF2FF', fg: '#1d4ed8', bar: '#2563EB' };
    return { label: 'Lots of room', bg: '#EEF0FF', fg: '#4338ca', bar: '#7B6FF5' };
  }
  function heatColour(p) {
    if (p === null) return ['#f3f4f6', '#6b7280'];
    if (p >= 90) return ['#FECACA', '#991B1B'];
    if (p >= 70) return ['#FDE68A', '#92400E'];
    if (p >= 40) return ['#BBF7D0', '#065F46'];
    if (p > 0) return ['#DCFCE7', '#065F46'];
    return ['#F0FDF4', '#4b5563'];
  }

  function ensureCapacityPage() {
    let page = document.getElementById('page-capacity');
    if (page) return page;
    const main = document.getElementById('mainContent');
    if (!main) return null;
    page = document.createElement('div');
    page.className = 'app-page';
    page.id = 'page-capacity';
    page.style.display = 'none';
    page.innerHTML = '<div class="cap-wrap" id="capRoot"></div>';
    main.appendChild(page);
    return page;
  }

  function renderCapacityPlanner() {
    ensureCapacityPage();
    const root = document.getElementById('capRoot');
    if (!root) return;
    const [from, to] = capRange();
    const evMap = buildEvents(addDays(from, -7), addDays(to, 7));
    const notCounted = calTrainers().filter(t => !counted(t.name)).map(t => t.name);
    let people = calTrainers().filter(t => counted(t.name));
    if (!capState.includeShadow) people = people.filter(t => !isShadowing(t.name));
    const chosen = people.filter(t => !(capState.excluded || []).includes(t.name));
    const maxL = maxBlock(capState.newTravel);
    const L = Math.min(+capState.length || 1, maxL);
    const rows = chosen.map(t => capacityFor(t.name, from, to, evMap, { travelAdmin: capState.travelAdmin, newTravel: capState.newTravel, notice: capState.notice, length: L }));
    const sum = k => rows.reduce((s, r) => s + r[k], 0);
    const showOther = rows.some(r => r.other);
    const avail = sum('available'), committed = sum('committed'), held = sum('held'), free = sum('free'), fits = sum('fits');
    const util = avail ? Math.round(committed / avail * 100) : 0;
    const target = Math.max(1, Math.min(100, +capState.target || 80));
    const targetDays = Math.round(avail * target / 100);
    const headroom = Math.max(0, targetDays - committed - held);
    const st = statusFor(util, target);
    const workingDays = rows.length ? rows[0].working : 0;
    const rangeTxt = fmtShort(from) + ' – ' + fmtShort(to) + ' ' + to.getFullYear();
    const feedsMissing = (typeof calLeaveEvents === 'undefined' || !calLeaveEvents.length);

    const opt = (v, l) => `<option value="${v}" ${capState.period === v ? 'selected' : ''}>${l}</option>`;
    let h = `
      <div class="cap-head">
        <div><div class="section-title" style="margin:0">&#128197; Capacity Planner</div>
        <p>How much training the team can still take on. Works in trainer-days: working days, minus bank holidays, leave and blocked days, minus what's already booked.</p></div>
        <div style="display:flex;gap:8px"><button class="cap-btn" onclick="calxCapCopy()">📋 Copy summary</button><button class="cap-btn primary" onclick="showPage('dashboard');setTimeout(function(){calSetView('week');var c=document.getElementById('calendarSection');if(c)c.scrollIntoView({behavior:'smooth'});},80)">Open team calendar</button></div>
      </div>
      <div class="cap-card">
        <div class="cap-controls">
          <div><label class="cap-l" for="capPeriod">Period</label><select id="capPeriod" onchange="calxCapSet('period',this.value)">${opt('next4w', 'Next 4 weeks')}${opt('next8w', 'Next 8 weeks')}${opt('thisMonth', 'Rest of this month')}${opt('nextMonth', 'Next month')}${opt('next3m', 'Next 3 months')}${opt('custom', 'Custom dates')}</select></div>
          ${capState.period === 'custom' ? `<div><label class="cap-l" for="capFrom">From</label><input type="date" id="capFrom" value="${keyOf(from)}" onchange="calxCapSet('from',this.value)"></div><div><label class="cap-l" for="capTo">To</label><input type="date" id="capTo" value="${keyOf(to)}" onchange="calxCapSet('to',this.value)"></div>` : ''}
          <div><label class="cap-l" for="capLen">Typical booking length</label><select id="capLen" onchange="calxCapSet('length',+this.value)">${Array.from({ length: maxL }, (_, i) => i + 1).map(n => `<option value="${n}" ${L === n ? 'selected' : ''}>${n} day${n > 1 ? 's' : ''}</option>`).join('')}</select></div>
          <div><label class="cap-l" for="capTarget">Target booked %</label><input type="number" id="capTarget" min="10" max="100" step="5" value="${target}" onchange="calxCapSet('target',+this.value)"></div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label class="cap-check"><input type="checkbox" ${capState.travelAdmin ? 'checked' : ''} onchange="calxCapSet('travelAdmin',this.checked)"> Count booked travel &amp; admin days</label>
            <label class="cap-check"><input type="checkbox" ${capState.newTravel ? 'checked' : ''} onchange="calxCapSet('newTravel',this.checked)"> New bookings need a travel day</label>
            <label class="cap-check"><input type="checkbox" ${capState.notice ? 'checked' : ''} onchange="calxCapSet('notice',this.checked)"> 14 working days' notice</label>
            <label class="cap-check"><input type="checkbox" ${capState.includeShadow ? 'checked' : ''} onchange="calxCapSet('includeShadow',this.checked)"> Include shadowing trainers</label>
          </div>
        </div>
        <div class="cap-trainers"><span class="calx-filters-label" style="align-self:center">Trainers</span>${people.map(t => `<button type="button" class="calx-chip" aria-pressed="${(capState.excluded || []).includes(t.name) ? 'false' : 'true'}" onclick="calxCapToggleTrainer('${esc(t.name).replace(/'/g, '&#39;')}')"><i style="background:${trainerColour(t.name)}"></i>${esc(t.name)}</button>`).join('') || '<span style="font-size:12px;color:var(--s-text-muted)">No trainers found</span>'}${notCounted.length ? `<span style="font-size:11.5px;color:var(--s-text-muted);align-self:center;margin-left:auto">Not counted as capacity: ${esc(notCounted.join(', '))}</span>` : ''}</div>
      </div>
      ${feedsMissing ? '<div class="cap-warn">⚠️ No team leave has loaded from Humaans, so leave isn\'t being taken off yet. Numbers may look more generous than they really are.</div>' : ''}
      <div class="cap-kpis">
        <div class="cap-kpi"><div class="lbl">Team utilisation</div><div class="val">${util}%</div><div class="sub"><span class="cap-badge" style="background:${st.bg};color:${st.fg}">${st.label}</span> target ${target}%</div></div>
        <div class="cap-kpi"><div class="lbl">Available trainer-days</div><div class="val">${avail}</div><div class="sub">${workingDays - (rows.length ? rows[0].fridays : 0)} Mon–Thu days × ${rows.length} trainer${rows.length === 1 ? '' : 's'}, after leave &amp; blocks (Fridays are admin)</div></div>
        <div class="cap-kpi"><div class="lbl">Already committed</div><div class="val">${committed}</div><div class="sub">${sum('training')} training${capState.travelAdmin ? ' + ' + sum('travelAdmin') + ' travel/admin' : ''}${held ? ' · ' + held + ' on hold' : ''}${sum('other') ? ' · ' + sum('other') + ' other' : ''}</div></div>
        <div class="cap-kpi"><div class="lbl">Free days</div><div class="val">${free}</div><div class="sub">${sum('freeBookable')} bookable${capState.notice ? ' after notice period' : ''}</div></div>
        <div class="cap-kpi"><div class="lbl">Room for</div><div class="val">${fits}</div><div class="sub">more ${L}-day booking${fits === 1 ? '' : 's'}, including ${capState.newTravel ? 'travel and admin days' : 'admin days'}</div></div>
        <div class="cap-kpi"><div class="lbl">Headroom to target</div><div class="val">${headroom}</div><div class="sub">trainer-days before hitting ${target}%</div></div>
      </div>
      <div class="cap-card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:8px"><strong style="font-size:14px;color:var(--s-text-primary)">By trainer</strong><span style="font-size:12px;color:var(--s-text-muted)">${rangeTxt}</span></div>
        <div style="overflow-x:auto"><table class="cap-t"><thead><tr><th>Trainer</th><th class="num">Available</th><th class="num">Leave</th><th class="num">Training</th>${capState.travelAdmin ? '<th class="num">Travel/admin</th>' : ''}<th class="num">On hold</th>${showOther ? '<th class="num" title="Days with something in their Google Calendar">Other</th>' : ''}<th class="num" title="Single Mon–Thu days with nothing on">Free days</th><th class="num" title="Whole bookings that fit, including the travel and admin days they need">Room for</th><th>Booked</th><th>Status</th></tr></thead><tbody>
        ${rows.sort((a, b) => b.util - a.util).map(r => {
          const s = statusFor(r.util, target);
          const pct = n => r.available ? (n / r.available * 100) : 0;
          return `<tr><td class="name"><i style="background:${trainerColour(r.name)}"></i>${esc(r.name)}</td>
            <td class="num">${r.available}</td><td class="num">${r.leave || '–'}</td><td class="num">${r.training}</td>${capState.travelAdmin ? `<td class="num">${r.travelAdmin}</td>` : ''}<td class="num">${r.held || '–'}</td>${showOther ? `<td class="num">${r.other || '–'}</td>` : ''}<td class="num"><strong>${r.free}</strong></td><td class="num" title="${r.fitDates.length ? esc(r.fitDates.join(', ')) : 'No gap big enough'}"><strong>${r.fits}</strong></td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="cap-bar" title="${r.util}% committed"><span style="width:${pct(r.training)}%;background:${trainerColour(r.name)}"></span><span style="width:${pct(r.travelAdmin)}%;background:#FBBF24"></span><span style="width:${pct(r.held)}%;background:repeating-linear-gradient(-45deg,#F59E0B,#F59E0B 3px,#FDE68A 3px,#FDE68A 6px)"></span></div><span style="font-weight:700;color:var(--s-text-primary);min-width:36px">${r.util}%</span></div></td>
            <td><span class="cap-badge" style="background:${s.bg};color:${s.fg}">${s.label}</span></td></tr>`;
        }).join('') || '<tr><td colspan="10" class="calx-empty">Pick at least one trainer.</td></tr>'}
        </tbody></table></div>
        <div class="cap-legend"><span><i style="background:var(--s-purple)"></i>Training</span><span><i style="background:#FBBF24"></i>Travel &amp; admin</span><span><i style="background:repeating-linear-gradient(-45deg,#F59E0B,#F59E0B 3px,#FDE68A 3px,#FDE68A 6px)"></i>Provisional hold</span><span><i style="background:#eef0f4"></i>Free</span></div>
      </div>`;

    // Weekly heatmap
    const weekKeys = [];
    for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) weekKeys.push(keyOf(w));
    if (weekKeys.length > 1 && rows.length) {
      h += `<div class="cap-card"><strong style="font-size:14px;color:var(--s-text-primary)">Week by week</strong><div style="font-size:12px;color:var(--s-text-muted);margin:2px 0 10px">% of each trainer's available days already committed. Spot the crunch weeks before they arrive.</div>
      <div class="cap-heat"><table class="cap-t"><thead><tr><th>Trainer</th>${weekKeys.map(k => { const d = fromKey(k); return `<th style="text-align:center">w/c ${d.getDate()} ${MON_SHORT[d.getMonth()]}</th>`; }).join('')}</tr></thead><tbody>`;
      const teamWeek = {};
      rows.forEach(r => {
        h += `<tr><td class="name"><i style="background:${trainerColour(r.name)}"></i>${esc(r.name)}</td>` + weekKeys.map(k => {
          const W = r.weeks[k];
          const T = teamWeek[k] = teamWeek[k] || { a: 0, c: 0 };
          if (W) { T.a += W.available; T.c += W.committed; }
          if (!W || !W.available) {
            const lbl = W && W.leave ? 'Leave' : '–';
            return `<td class="cell" style="background:#f3f4f6;color:#6b7280">${lbl}</td>`;
          }
          const p = Math.round(W.committed / W.available * 100);
          const [bg, fg] = heatColour(p);
          return `<td class="cell" style="background:${bg};color:${fg}" title="${W.committed} of ${W.available} days committed">${p}%</td>`;
        }).join('') + '</tr>';
      });
      h += `<tr><td class="name" style="border-top:2px solid var(--s-border)">Team</td>` + weekKeys.map(k => {
        const T = teamWeek[k] || { a: 0, c: 0 };
        const p = T.a ? Math.round(T.c / T.a * 100) : null;
        const [bg, fg] = heatColour(p);
        return `<td class="cell" style="border-top:2px solid var(--s-border);background:${bg};color:${fg}">${p === null ? '–' : p + '%'}</td>`;
      }).join('') + `</tr></tbody></table></div>
      <div class="cap-legend"><span><i style="background:#F0FDF4;border:1px solid #d1fae5"></i>0%</span><span><i style="background:#DCFCE7"></i>1–39%</span><span><i style="background:#BBF7D0"></i>40–69%</span><span><i style="background:#FDE68A"></i>70–89%</span><span><i style="background:#FECACA"></i>90%+</span></div></div>`;
    }

    h += `<div class="cap-note"><strong>How this is worked out.</strong> Available = Monday to Thursday in the period (Fridays are admin days for everyone), minus bank holidays, Humaans leave and blocked days. Committed = booked training days${capState.travelAdmin ? ', plus their travel and admin days (travel only where the booking needs it: not for Street HQ or hosted events)' : ''}. Provisional holds and days with something in a trainer's Google Calendar aren't counted as booked, but aren't free either. "Room for" uses exactly the same rules as <strong>Copy availability</strong> on the Training Calendar: ${L} back-to-back Monday to Thursday day${L > 1 ? 's' : ''} with an admin day after${capState.newTravel ? ' and a travel day before (never starting on a Monday, as Monday is the travel day)' : ''}. A Friday, or an existing admin/travel day, can be used for these, as admin and travel can overlap${capState.notice ? '. It only looks from 14 working days from today' : ''}. The longest block is 3 days when we travel to the client and 4 at Street HQ.</div>`;
    root.innerHTML = h;
    window._calxLastCap = { rows, from, to, util, avail, committed, free, fits, L, target, headroom, newTravel: capState.newTravel, notice: capState.notice };
  }
  window.renderCapacityPlanner = renderCapacityPlanner;

  window.calxCapSet = function (k, v) {
    capState[k] = v;
    if (k === 'period' && v === 'custom' && !capState.from) { const t = todayDate(); capState.from = keyOf(t); capState.to = keyOf(addDays(t, 27)); }
    saveCap(); renderCapacityPlanner();
  };
  window.calxCapToggleTrainer = function (name) {
    const n = String(name).replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const ex = capState.excluded || [];
    capState.excluded = ex.includes(n) ? ex.filter(x => x !== n) : ex.concat([n]);
    saveCap(); renderCapacityPlanner();
  };
  window.calxCapCopy = function () {
    const c = window._calxLastCap;
    if (!c) return;
    const where = c.newTravel ? 'at the client’s office' : 'at Street HQ';
    const needs = c.newTravel ? 'a travel day before and an admin day after' : 'an admin day after';
    const bookingWord = n => `${n} more ${c.L}-day booking${n === 1 ? '' : 's'}`;
    const lines = [
      `Training capacity (${dayTxt(c.from)} to ${dayTxt(c.to)})`,
      `Checking for: ${c.L}-day training ${where}`,
      '',
      `Team: ${c.util}% booked (target ${c.target}%)`,
      `• ${c.free} free trainer-day${c.free === 1 ? '' : 's'} across the team`,
      `• Room for ${bookingWord(c.fits)}`,
      '',
      'By trainer:',
      ...c.rows.map(r => {
        const soon = r.freeTooSoon > 0 ? ` (${r.freeTooSoon} too soon to book, inside the 14 working days’ notice)` : '';
        const room = r.fits
          ? `room for ${bookingWord(r.fits)} (${c.L === 1 ? 'on' : 'starting'} ${r.fitDates.join(', ')})`
          : 'no gap big enough for a booking';
        return `• ${r.name}: ${r.util}% booked. ${r.free} free day${r.free === 1 ? '' : 's'}${soon}, ${room}`;
      }),
      '',
      `Why free days and room for bookings don’t match: each booking also needs ${needs}, so a free day squeezed between other bookings${c.notice ? ', or inside the 14 working days’ notice period,' : ''} can’t be used on its own.`,
      '',
      'Worked out from the same calendar as Copy availability. Check with the Product Trainers before offering dates.',
    ];
    const text = lines.join('\n');
    const done = () => { if (typeof showToast === 'function') showToast('Capacity summary copied', 'success'); };
    try { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); } catch (e) { fallbackCopy(text, done); }
  };
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    ta.remove();
  }

  // Add a forward-looking capacity line to each Trainer Workload card
  function patchWorkloadCards() {
    if (typeof window.renderTrainerWorkload !== 'function' || window.renderTrainerWorkload._calx) return;
    const orig = window.renderTrainerWorkload;
    const wrapped = function () {
      const out = orig.apply(this, arguments);
      try {
        const from = todayDate(), to = addDays(from, 27);
        const evMap = buildEvents(from, to);
        document.querySelectorAll('#trainerGrid .trainer-card[data-trainer]').forEach(card => {
          if (card.querySelector('.calx-cardcap')) return;
          const name = card.getAttribute('data-trainer');
          if (!counted(name)) return;
          const r = capacityFor(name, from, to, evMap, { travelAdmin: true, newTravel: true, notice: false, length: 1 });
          const s = statusFor(r.util, capState.target || 80);
          const el = document.createElement('div');
          el.className = 'calx-cardcap';
          el.title = 'Open the Capacity Planner';
          el.innerHTML = `<div style="display:flex;justify-content:space-between"><span>Next 4 weeks</span><strong style="color:${s.fg}">${r.util}% booked</strong></div><div class="b"><span style="width:${Math.min(100, r.util)}%;background:${s.bar}"></span></div><div style="margin-top:3px">${r.free} free day${r.free === 1 ? '' : 's'}${r.leave ? ' · ' + r.leave + ' on leave' : ''}</div>`;
          el.addEventListener('click', () => { if (typeof showPage === 'function') showPage('capacity'); });
          card.appendChild(el);
        });
      } catch (e) { console.warn('[calendar-capacity] workload card patch failed', e); }
      return out;
    };
    wrapped._calx = true;
    window.renderTrainerWorkload = wrapped;
  }

  // Register the page with the dashboard's page switcher
  function installCapacityPage() {
    ensureCapacityPage();
    try {
      if (typeof PAGE_ELEMENT_IDS !== 'undefined') PAGE_ELEMENT_IDS.capacity = 'page-capacity';
      if (typeof PAGE_TITLES !== 'undefined') PAGE_TITLES.capacity = 'Capacity Planner';
    } catch (e) {}
    if (typeof window.showPage === 'function' && !window.showPage._calx) {
      const orig = window.showPage;
      const wrapped = function (key) {
        const r = orig.apply(this, arguments);
        if (key === 'capacity') renderCapacityPlanner();
        return r;
      };
      wrapped._calx = true;
      window.showPage = wrapped;
    }
    // Keep the sidebar button in step with the Trainer Workload permission
    if (typeof window.applyPermVisibility === 'function' && !window.applyPermVisibility._calx) {
      const orig = window.applyPermVisibility;
      const wrapped = function () {
        const r = orig.apply(this, arguments);
        const btn = document.getElementById('sideBtn-capacity');
        if (btn && typeof canDo === 'function') btn.style.display = canDo('viewTrainerWorkload') ? '' : 'none';
        return r;
      };
      wrapped._calx = true;
      window.applyPermVisibility = wrapped;
    }
  }


  // ═════════════════════════════════════════════════════════════════
  // 3. COPY AVAILABILITY — dates to offer a client (1-day / 2-day,
  //    at Street HQ vs at their office). Always check with the Product
  //    Trainers before sending.
  // ═════════════════════════════════════════════════════════════════
  const availState = Object.assign({ weeks: 4, trainer: '', notice: true }, lsGet('calxAvailPrefs_v1', {}));
  const saveAvail = () => lsSet('calxAvailPrefs_v1', availState);

  // Day status for one trainer: 'free' | 'fri' (admin Friday) | 'busy'
  function trainerDayStatus(name, d, evMap) {
    const st = trainerDay(name, d, evMap);
    return (st === 'off' || st === 'fri' || st === 'free' || st === 'buffer') ? st : 'busy';
  }

  function computeAvailability() {
    const today = todayDate();
    const start = availState.notice && typeof addWorkingDays === 'function' ? addWorkingDays(today, 14) : addDays(today, 1);
    const end = addDays(today, availState.weeks * 7);
    const evMap = buildEvents(addDays(start, -7), addDays(end, 7));
    let pool = calTrainers().filter(t => counted(t.name) && !isShadowing(t.name));
    if (availState.trainer) pool = pool.filter(t => t.name === availState.trainer);
    const okBuffer = st => st === 'free' || st === 'fri' || st === 'buffer';
    const res = { hq1: [], away1: [], hq2: [], away2: [], start, end };
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      if (!isBookable(d)) continue;
      const prev = prevWorkingDay(d), next1 = nextWorkingDay(d);
      const next2 = nextWorkingDay(next1);
      const two = isBookable(next1) && keyOf(next1) === keyOf(addDays(d, 1)) && next1 <= end; // back-to-back Mon–Thu
      let hq1 = [], away1 = [], hq2 = [], away2 = [];
      pool.forEach(t => {
        const s0 = trainerDayStatus(t.name, d, evMap);
        if (s0 !== 'free') return;
        const sPrev = trainerDayStatus(t.name, prev, evMap);
        const sN1 = trainerDayStatus(t.name, next1, evMap);
        const isMon = d.getDay() === 1;   // Monday is always the travel day when we go to the client
        if (okBuffer(sN1)) { hq1.push(t.name); if (!isMon && okBuffer(sPrev)) away1.push(t.name); }
        if (two && sN1 === 'free') {
          const sN2 = trainerDayStatus(t.name, next2, evMap);
          if (okBuffer(sN2)) { hq2.push(t.name); if (!isMon && okBuffer(sPrev)) away2.push(t.name); }
        }
      });
      if (hq1.length) res.hq1.push({ d, who: hq1 });
      if (away1.length) res.away1.push({ d, who: away1 });
      if (hq2.length) res.hq2.push({ d, d2: next1, who: hq2 });
      if (away2.length) res.away2.push({ d, d2: next1, who: away2 });
    }
    return res;
  }

  const dayTxt = d => DOW_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MON_SHORT[d.getMonth()];
  const pairTxt = (a, b) => a.getMonth() === b.getMonth()
    ? DOW_SHORT[a.getDay()] + ' ' + a.getDate() + ' – ' + DOW_SHORT[b.getDay()] + ' ' + b.getDate() + ' ' + MON_SHORT[b.getMonth()]
    : dayTxt(a) + ' – ' + dayTxt(b);

  const AVAIL_SECTIONS = [
    ['hq1',   'If you’re looking for one-day training based on coming to Street, these days are available:', false],
    ['away1', 'If you want one-day training based on us coming to you, these days are available (taking into account travel and admin days):', false],
    ['hq2',   'If you’re looking for two-day training based on coming to Street, these dates are available:', true],
    ['away2', 'If you want two-day training based on us coming to you, these dates are available (taking into account travel and admin days):', true],
  ];

  function availText(res) {
    const lines = ['Training availability (' + dayTxt(res.start) + ' to ' + dayTxt(res.end) + ')', ''];
    AVAIL_SECTIONS.forEach(([key, heading, two]) => {
      lines.push(heading);
      const list = res[key];
      if (!list.length) lines.push('• No availability in this period');
      else list.forEach(x => lines.push('• ' + (two ? pairTxt(x.d, x.d2) : dayTxt(x.d))));
      lines.push('');
    });
    lines.push('All dates are subject to confirmation.');
    return lines.join('\n');
  }

  function ensureAvailOverlay() {
    let o = document.getElementById('calxAvailOverlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'calxAvailOverlay';
    o.className = 'calx-overlay';
    o.innerHTML = '<div class="calx-panel" role="dialog" aria-modal="true" aria-labelledby="calxAvailTitle" style="width:620px"><div class="calx-panel-head"><div><h3 id="calxAvailTitle">📋 Copy availability</h3><div>Dates you can offer a client, worked out from the training calendar</div></div><button class="calx-x" onclick="calxCloseAvail()" aria-label="Close">✕</button></div><div class="calx-panel-body" id="calxAvailBody"></div><div class="calx-panel-foot" id="calxAvailFoot"></div></div>';
    o.addEventListener('click', e => { if (e.target === o) window.calxCloseAvail(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && o.classList.contains('open')) window.calxCloseAvail(); });
    document.body.appendChild(o);
    return o;
  }
  window.calxCloseAvail = function () { const o = document.getElementById('calxAvailOverlay'); if (o) o.classList.remove('open'); };

  // ── Custom availability: any number of days, at HQ or away, optionally split ──
  const customState = Object.assign({ away: true, total: 3, pattern: [3], gapWeeks: 2, sameTrainer: true },
    lsGet('calxAvailCustom_v1', {}));
  const saveCustom = () => lsSet('calxAvailCustom_v1', customState);
  let availTab = 'standard';

  // Longest back-to-back block: Mon–Thu at HQ (4), Tue–Thu away (3)
  const maxBlock = away => (away ? 3 : 4);

  // All ways of splitting N days into ordered blocks (max 3 blocks)
  function splitOptions(n, away) {
    const mx = maxBlock(away), out = [];
    const rec = (left, acc) => {
      if (acc.length > 3) return;
      if (left === 0) { out.push(acc.slice()); return; }
      for (let k = Math.min(mx, left); k >= 1; k--) { acc.push(k); rec(left - k, acc); acc.pop(); }
    };
    rec(n, []);
    return out.sort((x, y) => x.length - y.length);
  }
  function patternLabel(pat) {
    if (pat.length === 1) return pat[0] === 1 ? '1 day' : pat[0] + ' days back-to-back';
    return pat.map((n, i) => (i === 0 ? '' : 'then ') + (n === 1 ? '1 day' : n + ' days back-to-back')).join(', ');
  }
  function parsePattern(txt) {
    const parts = String(txt || '').split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n > 0);
    return parts.length ? parts : null;
  }

  // Status of a day for a trainer, including days already taken by earlier
  // blocks in the same suggestion (occ: iso -> 'train' | 'buffer')
  function statusWithOcc(name, d, evMap, occ) {
    const o = occ && occ.get(keyOf(d));
    if (o === 'train') return 'busy';
    const base = trainerDayStatus(name, d, evMap);
    if (o === 'buffer') return base === 'busy' ? 'busy' : (base === 'fri' ? 'fri' : 'buffer');
    return base;
  }
  // Can trainer do a block of L days starting on `start`?
  function blockFits(name, start, L, away, evMap, occ, end) {
    if (away && start.getDay() === 1) return null;                // Monday = travel day
    const days = [];
    for (let j = 0; j < L; j++) {
      const d = addDays(start, j);
      if (!isBookable(d) || d > end) return null;                   // back-to-back Mon–Thu only
      if (statusWithOcc(name, d, evMap, occ) !== 'free') return null;
      days.push(d);
    }
    const okB = st => st === 'free' || st === 'fri' || st === 'buffer';
    const admin = nextWorkingDay(days[days.length - 1]);
    if (!okB(statusWithOcc(name, admin, evMap, occ))) return null;
    let travel = null;
    if (away) { travel = prevWorkingDay(start); if (!okB(statusWithOcc(name, travel, evMap, occ))) return null; }
    return { days, admin, travel, trainer: name };
  }
  const occupy = (occ, blk) => {
    blk.days.forEach(d => occ.set(keyOf(d), 'train'));
    occ.set(keyOf(blk.admin), 'buffer');
    if (blk.travel) occ.set(keyOf(blk.travel), 'buffer');
  };

  function computeCustom() {
    const today = todayDate();
    const start = availState.notice && typeof addWorkingDays === 'function' ? addWorkingDays(today, 14) : addDays(today, 1);
    const end = addDays(today, availState.weeks * 7);
    const evMap = buildEvents(addDays(start, -7), addDays(end, 14));
    let pool = calTrainers().filter(t => counted(t.name) && !isShadowing(t.name)).map(t => t.name);
    if (availState.trainer) pool = pool.filter(n => n === availState.trainer);
    const pat = customState.pattern, away = customState.away;
    const res = { start, end, pat, away, options: [], error: '' };
    if (pat.some(n => n > maxBlock(away))) {
      res.error = away
        ? 'When we travel to the client, the longest back-to-back block is 3 days (Tuesday to Thursday). Try splitting the days.'
        : 'At Street HQ the longest back-to-back block is 4 days (Monday to Thursday). Try splitting the days.';
      return res;
    }
    const gapDays = customState.gapWeeks ? customState.gapWeeks * 7 : 9999;
    const seen = new Set();
    const tryFrom = (d0, trainersForBlock) => {
      // trainersForBlock(i) returns the list of trainers allowed for block i
      const occs = {};
      const blocks = [];
      let prevEnd = null;
      for (let i = 0; i < pat.length; i++) {
        let found = null;
        const from = i === 0 ? d0 : addDays(prevEnd, 1);
        const lastStart = i === 0 ? d0 : addDays(prevEnd, gapDays);
        for (let d = new Date(from); d <= lastStart && d <= end && !found; d = addDays(d, 1)) {
          for (const n of trainersForBlock(i, blocks)) {
            const occ = occs[n] = occs[n] || new Map();
            const blk = blockFits(n, d, pat[i], away, evMap, occ, end);
            if (blk) { found = blk; occupy(occ, blk); break; }
          }
        }
        if (!found) return null;
        blocks.push(found);
        prevEnd = found.days[found.days.length - 1];
      }
      return blocks;
    };
    for (let d = new Date(start); d <= end && res.options.length < 8; d = addDays(d, 1)) {
      if (!isBookable(d)) continue;
      let blocks = null;
      if (customState.sameTrainer) {
        for (const n of pool) { blocks = tryFrom(d, () => [n]); if (blocks) break; }
      } else {
        blocks = tryFrom(d, () => pool);
      }
      if (!blocks) continue;
      const sig = blocks.map(b => keyOf(b.days[0])).join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      res.options.push(blocks);
    }
    return res;
  }
  const blockTxt = b => b.days.length === 1 ? dayTxt(b.days[0]) : pairTxt(b.days[0], b.days[b.days.length - 1]);
  const optionTxt = blocks => blocks.map(blockTxt).join(', then ');
  function customHeading(res) {
    const total = res.pat.reduce((a, b) => a + b, 0);
    const where = res.away ? 'based on us coming to you' : 'based on coming to Street';
    const how = res.pat.length > 1 ? ' (' + patternLabel(res.pat) + ')' : (total > 1 ? ' (back-to-back)' : '');
    return 'If you’re looking for ' + total + '-day training ' + where + how + ', these dates are available' + (res.away ? ' (taking into account travel and admin days)' : '') + ':';
  }
  function customText(res) {
    const lines = ['Training availability (' + dayTxt(res.start) + ' to ' + dayTxt(res.end) + ')', '', customHeading(res)];
    if (!res.options.length) lines.push('• No availability in this period');
    else res.options.forEach((o, i) => lines.push('• Option ' + (i + 1) + ': ' + optionTxt(o)));
    lines.push('', 'All dates are subject to confirmation.');
    return lines.join('\n');
  }

  function renderAvail() {
    const people = calTrainers().filter(t => counted(t.name) && !isShadowing(t.name));
    const checked = !!window._calxAvailConfirmed;
    const tabBtn = (k, l) => `<button type="button" aria-pressed="${availTab === k ? 'true' : 'false'}" onclick="calxAvailTab('${k}')">${l}</button>`;
    let h = `
      <div class="calx-avail-warn"><strong>⚠️ Always check with the Product Trainers first</strong> before sending any availability to a client. These dates come from the calendar and can change quickly (new bookings, leave, holds).</div>
      <div class="calx-avail-tabs" role="group" aria-label="Availability type">${tabBtn('standard', 'Standard (1 &amp; 2 days)')}${tabBtn('custom', 'Custom')}</div>
      <div class="calx-avail-controls">
        <label>Look ahead<select onchange="calxAvailSet('weeks',+this.value)">${[2, 4, 6, 8, 12, 16].map(w => `<option value="${w}" ${availState.weeks === w ? 'selected' : ''}>${w} weeks</option>`).join('')}</select></label>
        <label>Trainer<select onchange="calxAvailSet('trainer',this.value)"><option value="">Any trainer</option>${people.map(t => `<option value="${esc(t.name)}" ${availState.trainer === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" ${availState.notice ? 'checked' : ''} onchange="calxAvailSet('notice',this.checked)"> Start after 14 working days' notice</label>
      </div>`;

    if (availTab === 'standard') {
      const res = computeAvailability();
      window._calxAvail = { kind: 'standard', res };
      AVAIL_SECTIONS.forEach(([key, heading, two]) => {
        const list = res[key];
        h += `<div class="calx-sec"><h4 style="text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--s-text-primary)">${esc(heading)}</h4>` +
          (list.length ? '<div class="calx-namechips">' + list.map(x => `<span style="background:#E8F9F3;color:#047857" title="${esc('Free: ' + x.who.join(', '))}">${esc(two ? pairTxt(x.d, x.d2) : dayTxt(x.d))}</span>`).join('') + '</div>'
            : '<div style="font-size:12px;color:var(--s-text-muted)">No availability in this period</div>') + '</div>';
      });
    } else {
      const cs = customState;
      const splits = splitOptions(cs.total, cs.away);
      const patKey = cs.pattern.join('+');
      h += `<div class="calx-custom">
        <div class="calx-custom-row">
          <span class="lbl">Where?</span>
          <div class="calx-avail-tabs sm">
            <button type="button" aria-pressed="${!cs.away}" onclick="calxCustomSet('away',false)">🏢 Coming to Street HQ</button>
            <button type="button" aria-pressed="${cs.away}" onclick="calxCustomSet('away',true)">🚗 We travel to them</button>
          </div>
        </div>
        <div class="calx-custom-row">
          <span class="lbl">How many days?</span>
          <input type="number" min="1" max="10" value="${cs.total}" onchange="calxCustomSet('total',this.value)" style="width:80px">
        </div>
        <div class="calx-custom-row" style="align-items:flex-start">
          <span class="lbl" style="padding-top:6px">How should the days be split?</span>
          <div style="flex:1;min-width:0">
            <div class="calx-namechips">${splits.map(sp => {
              const k = sp.join('+');
              return `<button type="button" class="calx-split ${k === patKey ? 'on' : ''}" onclick="calxCustomSet('pattern','${k}')" title="${esc(patternLabel(sp))}">${sp.length === 1 ? (sp[0] === 1 ? '1 day' : sp[0] + ' in a row') : sp.join(' + ')}</button>`;
            }).join('') || '<span style="font-size:12px;color:var(--s-text-muted)">Pick a number of days</span>'}</div>
            <div style="font-size:11.5px;color:var(--s-text-muted);margin-top:6px">Selected: <strong style="color:var(--s-text-primary)">${esc(patternLabel(cs.pattern))}</strong>. Or type your own order, e.g. 2+1+1: <input type="text" value="${esc(patKey)}" onchange="calxCustomSet('pattern',this.value)" style="width:90px;border:1.5px solid var(--s-border-mid);border-radius:6px;padding:3px 7px;font:12px 'DM Sans',sans-serif"></div>
          </div>
        </div>
        ${cs.pattern.length > 1 ? `<div class="calx-custom-row">
          <span class="lbl">Max gap between blocks</span>
          <select onchange="calxCustomSet('gapWeeks',+this.value)">${[[1, '1 week'], [2, '2 weeks'], [3, '3 weeks'], [4, '4 weeks'], [0, 'Any time in the look-ahead']].map(([v, l]) => `<option value="${v}" ${cs.gapWeeks === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <label class="chk" style="margin-left:6px"><input type="checkbox" ${cs.sameTrainer ? 'checked' : ''} onchange="calxCustomSet('sameTrainer',this.checked)"> Same trainer for every block</label>
        </div>` : ''}
      </div>`;
      const res = computeCustom();
      window._calxAvail = { kind: 'custom', res };
      h += `<div class="calx-sec"><h4 style="text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--s-text-primary)">${esc(customHeading(res))}</h4>`;
      if (res.error) h += `<div class="calx-avail-warn" style="margin:0">${esc(res.error)}</div>`;
      else if (!res.options.length) h += '<div style="font-size:12px;color:var(--s-text-muted)">No dates fit in this period. Try a longer look-ahead, a bigger gap between blocks, a different split, or untick "Same trainer".</div>';
      else h += '<div class="calx-opts">' + res.options.map((o, i) => `<div class="calx-opt"><span class="n">Option ${i + 1}</span><span class="d">${esc(optionTxt(o))}</span><span class="w">${esc([...new Set(o.map(b => b.trainer))].join(' & '))}</span></div>`).join('') + '</div>';
      h += '</div>';
    }

    h += `<div class="cap-note" style="font-size:11.5px;color:var(--s-text-muted);background:var(--s-surface);border:1px solid var(--s-border);border-radius:8px;padding:9px 11px;line-height:1.5">Mondays to Thursdays only (Fridays are admin days). "Coming to Street" needs the trainer free plus an admin day after each block. "Us coming to you" also needs a travel day before each block and never starts on a Monday (Monday is the travel day), so away blocks are Tuesday to Thursday. An admin day can double up as a travel day. Back-to-back days stay with one trainer. Trainer names aren't included in the copied text.</div>
      <label class="calx-avail-confirm"><input type="checkbox" id="calxAvailOk" ${checked ? 'checked' : ''} onchange="window._calxAvailConfirmed=this.checked;document.getElementById('calxAvailCopyBtn').disabled=!this.checked"> I've checked these dates with the Product Trainers</label>`;
    document.getElementById('calxAvailBody').innerHTML = h;
    document.getElementById('calxAvailFoot').innerHTML = `<span style="margin-right:auto;align-self:center;font-size:10.5px;color:var(--s-text-faint)">Version 2026-11-04e</span><button class="btn btn-ghost" onclick="calxCloseAvail()">Close</button><button class="btn btn-primary btn-sm" id="calxAvailCopyBtn" ${checked ? '' : 'disabled'} onclick="calxAvailCopy()">📋 Copy for client</button>`;
  }
  window.calxAvailTab = function (t) { availTab = t; renderAvail(); };
  window.calxCustomSet = function (k, v) {
    if (k === 'total') {
      const n = Math.max(1, Math.min(10, parseInt(v, 10) || 1));
      customState.total = n;
      const sp = splitOptions(n, customState.away);
      customState.pattern = sp.length ? sp[0] : [n];
    } else if (k === 'pattern') {
      const p = parsePattern(v);
      if (p) { customState.pattern = p; customState.total = p.reduce((a, b) => a + b, 0); }
    } else if (k === 'away') {
      customState.away = !!v;
      if (customState.pattern.some(n => n > maxBlock(customState.away))) {
        const sp = splitOptions(customState.total, customState.away);
        if (sp.length) customState.pattern = sp[0];
      }
    } else customState[k] = v;
    saveCustom(); renderAvail();
  };
  window.calxAvailSet = function (k, v) { availState[k] = v; saveAvail(); renderAvail(); };
  window.calxOpenAvail = function () { window._calxAvailConfirmed = false; ensureAvailOverlay().classList.add('open'); renderAvail(); };
  window.calxAvailCopy = function () {
    const a = window._calxAvail;
    if (!window._calxAvailConfirmed || !a) return;
    const text = a.kind === 'custom' ? customText(a.res) : availText(a.res);
    const done = () => { if (typeof showToast === 'function') showToast('Availability copied, ready to paste', 'success'); };
    try { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); } catch (e) { fallbackCopy(text, done); }
  };

  function installAvailButton() {
    if (document.getElementById('calxAvailBtn')) return;
    const right = document.querySelector('#calendarSection .calx-right');
    if (!right) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'calxAvailBtn';
    btn.className = 'cal-nav-btn calx-today';
    btn.textContent = '📋 Copy availability';
    btn.title = 'Dates you can offer a client. Check with the Product Trainers first.';
    btn.onclick = () => window.calxOpenAvail();
    right.insertBefore(btn, right.firstChild);
  }

  function boot() {
    installCalendar();
    installCapacityPage();
    patchWorkloadCards();
    installAvailButton();
    try { if (typeof allData !== 'undefined' && allData.length) { renderCalendarX(); window.renderTrainerWorkload(); } } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
