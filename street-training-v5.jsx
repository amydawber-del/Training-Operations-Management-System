import { useState, useEffect, useMemo } from "react";

const SHEET_URL = "https://script.google.com/macros/s/AKfycbzCvBhFSPyyoaVsui0DCxvGQQa0V7e_UCJ5LfqvcSysTHTFlNRcx4ewlET5TyouJ0ZYow/exec";
const AGENDA_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRjm9SZ2nPEl_4H5Y2djxFxEzBo0nMJzKErQ4ppm_kHFOifE_tCV7z01K00K4XdReMON9VwvRaCx2fH/pub?output=csv";

// ── Debrief save endpoint ─────────────────────────────────────
// After deploying apps-script.gs as a Google Apps Script Web App,
// replace the placeholder below with your /exec deployment URL.
const DEBRIEF_SHEET_URL = "https://script.google.com/macros/s/AKfycbzlCjx38OiGKdwVRrhz3-etk6o-TMOxtxRQxBdCfwqqcz5tjk_SkYJatmBR5Lk4cIIrGA/exec";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────
const C = {
  blue: "#2147f4", blueLight: "#f0f4ff", blueBorder: "#c5d3ff",
  dark: "#19191e", dark40: "#4c4d57", dark30: "#777989", dark20: "#a8aabb", dark10: "#dfe0ec",
  grey: "#f8f8f8", border: "#e5e5e5",
  yellow: "#d4c84a", yellowBg: "#fffef0",
  green: "#bde4b9", greenDark: "#1a5c18", greenBg: "#e8f5e9",
  amber: "#fff8e1", amberDark: "#856404",
  red: "#fde8eb", redDark: "#9b1c2e",
  orange: "#fff3e0", orangeDark: "#e65100",
};

// ─── MOCK DATA ─────────────────────────────────────────────────────────────
const MOCK_ROWS = [
  {
    "Company / Business Name:": "Ashtons Estate Agents",
    "Status": "Confirmed", "Assigned Trainer": "James Walker",
    "Preferred Training Date(s)": "12th March 2025", "Target go-live date": "1st April 2025",
    "Client Stakeholder Name and Phone Number (Authorising Training)": "Sarah Mitchell — 07712 334 891",
    "Email address": "sarah@ashtons.co.uk",
    "Attendees": "8 — mixed sales and lettings team, 2 senior negotiators, 1 office manager",
    "How familiar is your team with Street.co.uk?": "Some familiarity — been using for 6 months but not consistently",
    "What type of training are you interested in?": "Full system refresh + lettings workflow deep dive",
    "Which areas of Street are you wanting to cover during your training?": "Lettings, Accounting, Reporting",
    "Are there specific features or workflows you want to cover?": "Invoice allocation, aged debt reporting, split landlord setup",
    "What are your top 3 priorities for this training day?": "1. Lettings progression clarity\n2. Accounting confidence\n3. Reporting for management",
    "How would you like us to handle post-training support?": "Email recap + 30-day follow-up call",
    "Training Location (If Applicable and Not at Street HQ)": "Ashtons Head Office, 14 High Street, Guildford, GU1 3AA",
    "Parking Instructions or Specific Venue Information": "NCP car park across the road — ask reception for a permit",
    "Venue Setup Confirmation": "Yes — projector and screen confirmed",
    "Is there anything else we should know to make the training valuable for your team?": "Team has had previous negative experience with onboarding — wants a fresh start",
    "Referred By": "Street CS Team", "Invoice Value": "1200", "Score": "87",
    "Booked On Date": "14th Feb 2025", "Column 1": "Priority account — handle with care",
  },
  {
    "Company / Business Name:": "Paramount Properties",
    "Status": "Pending", "Assigned Trainer": "Laura Chen",
    "Preferred Training Date(s)": "19th March 2025", "Target go-live date": "15th April 2025",
    "Client Stakeholder Name and Phone Number (Authorising Training)": "David Park — 07800 112 445",
    "Email address": "david@paramountprop.co.uk", "Attendees": "5 — sales team only",
    "How familiar is your team with Street.co.uk?": "New users — just migrated from competitor CRM",
    "What type of training are you interested in?": "Full onboarding — sales focus",
    "Which areas of Street are you wanting to cover during your training?": "Sales, Pipeline Management, Applicants",
    "Are there specific features or workflows you want to cover?": "Offer management, sales memo generation, solicitor chasing",
    "What are your top 3 priorities for this training day?": "1. Sales pipeline confidence\n2. Offer workflow\n3. Applicant management",
    "How would you like us to handle post-training support?": "Dedicated Slack channel for 30 days",
    "Training Location (If Applicable and Not at Street HQ)": "Street HQ",
    "Parking Instructions or Specific Venue Information": "—", "Venue Setup Confirmation": "Confirmed",
    "Is there anything else we should know to make the training valuable for your team?": "Team is very motivated — came from a poor CRM experience",
    "Referred By": "Inbound inquiry", "Invoice Value": "950", "Score": "92",
    "Booked On Date": "20th Feb 2025", "Column 1": "",
  },
];

const HEADER_MAP = {
  company: "Company / Business Name:", status: "Status", trainer: "Assigned Trainer",
  date: "Preferred Training Date(s)", goLive: "Target go-live date",
  stakeholder: "Client Stakeholder Name and Phone Number (Authorising Training)",
  email: "Email address", attendees: "Attendees",
  familiar: "How familiar is your team with Street.co.uk?",
  trainingType: "What type of training are you interested in?",
  areas: "Which areas of Street are you wanting to cover during your training?",
  features: "Are there specific features or workflows you want to cover?",
  priorities: "What are your top 3 priorities for this training day?",
  followUp: "How would you like us to handle post-training support?",
  location: "Training Location (If Applicable and Not at Street HQ)",
  parking: "Parking Instructions or Specific Venue Information",
  venueSetup: "Venue Setup Confirmation",
  anything: "Is there anything else we should know to make the training valuable for your team?",
  referred: "Referred By", invoice: "Invoice Value", score: "Score",
  booked: "Booked On Date", col1: "Column 1",
};

// ─── HELP CENTRE BANK ────────────────────────────────────────────────────
const HELP_CENTRE_BANK = {
  Sales: [
    { title: "Managing your sales pipeline", url: "#" },
    { title: "Creating and sending offer letters", url: "#" },
    { title: "Sales progression & memo generation", url: "#" },
    { title: "Applicant matching & auto-alerts", url: "#" },
    { title: "Solicitor chasing workflow", url: "#" },
  ],
  Lettings: [
    { title: "Lettings progression — offer to move-in", url: "#" },
    { title: "Setting up and managing tenancies", url: "#" },
    { title: "Maintenance workflow & contractor management", url: "#" },
    { title: "Split landlord setup guide", url: "#" },
    { title: "Renewals and end-of-tenancy process", url: "#" },
  ],
  Accounting: [
    { title: "Invoice creation & allocation guide", url: "#" },
    { title: "Understanding the landlord & tenant ledger", url: "#" },
    { title: "Aged debt report — how to read & action", url: "#" },
    { title: "Supplier payments & contractor invoicing", url: "#" },
    { title: "Month-end & reconciliation checklist", url: "#" },
  ],
  Reporting: [
    { title: "Building custom reports in Street", url: "#" },
    { title: "Management dashboard overview", url: "#" },
    { title: "Exporting data & team performance reports", url: "#" },
  ],
  General: [
    { title: "Street platform overview & navigation", url: "#" },
    { title: "User settings & permissions guide", url: "#" },
    { title: "Automations & workflow triggers", url: "#" },
    { title: "Street mobile app — getting started", url: "#" },
  ],
};

