// Onboarding journey preflight - read-only, any client. Runs on prod (Render one-off job) so it
// sees the live Master Clients Base, the rules/variables store, the transcript store and env.
//   node scripts/wingguy-onboarding-preflight.js <clientId>
//
// Prints the client's position on the onboarding journey (docs/wingguy-onboarding-checklist.md
// steps 0-14) as DONE / OWED / MANUAL, deriving every verdict from the live system rather than a
// stored checklist - a stored ledger drifts; the record + live probes cannot. Born 2026-08-20
// from the Ashley Knowles session, where the record LOOKED complete while the transcript pipe had
// been dead for nine days and the calendar was routed down the wrong provider path. Every claim a
// pre-session email makes ("X is live, try it") should be green here first.
//
// ⚠ RENUMBERED 2026-09-06 to match the checklist's 15 beats. The moves that matter: the rules
// session became HOMEWORK at step 6 (was 2), the calendar/mailbox connection is step 2 (was 3),
// and the extension came off its parallel track into steps 9-10 (was the 'E' line).
//
// MANUAL steps cannot be probed from here - the proof lives on the client's screen, not in our
// system - so they print as reminders and never as DONE. They are: 1 connector, 3 test the
// calendar, 8 dress rehearsal, 10 prove the extension, 12 demonstrate /wg, 13 the feature tour,
// 14 linked helper. That is half the journey, and deliberately so: the steps we cannot see are
// exactly the ones that get skipped.
require('dotenv').config();

const cs = require('../services/clientService');

const DONE = '✅ DONE  ';
const OWED = '👉 OWED  ';
const MANUAL = '○ MANUAL';
const WARN = '⚠';

const present = (v) => Boolean(v && String(v).trim());
const short = (v, n = 12) => (present(v) ? `${String(v).slice(0, n)}…` : '(blank)');

const clientId = process.argv[2];
if (!clientId) {
  console.error('Usage: node scripts/wingguy-onboarding-preflight.js <clientId>');
  process.exit(1);
}

// One line per step; warnings collect underneath so the journey stays scannable.
const lines = [];
const warnings = [];
function step(n, name, verdict, evidence) {
  lines.push(`STEP ${String(n).padStart(2)} ${name.padEnd(20)} ${verdict}  ${evidence}`);
}

