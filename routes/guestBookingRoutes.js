/**
 * Public guest self-serve booking (Guy-only): signed link → slots → Google Calendar invite.
 */
const express = require("express");
const { DateTime } = require("luxon");
const {
  verifyGuestBookingToken,
  signGuestBookingToken,
} = require("../services/guestBookingToken.js");
const {
  fetchHostClientProfile,
  buildGuestBookingEventDetails,
} = require("../services/guestBookingEventBuilder.js");
const {
  getOAuthPrimaryBatchAvailability,
  isValidIanaTimezone,
} = require("../services/calendarOAuthAvailability.js");
const {
  normalizeTimezoneInput,
} = require("../services/guestTimezoneAliases.js");
const { filterGuestBookingDays } = require("../services/guestBookingDayFilter.js");
const {
  serializeBookError,
  logGuestBookFailure,
  buildGuestBookErrorReport,
  buildGuestBookValidationReport,
} = require("../services/guestBookError.js");
const {
  createGuestMeeting,
  assertPrimarySlotFree,
} = require("../services/calendarOAuthService.js");
const {
  maybeUpdateLeadEmailIfChanged,
} = require("../services/guestBookingAirtable.js");

const router = express.Router();
router.use(express.json());

function firstNameFromFull(n) {
  const s = String(n || "").trim();
  if (!s) return "there";
  return s.split(/\s+/)[0];
}

function getTodayInTimezone(tz) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now).replace(/\//g, "-");
}

