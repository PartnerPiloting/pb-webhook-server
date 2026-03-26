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
    body{font-family:system-ui,sans-serif;max-width:520px;margin:24px auto;padding:0 16px;color:#1a1a1a;}
    h1{font-size:1.25rem;font-weight:600;}
    .muted{color:#555;font-size:0.95rem;}
    .slot{display:block;width:100%;text-align:left;padding:12px 14px;margin:8px 0;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;font-size:1rem;}
    .slot:hover{border-color:#333;}
    .slot.selected{border-color:#0a0;background:#f6fff6;}
    section{margin-top:20px;}
    label{display:block;margin-top:12px;font-weight:500;}
    input,textarea{width:100%;padding:10px 12px;margin-top:6px;border:1px solid #ccc;border-radius:8px;font-size:1rem;box-sizing:border-box;}
    textarea{min-height:88px;resize:vertical;}
    button.primary{margin-top:16px;padding:12px 20px;font-size:1rem;border:none;border-radius:10px;background:#111;color:#fff;cursor:pointer;width:100%;}
    button.primary:disabled{opacity:0.5;cursor:not-allowed;}
    .err{color:#b00020;margin-top:8px;}
    .ok{background:#f0fdf4;border:1px solid #86efac;padding:14px;border-radius:10px;margin-top:16px;}
    details{margin-top:16px;}
    summary{cursor:pointer;font-weight:500;}
    #allSlots{max-height:280px;overflow-y:auto;margin-top:8px;}
  </style>
</head>
<body>
  <h1>Hi ${leadFirst}, looking forward to chatting.</h1>
  <p class="muted">Here are a few times that might work, or pick from the full list below. Rather email me instead? Just reply to the message I sent you.</p>
  <div id="suggested"></div>
  <details>
    <summary>See all times</summary>
    <div id="allSlots"></div>
  </details>
  <section>
    <label for="email">Your email (for the calendar invite)</label>
    <input id="email" type="email" autocomplete="email"/>
    <label for="notes">Anything you’d like to cover? (optional)</label>
    <textarea id="notes" placeholder="Optional"></textarea>
    <div id="msg" class="err"></div>
    <button type="button" class="primary" id="btn" disabled>Confirm time</button>
  </section>
  <script type="application/json" id="gctx">${ctxJson}</script>
  <script>
(function(){
  const ctx = JSON.parse(document.getElementById('gctx').textContent);
  document.getElementById('email').value = ctx.marketingEmail || '';
  let days = [];
  let selected = null;
  const msg = document.getElementById('msg');
  const btn = document.getElementById('btn');

  function showErr(t){ msg.textContent = t || ''; }
  function setSelected(slot){
    selected = slot;
    document.querySelectorAll('.slot').forEach(function(el){
      el.classList.toggle('selected', el.dataset.time === slot.time);
    });
    btn.disabled = false;
  }

  fetch('/api/guest/availability?t=' + encodeURIComponent(ctx.t))
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(!data.ok){ showErr(data.error || 'Could not load times'); return; }
      days = data.days || [];
      const sug = document.getElementById('suggested');
      const suggested = data.suggested || [];
      if(suggested.length === 0){
        sug.innerHTML = '<p class="muted">No open slots in the next few weeks. Please reply to my email.</p>';
        return;
      }
      sug.innerHTML = '<p class="muted">Suggested for you:</p>';
      suggested.forEach(function(s){
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slot';
        b.dataset.time = s.time;
        b.textContent = s.dayLabel + ' · ' + s.display;
        b.onclick = function(){ setSelected(s); };
        sug.appendChild(b);
      });
      const all = document.getElementById('allSlots');
      days.forEach(function(d){
        if(!d.freeSlots || !d.freeSlots.length) return;
        const h = document.createElement('div');
        h.innerHTML = '<strong>' + d.day + '</strong>';
        all.appendChild(h);
        d.freeSlots.forEach(function(sl){
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'slot';
          b.dataset.time = sl.time;
          b.textContent = sl.display;
          b.onclick = function(){ setSelected({ time: sl.time, display: sl.display, dayLabel: d.day }); };
          all.appendChild(b);
        });
      });
    })
    .catch(function(){ showErr('Network error loading times'); });

  btn.onclick = function(){
    showErr('');
    if(!selected){ showErr('Choose a time first'); return; }
    const email = document.getElementById('email').value.trim();
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){ showErr('Please enter a valid email'); return; }
    btn.disabled = true;
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
        return;
      }
      document.body.innerHTML = '<div class="ok"><strong>You’re booked.</strong><p>Check your email for the Google Calendar invite and tap <strong>Accept</strong> so it’s on your calendar.</p></div>';
    })
    .catch(function(){ showErr('Network error'); btn.disabled = false; });
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
