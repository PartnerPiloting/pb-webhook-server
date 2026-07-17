// READ-ONLY Zoho calendar diagnostic. Answers "why does Wingguy see the calendar but no events?"
// by dumping what Zoho ACTUALLY returns, at each step, for one tenant:
//   1. the record's provider/domain/token state
//   2. token refresh (+ granted scopes)
//   3. every calendar on the account (uid / name / isdefault) — reveals a wrong-calendar pick
//   4. the raw events response per calendar for a window (+ the first raw event's shape)
//   5. how many of those events our mapper would keep vs silently drop, and why
//
//   node scripts/wingguy-zoho-diagnose.js [clientId] [daysForward] [daysBack]
// e.g. ... Julian-Davis 14 30  → 30 days BACK through 14 days FORWARD.
// Zoho caps a range query at 31 days, so the span is chunked (same as the live adapter).
// Never prints tokens. Never writes anything.
require('dotenv').config();
const clientService = require('./../services/clientService');

const tenant = process.argv[2] || 'Julian-Davis';
const DAYS = Number(process.argv[3] || 7);
const DAYS_BACK = Number(process.argv[4] || 0);

// --- copies of the adapter's helpers, so we can see each step in isolation -------------------
function zohoHosts(domain) {
  let d = String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!d) d = 'com';
  if (/^(com|com\.au|com\.cn|eu|in|jp|ca|sa|com\.sa|uk)$/i.test(d)) {
    return { calendarBase: `https://calendar.zoho.${d}`, accountsBase: `https://accounts.zoho.${d}` };
  }
  return { calendarBase: `https://${d}`, accountsBase: `https://${d.replace(/^calendar\./, 'accounts.')}` };
}
function isoToZoho(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
// The LIVE mapper's date parser — if this returns null the event is silently dropped.
function zohoToISO(s) {
  const str = String(s || '').trim();
  let m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})$/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7].slice(0, 3)}:${m[7].slice(3)}`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

(async () => {
  console.log(`=== 1. RECORD (${tenant}) ===`);
  const c = await clientService.getClientById(tenant);
  if (!c) { console.log('!! client not found'); process.exit(0); }
  console.log('calendarProvider       =', c.calendarProvider || '(blank)');
  console.log('calendarProviderDomain =', c.calendarProviderDomain || '(blank)');
  console.log('calendarProviderToken  =', c.calendarProviderToken ? 'SET' : '(blank)');
  console.log('googleCalendarEmail    =', c.googleCalendarEmail || '(blank)  <- must be blank, else Google path wins');
  console.log('timezone               =', c.timezone || '(blank)');
  if (!c.calendarProviderToken) { console.log('\n!! no Zoho token — he has not completed the connect flow.'); process.exit(0); }

  const { calendarBase, accountsBase } = zohoHosts(c.calendarProviderDomain);
  console.log('\ncalendarBase =', calendarBase, '\naccountsBase =', accountsBase);

  console.log('\n=== 2. TOKEN REFRESH ===');
  const tu = new URL(`${accountsBase}/oauth/v2/token`);
  tu.searchParams.set('refresh_token', c.calendarProviderToken);
  tu.searchParams.set('client_id', process.env.ZOHO_CLIENT_ID);
  tu.searchParams.set('client_secret', process.env.ZOHO_CLIENT_SECRET);
  tu.searchParams.set('grant_type', 'refresh_token');
  const tr = await fetch(tu.toString(), { method: 'POST', headers: { Accept: 'application/json' } });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) { console.log(`!! refresh FAILED HTTP ${tr.status}:`, JSON.stringify(tj).slice(0, 300)); process.exit(0); }
  console.log('refresh OK · expires_in =', tj.expires_in, '· granted scope =', tj.scope || '(not returned)');
  const headers = { Authorization: `Zoho-oauthtoken ${tj.access_token}`, Accept: 'application/json' };

  console.log('\n=== 3. CALENDARS ON THE ACCOUNT ===');
  const cr = await fetch(`${calendarBase}/api/v1/calendars`, { headers });
  const ctext = await cr.text();
  if (!cr.ok) { console.log(`!! calendars list HTTP ${cr.status}:`, ctext.slice(0, 300)); process.exit(0); }
  let cj = {};
  try { cj = JSON.parse(ctext); } catch (_) { console.log('!! non-JSON:', ctext.slice(0, 200)); process.exit(0); }
  const cals = cj.calendars || cj.data || [];
  console.log(`found ${cals.length} calendar(s):`);
  cals.forEach((k, i) => console.log(`  [${i}] uid=${k.uid} · name="${k.name}" · isdefault=${k.isdefault} · include_infreebusy=${k.include_infreebusy}`));
  const picked = cals.find((k) => k.isdefault) || cals[0];
  console.log('ADAPTER WOULD PICK →', picked ? `uid=${picked.uid} ("${picked.name}")` : '(none)');

  const now = Date.now();
  const from = now - DAYS_BACK * 86400000;
  const to = now + DAYS * 86400000;
  console.log(`\n=== 4. EVENTS per calendar (${DAYS_BACK} days back → ${DAYS} days forward) ===`);
  console.log(`window: ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);
  // Zoho rejects/limits ranges over 31 days — chunk exactly like the live adapter does.
  const CHUNK_MS = 30 * 86400000;
  const chunks = [];
  for (let cur = from; cur < to; cur += CHUNK_MS) chunks.push([cur, Math.min(cur + CHUNK_MS, to)]);
  console.log(`chunked into ${chunks.length} query window(s) (Zoho caps a range at 31 days)`);

  for (const k of cals) {
    const all = [];
    let failed = false;
    for (const [cs, ce] of chunks) {
      const range = JSON.stringify({ start: isoToZoho(new Date(cs).toISOString()), end: isoToZoho(new Date(ce).toISOString()) });
      const u = new URL(`${calendarBase}/api/v1/calendars/${encodeURIComponent(k.uid)}/events`);
      u.searchParams.set('range', range);
      u.searchParams.set('byinstance', 'true');
      const r = await fetch(u.toString(), { headers });
      const text = await r.text();
      if (!r.ok) { console.log(`\n  "${k.name}" ${range} → HTTP ${r.status}: ${text.slice(0, 250)}`); failed = true; continue; }
      let j = {};
      try { j = JSON.parse(text); } catch (_) { console.log(`\n  "${k.name}" → non-JSON: ${text.slice(0, 200)}`); failed = true; continue; }
      const list = j.events || j.data || [];
      console.log(`  chunk ${range} → ${list.length} event(s)`);
      all.push(...list);
    }
    console.log(`\n  "${k.name}" (uid=${k.uid}) → ${all.length} raw event(s) TOTAL${failed ? ' (some chunks errored — see above)' : ''}`);
    if (!all.length) continue;

    // Every event: what it is, whether Zoho calls it all-day/multi-day, and whether we'd keep it.
    console.log('  ALL EVENTS (raw):');
    let kept = 0; const dropped = [];
    for (const ev of all) {
      const dt = ev.dateandtime || {};
      const s = zohoToISO(dt.start); const e = zohoToISO(dt.end);
      const ok = !!(s && e);
      if (ok) kept++; else dropped.push(ev);
      console.log(`    [${ok ? 'KEEP' : 'DROP'}] "${ev.title || '(untitled)'}" · isallday=${ev.isallday} · multiday=${ev.multiday} · start=${JSON.stringify(dt.start)} end=${JSON.stringify(dt.end)} · tz=${dt.timezone || '?'}`);
    }
    console.log(`\n  MAPPER: would keep ${kept} / ${all.length}${dropped.length ? ` — DROPPING ${dropped.length}` : ''}`);
    if (dropped.length) {
      console.log('  FIRST DROPPED EVENT (full raw shape — this is what we must learn to parse):');
      console.log(JSON.stringify(dropped[0], null, 2).split('\n').map((l) => '    ' + l).join('\n').slice(0, 1800));
    }
  }
  console.log('\n=== DONE ===');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