// ─── HELPERS ──────────────────────────────────────────────────────────────
function h(row, key) {
  const header = HEADER_MAP[key];
  if (!header || !row) return "—";
  return row[header] || "—";
}
function mapRow(headers, row) {
  const obj = {};
  headers.forEach((header, i) => { obj[header] = row[i] || ""; });
  return obj;
}
function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const cols = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || "").replace(/^"|"$/g, ""); });
    return obj;
  });
}
function buildAgendaFromAreas(areasStr, agendaData) {
  if (!agendaData.length || !areasStr || areasStr === "—") return [];
  const requested = areasStr.split(/,|;|\n/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const grouped = {};
  agendaData.forEach(row => {
    const area = (row["Area of Street"] || "").trim();
    if (!area) return;
    const areaLow = area.toLowerCase();
    const matches = requested.some(r => areaLow.includes(r) || r.includes(areaLow) || r.split(" ").some(w => w.length > 3 && areaLow.includes(w)));
    if (matches) {
      if (!grouped[area]) grouped[area] = [];
      const item = row["Street Agenda"] || "";
      const involves = row["What it Involves:"] || "";
      const category = row["Street Settings Category"] || "";
      if (item) grouped[area].push({ item, involves, category });
    }
  });
  return Object.entries(grouped).map(([area, items]) => ({ area, items }));
}

// Auto-derive primary training theme from areas string
function deriveTheme(areasStr) {
  if (!areasStr || areasStr === "—") return "General";
  const s = areasStr.toLowerCase();
  const scores = { "Accounting": 0, "Lettings": 0, "Sales": 0, "Reporting": 0, "Property Management": 0 };
  if (s.includes("account") || s.includes("invoice") || s.includes("ledger") || s.includes("debt")) scores["Accounting"] += 3;
  if (s.includes("letting") || s.includes("tenancy") || s.includes("landlord") || s.includes("maintenance")) scores["Lettings"] += 3;
  if (s.includes("sales") || s.includes("pipeline") || s.includes("offer") || s.includes("applicant")) scores["Sales"] += 3;
  if (s.includes("report") || s.includes("dashboard") || s.includes("analytics")) scores["Reporting"] += 3;
  if (s.includes("property") || s.includes("management") || s.includes("pm")) scores["Property Management"] += 3;
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return "General Optimisation";
  if (sorted[0][1] === sorted[1][1] && sorted[1][1] > 0) return `${sorted[0][0]} & ${sorted[1][0]}`;
  return `${sorted[0][0]} Driven`;
}

// ─── RISK FLAG LOGIC ──────────────────────────────────────────────────────
function getRiskLevel(notes) {
  const high = notes.adoptionRisk === "High" || notes.adoptionRisk === "Critical" || notes.escalation === "Yes — urgent" || notes.escalation === "High";
  const med = notes.adoptionRisk === "Medium" || notes.escalation === "Yes — within 7 days" || notes.escalation === "Medium";
  if (high) return "high";
  if (med) return "medium";
  return "low";
}
function getRiskStyle(level) {
  if (level === "high") return { bg: C.red, color: C.redDark, border: "#f9b4bc", label: "HIGH RISK — action required" };
  if (level === "medium") return { bg: C.amber, color: C.amberDark, border: "#f1c238", label: "MEDIUM RISK — monitor closely" };
  return { bg: C.greenBg, color: C.greenDark, border: "#7bc97a", label: "LOW RISK — on track" };
}

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────
const StreetLogo = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div style={{ width: 28, height: 28, borderRadius: 4, background: C.blue, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 15, fontWeight: 900, color: "#fff", fontFamily: "Arial" }}>S</span>
    </div>
    <span style={{ fontSize: 14, fontWeight: 700, color: C.dark, letterSpacing: "-0.01em" }}>street</span>
  </div>
);

function NotesBlock({ label, placeholder, value, onChange, minHeight = 68 }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <textarea className="notes-input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", minHeight, padding: "8px 12px", fontFamily: "Arial, sans-serif", fontSize: 13, lineHeight: "20px", color: C.dark, background: C.yellowBg, border: `1px dashed ${C.yellow}`, borderRadius: 4, resize: "vertical", outline: "none" }} />
    </div>
  );
}

function EditableBulletList({ items, onChange, placeholder = "Add item…" }) {
  const add = () => onChange([...items, ""]);
  const update = (i, v) => { const n = [...items]; n[i] = v; onChange(n); };
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.blue, marginTop: 8, flexShrink: 0 }} />
          <input type="text" value={item} onChange={e => update(i, e.target.value)} placeholder={placeholder}
            style={{ flex: 1, border: "none", borderBottom: `1px dashed ${C.yellow}`, padding: "3px 0", fontFamily: "Arial, sans-serif", fontSize: 13, color: C.dark, background: "transparent", outline: "none" }} />
          <button className="no-print" onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", color: C.dark20, fontSize: 14, padding: "0 2px", flexShrink: 0 }}>×</button>
        </div>
      ))}
      <button className="no-print" onClick={add} style={{ background: "none", border: `1px dashed ${C.border}`, borderRadius: 4, padding: "4px 10px", fontSize: 11, color: C.dark30, cursor: "pointer", marginTop: 4 }}>+ Add item</button>
    </div>
  );
}

function TagSelect({ label, k, options, notes, setNotes, colored = false }) {
  const val = notes[k] || "";
  const colorMap = {
    "High": { bg: C.red, color: C.redDark, border: "#f9b4bc" },
    "Critical": { bg: C.red, color: C.redDark, border: "#f9b4bc" },
    "Medium": { bg: C.amber, color: C.amberDark, border: "#f1c238" },
    "Low": { bg: C.greenBg, color: C.greenDark, border: "#7bc97a" },
    "Yes — urgent": { bg: C.red, color: C.redDark, border: "#f9b4bc" },
    "High potential": { bg: C.greenBg, color: C.greenDark, border: "#7bc97a" },
    "Resistant": { bg: C.red, color: C.redDark, border: "#f9b4bc" },
    "Defensive": { bg: C.red, color: C.redDark, border: "#f9b4bc" },
    "Fully Met": { bg: C.greenBg, color: C.greenDark, border: "#7bc97a" },
    "Not Met": { bg: C.red, color: C.redDark, border: "#f9b4bc" },
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {options.map(opt => {
          const isActive = val === opt;
          const style = colored && isActive && colorMap[opt] ? colorMap[opt] : null;
          return (
            <button key={opt} onClick={() => setNotes(prev => ({ ...prev, [k]: isActive ? "" : opt }))} style={{
              padding: "5px 11px", borderRadius: 3, cursor: "pointer", fontFamily: "Arial, sans-serif", fontSize: 12,
              fontWeight: isActive ? 700 : 400,
              background: style ? style.bg : isActive ? C.blue : C.grey,
              color: style ? style.color : isActive ? "#fff" : C.dark40,
              border: `1px solid ${style ? style.border : isActive ? C.blue : C.border}`,
              transition: "all 0.1s"
            }}>{opt}</button>
          );
        })}
      </div>
    </div>
  );
}

function ComplexityScore({ value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Workflow Complexity Score (1–5)</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(value === n ? 0 : n)} style={{
            width: 36, height: 36, borderRadius: 4, cursor: "pointer", fontFamily: "Arial", fontSize: 14, fontWeight: 700,
            background: n <= value ? C.blue : C.grey,
            color: n <= value ? "#fff" : C.dark20,
            border: `1px solid ${n <= value ? C.blue : C.border}`,
            transition: "all 0.1s"
          }}>{'★'}</button>
        ))}
        {value > 0 && (
          <span style={{ fontSize: 12, color: value >= 4 ? C.redDark : value >= 3 ? C.amberDark : C.greenDark, fontWeight: 600, marginLeft: 6 }}>
            {value === 1 ? "Simple" : value === 2 ? "Straightforward" : value === 3 ? "Moderate" : value === 4 ? "Complex" : "Very Complex"}
          </span>
        )}
      </div>
    </div>
  );
}

function ConfidenceBar({ label, value, onChange, color }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
        {value > 0 && <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}/10</span>}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
          <button key={n} onClick={() => onChange(value === n ? 0 : n)} style={{
            flex: 1, height: 28, borderRadius: 3, cursor: "pointer", border: "none",
            background: n <= value ? color : C.grey, opacity: n <= value ? 1 : 0.4,
            transition: "all 0.1s", fontSize: 10, color: n <= value ? "#fff" : C.dark30, fontWeight: 600
          }}>{n}</button>
        ))}
      </div>
    </div>
  );
}