(async () => {
  const client = await cs.getClientById(clientId);
  if (!client) {
    console.error(`!! NOT FOUND - no client with Client ID = ${clientId}`);
    process.exit(1);
  }

  console.log(`=== ONBOARDING JOURNEY - ${client.clientName} (${clientId}) - read-only, live probes ===\n`);

  // ---- STEP 0: what the join page left behind ---------------------------------
  // Auto-provisioning builds the row now (services/joinProvisioningService.js), so this is a
  // read rather than a build. Timezone is always PRESENT because provisioning hardcodes
  // Australia/Brisbane - so print the value, never just its presence: eyeballing it is the check.
  try {
    const problems = [];
    if (client.status !== 'Active') problems.push(`status=${client.status}`);
    if (!present(client.portalToken)) problems.push('no Portal Token');
    if (!present(client.airtableBaseId)) problems.push('no leads base');
    if (!present(client.timezone)) problems.push('no timezone');
    let roundTrip = '';
    if (present(client.portalToken)) {
      const back = await cs.getClientByPortalToken(client.portalToken);
      const ok = back && back.clientId === clientId;
      roundTrip = ok ? 'token round-trips' : 'TOKEN RESOLVES WRONG';
      if (!ok) problems.push(`portal token resolves to ${back ? back.clientId : 'nothing'}`);
    }
    const tz = `tz ${client.timezone || '(blank)'}`;
    step(0, 'record ready', problems.length ? OWED : DONE,
      problems.length ? `${problems.join(' · ')} · ${tz}`
        : `Active · ${roundTrip} · base ${client.airtableBaseId} · ${tz}`);
  } catch (e) { step(0, 'record ready', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 1: connector in their Claude (manual proof) -----------------------
  step(1, 'connector', MANUAL,
    `their URL = https://pb-webhook-server.onrender.com/mcp2/${client.portalToken || '(no token)'} - proof is Wingguy answering in THEIR Claude; new tools need Refresh Tool List + fresh chat`);

  // ---- STEP 2: calendar + mailbox WIRING (the record, not the seam) ------------
  // One approval covers both for Google/Microsoft, so this step judges the wiring on the row.
  // Whether the calendar actually reads is step 3's job, and the mailbox is step 5's.
  let calInfo = null;
  try {
    const cal = require('../services/wingguyCalendar');
    calInfo = await cal.getCoachCalendarInfo(clientId);
    const provider = cal.providerForInfo(calInfo);
    // The Julian/Ashley trap: a set Calendar Email forces the google service-account path even
    // when a provider (unipile/nylas/zoho) is connected - the calendar then reads empty.
    if (present(calInfo.calendarEmail) && present(calInfo.calendarProvider) && calInfo.calendarProvider !== 'google') {
      warnings.push(`${WARN} step 2 TRAP: Calendar Email is set on a ${calInfo.calendarProvider} tenant - providerForInfo forces 'google' and the calendar reads empty. Blank the Calendar Email field.`);
    }
    const wired = provider === 'google' ? present(calInfo.calendarEmail) : present(calInfo.calendarProvider);
    step(2, 'calendar + mailbox', wired ? DONE : OWED,
      wired ? `provider=${provider} · Read IDs=${calInfo.calendarReadIds || '(default)'} · Write ID ${present(calInfo.calendarWriteId) ? 'set' : '(provider default)'}`
            : 'nothing connected - mint the hosted link (Google/Microsoft) or the zoho start link');
  } catch (e) { step(2, 'calendar + mailbox', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 3: test the calendar - through the live seam, not the record -------
  // Its own beat because the connection is invisible to us until someone looks: a client who
  // approved and one who did not look identical on the row.
  try {
    const cal = require('../services/wingguyCalendar');
    const { listCalendars } = require('../services/calendarProvider');
    const info = calInfo || await cal.getCoachCalendarInfo(clientId);
    const provider = cal.providerForInfo(info);
    if (provider === 'google') {
      const connected = present(info.calendarEmail);
      step(3, 'test the calendar', connected ? DONE : OWED,
        connected ? `google service-account share to ${info.calendarEmail} - ALSO ask the client "what's on my calendar this week?" and check a PERSONAL event shows`
          : 'nothing connected');
    } else {
      const cals = await listCalendars(cal.coachForCalendar(info));
      const n = cals && cals.calendars ? cals.calendars.length : 0;
      const ok = !cals.error && n > 0;
      step(3, 'test the calendar', ok ? DONE : OWED,
        ok ? `${n} calendar(s) via the seam - now the real test: client asks "what's on my calendar this week?" and confirms a PERSONAL event shows`
           : `provider=${provider} but listCalendars ${cals.error ? `errored: ${cals.error}` : 'returned nothing'}`);
      if (ok && n === 1) {
        warnings.push(`${WARN} step 3: only ONE calendar came back - the classic wrong-account tell. Eyeball the list with the client before moving on.`);
      }
    }
  } catch (e) { step(3, 'test the calendar', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 4: meeting link + invite contact details --------------------------
  try {
    const missing = [];
    if (!present(client.bookingZoom)) missing.push('Meeting Link BLANK (invites go out with nothing to click)');
    if (!present(client.coachPhone)) missing.push('phone blank');
    if (!present(client.coachLinkedInUrl)) missing.push('LinkedIn URL blank');
    step(4, 'meeting link', missing.length && !present(client.bookingZoom) ? OWED : DONE,
      missing.length ? missing.join(' · ') : `link set · phone + LinkedIn on the invite`);
  } catch (e) { step(4, 'meeting link', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 5: test the email --------------------------------------------------
  try {
    const viaUnipile = client.emailProvider === 'unipile' && present(client.unipileAccountId);
    const viaNylas = present(client.nylasGrantId);
    const connected = viaUnipile || viaNylas;
    step(5, 'test the email', connected ? DONE : OWED,
      connected
        ? `${viaUnipile ? `unipile account ${short(client.unipileAccountId)}` : `nylas grant ${short(client.nylasGrantId)}`} - real test is the CLIENT finding a known sender, then asking for the full text`
        : 'no mailbox connected');
  } catch (e) { step(5, 'test the email', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 6: their instructions - HOMEWORK since 2026-09-06 ------------------
  // Moved from step 2. It lands after they have watched Wingguy read their diary and their mail,
  // so the interview is answered with context. Cost: nothing sounds like them until this is done.
  try {
    const store = require('../services/wingguyRulesStore');
    const fields = require('../config/wingguySetupFields');
    const [rules, varRows, assetRows] = [
      await store.getActiveRules({ tenantId: clientId, layer: 'client' }),
      await store.getVariables({ tenantId: clientId }),
      await store.getAssets({ tenantId: clientId }),
    ];
    const varValues = new Map(varRows.map((r) => [r.var_key, String(r.value || '').trim()]));
    const assetValues = new Map(assetRows.filter((r) => r.status !== 'retired').map((r) => [r.asset_key, String(r.url || '').trim()]));
    const essentials = [
      ...fields.VARIABLE_FIELDS.filter((f) => f.tier === 'essential').map((f) => ({ key: f.key, filled: present(varValues.get(f.key)) })),
      ...fields.ASSET_FIELDS.filter((f) => f.tier === 'essential').map((f) => ({ key: f.key, filled: present(assetValues.get(f.key)) })),
      ...fields.VOICE_FIELDS.filter((f) => f.tier === 'essential').map((f) => ({ key: f.key, filled: present(varValues.get(f.key)) })),
    ];
    const filled = essentials.filter((f) => f.filled).length;
    const ownRules = rules.length;
    const done = ownRules > 0 && filled === essentials.length;
    const detail = `${ownRules} own instruction(s) · setup-page essentials ${filled}/${essentials.length}`;
    step(6, 'instructions (hwk)', done ? DONE : OWED,
      done ? detail : `${detail}${ownRules === 0 ? ' (0 = setup page never opened: seeding fires on first open)' : ''}`);
    if (!done && essentials.length) {
      const missing = essentials.filter((f) => !f.filled).map((f) => f.key).join(', ');
      if (missing) warnings.push(`${WARN} step 6 essentials still blank: ${missing}`);
    }
    if (ownRules === 0) {
      warnings.push(`${WARN} step 6 is HOMEWORK and has not been done - anything Wingguy drafts before it has no voice on it. Do NOT demo drafting; chase the homework instead.`);
    }
  } catch (e) { step(6, 'instructions (hwk)', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 7: recorder + transcript pipe (the step that lied on 2026-08-20) ---
  try {
    const provider = String(client.transcriptProvider || 'fathom').toLowerCase();
    const gates = [];
    const problems = [];
    if (provider === 'granola') {
      if (!present(client.granolaApiKey)) problems.push('no Granola API key');
      if (!present(client.granolaWebhookSecret)) problems.push('no webhook secret (register-granola-webhook.js prints it once)');
      gates.push(`webhook=${process.env.GRANOLA_WEBHOOK_ENABLED || 'OFF'}`, `ingest=${process.env.GRANOLA_INGEST_ENABLED || 'OFF'}`);
      if (String(process.env.GRANOLA_INGEST_ENABLED).toLowerCase() !== 'true') problems.push('GRANOLA_INGEST_ENABLED is OFF - notes queue but NEVER file');
    } else if (provider === 'fireflies') {
      if (!present(client.firefliesApiKey)) problems.push('no Fireflies API key');
      if (!present(client.firefliesWebhookSecret)) problems.push('no webhook secret');
      gates.push(`webhook=${process.env.FIREFLIES_WEBHOOK_ENABLED || 'OFF'}`, `ingest=${process.env.FIREFLIES_INGEST_ENABLED || 'OFF'}`);
    } else if (!present(client.fathomApiKey)) {
      problems.push('no Fathom API key');
    }
    const { listMeetingsForCoach } = require('../services/recallWebhookDb');
    const { listHeldCaptures } = require('../services/capturePolicyStore');
    const stored = await listMeetingsForCoach(clientId, { limit: 100 }).catch(() => []);
    const held = await listHeldCaptures(clientId, { limit: 50 }).catch(() => []);
    const stuck = held.filter((h) => present(h.last_error));
    if (stuck.length) problems.push(`${stuck.length} held capture(s) FAILING release: "${stuck[0].last_error}"`);
    const policy = present(client.captureMode) ? ` · capture=${client.captureMode}/${client.captureHoldMinutes || 0}min` : '';
    step(7, 'recorder', problems.length ? OWED : DONE,
      `${provider}${gates.length ? ` (${gates.join(' ')})` : ''} · stored=${stored.length} held=${held.length}${policy}${problems.length ? ` · ${problems.join(' · ')}` : ''}`);
    if (stored.length === 0 && !problems.length) {
      warnings.push(`${WARN} step 7 wiring looks right but NOTHING has ever filed - say "switching it on", never "it works", until the first real meeting lands`);
    }
  } catch (e) { step(7, 'recorder', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 8: dress rehearsal (manual by design) ------------------------------
  step(8, 'dress rehearsal', MANUAL, 'prove live together: offer times → book → invite arrives WITH the meeting link → cancel');

  // ---- STEP 9: ship + install the extension ------------------------------------
  // Only bites once the extension is on this client's journey (Wingguy Enabled).
  let extensionOnJourney = false;
  try {
    const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
    const provider = raw['Extension Folder Provider'] || '';
    const ref = raw['Extension Folder Ref'] || '';
    extensionOnJourney = Boolean(client.wingguyEnabled);
    if (extensionOnJourney) {
      step(9, 'ship + install', provider && ref ? DONE : OWED,
        provider && ref ? `${provider} folder on file - ship-extension.js reaches this client`
          : 'no update folder - send the ask email (own machine or company-managed? personal Microsoft account?), then the matching card; updates are hand-delivered until this is set');
    } else if (provider || ref) {
      step(9, 'ship + install', OWED, 'folder fields set but Wingguy Enabled is off - flip the gate or clear the fields');
    } else {
      step(9, 'ship + install', MANUAL, 'Wingguy Enabled is off - chat-only client, no extension on this journey');
    }
  } catch (e) { step(9, 'ship + install', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 10: prove the extension works for them (manual by design) ----------
  if (extensionOnJourney) {
    step(10, 'prove extension', MANUAL,
      'on THEIR screen: Wingguy card at the shipped version → open the portal ONCE in that browser (storage is per browser) → /wg on a real profile shows the panel. Proves the install, NOT drafting.');
  }

  // ---- STEP 11: their own Claude key -------------------------------------------
  try {
    const managed = Boolean(client.managedClaudeKey);
    const hasKey = present(client.anthropicApiKey);
    const briefOn = present(client.followupBrief) && String(client.followupBrief).toLowerCase() !== 'no';
    if (briefOn && !hasKey && !managed) {
      // Not a billing leak: the one-door rule (config/anthropicClient.js) BLOCKS a keyless,
      // unmanaged client - nothing falls through to the platform key. Auto-provisioning sets
      // Followup Brief = Yes from birth, so this state is normal for a brand-new client; the
      // Follow-Ups screen tells them their key isn't set up yet.
      warnings.push(`${WARN} step 11: Followup Brief is ON with no client key - brief/drafts are BLOCKED (never platform-billed) until their sk-ant- key is on the row.`);
    }
    step(11, 'own Claude key', managed || hasKey ? DONE : OWED,
      managed ? 'managed plan - runs on the platform key by design'
        : hasKey ? `client key SET · Followup Brief=${client.followupBrief || 'off'}`
        : `BYO with no key - /wg drafting and the overnight brief are BLOCKED until sk-ant- is on the row · Followup Brief=${client.followupBrief || 'off'}${briefOn ? '' : ' (correct order)'}`);
  } catch (e) { step(11, 'own Claude key', OWED, `probe failed: ${e.message}`); }

  // ---- STEP 12: demonstrate /wg on LinkedIn (manual by design) -----------------
  if (extensionOnJourney) {
    step(12, 'demonstrate /wg', MANUAL,
      'the payoff - a REAL profile they would message, /wg, and their EDIT of the draft is the lesson. Needs step 6 (voice) and step 11 (key) done first, or it is flat or blocked.');
  }

  // ---- STEP 13: the feature tour (manual by design) -----------------------------
  step(13, 'feature tour', MANUAL,
    'pick 2-3, do not tour the cabinet. Lead with people-you-have-met: a lead from a recorded call needs NO LinkedIn URL, and transcripts attach by identity. Then prep-me, the follow-up queue, history.');

  // ---- STEP 14: Linked Helper - deliberately LAST (decided 2026-08-22) ----------
  // Mostly un-probeable from here; the step exists so the printed journey matches the doctrine:
  // for NEW clients the LH hookup + first campaign close the onboarding, after steps 0-13.
  // Clients already mid-journey on the old LH-first order finish that way. One thing IS derivable:
  // the Email Series Start Date convention (set at THIS session - the drip takes over when the
  // weekly sessions stop), so surface its state.
  try {
    const raw14 = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
    const seriesStart = raw14['Email Series Start Date'] || '';
    step(14, 'linked helper + VPS', MANUAL,
      'the CLOSING step for new clients - hookup + Campaign 1 once targeting is decided and the profile says connector; trial clock starts at first campaign launch; offer the VPS, never re-pitch a no'
      + (seriesStart ? ` · email series starts ${seriesStart}` : ' · Email Series Start Date NOT SET - set it at this session'));
  } catch (e) {
    step(14, 'linked helper + VPS', MANUAL, `the CLOSING step for new clients (series-date probe failed: ${e.message})`);
  }

  console.log(lines.join('\n'));
  if (warnings.length) console.log('\n' + warnings.join('\n'));
  console.log('\n=== DONE (read-only) ===');
  process.exit(0);
})().catch((e) => { console.error('PREFLIGHT ERROR:', e); process.exit(1); });
