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
 *  2. CAPACITY PLANNER — a day-based capacity calculator (new page):
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
  const company = r => (typeof getCompanyName === 'function' ? getCompanyName(r) : (r.company || r.contact || '(Unknown)'));
  const initials = n => String(n || '?').split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const fmtShort = d => DOW_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MON_SHORT[d.getMonth()];
  const fmtLong = d => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function lsGet(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function calTrainers() {
    try { return (trainers || []).filter(u => u.role === 'trainer' || u.role === 'admin'); } catch (e) { return []; }
  }
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
      let clusters = [];
      try { clusters = dates.length ? clusterDates(dates) : [[keyOf(r.bookedOn)]]; } catch (e) { clusters = []; }
      clusters.forEach(c => {
        try {
          const travel = prevWorkingDay(fromKey(c[0]));
          const admin = nextWorkingDay(fromKey(c[c.length - 1]));
          add(keyOf(travel), { type: 'travel', sub: 'Travel', trainer: r.trainer || '', label: 'Travel – ' + company(r), rowIdx: r._idx, r });
          add(keyOf(admin), { type: 'travel', sub: 'Admin', trainer: r.trainer || '', label: 'Admin – ' + company(r), rowIdx: r._idx, r });
        } catch (e) {}
      });
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

  // Who is busy / free on a day (busy = training, travel/admin, leave, or blocked)
  function dayAvailability(k, evs) {
    const pool = calTrainers().filter(t => !isShadowing(t.name));
    const free = [], busy = [], held = [];
    pool.forEach(t => {
      const mine = evs.filter(e => e.trainer === t.name);
      const b = blockFor(k, t.name);
      const fullyBlocked = b && (!b.scope || b.scope === 'all' || (b.trainers || []).includes(t.name));
      if (fullyBlocked || mine.some(e => e.type === 'training' || e.type === 'travel' || e.type === 'leave')) busy.push(t.name);
      else if (mine.some(e => e.type === 'provisional')) held.push(t.name);
      else free.push(t.name);
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
  .calx-namechips span{font-size:11px;font-weight:600;padding:3px 9px;border-radius:100px;}
  .calx-panel-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--s-border);background:var(--s-surface);}

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
      if (date.getTime() === today.getTime()) cls += ' cal-day-today';
      if (date < today) cls += ' cal-day-past';
      if (hol) cls += ' cal-day-holiday';
      if (blockFor(k, tf)) cls += ' cal-day-blocked';

      // Free indicator (future working days only)
      let freeHtml = '';
      if (date >= today && isWork(date)) {
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
    if (!people.length) { wrap.innerHTML = '<div class="calx-empty">No trainers to show.</div>'; return; }

    let h = '<div class="calx-week"><table><thead><tr><th>Trainer</th>';
    days.forEach(d => { h += `<th class="${d.getTime() === today.getTime() ? 'today' : ''}">${DOW_SHORT[d.getDay()]} ${d.getDate()}<small>${MON_SHORT[d.getMonth()]}${d.getTime() === today.getTime() ? ' · Today' : ''}</small></th>`; });
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
        mine.forEach(e => {
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
        if (!c && !off && d >= today && !shadow) c = '<span class="calx-freecell">Free</span>';
        const tdCls = (off ? 'off ' : '') + (d.getTime() === today.getTime() ? 'todaycol' : '');
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
  window.calxOpenDay = function (k) {
    const o = ensureOverlay();
    const date = fromKey(k);
    const all = buildEvents(date, date)[k] || [];
    const tf = trainerFilterVal();
    const evs = all.filter(e => matchesTrainer(e, tf));
    const hol = isHol(date) ? holName(date) : null;
    const b = blockFor(k, tf);
    const a = dayAvailability(k, all);
    document.getElementById('calxDayTitle').textContent = fmtLong(date);
    document.getElementById('calxDaySub').textContent = !isWork(date) ? (hol ? 'Bank holiday · ' + hol : 'Weekend') :
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
    body += sec('Training sessions', train);
    body += sec('Provisional holds', prov);
    body += sec('Travel & admin days', trav);
    body += sec('On leave', chips(leaveNames, '#eef0f3', '#4b5563'));
    body += sec('Google Calendar', goog);
    if (isWork(date)) {
      body += sec('Free', chips(tf ? a.free.filter(n => n === tf) : a.free, '#E8F9F3', '#047857') || '<div style="font-size:12px;color:var(--s-text-muted)">Nobody free</div>');
      if (a.held.length) body += sec('On hold (provisional)', chips(a.held, '#FEF3CD', '#92400e'));
    }
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
    period: 'next4w', from: '', to: '', length: 1, travelAdmin: true, notice: true, target: 80, includeShadow: false, excluded: [],
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

  // Core calculation for one trainer.
  function capacityFor(name, from, to, evMap, opts) {
    const o = Object.assign({ travelAdmin: true, notice: true, length: 1 }, opts || {});
    const earliest = o.notice && typeof addWorkingDays === 'function' ? addWorkingDays(todayDate(), 14) : todayDate();
    const res = { name, working: 0, bankHols: 0, leave: 0, blocked: 0, available: 0, training: 0, travelAdmin: 0, held: 0, free: 0, freeBookable: 0, fits: 0, weeks: {} };
    const seq = []; // working-day sequence: true = free & bookable, false = not
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      if (isWeekend(d)) continue;
      const wk = keyOf(mondayOf(d));
      const W = res.weeks[wk] = res.weeks[wk] || { available: 0, committed: 0, leave: 0 };
      if (isHol(d)) { res.bankHols++; continue; }
      res.working++;
      const k = keyOf(d);
      const b = blockFor(k, name);
      const mine = (evMap[k] || []).filter(e => e.trainer === name);
      if (b) { res.blocked++; seq.push(false); continue; }
      if (mine.some(e => e.type === 'leave')) { res.leave++; W.leave++; seq.push(false); continue; }
      res.available++; W.available++;
      if (mine.some(e => e.type === 'training')) { res.training++; W.committed++; seq.push(false); }
      else if (o.travelAdmin && mine.some(e => e.type === 'travel')) { res.travelAdmin++; W.committed++; seq.push(false); }
      else if (mine.some(e => e.type === 'provisional')) { res.held++; seq.push(false); }
      else {
        res.free++;
        const ok = d >= earliest;
        if (ok) res.freeBookable++;
        seq.push(ok);
      }
    }
    // How many N-day bookings fit in the free runs (plus travel + admin days either side)
    const need = Math.max(1, o.length) + (o.travelAdmin ? 2 : 0);
    let run = 0;
    seq.concat([false]).forEach(v => { if (v) run++; else { res.fits += Math.floor(run / need); run = 0; } });
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
    const evMap = buildEvents(from, to);
    let people = calTrainers();
    if (!capState.includeShadow) people = people.filter(t => !isShadowing(t.name));
    const chosen = people.filter(t => !(capState.excluded || []).includes(t.name));
    const L = +capState.length || 1;
    const rows = chosen.map(t => capacityFor(t.name, from, to, evMap, { travelAdmin: capState.travelAdmin, notice: capState.notice, length: L }));
    const sum = k => rows.reduce((s, r) => s + r[k], 0);
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
          <div><label class="cap-l" for="capLen">Typical booking length</label><select id="capLen" onchange="calxCapSet('length',+this.value)">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${L === n ? 'selected' : ''}>${n} day${n > 1 ? 's' : ''}</option>`).join('')}</select></div>
          <div><label class="cap-l" for="capTarget">Target booked %</label><input type="number" id="capTarget" min="10" max="100" step="5" value="${target}" onchange="calxCapSet('target',+this.value)"></div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label class="cap-check"><input type="checkbox" ${capState.travelAdmin ? 'checked' : ''} onchange="calxCapSet('travelAdmin',this.checked)"> Count travel &amp; admin days</label>
            <label class="cap-check"><input type="checkbox" ${capState.notice ? 'checked' : ''} onchange="calxCapSet('notice',this.checked)"> 14 working days' notice</label>
            <label class="cap-check"><input type="checkbox" ${capState.includeShadow ? 'checked' : ''} onchange="calxCapSet('includeShadow',this.checked)"> Include shadowing trainers</label>
          </div>
        </div>
        <div class="cap-trainers"><span class="calx-filters-label" style="align-self:center">Trainers</span>${people.map(t => `<button type="button" class="calx-chip" aria-pressed="${(capState.excluded || []).includes(t.name) ? 'false' : 'true'}" onclick="calxCapToggleTrainer('${esc(t.name).replace(/'/g, '&#39;')}')"><i style="background:${trainerColour(t.name)}"></i>${esc(t.name)}</button>`).join('') || '<span style="font-size:12px;color:var(--s-text-muted)">No trainers found</span>'}</div>
      </div>
      ${feedsMissing ? '<div class="cap-warn">⚠️ No team leave has loaded from Humaans, so leave isn\'t being taken off yet. Numbers may look more generous than they really are.</div>' : ''}
      <div class="cap-kpis">
        <div class="cap-kpi"><div class="lbl">Team utilisation</div><div class="val">${util}%</div><div class="sub"><span class="cap-badge" style="background:${st.bg};color:${st.fg}">${st.label}</span> target ${target}%</div></div>
        <div class="cap-kpi"><div class="lbl">Available trainer-days</div><div class="val">${avail}</div><div class="sub">${workingDays} working days × ${rows.length} trainer${rows.length === 1 ? '' : 's'}, after leave &amp; blocks</div></div>
        <div class="cap-kpi"><div class="lbl">Already committed</div><div class="val">${committed}</div><div class="sub">${sum('training')} training${capState.travelAdmin ? ' + ' + sum('travelAdmin') + ' travel/admin' : ''}${held ? ' · ' + held + ' on hold' : ''}</div></div>
        <div class="cap-kpi"><div class="lbl">Free days</div><div class="val">${free}</div><div class="sub">${sum('freeBookable')} bookable${capState.notice ? ' after notice period' : ''}</div></div>
        <div class="cap-kpi"><div class="lbl">Could still fit</div><div class="val">${fits}</div><div class="sub">${L}-day booking${fits === 1 ? '' : 's'} that fit the calendar</div></div>
        <div class="cap-kpi"><div class="lbl">Headroom to target</div><div class="val">${headroom}</div><div class="sub">trainer-days before hitting ${target}%</div></div>
      </div>
      <div class="cap-card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:8px"><strong style="font-size:14px;color:var(--s-text-primary)">By trainer</strong><span style="font-size:12px;color:var(--s-text-muted)">${rangeTxt}</span></div>
        <div style="overflow-x:auto"><table class="cap-t"><thead><tr><th>Trainer</th><th class="num">Available</th><th class="num">Leave</th><th class="num">Training</th>${capState.travelAdmin ? '<th class="num">Travel/admin</th>' : ''}<th class="num">On hold</th><th class="num">Free</th><th class="num">Fits</th><th>Booked</th><th>Status</th></tr></thead><tbody>
        ${rows.sort((a, b) => b.util - a.util).map(r => {
          const s = statusFor(r.util, target);
          const pct = n => r.available ? (n / r.available * 100) : 0;
          return `<tr><td class="name"><i style="background:${trainerColour(r.name)}"></i>${esc(r.name)}</td>
            <td class="num">${r.available}</td><td class="num">${r.leave || '–'}</td><td class="num">${r.training}</td>${capState.travelAdmin ? `<td class="num">${r.travelAdmin}</td>` : ''}<td class="num">${r.held || '–'}</td><td class="num"><strong>${r.free}</strong></td><td class="num"><strong>${r.fits}</strong></td>
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

    h += `<div class="cap-note"><strong>How this is worked out.</strong> Available = weekdays in the period, minus bank holidays, Humaans leave and blocked days. Committed = booked training days${capState.travelAdmin ? ', plus the travel day before and admin day after each block (same rule as the calendar)' : ''}. Provisional holds aren't counted as booked but aren't free either. "Could still fit" looks for gaps long enough for a ${L}-day booking${capState.travelAdmin ? ' plus travel and admin' : ''}${capState.notice ? ', starting at least 14 working days from today' : ''}.</div>`;
    root.innerHTML = h;
    window._calxLastCap = { rows, from, to, util, avail, committed, free, fits, L, target, headroom };
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
    const lines = [
      `*Training capacity: ${fmtShort(c.from)} – ${fmtShort(c.to)}*`,
      `Team is ${c.util}% booked (target ${c.target}%). ${c.free} free trainer-days, room for about ${c.fits} more ${c.L}-day booking${c.fits === 1 ? '' : 's'}.`,
      '',
      ...c.rows.map(r => `• ${r.name}: ${r.util}% booked, ${r.free} free day${r.free === 1 ? '' : 's'}, fits ${r.fits}`),
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
          const r = capacityFor(name, from, to, evMap, { travelAdmin: true, notice: false, length: 1 });
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

  function boot() {
    installCalendar();
    installCapacityPage();
    patchWorkloadCards();
    try { if (typeof allData !== 'undefined' && allData.length) { renderCalendarX(); window.renderTrainerWorkload(); } } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