function buildDateRange(tz, numDays) {
  const todayStr = getTodayInTimezone(tz);
  const today = new Date(`${todayStr}T12:00:00`);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dates = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(tomorrow);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

/** First weekday strictly after today; then skip weekends until Mon–Fri. */
function getQuickPickStartDate(hostTz) {
  const todayStr = getTodayInTimezone(hostTz);
  let dt = DateTime.fromISO(todayStr, { zone: hostTz });
  let next = dt.plus({ days: 1 });
  while (next.weekday > 5) next = next.plus({ days: 1 });
  let after = next.plus({ days: 1 });
  while (after.weekday > 5) after = after.plus({ days: 1 });
  return after.toISODate();
}

function timezoneLabelFromIana(tz) {
  if (!tz) return "";
  const last = tz.split("/").pop() || tz;
  return last.replace(/_/g, " ");
}

/**
 * Guest tz: query guestTz or tz. Empty → host (Airtable Timezone for Guy-Wilson, else Brisbane).
 * Friendly names (Sydney, NSW, Vic, …) → IANA via guestTimezoneAliases.
 */
function resolveGuestTimezone(reqQuery, hostTz) {
  const raw = String(reqQuery.guestTz || reqQuery.tz || "").trim();
  if (!raw) return hostTz;
  const normalized = normalizeTimezoneInput(raw);
  if (normalized && isValidIanaTimezone(normalized)) return normalized;
  if (isValidIanaTimezone(raw)) return raw;
  return hostTz;
}

/**
 * One quick pick per calendar day for the first `maxPick` eligible days.
 * Within each day, choose a different time-of-day band: morning / midday / afternoon.
 */
function pickDistributedSlots(days, quickPickStartDate, maxPick) {
  const eligible = days.filter(
    (d) => d.date >= quickPickStartDate && d.freeSlots?.length
  );
  const picks = [];
  /** Position within that day’s slot list: ~25%, ~50%, ~75% */
  const band = [0.25, 0.5, 0.75];
  for (let d = 0; d < Math.min(maxPick, eligible.length); d++) {
    const day = eligible[d];
    const slots = day.freeSlots;
    const n = slots.length;
    const idx =
      n === 1
        ? 0
        : Math.min(
            Math.floor((n - 1) * band[d]),
            n - 1
          );
    picks.push({
      date: day.date,
      dayLabel: day.day,
      time: slots[idx].time,
      display: slots[idx].display,
    });
  }
  return picks;
}

function simpleEmailOk(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

/**
 * Shared by POST /api/guest/book and GET /debug-guest-book-harness.
 * @returns {Promise<{ ok: true, eventId: string, htmlLink?: string } | { ok: false, status: number, error: string, errorDetail: string }>}
 */
async function executeGuestBookOnce({ t, start, attendeeEmail, guestNotes }) {
  let verified;
  try {
    verified = verifyGuestBookingToken(t);
  } catch (e) {
    const r = buildGuestBookValidationReport(
      "guest_booking_token_config",
      "Booking is not configured on the server.",
      { hint: "GUEST_BOOKING_LINK_SECRET missing or invalid" }
    );
    return { ok: false, status: 503, error: r.summary, errorDetail: r.detail };
  }
  if (!verified.ok) {
    const r = buildGuestBookValidationReport(
      "guest_booking_token_verify",
      `Link problem: ${verified.error}`,
      { code: verified.error }
    );
    return { ok: false, status: 400, error: r.summary, errorDetail: r.detail };
  }
  if (!start || !simpleEmailOk(attendeeEmail)) {
    const r = buildGuestBookValidationReport(
      "guest_book_request_fields",
      "start time and a valid email are required.",
      { hasStart: !!start, attendeeEmail: attendeeEmail ? "[provided]" : "[missing]" }
    );
    return { ok: false, status: 400, error: r.summary, errorDetail: r.detail };
  }

  const { n, li, e } = verified.payload;
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    const r = buildGuestBookValidationReport(
      "guest_book_start_parse",
      "That start time could not be read.",
      { start: String(start) }
    );
    return { ok: false, status: 400, error: r.summary, errorDetail: r.detail };
  }
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

  try {
    await assertPrimarySlotFree(startDate.toISOString(), endDate.toISOString());
    const details = await buildGuestBookingEventDetails({
      leadFullName: n,
      leadLinkedIn: li,
      guestNotes: guestNotes || "",
    });
    const created = await createGuestMeeting({
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      attendeeEmail,
      summary: details.summary,
      description: details.description,
      location: details.location,
    });

    try {
      const host = await fetchHostClientProfile();
      await maybeUpdateLeadEmailIfChanged({
        airtableBaseId: host.airtableBaseId,
        linkedInUrl: li,
        oldEmail: e,
        newEmail: attendeeEmail,
      });
    } catch (_) {
      /* non-fatal */
    }

    return {
      ok: true,
      eventId: created.id,
      htmlLink: created.htmlLink,
    };
  } catch (err) {
    logGuestBookFailure(err);
    const report = buildGuestBookErrorReport(err);
    if (report.summary.includes("just taken")) {
      return { ok: false, status: 409, error: report.summary, errorDetail: report.detail };
    }
    return { ok: false, status: 500, error: report.summary, errorDetail: report.detail };
  }
}

router.get("/guest-book", async (req, res) => {
  const token = req.query.t;
  let verified;
  try {
    verified = verifyGuestBookingToken(token);
  } catch (e) {
    return res
      .status(503)
      .type("html")
      .send(
        "<!DOCTYPE html><html><body><p>Booking is not available right now.</p></body></html>"
      );
  }
  if (!verified.ok) {
    return res
      .status(400)
      .type("html")
      .send(
        `<!DOCTYPE html><html><body><p>Invalid or expired link (${verified.error}).</p></body></html>`
      );
  }

  const { n, e } = verified.payload;
  const leadFirst = firstNameFromFull(n);
  const guestTzParam = String(req.query.guestTz || req.query.tz || "").trim();
  const ctx = {
    t: token,
    leadFirst,
    marketingEmail: e,
    leadFullName: n,
    guestTzParam,
  };
  const ctxJson = JSON.stringify(ctx).replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pick a time</title>
  <style>
    :root{
      --bg:#f1f5f9;
      --card:#ffffff;
      --text:#0f172a;
      --muted:#64748b;
      --border:#e2e8f0;
      --accent:#0d9488;
      --accent-dim:#ccfbf1;
      --accent-hover:#0f766e;
      --radius:14px;
      --shadow:0 4px 24px rgba(15,23,42,.06);
    }
    *{box-sizing:border-box;}
    body{
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      margin:0;min-height:100vh;background:var(--bg);color:var(--text);
      -webkit-font-smoothing:antialiased;
    }
    .wrap{max-width:440px;margin:0 auto;padding:28px 18px 48px;transition:max-width .2s ease;}
    /* Laptop: wider single column, roomier grid */
    [data-device="laptop"] .wrap{max-width:580px;padding:32px 22px 52px;}
    /* Desktop: two columns — schedule | details */
    [data-device="desktop"] .wrap{max-width:1040px;padding:36px 28px 56px;}
    .card{
      background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);
      padding:24px 20px 20px;border:1px solid rgba(226,232,240,.8);
    }
    [data-device="desktop"] .card{padding:28px 32px 28px;}
    .card-inner{display:flex;flex-direction:column;gap:0;}
    [data-device="desktop"] .card-inner{
      display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,380px);
      gap:0 36px;align-items:start;
    }
    .col-schedule{min-width:0;}
    [data-device="desktop"] .col-details{
      border-left:1px solid var(--border);padding-left:32px;margin-left:0;
      position:sticky;top:28px;
    }
    [data-device="desktop"] section{margin-top:0;padding-top:0;border-top:none;}
    .sub-desktop{display:none;margin:0 0 20px;}
    [data-device="desktop"] .sub-mobile{display:none;}
    [data-device="desktop"] .sub-desktop{display:block;}
    h1{font-size:1.35rem;font-weight:650;line-height:1.25;margin:0 0 8px;letter-spacing:-.02em;}
    .sub{color:var(--muted);font-size:.95rem;line-height:1.45;margin:0 0 20px;}
    .tz{font-size:.8rem;color:var(--muted);margin-bottom:16px;padding:8px 12px;background:#f8fafc;border-radius:10px;border:1px solid var(--border);}
    .block-title{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px;}
    .suggested-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px;}
    .sug-btn{
      flex:1;min-width:min(100%,140px);
      text-align:left;padding:12px 14px;border-radius:12px;border:2px solid var(--border);
      background:#fff;font-size:.9rem;font-weight:500;cursor:pointer;color:var(--text);
      transition:border-color .15s,background .15s,box-shadow .15s;
    }
    .sug-btn:hover{border-color:var(--accent);background:var(--accent-dim);}
    .sug-btn.selected{border-color:var(--accent);background:var(--accent-dim);box-shadow:0 0 0 1px var(--accent);}
    .day-strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin:0 -4px 14px;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
    .day-strip::-webkit-scrollbar{height:4px;}
    .day-chip{
      flex:0 0 auto;padding:10px 16px;border-radius:999px;border:2px solid var(--border);
      background:#fff;font-size:.88rem;font-weight:600;cursor:pointer;color:var(--text);
      transition:all .15s;min-height:44px;
    }
    .day-chip:hover{border-color:#94a3b8;}
    .day-chip.active{border-color:var(--accent);background:var(--accent-dim);color:var(--accent-hover);}
    .time-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;}
    [data-device="laptop"] .time-grid{grid-template-columns:repeat(3,1fr);gap:10px;}
    [data-device="desktop"] .time-grid{grid-template-columns:repeat(3,1fr);gap:10px;}
    .slot-btn{
      padding:14px 12px;border-radius:12px;border:2px solid var(--border);
      background:#fff;font-size:.95rem;font-weight:500;cursor:pointer;color:var(--text);
      min-height:48px;transition:border-color .15s,background .15s,box-shadow .15s;
    }
    .slot-btn:hover{border-color:var(--accent);background:#f0fdfa;}
    .slot-btn.selected{border-color:var(--accent);background:var(--accent-dim);box-shadow:0 0 0 1px var(--accent);}
    .pick-hint{font-size:.85rem;color:var(--muted);margin:4px 0 18px;min-height:1.2em;}
    .pick-hint strong{color:var(--accent-hover);}
    section{margin-top:8px;padding-top:20px;border-top:1px solid var(--border);}
    label{display:block;margin-top:14px;font-size:.88rem;font-weight:600;color:#334155;}
    label:first-of-type{margin-top:0;}
    input,textarea{width:100%;padding:12px 14px;margin-top:6px;border:2px solid var(--border);border-radius:12px;font-size:1rem;font-family:inherit;transition:border-color .15s;}
    input:focus,textarea:focus{outline:none;border-color:var(--accent);}
    textarea{min-height:88px;resize:vertical;}
    .primary{
      margin-top:20px;padding:15px 20px;font-size:1.05rem;font-weight:600;border:none;border-radius:12px;
      background:linear-gradient(180deg,#14b8a6,#0d9488);color:#fff;cursor:pointer;width:100%;
      box-shadow:0 2px 12px rgba(13,148,136,.35);transition:transform .1s,box-shadow .15s,opacity .15s;
    }
    .primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 16px rgba(13,148,136,.45);}
    .primary:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none;background:#94a3b8;}
    .err{color:#b91c1c;font-size:.9rem;margin-top:10px;}
    .err-detail-hint{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#9a3412;margin:12px 0 6px;}
    .err-detail{
      display:none;margin-top:10px;padding:14px 16px;text-align:left;
      background:#fff7ed;border:1px solid #fdba74;border-radius:12px;
      font-size:.78rem;line-height:1.5;color:#431407;
      white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      max-height:min(55vh,420px);overflow-y:auto;
    }
    .ok{background:#ecfdf5;border:1px solid #6ee7b7;padding:20px;border-radius:var(--radius);max-width:min(1040px,92vw);margin:40px auto;padding-left:24px;padding-right:24px;}
    .empty{padding:20px;text-align:center;color:var(--muted);font-size:.95rem;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="card-inner">
        <div class="col-schedule">
          <h1>Hi ${leadFirst}, looking forward to chatting.</h1>
          <p class="sub sub-mobile">Pick a slot below — start with a quick suggestion or choose another day.</p>
          <p class="sub sub-desktop">Pick a time on the left, then add your details on the right.</p>
          <div id="tzLine" class="tz" style="display:none"></div>
          <div id="suggested"></div>
          <div id="picker" style="display:none">
            <p class="block-title">Choose a day</p>
            <div id="dayStrip" class="day-strip" role="tablist" aria-label="Available dates"></div>
            <p class="block-title" style="margin-top:4px">Choose a time</p>
            <div id="timeGrid" class="time-grid" role="group" aria-label="Available times"></div>
            <p id="pickHint" class="pick-hint"></p>
          </div>
          <div id="loadErr" class="err"></div>
          <p id="loadErrDetailHint" class="err-detail-hint" style="display:none">Full diagnostic (copy if you need help)</p>
          <div id="loadErrDetail" class="err-detail" style="display:none" aria-live="polite"></div>
        </div>
        <div class="col-details">
          <section>
            <label for="email">Your email (for the calendar invite)</label>
            <input id="email" type="email" autocomplete="email" inputmode="email"/>
            <label for="notes">Anything you’d like to cover? (optional)</label>
            <textarea id="notes" placeholder="Topics, questions, context…"></textarea>
            <div id="msg" class="err"></div>
            <p id="msgDetailHint" class="err-detail-hint" style="display:none">Full diagnostic (copy if you need help)</p>
            <div id="msgDetail" class="err-detail" style="display:none" aria-live="polite"></div>
            <button type="button" class="primary" id="btn" disabled>Choose a time to continue</button>
          </section>
        </div>
      </div>
    </div>
  </div>
  <script type="application/json" id="gctx">${ctxJson}</script>
  <script>
(function(){
  function applyDeviceMode(){
    var w = window.innerWidth || document.documentElement.clientWidth;
    var mode = 'laptop';
    if (w < 720) mode = 'mobile';
    else if (w >= 1200) mode = 'desktop';
    document.documentElement.setAttribute('data-device', mode);
  }
  applyDeviceMode();
  window.addEventListener('resize', function(){
    applyDeviceMode();
  });

  const ctx = JSON.parse(document.getElementById('gctx').textContent);
  document.getElementById('email').value = ctx.marketingEmail || '';
  let days = [];
  let daysWithSlots = [];
  let activeDayIndex = 0;
  let selected = null;
  const msg = document.getElementById('msg');
  const loadErr = document.getElementById('loadErr');
  const btn = document.getElementById('btn');
  const pickHint = document.getElementById('pickHint');

  function setDetailEl(id, hintId, text){
    var box = document.getElementById(id);
    var hint = hintId ? document.getElementById(hintId) : null;
    if (!box) return;
    if (text) {
      if (hint) hint.style.display = 'block';
      box.style.display = 'block';
      box.textContent = text;
    } else {
      if (hint) hint.style.display = 'none';
      box.style.display = 'none';
      box.textContent = '';
    }
  }
  function showErr(t, detail){
    msg.textContent = t || '';
    setDetailEl('msgDetail', 'msgDetailHint', detail || '');
  }
  function showLoadErr(t, detail){
    loadErr.textContent = safeErrText(t) || '';
    setDetailEl('loadErrDetail', 'loadErrDetailHint', detail || '');
  }
  /** Never show Google's useless bare string "Error" */
  function safeErrText(s){
    if (s == null || s === '') return '';
    var t = String(s).trim();
    if (t === 'Error') return 'Booking failed. Please try again or pick another time.';
    return t;
  }
  function apiErrMsg(x){
    if (!x) return 'Could not book';
    var e = x.error;
    var raw = '';
    if (typeof e === 'string' && e) raw = e;
    else if (e && typeof e === 'object' && e.message) {
      raw = String(e.message) === 'Error' && e.reason ? String(e.reason) : String(e.message);
    } else if (x.message) raw = String(x.message);
    if (raw) return safeErrText(raw) || 'Could not book';
    try { if (e && typeof e === 'object') return JSON.stringify(e); } catch (_) {}
    return 'Could not book';
  }

  function setSelected(slot){
    selected = slot;
    var dateStr = slot.date || (slot.time && slot.time.indexOf('T') > 0 ? slot.time.split('T')[0] : '');
    daysWithSlots.forEach(function(d, i){
      if(d.date === dateStr) activeDayIndex = i;
    });
    document.querySelectorAll('.slot-btn').forEach(function(el){
      el.classList.toggle('selected', el.dataset.time === slot.time);
    });
    document.querySelectorAll('.sug-btn').forEach(function(el){
      el.classList.toggle('selected', el.dataset.time === slot.time);
    });
    btn.disabled = false;
    btn.textContent = "Let's lock it in";
    var line = (slot.dayLabel || '') + ' · ' + (slot.display || '');
    pickHint.innerHTML = 'Selected: <strong>' + line.replace(/</g,'') + '</strong>';
    renderDayStrip();
    renderSlots();
  }

  function renderDayStrip(){
    var strip = document.getElementById('dayStrip');
    strip.innerHTML = '';
    daysWithSlots.forEach(function(d, idx){
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'day-chip' + (idx === activeDayIndex ? ' active' : '');
      chip.setAttribute('role','tab');
      chip.setAttribute('aria-selected', idx === activeDayIndex ? 'true' : 'false');
      chip.textContent = d.day;
      chip.onclick = function(){
        activeDayIndex = idx;
        renderDayStrip();
        renderSlots();
      };
      strip.appendChild(chip);
    });
    requestAnimationFrame(function(){
      var active = strip.querySelector('.day-chip.active');
      if (active) active.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    });
  }

  function renderSlots(){
    var grid = document.getElementById('timeGrid');
    grid.innerHTML = '';
    var d = daysWithSlots[activeDayIndex];
    if(!d || !d.freeSlots) return;
    d.freeSlots.forEach(function(sl){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot-btn';
      b.dataset.time = sl.time;
      if(selected && selected.time === sl.time) b.classList.add('selected');
      b.textContent = sl.display;
      b.onclick = function(){
        setSelected({ time: sl.time, display: sl.display, dayLabel: d.day, date: d.date });
      };
      grid.appendChild(b);
    });
  }

  (function(){
    var qs = '/api/guest/availability?t=' + encodeURIComponent(ctx.t);
    if (ctx.guestTzParam) qs += '&guestTz=' + encodeURIComponent(ctx.guestTzParam);
    return fetch(qs);
  })()
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(!data.ok){
        showLoadErr(safeErrText(data.error) || 'Could not load times', data.errorDetail || '');
        return;
      }
      days = data.days || [];
      if(data.displayTimezoneLabel){
        var el = document.getElementById('tzLine');
        el.style.display = 'block';
        el.textContent = 'Times are in your timezone (' + data.displayTimezoneLabel + ').';
      }
      daysWithSlots = days.filter(function(d){ return d.freeSlots && d.freeSlots.length; });
      var suggested = data.suggested || [];
      var sugEl = document.getElementById('suggested');
      if(suggested.length === 0 || daysWithSlots.length === 0){
        sugEl.innerHTML = '<div class="empty">No open slots in the next few weeks. Please reply to the email and we’ll find a time.</div>';
        return;
      }
      document.getElementById('picker').style.display = 'block';
      sugEl.innerHTML = '<p class="block-title">Quick picks</p><div class="suggested-row" id="sugRow"></div>';
      var row = document.getElementById('sugRow');
      suggested.forEach(function(s){
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sug-btn';
        b.dataset.time = s.time;
        b.textContent = s.dayLabel + ' · ' + s.display;
        b.onclick = function(){ setSelected(s); };
        row.appendChild(b);
      });
      activeDayIndex = 0;
      renderDayStrip();
      renderSlots();
    })
    .catch(function(){ showLoadErr('Network error loading times'); });

  btn.onclick = function(){
    showErr('', '');
    if(!selected){ showErr('Choose a time first'); return; }
    var email = document.getElementById('email').value.trim();
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){ showErr('Please enter a valid email'); return; }
    btn.disabled = true;
    btn.textContent = 'Locking…';
    fetch('/api/guest/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        t: ctx.t,
        start: selected.time,
        attendeeEmail: email,
        guestNotes: document.getElementById('notes').value.trim()
      })
    })
    .then(function(r){
      return r.text().then(function(text){
        var j = {};
        try { if (text) j = JSON.parse(text); } catch (e) {
          return { __fail: true, msg: 'Could not read server response (HTTP ' + r.status + ').' };
        }
        if (!r.ok) {
          var failRaw = j.error !== undefined && j.error !== null ? j.error : j.message;
          var failStr = typeof failRaw === 'string' ? failRaw : (failRaw && failRaw.message ? String(failRaw.message) : '');
          var mapped = safeErrText(failStr) || ('Request failed (' + r.status + ')');
          return { __fail: true, msg: mapped, detail: j.errorDetail || '' };
        }
        return j;
      });
    })
    .then(function(data){
      if (data && data.__fail) {
        showErr(data.msg || apiErrMsg(data), data.detail);
        btn.disabled = false;
        btn.textContent = "Let's lock it in";
        return;
      }
      if (!data || !data.ok) {
        showErr(apiErrMsg(data), data.errorDetail || '');
        btn.disabled = false;
        btn.textContent = "Let's lock it in";
        return;
      }
      document.body.innerHTML = '<div class="ok"><strong>You’re booked.</strong><p style="margin:.75em 0 0;line-height:1.5">Check your email for the Google Calendar invite and tap <strong>Accept</strong> so it’s on your calendar.</p></div>';
    })
    .catch(function(){ showErr('Network error'); btn.disabled = false; btn.textContent = "Let's lock it in"; });
  };
})();
  </script>
</body>
</html>`;

  return res.type("html").send(html);
});

router.get("/api/guest/availability", async (req, res) => {
  let verified;
  try {
    verified = verifyGuestBookingToken(req.query.t);
  } catch (e) {
    return res.status(503).json({ ok: false, error: "not_configured" });
  }
  if (!verified.ok) {
    return res.status(400).json({ ok: false, error: verified.error });
  }

  try {
    const host = await fetchHostClientProfile();
    const hostTz = host.timezone || "Australia/Brisbane";
    const guestTz = resolveGuestTimezone(req.query, hostTz);
    const dates = buildDateRange(hostTz, 35);
    let { days, error } = await getOAuthPrimaryBatchAvailability(dates, {
      hostTz,
      guestTz,
      hostStartMinutes: 9 * 60 + 30,
      hostEndMinutes: 16 * 60,
      guestStartMinutes: 9 * 60,
      guestEndMinutes: 17 * 60,
    });
    if (error) {
      const r = buildGuestBookValidationReport(
        "guest_availability_batch",
        String(error),
        { step: "getOAuthPrimaryBatchAvailability" }
      );
      return res.status(500).json({
        ok: false,
        error: r.summary,
        errorDetail: r.detail,
      });
    }
    days = filterGuestBookingDays(days, hostTz);
    const quickPickStart = getQuickPickStartDate(hostTz);
    const suggested = pickDistributedSlots(days, quickPickStart, 3);
    return res.json({
      ok: true,
      timezone: guestTz,
      hostTimezone: hostTz,
      displayTimezoneLabel: timezoneLabelFromIana(guestTz),
      days,
      suggested,
    });
  } catch (e) {
    const report = buildGuestBookErrorReport(e);
    return res.status(500).json({
      ok: false,
      error: report.summary,
      errorDetail: report.detail,
    });
  }
});

router.post("/api/guest/book", async (req, res) => {
  try {
    const bodyType = typeof req.body;
    const hasBody = req.body != null;
    const { t, start, attendeeEmail, guestNotes } = req.body || {};
    console.log(
      "[guest-book] POST /api/guest/book",
      JSON.stringify({
        hasBody,
        bodyType,
        hasToken: !!t,
        tokenLen: t ? String(t).length : 0,
        start: start || null,
        attendeeEmail: attendeeEmail || null,
        hasGuestNotes: !!guestNotes,
        contentType: req.headers["content-type"] || null,
      })
    );
    const out = await executeGuestBookOnce({ t, start, attendeeEmail, guestNotes });
    console.log(
      "[guest-book] executeGuestBookOnce result",
      JSON.stringify({ ok: out.ok, status: out.status, error: out.error ? String(out.error).slice(0, 200) : null })
    );
    if (out.ok) {
      return res.json({
        ok: true,
        eventId: out.eventId,
        htmlLink: out.htmlLink,
      });
    }
    return res.status(out.status).json({
      ok: false,
      error: out.error,
      errorDetail: out.errorDetail,
    });
  } catch (uncaught) {
    console.error("[guest-book] UNCAUGHT in POST /api/guest/book", uncaught?.message, uncaught?.stack);
    const report = buildGuestBookErrorReport(uncaught);
    return res.status(500).json({
      ok: false,
      error: report.summary,
      errorDetail: report.detail,
    });
  }
});

/**
 * GET /debug-guest-book-harness?secret=PB_WEBHOOK_SECRET
 * Full live test: signs token on server, runs same path as POST /api/guest/book, then deletes probe event.
 * No local .env. Optional: startISO= (UTC ISO), or slot= + guestTz= for wall time, probeEmail=, deleteAfter=0 to keep event.
 */
router.get("/debug-guest-book-harness", async (req, res) => {
  const expected = process.env.PB_WEBHOOK_SECRET || process.env.DEBUG_API_KEY;
  const q = req.query.secret;
  if (!expected || typeof q !== "string" || q !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const guestTz =
    String(req.query.guestTz || "Australia/Sydney").trim() || "Australia/Sydney";
  const probeEmail =
    String(req.query.probeEmail || "").trim() ||
    "taniaadelewilson@gmail.com";
  const name = String(req.query.name || "Harness Test Lead").trim();
  const li =
    String(req.query.li || "https://www.linkedin.com/in/example").trim();

  let startISO = String(req.query.startISO || "").trim();
  if (!startISO) {
    const slotQ = String(req.query.slot || "").trim();
    if (slotQ) {
      const dt = DateTime.fromISO(slotQ, { zone: guestTz });
      if (!dt.isValid) {
        return res.status(400).json({
          ok: false,
          error: "Invalid slot (use ISO local time, e.g. 2026-03-28T14:00:00)",
          guestTz,
          slot: slotQ,
        });
      }
      startISO = dt.toUTC().toISO();
    } else {
      const t0 = Date.now() + 3 * 60 * 60 * 1000;
      startISO = new Date(Math.ceil(t0 / 60000) * 60000).toISOString();
    }
  }

  let token;
  try {
    token = signGuestBookingToken({
      n: name,
      li,
      e: probeEmail,
      exp: Math.floor(Date.now() / 1000) + 14 * 86400,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
      hint: "GUEST_BOOKING_LINK_SECRET missing or too short on server",
    });
  }

  const out = await executeGuestBookOnce({
    t: token,
    start: startISO,
    attendeeEmail: probeEmail,
    guestNotes: "debug-guest-book-harness",
  });

  if (!out.ok) {
    return res.status(out.status).json({
      ok: false,
      harness: true,
      error: out.error,
      errorDetail: out.errorDetail,
      startISO,
      guestTz,
    });
  }

  const deleteAfter = req.query.deleteAfter !== "0";
  if (deleteAfter && out.eventId) {
    try {
      const { google } = require("googleapis");
      const { getGmailOAuthClient } = require("../services/gmailApiService.js");
      const auth = getGmailOAuthClient();
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.delete({
        calendarId: "primary",
        eventId: out.eventId,
      });
      return res.json({
        ok: true,
        harness: true,
        message:
          "Guest book path succeeded; probe calendar event was deleted.",
        startISO,
        guestTz,
        eventId: out.eventId,
        deletedProbeEvent: true,
      });
    } catch (delErr) {
      return res.json({
        ok: true,
        harness: true,
        warning: delErr.message || String(delErr),
        startISO,
        guestTz,
        eventId: out.eventId,
        htmlLink: out.htmlLink,
        deletedProbeEvent: false,
      });
    }
  }

  return res.json({
    ok: true,
    harness: true,
    startISO,
    guestTz,
    eventId: out.eventId,
    htmlLink: out.htmlLink,
    deletedProbeEvent: false,
  });
});

/**
 * GET /debug-guest-booking-url?secret=PB_WEBHOOK_SECRET&name=...&li=...&email=...
 * Browser test: redirects to /guest-book with a valid signed token. URL-encode li and email.
 */
router.get("/debug-guest-booking-url", (req, res) => {
  const expected = process.env.PB_WEBHOOK_SECRET || process.env.DEBUG_API_KEY;
  const q = req.query.secret;
  if (!expected || typeof q !== "string" || q !== expected) {
    return res.status(401).type("text/plain").send("Unauthorized");
  }
  const name = req.query.name && String(req.query.name).trim();
  const li = req.query.li && String(req.query.li).trim();
  const email = req.query.email && String(req.query.email).trim();
  if (!name || !li || !email) {
    return res
      .status(400)
      .type("text/plain")
      .send("Required query params: name, li, email (URL-encoded)");
  }
  let token;
  try {
    token = signGuestBookingToken({
      n: name,
      li,
      e: email,
      exp: Math.floor(Date.now() / 1000) + 90 * 86400,
    });
  } catch (e) {
    return res.status(500).type("text/plain").send(e.message || String(e));
  }
  const host = req.get("host") || "pb-webhook-server.onrender.com";
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const base = `${proto}://${host}`;
  const tzQ = (req.query.guestTz || req.query.tz || "").trim();
  let dest = `${base}/guest-book?t=${encodeURIComponent(token)}`;
  if (tzQ) dest += `&guestTz=${encodeURIComponent(tzQ)}`;
  res.redirect(302, dest);
});

