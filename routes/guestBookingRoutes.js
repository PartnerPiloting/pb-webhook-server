/**
 * Public guest self-serve booking (Guy-only): signed link → slots → Google Calendar invite.
 */
const express = require("express");
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
} = require("../services/calendarOAuthAvailability.js");
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
  const dates = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function pickSuggestedSlots(days, maxPick) {
  const picks = [];
  for (const day of days) {
    if (picks.length >= maxPick) break;
    if (day.freeSlots && day.freeSlots.length > 0) {
      picks.push({
        date: day.date,
        dayLabel: day.day,
        time: day.freeSlots[0].time,
        display: day.freeSlots[0].display,
      });
    }
  }
  return picks;
}

function simpleEmailOk(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
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
  const ctx = {
    t: token,
    leadFirst,
    marketingEmail: e,
    leadFullName: n,
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
    .wrap{max-width:440px;margin:0 auto;padding:28px 18px 48px;}
    .card{
      background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);
      padding:24px 20px 20px;border:1px solid rgba(226,232,240,.8);
    }
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
    .ok{background:#ecfdf5;border:1px solid #6ee7b7;padding:20px;border-radius:var(--radius);max-width:440px;margin:40px auto;padding-left:24px;padding-right:24px;}
    .empty{padding:20px;text-align:center;color:var(--muted);font-size:.95rem;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Hi ${leadFirst}, looking forward to chatting.</h1>
      <p class="sub">Pick a slot below — start with a quick suggestion or choose another day.</p>
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
      <section>
        <label for="email">Your email (for the calendar invite)</label>
        <input id="email" type="email" autocomplete="email" inputmode="email"/>
        <label for="notes">Anything you’d like to cover? (optional)</label>
        <textarea id="notes" placeholder="Topics, questions, context…"></textarea>
        <div id="msg" class="err"></div>
        <button type="button" class="primary" id="btn" disabled>Choose a time to continue</button>
      </section>
    </div>
  </div>
  <script type="application/json" id="gctx">${ctxJson}</script>
  <script>
(function(){
  const ctx = JSON.parse(document.getElementById('gctx').textContent);
  document.getElementById('email').value = ctx.marketingEmail || '';
  let days = [];
  let daysWithSlots = [];
  let activeDayIndex = 0;
  let selected = null;
  let tzLabel = '';
  const msg = document.getElementById('msg');
  const loadErr = document.getElementById('loadErr');
  const btn = document.getElementById('btn');
  const pickHint = document.getElementById('pickHint');

  function showErr(t){ msg.textContent = t || ''; }
  function showLoadErr(t){ loadErr.textContent = t || ''; }

  function formatTz(tz){
    if(!tz) return '';
    try{
      var parts = new Intl.DateTimeFormat('en-AU',{timeZone:tz,timeZoneName:'short'}).formatToParts(new Date());
      var name = parts.filter(function(p){ return p.type === 'timeZoneName'; }).map(function(p){ return p.value; }).join('');
      return name || tz.split('/').pop().replace(/_/g,' ');
    }catch(_){ return tz.split('/').pop().replace(/_/g,' '); }
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
    btn.textContent = 'Confirm this time';
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

  fetch('/api/guest/availability?t=' + encodeURIComponent(ctx.t))
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(!data.ok){ showLoadErr(data.error || 'Could not load times'); return; }
      days = data.days || [];
      tzLabel = data.timezone || '';
      if(tzLabel){
        var el = document.getElementById('tzLine');
        el.style.display = 'block';
        el.textContent = 'Times are in ' + formatTz(tzLabel) + ' (' + tzLabel.replace(/_/g,' ') + ').';
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
    showErr('');
    if(!selected){ showErr('Choose a time first'); return; }
    var email = document.getElementById('email').value.trim();
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){ showErr('Please enter a valid email'); return; }
    btn.disabled = true;
    btn.textContent = 'Booking…';
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
    .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j }; }); })
    .then(function(x){
      if(!x.j.ok){
        showErr(x.j.error || 'Could not book');
        btn.disabled = false;
        btn.textContent = 'Confirm this time';
        return;
      }
      document.body.innerHTML = '<div class="ok"><strong>You’re booked.</strong><p style="margin:.75em 0 0;line-height:1.5">Check your email for the Google Calendar invite and tap <strong>Accept</strong> so it’s on your calendar.</p></div>';
    })
    .catch(function(){ showErr('Network error'); btn.disabled = false; btn.textContent = 'Confirm this time'; });
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
    const tz = host.timezone || "Australia/Brisbane";
    const dates = buildDateRange(tz, 35);
    const { days, error } = await getOAuthPrimaryBatchAvailability(
      dates,
      9,
      17,
      tz
    );
    if (error) {
      return res.status(500).json({ ok: false, error });
    }
    const suggested = pickSuggestedSlots(days, 3);
    return res.json({
      ok: true,
      timezone: tz,
      days,
      suggested,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || String(e) });
  }
});

router.post("/api/guest/book", async (req, res) => {
  const { t, start, attendeeEmail, guestNotes } = req.body || {};
  let verified;
  try {
    verified = verifyGuestBookingToken(t);
  } catch (e) {
    return res.status(503).json({ ok: false, error: "not_configured" });
  }
  if (!verified.ok) {
    return res.status(400).json({ ok: false, error: verified.error });
  }
  if (!start || !simpleEmailOk(attendeeEmail)) {
    return res.status(400).json({ ok: false, error: "start and valid email required" });
  }

  const { n, li, e } = verified.payload;
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ ok: false, error: "invalid start time" });
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

    return res.json({
      ok: true,
      eventId: created.id,
      htmlLink: created.htmlLink,
    });
  } catch (err) {
    const m = err.message || String(err);
    if (m.includes("just taken")) {
      return res.status(409).json({ ok: false, error: m });
    }
    return res.status(500).json({ ok: false, error: m });
  }
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
  res.redirect(302, `${base}/guest-book?t=${encodeURIComponent(token)}`);
});

module.exports = router;