function Section({ num, title, children, flagged = false }) {
  return (
    <div style={{ marginBottom: 28, pageBreakInside: "avoid", ...(flagged ? { background: C.red, border: `1px solid #f9b4bc`, borderRadius: 4, padding: "16px", marginBottom: 28 } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        {num && <div style={{ width: 22, height: 22, borderRadius: "50%", background: flagged ? C.redDark : C.blue, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11, flexShrink: 0 }}>{num}</div>}
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: flagged ? C.redDark : C.dark30 }}>{title}</h3>
        <div style={{ flex: 1, height: 1, background: flagged ? "#f9b4bc" : C.border }} />
        {flagged && <span style={{ fontSize: 10, fontWeight: 700, color: C.redDark, background: C.red, border: `1px solid #f9b4bc`, borderRadius: 3, padding: "2px 7px" }}>AUTO-FLAGGED</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 12px", fontSize: 14, color: C.dark, lineHeight: "20px" }}>{value || "—"}</div>
    </div>
  );
}

function PrepBlock({ title, prompts }) {
  return (
    <div style={{ background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderLeft: `3px solid ${C.blue}`, borderRadius: "0 4px 4px 0", padding: "12px 14px", marginTop: 8 }}>
      <div style={{ fontSize: 11, color: C.blue, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, fontWeight: 700 }}>{title}</div>
      {prompts.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 13, color: C.dark40, lineHeight: "18px" }}>
          <span style={{ color: C.blue, flexShrink: 0, fontWeight: 700 }}>›</span><span>{p}</span>
        </div>
      ))}
    </div>
  );
}

function DynamicAgenda({ agendaBlocks, agendaLoading, areasRaw }) {
  if (agendaLoading) return <div style={{ padding: "10px 0", fontSize: 13, color: C.dark20 }}>Loading agenda data…</div>;
  if (!agendaBlocks.length) return <div style={{ padding: "12px 14px", border: `1px solid ${C.border}`, borderRadius: 4, background: C.grey, fontSize: 13, color: C.dark30 }}>No matching items found for: <em>{areasRaw}</em></div>;
  return (
    <div>
      {agendaBlocks.map((block, bi) => (
        <div key={bi} style={{ border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: 8, overflow: "hidden" }}>
          <div style={{ background: C.blueLight, borderBottom: `1px solid ${C.blueBorder}`, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.blue, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.06em" }}>{block.area}</span>
            <span style={{ fontSize: 10, color: C.dark20, marginLeft: "auto" }}>{block.items.length} item{block.items.length !== 1 ? "s" : ""}</span>
          </div>
          {block.items.map((item, ii) => (
            <div key={ii} style={{ padding: "8px 12px", borderBottom: ii < block.items.length - 1 ? `1px solid ${C.border}` : "none", display: "flex", gap: 10 }}>
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.dark20, marginTop: 7, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>{item.item}</div>
                {item.involves && <div style={{ fontSize: 12, color: C.dark30, marginTop: 2 }}>{item.involves}</div>}
                {item.category && <span style={{ fontSize: 10, color: C.blue, background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderRadius: 3, padding: "1px 6px", display: "inline-block", marginTop: 3 }}>{item.category}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── TRAINER PREP VIEW ────────────────────────────────────────────────────
function TrainerView({ row, agendaBlocks, agendaLoading, notes, setNotes }) {
  const n = k => notes[k] || "";
  const sn = k => v => setNotes(p => ({ ...p, [k]: v }));
  const nb = (label, k, ph, mh = 68) => <NotesBlock label={label} placeholder={ph} value={n(k)} onChange={sn(k)} minHeight={mh} />;
  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: C.dark, fontSize: 14, lineHeight: "20px" }}>
      <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "20px 24px", marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: C.blue, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>TRAINER INTERNAL — NOT CLIENT FACING</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{h(row, "company")}</h1>
        <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
          {[["Status", h(row, "status")], ["Trainer", h(row, "trainer")], ["Date", h(row, "date")], ["Invoice", `£${h(row, "invoice")}`]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: 10, color: C.dark30, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{l}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div></div>
          ))}
        </div>
      </div>
      <Section num="1" title="Stakeholder Map">
        <Field label="Authorising Contact" value={h(row, "stakeholder")} />
        <Field label="Attendees" value={h(row, "attendees")} />
        <PrepBlock title="Stakeholder Prompts" prompts={["Who holds decision power in this team?", "Who influences workflow day-to-day?", "Who might resist adopting new processes?", "Who needs high-level confidence vs granular detail?", "Mixed seniority? Sales vs Lettings split?", "Admin-heavy? Accounting confidence level?"]} />
        {nb("Stakeholder Notes", "stakeholder", "Observations about the stakeholder landscape…")}
      </Section>
      <Section num="2" title="Experience & Risk Assessment">
        <Field label="Team Familiarity with Street" value={h(row, "familiar")} />
        <PrepBlock title="Internal Reflection" prompts={["Is this a refresher, optimisation, or recovery session?", "Are they under-utilising key features?", "Where is the biggest efficiency leak?", "What's the likely resistance point?"]} />
        {nb("Risk Notes", "risk", "Concerns, risks, context about experience level…")}
      </Section>
      <Section num="3" title="Requested Focus Areas">
        <Field label="Training Type" value={h(row, "trainingType")} />
        <Field label="Areas Requested" value={h(row, "areas")} />
        <Field label="Specific Features / Workflows" value={h(row, "features")} />
        <Field label="Top 3 Priorities" value={h(row, "priorities")} />
        <PrepBlock title="What They're Not Saying" prompts={["Where are they probably inefficient that they haven't flagged?", "Automation opportunities to surface unprompted?", "Which demo scenarios to preload?", "Need: aged debt / split landlord / invoice allocated / maintenance / progression chain?"]} />
        {nb("Prep Notes", "prep", "Demo accounts to prepare, data scenarios, kit needed…")}
      </Section>
      <Section num="4" title="Dynamic Agenda — Built from Areas Requested">
        <div style={{ fontSize: 12, color: C.dark30, marginBottom: 10 }}>Matching to: <strong style={{ color: C.dark }}>{h(row, "areas")}</strong></div>
        <DynamicAgenda agendaBlocks={agendaBlocks} agendaLoading={agendaLoading} areasRaw={h(row, "areas")} />
        {nb("Additional Agenda Notes", "agendaExtra", "Custom agenda items, structure notes…", 52)}
      </Section>
      <Section num="5" title="Logistics Check">
        <Field label="Location" value={h(row, "location")} />
        <Field label="Parking / Venue" value={h(row, "parking")} />
        <Field label="Venue Setup" value={h(row, "venueSetup")} />
        <PrepBlock title="Kit Check" prompts={["HDMI cable required on-site?", "Wi-Fi backup / hotspot ready?", "Printed workbook needed?", "Demo account refreshed?"]} />
        {nb("Logistics Notes", "logistics", "Travel, venue, setup notes…", 52)}
      </Section>
      <Section num="6" title="Post-Training Plan">
        <Field label="Client Preference" value={h(row, "followUp")} />
        <PrepBlock title="Follow-Up Actions" prompts={["Diary placeholder booked?", "Email recap prepared?", "Resource pack ready?", "Internal escalation needed?"]} />
        {nb("Follow-up Notes", "followup", "Draft follow-up plan, action items…")}
      </Section>
      <Section num="7" title="Internal Notes">
        <Field label="Additional Context" value={h(row, "anything")} />
        <Field label="Column 1 Notes" value={h(row, "col1")} />
        <Field label="Score" value={h(row, "score")} />
        <Field label="Referred By" value={h(row, "referred")} />
        {nb("General Internal Notes", "general", "Anything else for the team…")}
      </Section>
    </div>
  );
}

// ─── CLIENT DOC VIEW ──────────────────────────────────────────────────────
function ClientView({ row, agendaBlocks, agendaLoading, notes, setNotes }) {
  const n = k => notes[k] || "";
  const sn = k => v => setNotes(p => ({ ...p, [k]: v }));
  const DataRow = ({ label, value }) => (
    <div style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 12, color: C.dark30, fontWeight: 600, minWidth: 160, flexShrink: 0 }}>{label}</div>
      <div style={{ fontSize: 14, color: C.dark, lineHeight: "20px" }}>{value || "—"}</div>
    </div>
  );
  const BulletList = ({ text }) => {
    if (!text || text === "—") return <div style={{ color: C.dark30 }}>—</div>;
    return <div>{text.split(/\n/).map(s => s.trim()).filter(Boolean).map((item, i) => (
      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 7, alignItems: "flex-start" }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.blue, marginTop: 7, flexShrink: 0 }} />
        <span style={{ fontSize: 14, color: C.dark, lineHeight: "20px" }}>{item}</span>
      </div>
    ))}</div>;
  };
  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: C.dark, fontSize: 14, lineHeight: "20px" }}>
      <div style={{ borderLeft: `3px solid ${C.blue}`, paddingLeft: 20, marginBottom: 28 }}>
        <div style={{ fontSize: 11, color: C.blue, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Street Product Training</div>
        <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{h(row, "company")}</h1>
        <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
          {[["Assigned Trainer", h(row, "trainer")], ["Training Date", h(row, "date")], ["Target Go-Live", h(row, "goLive")]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: 10, color: C.dark30, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{l}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div></div>
          ))}
        </div>
      </div>
      <div style={{ background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderLeft: `3px solid ${C.blue}`, borderRadius: "0 4px 4px 0", padding: "16px 20px", marginBottom: 28 }}>
        <div style={{ fontSize: 11, color: C.blue, textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>Training Objectives</div>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: C.dark40 }}>This session is designed to ensure your team is fully utilising Street, with particular focus on:</p>
        <BulletList text={h(row, "priorities")} />
      </div>
      <Section num="1" title="Attendees">
        <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "14px 16px", marginBottom: 10 }}>
          <p style={{ margin: 0 }}>{h(row, "attendees")}</p>
        </div>
        <DataRow label="Authorising Contact" value={h(row, "stakeholder")} />
        <NotesBlock label="Attendee Notes" placeholder="Notes about specific attendees or group dynamics…" value={n("attendees")} onChange={sn("attendees")} />
      </Section>
      <Section num="2" title="Session Agenda">
        <div style={{ fontSize: 12, color: C.dark30, marginBottom: 10 }}>Areas covered: <strong style={{ color: C.dark }}>{h(row, "areas")}</strong></div>
        <DynamicAgenda agendaBlocks={agendaBlocks} agendaLoading={agendaLoading} areasRaw={h(row, "areas")} />
        <NotesBlock label="Session Notes" placeholder="Custom agenda items or session notes for the client…" value={n("session")} onChange={sn("session")} />
      </Section>
      <Section num="3" title="Post-Training Support">
        <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "14px 16px" }}>
          <p style={{ margin: 0 }}>{h(row, "followUp")}</p>
        </div>
        <NotesBlock label="Support Notes" placeholder="Agreed follow-up commitments…" value={n("support")} onChange={sn("support")} />
      </Section>
      <Section num="4" title="Location & Logistics">
        <DataRow label="Venue" value={h(row, "location")} />
        <DataRow label="Parking / Info" value={h(row, "parking")} />
        <DataRow label="Setup Confirmed" value={h(row, "venueSetup")} />
        <NotesBlock label="Logistics Notes" placeholder="Additional venue or setup details…" value={n("logistics")} onChange={sn("logistics")} />
      </Section>
      <Section num="5" title="Additional Notes">
        <NotesBlock label="General Notes" placeholder="Any other information to include…" value={n("clientGeneral")} onChange={sn("clientGeneral")} minHeight={100} />
      </Section>
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: C.dark20 }}>STREET.CO.UK — CONFIDENTIAL</div>
        <div style={{ fontSize: 11, color: C.dark20 }}>TRAINING DOCUMENT</div>
      </div>
    </div>
  );
}