/**
 * GET /debug-guest-book-pipeline?secret=PB_WEBHOOK_SECRET&mode=airtable|calendar|full
 * Online diagnosis without local .env. mode=airtable: Client Master + event copy only.
 * mode=calendar: OAuth calendar insert test + delete. mode=full: createGuestMeeting + delete.
 */
router.get("/debug-guest-book-pipeline", async (req, res) => {
  const expected = process.env.PB_WEBHOOK_SECRET || process.env.DEBUG_API_KEY;
  const q = req.query.secret;
  if (!expected || typeof q !== "string" || q !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const mode = String(req.query.mode || "airtable").toLowerCase();
  const steps = [];
  const push = (name, ok, rest = {}) => {
    steps.push({ name, ok, ...rest });
  };

  try {
    const {
      fetchHostClientProfile,
      buildGuestBookingEventDetails,
    } = require("../services/guestBookingEventBuilder.js");

    const host = await fetchHostClientProfile();
    push("fetchHostClientProfile", true, {
      timezone: host.timezone,
      clientId: host.clientId,
    });

    const details = await buildGuestBookingEventDetails({
      leadFullName: "Pipeline Test",
      leadLinkedIn: "https://www.linkedin.com/in/example",
      guestNotes: "",
    });
    push("buildGuestBookingEventDetails", true, {
      summaryLen: (details.summary || "").length,
    });

    if (mode === "airtable") {
      return res.json({ ok: true, mode, steps });
    }

    const {
      createTestEvent,
      createGuestMeeting,
    } = require("../services/calendarOAuthService.js");
    const { google } = require("googleapis");
    const { getGmailOAuthClient } = require("../services/gmailApiService.js");

    const probeEmail =
      String(req.query.probeEmail || "").trim() ||
      "taniaadelewilson@gmail.com";

    if (mode === "calendar") {
      const r = await createTestEvent({ attendeeEmail: probeEmail });
      push("createTestEvent", true, { eventId: r.id });
      const auth = getGmailOAuthClient();
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.delete({ calendarId: "primary", eventId: r.id });
      push("deleteEvent", true, { eventId: r.id });
      return res.json({ ok: true, mode, steps });
    }

    if (mode === "full") {
      const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      const created = await createGuestMeeting({
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        attendeeEmail: probeEmail,
        summary: `${details.summary} [probe]`,
        description: details.description,
        location: details.location,
      });
      push("createGuestMeeting", true, { eventId: created.id });
      const auth = getGmailOAuthClient();
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.delete({ calendarId: "primary", eventId: created.id });
      push("deleteEvent", true, {});
      return res.json({ ok: true, mode, steps });
    }

    return res
      .status(400)
      .json({ ok: false, error: "Unknown mode (use airtable, calendar, full)", steps });
  } catch (err) {
    const { serializeBookError, logGuestBookFailure } = require("../services/guestBookError.js");
    logGuestBookFailure(err);
    const msg = serializeBookError(err);
    push("error", false, { message: msg, raw: err.response?.data });
    return res.status(500).json({
      ok: false,
      mode,
      steps,
      error: msg,
      raw: err.response?.data,
    });
  }
});

module.exports = router;