// ─── POST-TRAINING SUMMARY PACK (CLIENT) ──────────────────────────────────
function PostTrainingClientView({ row, agendaBlocks, agendaLoading, notes, setNotes }) {
  const n = (k, def) => notes[k] !== undefined ? notes[k] : (def !== undefined ? def : "");
  const sn = k => v => setNotes(p => ({ ...p, [k]: v }));

  const preConf = n("preConfidence", 0);
  const postConf = n("postConfidence", 0);
  const delta = preConf && postConf ? postConf - preConf : null;

  const qaRows = n("qa", [{ area: "", q: "", a: "", followUp: false }]);
  const addQA = () => sn("qa")([...qaRows, { area: "", q: "", a: "", followUp: false }]);
  const updateQA = (i, field, val) => { const r = [...qaRows]; r[i] = { ...r[i], [field]: val }; sn("qa")(r); };
  const removeQA = (i) => sn("qa")(qaRows.filter((_, j) => j !== i));

  const [helpActive, setHelpActive] = useState(["Sales", "Lettings"]);
  const [helpSelected, setHelpSelected] = useState(n("helpSelected", []));
  const toggleCat = (cat) => setHelpActive(p => p.includes(cat) ? p.filter(c => c !== cat) : [...p, cat]);
  const toggleItem = (key) => { const next = helpSelected.includes(key) ? helpSelected.filter(k => k !== key) : [...helpSelected, key]; setHelpSelected(next); sn("helpSelected")(next); };
  const selectedLinks = helpSelected.map(key => { const [cat, idx] = key.split("-"); return HELP_CENTRE_BANK[cat]?.[parseInt(idx)]; }).filter(Boolean);

  const confColor = (v) => v <= 4 ? C.redDark : v <= 6 ? C.amberDark : C.greenDark;
  const confBg = (v) => v <= 4 ? "#ef5350" : v <= 6 ? "#ff9800" : "#4caf50";

  const BulletList = ({ text }) => {
    if (!text || text === "—") return null;
    return <div>{text.split(/\n/).map(s => s.trim()).filter(Boolean).map((item, i) => (
      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, alignItems: "flex-start" }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.blue, marginTop: 7, flexShrink: 0 }} />
        <span style={{ fontSize: 14, color: C.dark, lineHeight: "20px" }}>{item}</span>
      </div>
    ))}</div>;
  };

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: C.dark, fontSize: 14, lineHeight: "20px" }}>
      {/* Doc header */}
      <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: `3px solid ${C.blue}` }}>
        <div style={{ fontSize: 10, color: C.blue, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>STREET PRODUCT TRAINING</div>
        <div style={{ fontSize: 11, color: C.dark30, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Post-Training Summary Pack</div>
        <h1 style={{ margin: "0 0 16px", fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{h(row, "company")}</h1>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          {[["Training Date", h(row, "date")], ["Trainer", h(row, "trainer")], ["Attendees", h(row, "attendees")]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: 10, color: C.dark30, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{l}</div><div style={{ fontSize: 13, fontWeight: 600, maxWidth: 300 }}>{v}</div></div>
          ))}
        </div>
      </div>

      {/* Confidence Delta */}
      <Section num={null} title="Confidence Score">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 14px" }}>
            <ConfidenceBar label="Pre-Session Confidence" value={preConf} onChange={v => sn("preConfidence")(v)} color="#ff9800" />
          </div>
          <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 14px" }}>
            <ConfidenceBar label="Post-Session Confidence" value={postConf} onChange={v => sn("postConfidence")(v)} color="#4caf50" />
          </div>
        </div>
        {delta !== null && (
          <div style={{
            background: delta >= 0 ? C.greenBg : C.red, border: `1px solid ${delta >= 0 ? "#7bc97a" : "#f9b4bc"}`,
            borderRadius: 4, padding: "10px 16px", display: "flex", alignItems: "center", gap: 14
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: delta >= 0 ? C.greenDark : C.redDark }}>
              {delta >= 0 ? "+" : ""}{delta}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: delta >= 0 ? C.greenDark : C.redDark, textTransform: "uppercase", letterSpacing: "0.06em" }}>Confidence Delta</div>
              <div style={{ fontSize: 12, color: delta >= 0 ? C.greenDark : C.redDark }}>
                {delta >= 3 ? "Strong uplift — excellent session outcome" : delta >= 1 ? "Positive progress — good session" : delta === 0 ? "No change — consider follow-up session" : "Score dropped — review session notes"}
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section num="1" title="Session Overview">
        <p style={{ fontSize: 14, color: C.dark, marginBottom: 12 }}>Thank you for your time during your Street training session. The session focused on:</p>
        <div style={{ background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderLeft: `3px solid ${C.blue}`, borderRadius: "0 4px 4px 0", padding: "12px 16px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: C.dark40 }}>{h(row, "areas")}</div>
        </div>
        <p style={{ fontSize: 14, color: C.dark40, marginBottom: 8 }}>With particular attention to:</p>
        <BulletList text={h(row, "priorities")} />
        <NotesBlock label="Session Overview Notes" placeholder="Additional overview context…" value={n("overviewNotes")} onChange={sn("overviewNotes")} minHeight={52} />
      </Section>

      <Section num="2" title="What We Covered">
        <p style={{ fontSize: 12, color: C.dark30, marginBottom: 14, fontStyle: "italic" }}>Customise before sending — fill in what was actually covered.</p>
        {[["Sales", "covered_sales"], ["Lettings Front End", "covered_lettings"], ["Property Management", "covered_pm"], ["Accounting & Invoicing", "covered_accounting"]].map(([label, k]) => (
          <div key={k} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.dark40, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{label}</div>
            <EditableBulletList items={n(k, [""])} onChange={sn(k)} placeholder="Add topic covered…" />
          </div>
        ))}
      </Section>

      <Section num="3" title="Key Workflow Improvements Identified">
        <p style={{ fontSize: 14, color: C.dark40, marginBottom: 12 }}>During the session, we discussed the following optimisation opportunities:</p>
        <EditableBulletList items={n("workflows", [""])} onChange={sn("workflows")} placeholder="Add workflow improvement…" />
      </Section>

      <Section num="4" title="Questions Raised & Clarifications Provided">
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 90px", background: C.grey, borderBottom: `1px solid ${C.border}` }}>
            {["Area", "Question", "Outcome / Explanation", "Follow-Up"].map(col => (
              <div key={col} style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: C.dark30, textTransform: "uppercase", letterSpacing: "0.06em", borderRight: `1px solid ${C.border}` }}>{col}</div>
            ))}
          </div>
          {qaRows.map((row_, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 90px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ borderRight: `1px solid ${C.border}`, padding: "6px 8px" }}>
                <select value={row_.area || ""} onChange={e => updateQA(i, "area", e.target.value)}
                  style={{ width: "100%", border: "none", fontFamily: "Arial", fontSize: 12, color: C.dark, background: "transparent", outline: "none" }}>
                  <option value="">Area…</option>
                  {["Sales", "Lettings", "PM", "Accounting", "Reporting", "General"].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div style={{ borderRight: `1px solid ${C.border}`, padding: "6px 8px" }}>
                <input type="text" value={row_.q} onChange={e => updateQA(i, "q", e.target.value)} placeholder="Question raised…"
                  style={{ width: "100%", border: "none", fontFamily: "Arial", fontSize: 13, color: C.dark, background: "transparent", outline: "none" }} />
              </div>
              <div style={{ borderRight: `1px solid ${C.border}`, padding: "6px 8px" }}>
                <input type="text" value={row_.a} onChange={e => updateQA(i, "a", e.target.value)} placeholder="Outcome…"
                  style={{ width: "100%", border: "none", fontFamily: "Arial", fontSize: 13, color: C.dark, background: "transparent", outline: "none" }} />
              </div>
              <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={row_.followUp || false} onChange={e => updateQA(i, "followUp", e.target.checked)}
                  style={{ accentColor: C.blue, width: 14, height: 14, cursor: "pointer" }} />
                <span style={{ fontSize: 11, color: row_.followUp ? C.redDark : C.dark30 }}>{row_.followUp ? "Yes" : "No"}</span>
                <button className="no-print" onClick={() => removeQA(i)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.dark20, fontSize: 13 }}>×</button>
              </div>
            </div>
          ))}
        </div>
        <button className="no-print" onClick={addQA} style={{ background: "none", border: `1px dashed ${C.border}`, borderRadius: 4, padding: "5px 12px", fontSize: 11, color: C.dark30, cursor: "pointer", marginTop: 6 }}>+ Add Q&A row</button>
      </Section>

      <Section num="5" title="Agreed Actions">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[["Actions for " + h(row, "company"), "actionsClient"], ["Actions for Street", "actionsStreet"]].map(([label, k]) => (
            <div key={k}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.dark40, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{label}</div>
              <EditableBulletList items={n(k, [""])} onChange={sn(k)} placeholder="Add action…" />
            </div>
          ))}
        </div>
      </Section>

      <Section num="6" title="Help Centre & Resources Shared">
        <div className="no-print" style={{ marginBottom: 12 }}>
          <div style={{ background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderRadius: 4, padding: "10px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: C.blue, fontWeight: 700, textTransform: "uppercase" }}>Filter:</span>
            {Object.keys(HELP_CENTRE_BANK).map(cat => (
              <button key={cat} onClick={() => toggleCat(cat)} style={{ padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontFamily: "Arial", fontSize: 11, fontWeight: helpActive.includes(cat) ? 700 : 400, background: helpActive.includes(cat) ? C.blue : "#fff", color: helpActive.includes(cat) ? "#fff" : C.dark30, border: `1px solid ${helpActive.includes(cat) ? C.blue : C.border}` }}>{cat}</button>
            ))}
          </div>
          {Object.keys(HELP_CENTRE_BANK).filter(cat => helpActive.includes(cat)).map(cat => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{cat}</div>
              {HELP_CENTRE_BANK[cat].map((link, i) => {
                const key = `${cat}-${i}`; const isSel = helpSelected.includes(key);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, padding: "6px 10px", borderRadius: 4, background: isSel ? C.blueLight : C.grey, border: `1px solid ${isSel ? C.blueBorder : C.border}`, cursor: "pointer" }} onClick={() => toggleItem(key)}>
                    <div style={{ width: 14, height: 14, borderRadius: 2, background: isSel ? C.blue : "#fff", border: `1.5px solid ${isSel ? C.blue : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {isSel && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 13, color: isSel ? C.blue : C.dark40 }}>{link.title}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {selectedLinks.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {selectedLinks.map((link, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.blue, marginTop: 7, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: C.blue }}>{link.title}</span>
              </div>
            ))}
          </div>
        )}
        <NotesBlock label="Additional Resources" placeholder="Recording links, template resources, custom URLs…" value={n("resources")} onChange={sn("resources")} minHeight={52} />
      </Section>

      <Section num="7" title="Next Steps & Ongoing Support">
        <div style={{ background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderLeft: `3px solid ${C.blue}`, borderRadius: "0 4px 4px 0", padding: "14px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.dark30, marginBottom: 6, fontWeight: 600 }}>As requested by {h(row, "company")}:</div>
          <div style={{ fontSize: 14, color: C.dark }}>{h(row, "followUp")}</div>
        </div>
        {["Booking a follow-up session in 2–4 weeks", "Reviewing internal workflows with the team", "Identifying one system owner per department"].map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 7 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.dark20, marginTop: 7, flexShrink: 0 }} />
            <span style={{ fontSize: 14, color: C.dark40 }}>{item}</span>
          </div>
        ))}
        <NotesBlock label="Next Steps Notes" placeholder="Additional next step commitments or timelines…" value={n("nextSteps")} onChange={sn("nextSteps")} minHeight={52} />
      </Section>

      <Section num="8" title="Overall Objective Reminder">
        {["Full system utilisation", "Workflow clarity across the team", "Cross-team consistency", "Confidence in accounting and invoicing processes"].map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 7 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.blue, marginTop: 7, flexShrink: 0 }} />
            <span style={{ fontSize: 14, color: C.dark }}>{item}</span>
          </div>
        ))}
        <p style={{ fontSize: 14, color: C.dark40, marginTop: 14 }}>We're here to support you as you continue embedding these improvements.</p>
      </Section>

      <div style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: C.dark20 }}>Street Group | Product Training | {h(row, "trainer")}</div>
        <div style={{ fontSize: 11, color: C.dark20 }}>STREET.CO.UK — CONFIDENTIAL</div>
      </div>
    </div>
  );
}

// ─── INTERNAL DEBRIEF VIEW ────────────────────────────────────────────────
function PostTrainingInternalView({ row, notes, setNotes }) {
  const n = (k, def) => notes[k] !== undefined ? notes[k] : (def !== undefined ? def : "");
  const sn = k => v => setNotes(p => ({ ...p, [k]: v }));
  const nb = (label, k, ph, mh = 68, def = "") => <NotesBlock label={label} placeholder={ph} value={n(k, def)} onChange={sn(k)} minHeight={mh} />;
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const [saveMsg, setSaveMsg] = useState("");

  const handleSave = async () => {
    setSaveStatus("saving");
    setSaveMsg("");
    try {
      const result = await saveDebriefToSheet(row, notes);
      setSaveStatus("saved");
      setSaveMsg(result.action === "updated" ? "Updated existing record ✓" : "New record saved ✓");
      setTimeout(() => setSaveStatus("idle"), 4000);
    } catch (err) {
      setSaveStatus("error");
      setSaveMsg(err.message);
    }
  };

  const preConf = n("preConfidence", 0);
  const postConf = n("postConfidence", 0);
  const delta = preConf && postConf ? postConf - preConf : null;

  const prepHours = parseFloat(n("prepHours", "")) || 0;
  const deliveryHours = parseFloat(n("deliveryHours", "")) || 0;
  const followUpHours = parseFloat(n("followUpHours", "")) || 0;
  const totalHours = prepHours + deliveryHours + followUpHours;
  const invoiceVal = parseFloat((h(row, "invoice") || "").replace(/[^0-9.]/g, "")) || 0;
  const revenuePerHour = totalHours > 0 && invoiceVal > 0 ? (invoiceVal / totalHours).toFixed(2) : null;

  const theme = deriveTheme(h(row, "areas"));
  const riskLevel = getRiskLevel(notes);
  const riskStyle = getRiskStyle(riskLevel);

  const ts = (k, opts) => <TagSelect label={k} k={k.toLowerCase().replace(/[^a-z]/g, "_")} options={opts} notes={notes} setNotes={setNotes} colored />;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: C.dark, fontSize: 14, lineHeight: "20px" }}>

      {/* Header */}
      <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "20px 24px", marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: C.blue, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>POST-TRAINING INTERNAL DEBRIEF — NOT CLIENT FACING</div>
        <h1 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700 }}>{h(row, "company")}</h1>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[["Date", h(row, "date")], ["Trainer", h(row, "trainer")], ["Invoice", `£${h(row, "invoice")}`]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: 10, color: C.dark30, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{l}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div></div>
          ))}
        </div>
      </div>

      {/* Auto-flag banner */}
      {riskLevel !== "low" && (
        <div style={{ background: riskStyle.bg, border: `1px solid ${riskStyle.border}`, borderRadius: 4, padding: "10px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: riskStyle.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: riskStyle.color }}>{riskStyle.label}</span>
          <span style={{ fontSize: 12, color: riskStyle.color, marginLeft: 4 }}>— Adoption Risk: {notes.adoption_risk || "—"} | Escalation: {notes.escalation_required_ || "—"}</span>
        </div>
      )}

      {/* Data Engine snapshot — structured fields for sheet export */}
      <Section num={null} title="Data Engine — Structured Fields">
        <div style={{ background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderLeft: `3px solid ${C.blue}`, borderRadius: "0 4px 4px 0", padding: "12px 16px", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>All structured fields below feed directly into your spreadsheet Data_Engine tab</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[
              ["Primary Theme", theme],
              ["Pre-Session Confidence", preConf || "Not set"],
              ["Post-Session Confidence", postConf || "Not set"],
              ["Confidence Delta", delta !== null ? (delta >= 0 ? `+${delta}` : delta) : "—"],
              ["Total Hours", totalHours || "Not set"],
              ["Revenue / Hour", revenuePerHour ? `£${revenuePerHour}` : "—"],
              ["Risk Level", riskLevel.toUpperCase()],
              ["Repeat Client", notes.repeat_client_ || "Not set"],
              ["Delivery Type", notes.session_delivery_type || "Not set"],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: C.dark30, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.dark }}>{String(value)}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Session Classification */}
      <Section num="1" title="Session Classification">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <TagSelect label="Session Delivery Type" k="session_delivery_type" options={["Onsite", "Remote", "HQ Visit", "Accounting Only", "Recovery Session", "Refresher"]} notes={notes} setNotes={setNotes} />
            <TagSelect label="Repeat Client?" k="repeat_client_" options={["Yes", "No"]} notes={notes} setNotes={setNotes} colored />
            {notes.repeat_client_ === "Yes" && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Previous Session Date</div>
                <input type="text" value={n("prevSessionDate")} onChange={e => sn("prevSessionDate")(e.target.value)} placeholder="e.g. 10th October 2024"
                  style={{ width: "100%", border: `1px dashed ${C.yellow}`, borderRadius: 4, padding: "7px 10px", fontFamily: "Arial", fontSize: 13, color: C.dark, background: C.yellowBg, outline: "none" }} />
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Auto-Detected Primary Theme</div>
            <div style={{ background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderRadius: 4, padding: "9px 12px", fontSize: 14, color: C.blue, fontWeight: 700, marginBottom: 12 }}>{theme}</div>
            <ComplexityScore value={n("complexity", 0)} onChange={v => sn("complexity")(v)} />
          </div>
        </div>
      </Section>

      {/* Confidence */}
      <Section num="2" title="Confidence Score (Pre & Post)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 14px" }}>
            <ConfidenceBar label="Pre-Session Confidence" value={preConf} onChange={v => sn("preConfidence")(v)} color="#ff9800" />
          </div>
          <div style={{ background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, padding: "12px 14px" }}>
            <ConfidenceBar label="Post-Session Confidence" value={postConf} onChange={v => sn("postConfidence")(v)} color="#4caf50" />
          </div>
        </div>
        {delta !== null && (
          <div style={{ background: delta >= 0 ? C.greenBg : C.red, border: `1px solid ${delta >= 0 ? "#7bc97a" : "#f9b4bc"}`, borderRadius: 4, padding: "10px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: delta >= 0 ? C.greenDark : C.redDark }}>{delta >= 0 ? "+" : ""}{delta}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: delta >= 0 ? C.greenDark : C.redDark, textTransform: "uppercase", letterSpacing: "0.06em" }}>Confidence Delta</div>
              <div style={{ fontSize: 12, color: delta >= 0 ? C.greenDark : C.redDark }}>
                {delta >= 3 ? "Strong uplift — excellent outcome" : delta >= 1 ? "Positive progress — good session" : delta === 0 ? "No change — consider follow-up" : "Score dropped — review session notes"}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Commercial */}
      <Section num="3" title="Commercial Assessment" flagged={riskLevel === "high"}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <TagSelect label="Upsell Opportunity Spotted?" k="upsell_opportunity" options={["High potential", "Some opportunity", "Unlikely", "Already maximised"]} notes={notes} setNotes={setNotes} colored />
            <TagSelect label="Escalation Required?" k="escalation_required_" options={["Yes — urgent", "Yes — within 7 days", "Medium", "No", "Monitor"]} notes={notes} setNotes={setNotes} colored />
          </div>
          <div>
            <TagSelect label="Adoption Risk Level" k="adoption_risk" options={["Low", "Medium", "High", "Critical"]} notes={notes} setNotes={setNotes} colored />
            <TagSelect label="System Misuse Identified?" k="system_misuse" options={["Yes — significant", "Yes — minor", "None identified"]} notes={notes} setNotes={setNotes} colored />
          </div>
        </div>
        <TagSelect label="Accounting Readiness Level" k="accounting_readiness" options={["Not ready", "Basic only", "Developing", "Confident", "Advanced"]} notes={notes} setNotes={setNotes} />
        {nb("Commercial Notes", "commercialNotes", "Upsell opportunities, commercial risks, strategic context…", 72)}
      </Section>

      {/* Training Quality */}
      <Section num="4" title="Training Quality Self-Assessment">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <TagSelect label="Session Energy Level" k="session_energy" options={["Very Engaged", "Engaged", "Neutral", "Resistant", "Defensive"]} notes={notes} setNotes={setNotes} colored />
            <TagSelect label="Objectives Met?" k="objectives_met" options={["Fully Met", "Mostly Met", "Partially Met", "Not Met"]} notes={notes} setNotes={setNotes} colored />
          </div>
          <div>
            <TagSelect label="Workflow Complexity" k="complexity_tag" options={["Simple", "Straightforward", "Moderate", "Complex", "Very Complex"]} notes={notes} setNotes={setNotes} colored />
          </div>
        </div>
        {nb("What Went Well", "wentWell", "Strong moments, high engagement, things that landed well…", 60)}
        {nb("What To Improve", "improved", "Pacing issues, confusion points, topics to refine next time…", 60)}
      </Section>

      {/* Time Tracking */}
      <Section num="5" title="Time Tracking & Revenue Analysis">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          {[["Prep Hours", "prepHours"], ["Delivery Hours", "deliveryHours"], ["Follow-Up Hours", "followUpHours"]].map(([label, k]) => (
            <div key={k}>
              <div style={{ fontSize: 11, color: C.dark30, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
              <input type="number" min="0" step="0.5" value={n(k)} onChange={e => sn(k)(e.target.value)} placeholder="0.0"
                style={{ width: "100%", border: `1px dashed ${C.yellow}`, borderRadius: 4, padding: "8px 10px", fontFamily: "Arial", fontSize: 14, color: C.dark, background: C.yellowBg, outline: "none" }} />
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            ["Total Hours", totalHours ? `${totalHours.toFixed(1)} hrs` : "—", totalHours > 0 ? C.blueLight : C.grey, totalHours > 0 ? C.blueBorder : C.border, totalHours > 0 ? C.blue : C.dark20],
            ["Invoice Value", invoiceVal ? `£${invoiceVal.toLocaleString()}` : "—", C.grey, C.border, C.dark30],
            ["Revenue / Hour", revenuePerHour ? `£${revenuePerHour}` : "—", revenuePerHour ? (parseFloat(revenuePerHour) >= 150 ? C.greenBg : C.amber) : C.grey, revenuePerHour ? (parseFloat(revenuePerHour) >= 150 ? "#7bc97a" : "#f1c238") : C.border, revenuePerHour ? (parseFloat(revenuePerHour) >= 150 ? C.greenDark : C.amberDark) : C.dark20],
          ].map(([label, val, bg, bdr, col]) => (
            <div key={label} style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 4, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, color: C.dark30, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: col }}>{val}</div>
            </div>
          ))}
        </div>
        {nb("Time Notes", "timeNotes", "Context about time spent — travel, admin, prep complexity…", 52)}
      </Section>

      {/* Follow-Up */}
      <Section num="6" title="Follow-Up & Commitments">
        {nb("Committed Actions", "internalActions", "What did we promise? Ticket raised? Who owns it?", 64)}
        {nb("Internal Handoff Notes", "handoff", "What CS, support, or account management needs to know…", 64)}
        {nb("Risk Notes", "riskNotes", "Individuals flagged as resistant, data migration issues, process blockers…", 72)}
      </Section>

      {/* General */}
      <Section num="7" title="General Debrief Notes">
        {nb("Notes", "debriefGeneral", "Anything else the team should know — people, politics, priorities…", 100)}
      </Section>

      <div className="no-print" style={{ marginTop: 24, padding: "14px 20px", background: C.blueLight, border: `1px solid ${C.blueBorder}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>Save to Data Engine Spreadsheet</div>
          <div style={{ fontSize: 11, color: C.dark30, marginTop: 2 }}>Saves all structured fields + notes to your Google Sheet. Re-saving updates the existing row.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {saveStatus === "saved" && <span style={{ fontSize: 12, color: C.greenDark, fontWeight: 600 }}>{saveMsg}</span>}
          {saveStatus === "error" && <span style={{ fontSize: 11, color: C.redDark, maxWidth: 260 }}>{saveMsg}</span>}
          <button
            onClick={handleSave}
            disabled={saveStatus === "saving"}
            style={{
              background: saveStatus === "saved" ? C.greenDark : saveStatus === "error" ? C.redDark : C.blue,
              color: "#fff", border: "none", borderRadius: 4, padding: "8px 18px",
              fontSize: 12, fontWeight: 700, cursor: saveStatus === "saving" ? "not-allowed" : "pointer",
              fontFamily: "Arial", display: "flex", alignItems: "center", gap: 6, opacity: saveStatus === "saving" ? 0.7 : 1,
              transition: "background 0.2s"
            }}
          >
            {saveStatus === "saving" ? (
              <><span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Saving…</>
            ) : saveStatus === "saved" ? "✓ Saved" : saveStatus === "error" ? "⚠ Retry" : (
              <><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 11h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> Save to Sheet</>
            )}
          </button>
        </div>
      </div>
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: C.dark20 }}>INTERNAL DEBRIEF — NOT FOR DISTRIBUTION</div>
        <div style={{ fontSize: 11, color: C.dark20 }}>Street Group | Training Ops</div>
      </div>
    </div>
  );
}

// ─── SAVE DEBRIEF TO SHEET ────────────────────────────────────────────────
async function saveDebriefToSheet(row, notes) {
  if (!DEBRIEF_SHEET_URL || DEBRIEF_SHEET_URL === "YOUR_APPS_SCRIPT_EXEC_URL_HERE") {
    throw new Error("DEBRIEF_SHEET_URL is not configured. See apps-script.gs setup instructions.");
  }

  const prepHours     = parseFloat(notes.prepHours     || "") || 0;
  const deliveryHours = parseFloat(notes.deliveryHours || "") || 0;
  const followUpHours = parseFloat(notes.followUpHours || "") || 0;
  const totalHours    = prepHours + deliveryHours + followUpHours;
  const invoiceVal    = parseFloat((h(row, "invoice") || "").replace(/[^0-9.]/g, "")) || 0;
  const revenuePerHour = totalHours > 0 && invoiceVal > 0
    ? (invoiceVal / totalHours).toFixed(2) : "";
  const preConf  = notes.preConfidence  || 0;
  const postConf = notes.postConfidence || 0;
  const delta    = preConf && postConf ? postConf - preConf : "";
  const theme    = deriveTheme(h(row, "areas"));
  const riskLevel = getRiskLevel(notes);

  const payload = {
    action:              "saveDebrief",
    company:             h(row, "company"),
    trainer:             h(row, "trainer"),
    trainingDate:        h(row, "date"),
    invoiceValue:        h(row, "invoice"),
    theme,
    deliveryType:        notes.session_delivery_type || "",
    repeatClient:        notes.repeat_client_        || "",
    prevSessionDate:     notes.prevSessionDate       || "",
    preConfidence:       preConf  || "",
    postConfidence:      postConf || "",
    confidenceDelta:     delta !== "" ? (delta >= 0 ? `+${delta}` : String(delta)) : "",
    complexity:          notes.complexity            || "",
    adoptionRisk:        notes.adoption_risk         || "",
    upsellOpportunity:   notes.upsell_opportunity    || "",
    escalation:          notes.escalation_required_  || "",
    systemMisuse:        notes.system_misuse         || "",
    accountingReadiness: notes.accounting_readiness  || "",
    sessionEnergy:       notes.session_energy        || "",
    objectivesMet:       notes.objectives_met        || "",
    prepHours:           prepHours     || "",
    deliveryHours:       deliveryHours || "",
    followUpHours:       followUpHours || "",
    totalHours:          totalHours    || "",
    revenuePerHour,
    riskLevel:           riskLevel.toUpperCase(),
    commercialNotes:     notes.commercialNotes  || "",
    wentWell:            notes.wentWell         || "",
    improved:            notes.improved         || "",
    internalActions:     notes.internalActions  || "",
    handoff:             notes.handoff          || "",
    riskNotes:           notes.riskNotes        || "",
    debriefGeneral:      notes.debriefGeneral   || "",
    timeNotes:           notes.timeNotes        || "",
  };

  const url = DEBRIEF_SHEET_URL + "?" + new URLSearchParams(payload).toString();
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Unknown error from Apps Script");
  return json;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState("trainer");
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [agendaData, setAgendaData] = useState([]);
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [allNotes, setAllNotes] = useState({});

  const isPost = view === "post-client" || view === "post-internal";
  const notesKey = isPost ? `${selected}-post` : `${selected}-${view}`;
  const notes = allNotes[notesKey] || {};
  const setNotes = updater => setAllNotes(prev => ({ ...prev, [notesKey]: typeof updater === "function" ? updater(prev[notesKey] || {}) : updater }));

  useEffect(() => {
    fetch(`${SHEET_URL}?action=getData`).then(r => r.json())
      .then(data => {
        if (!data.success) throw new Error();
        const [hdrs, ...rest] = data.data;
        setRows(rest.filter(r => r.some(c => c !== "")).map(r => mapRow(hdrs, r)));
        setLoading(false);
      }).catch(() => { setRows(MOCK_ROWS); setUsingMock(true); setLoading(false); });
  }, []);

  useEffect(() => {
    fetch(AGENDA_CSV_URL).then(r => r.text()).then(text => { setAgendaData(parseCSV(text)); setAgendaLoading(false); }).catch(() => setAgendaLoading(false));
  }, []);

  // Auto-select a company when opened from the dashboard via ?company=... URL param
  useEffect(() => {
    if (rows.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const company = params.get("company");
    if (!company) return;
    const idx = rows.findIndex(r =>
      (r[HEADER_MAP.company] || "").toLowerCase() === company.toLowerCase()
    );
    if (idx !== -1) setSelected(idx);
  }, [rows]);

  const currentRow = rows[selected];
  const areasRaw = currentRow ? h(currentRow, "areas") : "—";
  const agendaBlocks = useMemo(() => agendaData.length ? buildAgendaFromAreas(areasRaw, agendaData) : [], [areasRaw, agendaData]);
  const riskLevel = getRiskLevel(allNotes[`${selected}-post`] || {});

  const TAB_GROUPS = [
    { label: "Pre-Training", tabs: [{ id: "trainer", label: "Trainer Prep" }, { id: "client", label: "Client Doc" }] },
    { label: "Post-Training", tabs: [{ id: "post-client", label: "Summary Pack" }, { id: "post-internal", label: "Internal Debrief" }] },
  ];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 14px; line-height: 20px; color: #333; background: #fff; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #f8f8f8; } ::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 2px; }
        .sb-btn:hover { background: #f0f4ff !important; border-color: #c5d3ff !important; }
        .tab-btn:hover { color: #2147f4 !important; background: #f0f4ff !important; }
        .print-btn:hover { background: #1639d4 !important; }
        .notes-input:focus { border-color: #2147f4 !important; background: #fffef5 !important; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .notes-input { border: 1px dashed #bbb !important; min-height: 28px !important; }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <div className="no-print" style={{ background: "#fff", borderBottom: `1px solid ${C.border}`, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, height: 52, position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <StreetLogo />
            <div style={{ width: 1, height: 20, background: C.border }} />
            <span style={{ fontSize: 12, color: C.dark30 }}>Training Doc Generator</span>
            {usingMock && <span style={{ fontSize: 10, color: C.dark20, background: C.grey, border: `1px solid ${C.border}`, borderRadius: 3, padding: "2px 6px" }}>PREVIEW</span>}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {TAB_GROUPS.map(group => (
              <div key={group.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 9, color: C.dark20, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 2, whiteSpace: "nowrap" }}>{group.label}</span>
                <div style={{ display: "flex", background: C.grey, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
                  {group.tabs.map((tab, i) => (
                    <button key={tab.id} className="tab-btn" onClick={() => setView(tab.id)} style={{
                      background: view === tab.id ? "#fff" : "transparent",
                      color: view === tab.id ? C.blue : C.dark30,
                      border: "none", borderRight: i < group.tabs.length - 1 ? `1px solid ${C.border}` : "none",
                      padding: "6px 11px", cursor: "pointer", fontSize: 11,
                      fontWeight: view === tab.id ? 700 : 400, fontFamily: "Arial",
                      boxShadow: view === tab.id ? "0 1px 3px rgba(0,0,0,0.06)" : "none", whiteSpace: "nowrap"
                    }}>
                      {tab.id === "post-internal" && riskLevel === "high" && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.redDark, marginRight: 5, marginBottom: 1 }} />}
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="print-btn" onClick={() => window.print()} style={{ background: C.blue, color: "#fff", border: "none", borderRadius: 4, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Arial", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 10H1.5A.5.5 0 011 9.5V5.5A2 2 0 013 3.5h8A2 2 0 0113 5.5v4a.5.5 0 01-.5.5H11" stroke="white" strokeLinecap="round" strokeLinejoin="round"/><rect x="3" y="9.5" width="8" height="4" rx=".5" stroke="white"/><path d="M3 3.5V2a.5.5 0 01.5-.5h7a.5.5 0 01.5.5v1.5" stroke="white" strokeLinecap="round"/></svg>
              Print / Save PDF
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1 }}>
          {/* Sidebar */}
          <div className="no-print" style={{ width: 236, background: "#fafafa", borderRight: `1px solid ${C.border}`, padding: "14px 10px", flexShrink: 0, overflowY: "auto" }}>
            <div style={{ fontSize: 10, color: C.dark20, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, padding: "0 4px" }}>Records ({rows.length})</div>
            {loading && <div style={{ color: C.dark20, fontSize: 12, paddingTop: 20, textAlign: "center" }}>Loading…</div>}
            {rows.map((r, i) => {
              const name = h(r, "company") !== "—" ? h(r, "company") : `Row ${i + 1}`;
              const trainer = h(r, "trainer") !== "—" ? h(r, "trainer") : "";
              const status = h(r, "status");
              const rowRisk = getRiskLevel(allNotes[`${i}-post`] || {});
              const isSel = selected === i;
              return (
                <button key={i} className="sb-btn" onClick={() => setSelected(i)} style={{ width: "100%", textAlign: "left", background: isSel ? "#fff" : "transparent", border: isSel ? `1px solid ${C.blueBorder}` : "1px solid transparent", borderRadius: 4, padding: "9px 10px", cursor: "pointer", marginBottom: 2, boxShadow: isSel ? "0 1px 3px rgba(33,71,244,0.08)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {rowRisk === "high" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.redDark, flexShrink: 0 }} />}
                    <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? C.dark : C.dark40, lineHeight: 1.3 }}>{name}</div>
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                    {trainer && <span style={{ fontSize: 10, color: isSel ? C.blue : C.dark30 }}>{trainer}</span>}
                    {status && status !== "—" && (
                      <span style={{ fontSize: 9, fontWeight: 600, background: status === "Confirmed" ? C.green : C.amber, color: status === "Confirmed" ? C.greenDark : C.amberDark, borderRadius: 3, padding: "1px 5px" }}>{status.toUpperCase()}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Main */}
          <div style={{ flex: 1, padding: "26px 38px", maxWidth: 880, overflowY: "auto" }}>
            {!loading && currentRow && (
              <div className="no-print" style={{ background: C.yellowBg, border: `1px dashed ${C.yellow}`, borderRadius: 4, padding: "7px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.yellow, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "#6b5e00" }}>Yellow dashed fields are editable and print with the document. All structured selections feed into your Data_Engine spreadsheet tab.</span>
              </div>
            )}
            {loading && <div style={{ color: C.dark20, fontSize: 14, paddingTop: 60, textAlign: "center" }}>Loading…</div>}
            {!loading && currentRow && view === "trainer" && <TrainerView row={currentRow} agendaBlocks={agendaBlocks} agendaLoading={agendaLoading} notes={notes} setNotes={setNotes} />}
            {!loading && currentRow && view === "client" && <ClientView row={currentRow} agendaBlocks={agendaBlocks} agendaLoading={agendaLoading} notes={notes} setNotes={setNotes} />}
            {!loading && currentRow && view === "post-client" && <PostTrainingClientView row={currentRow} agendaBlocks={agendaBlocks} agendaLoading={agendaLoading} notes={notes} setNotes={setNotes} />}
            {!loading && currentRow && view === "post-internal" && <PostTrainingInternalView row={currentRow} notes={notes} setNotes={setNotes} />}
            {!loading && rows.length === 0 && <div style={{ color: C.dark20, fontSize: 14, paddingTop: 60, textAlign: "center" }}>No records found.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
