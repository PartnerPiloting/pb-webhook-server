/**
 * Tests for services/bounceWatch.js (Craig Carolan, 2026-10-19).
 *
 * Contracts:
 *   1. A Gmail "Delivery Status Notification (Failure)" is recognised and the failed address found
 *      (Craig's real bounce shape: "Your message to X has been blocked").
 *   2. A Microsoft "Undeliverable:" NDR is recognised and its address found.
 *   3. A generic DSN (Final-Recipient: rfc822;) is handled; the coach's own address is never reported.
 *   4. An ordinary email is NOT a bounce.
 *   5. The sweep alerts the coach ONCE per bounce (the table de-dupes a second pass), names the lead
 *      when the address matches a record, and copies Guy.
 *   6. A tenant whose mailbox read fails does not stop the others.
 *
 * Run: node tests/bounce-watch.test.js
 */
const assert = require('assert');
const bw = require('../services/bounceWatch');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

const GMAIL_DSN = `<div><h2>Message blocked</h2><p>Your message to <b>iscraig.carolan@infocus.com.au</b> has been blocked. See technical details below for more information.</p>
<p>The response from the remote server was:</p><pre>550 5.4.1 Recipient address rejected: Access denied. For more information see https://aka.ms/EXOSmtpErrors [SY2PEPF00004FF5.ausprd01.prod.outlook.com 2026-10-18T23:53:20.342Z 08DF2520762157D1]</pre></div>`;

const MS_NDR = `<p>Delivery has failed to these recipients or groups:</p><p><a href="mailto:jane.doe@acme.com.au">jane.doe@acme.com.au</a> (jane.doe@acme.com.au)<br>The email address you entered couldn't be found.</p>`;

const GENERIC_DSN = `This is the mail system at host mx.example.net.
I'm sorry to have to inform you that your message could not be delivered to one or more recipients.
<bob.smith@example.org>: host mail.example.org said: 550 5.1.1 User unknown
Final-Recipient: rfc822; bob.smith@example.org
Reporting-MTA: dns; mx.example.net
From: guy@coach.com`;

console.log('recognising bounces:');
check('1. Gmail DSN -> bounce, address found', () => {
  assert.ok(bw.isBounceMessage({ fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)' }));
  const got = bw.extractBouncedAddresses(bw.bodyToText(GMAIL_DSN), new Set(['guy@coach.com']));
  assert.deepStrictEqual(got, ['iscraig.carolan@infocus.com.au']);
});
check('2. Microsoft NDR -> bounce, address found', () => {
  assert.ok(bw.isBounceMessage({ fromEmail: 'postmaster@outlook.com', subject: 'Undeliverable: Craig Carolan & Guy Wilson' }));
  const got = bw.extractBouncedAddresses(bw.bodyToText(MS_NDR), new Set());
  assert.deepStrictEqual(got, ['jane.doe@acme.com.au']);
});
check('3. generic DSN -> address found, coach\'s own address never reported', () => {
  assert.ok(bw.isBounceMessage({ fromEmail: 'MAILER-DAEMON@mx.example.net', subject: 'Undelivered Mail Returned to Sender' }));
  const got = bw.extractBouncedAddresses(GENERIC_DSN, new Set(['guy@coach.com']));
  assert.deepStrictEqual(got, ['bob.smith@example.org']);
});
(async () => {
  await acheck('4b. matchLead finds the lead by the corrected form when the bounced form no longer matches', async () => {
    const inbound = { findLeadByEmail: async (c, e) => (e === 'sam.trattles@acme.com' ? { id: 'recSam', firstName: 'Sam', lastName: 'Trattles', email: 'sam.trattles@acme.com' } : null) };
    const hit = await bw.matchLead(inbound, { clientId: 't' }, 'emailissam.trattles@acme.com');
    assert.strictEqual(hit.lead && hit.lead.id, 'recSam');
    assert.strictEqual(hit.matchedAs, 'sam.trattles@acme.com');
    const miss = await bw.matchLead(inbound, { clientId: 't' }, 'nobody@acme.com');
    assert.strictEqual(miss.lead, null);
  });
})();
check('4. an ordinary email is not a bounce', () => {
  assert.ok(!bw.isBounceMessage({ fromEmail: 'craig.carolan@infocus.com.au', subject: 'Re: catching up' }));
  assert.ok(!bw.isBounceMessage({ fromEmail: 'noreply@calendar.google.com', subject: 'Accepted: Craig Carolan & Guy Wilson' }));
});

// ── A fake world for the sweep ───────────────────────────────────────────────────────────────────
function fakeWorld() {
  const rows = new Set(); // "tenant|msg|address"
  const pool = {
    connect: async () => ({ query: async () => ({}), release: () => {} }),
    query: async (sql, params) => {
      if (/INSERT INTO wingguy_bounce_alerts/.test(sql)) {
        const key = params.slice(0, 3).join('|');
        if (rows.has(key)) return { rowCount: 0, rows: [] };
        rows.add(key);
        return { rowCount: 1, rows: [{ message_id: params[1] }] };
      }
      if (/SELECT 1 FROM wingguy_bounce_alerts/.test(sql)) {
        // another row for the same tenant + address, other message id = reported in the last day
        const [tenant, address, msgId] = params;
        const hit = [...rows].some((k) => { const [t, m, a] = k.split('|'); return t === tenant && a === address && m !== msgId; });
        return { rowCount: hit ? 1 : 0, rows: hit ? [{}] : [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const coaches = [
    { clientId: 'guy', clientName: 'Guy Wilson', status: 'Active', clientEmailAddress: 'guy@coach.com', timezone: 'Australia/Brisbane', airtableBaseId: 'appX' },
    { clientId: 'broken', clientName: 'Broken Mailbox', status: 'Active', clientEmailAddress: 'b@coach.com', airtableBaseId: 'appY' },
    { clientId: 'nomail', clientName: 'No Mailbox', status: 'Active', airtableBaseId: 'appZ' },
  ];
  const clientService = { getAllClients: async () => coaches };
  const mailProvider = {
    hasMailbox: (c) => c.clientId !== 'nomail',
    listRecent: async (c) => {
      if (c.clientId === 'broken') return { ok: false, error: 'HTTP 503' };
      return { ok: true, messages: [
        { id: 'm1', fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', date: '2026-10-18T23:53:20Z' },
        { id: 'm2', fromEmail: 'craig.carolan@infocus.com.au', subject: 'Re: catching up' },
        // The same bad address bouncing again five hours later (the invite was moved; the update to the old address bounced)
        { id: 'm3', fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', date: '2026-10-19T05:02:20Z' },
      ] };
    },
    getMessage: async (c, id) => ({ ok: true, message: { body: id === 'm2' ? '<p>hi</p>' : GMAIL_DSN } }),
  };
  // Craig's record has already been CORRECTED: only the clean address matches, not the bounced one.
  const inbound = { findLeadByEmail: async (c, email) => (email === 'craig.carolan@infocus.com.au' ? { id: 'recCraig', firstName: 'Craig', lastName: 'Carolan', email: 'craig.carolan@infocus.com.au' } : null) };
  const sent = [];
  const sendEmail = async (subject, html, to, opts) => { sent.push({ subject, html, to, text: opts && opts.text }); return { success: true }; };
  return { pool, clientService, mailProvider, inbound, sendEmail, sent };
}

(async () => {
  console.log('the sweep:');
  const w = fakeWorld();
  const deps = { pool: w.pool, clientService: w.clientService, mailProvider: w.mailProvider, inbound: w.inbound, sendEmail: w.sendEmail, now: () => Date.parse('2026-10-19T00:10:00Z') };
  await acheck('5. ONE alert per address per day, lead named even though the record was already fixed, Guy copied; second pass is silent', async () => {
    const r1 = await bw.sweepBounces(deps);
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.bounces, 2, 'both DSNs count as bounces');
    assert.strictEqual(r1.alerted, 1, 'but the same address is reported once');
    const coachMails = w.sent.filter((s) => s.to === 'guy@coach.com');
    assert.strictEqual(coachMails.length, 1, 'exactly one email to the coach');
    const coachMail = coachMails[0];
    assert.ok(/iscraig\.carolan@infocus\.com\.au/.test(coachMail.subject), 'subject names the address');
    assert.ok(/Craig Carolan/.test(coachMail.subject), 'subject names the lead (matched via the corrected address)');
    assert.ok(/record already has a different address/.test(coachMail.html) && /craig\.carolan@infocus\.com\.au<\/strong>/.test(coachMail.html), 'body says the record is already right and points at the invite');
    assert.ok(!/Fix it on Craig Carolan's record/.test(coachMail.html), 'no "fix the record" step when the record is already right');
    const adminCopy = w.sent.find((s) => s.to === null);
    assert.ok(adminCopy && /^\[guy\]/.test(adminCopy.subject), 'Guy gets a copy tagged with the tenant');
    const before = w.sent.length;
    const r2 = await bw.sweepBounces(deps);
    assert.strictEqual(r2.alerted, 0, 'already-reported bounce is not re-alerted');
    assert.strictEqual(w.sent.length, before, 'no more emails on the second pass');
  });
  await acheck('6. a failing mailbox does not stop the others', async () => {
    const r = await bw.sweepBounces(deps);
    assert.strictEqual(r.tenants, 2, 'the tenant with no mailbox is skipped, the broken one is still tried');
    assert.strictEqual(r.failed, 0, 'a failed list is logged, not thrown');
  });
  await acheck('7. a bounce to someone who is not a lead goes to the client only - no copy to Guy', async () => {
    const w2 = fakeWorld();
    w2.inbound.findLeadByEmail = async () => null;
    const r = await bw.sweepBounces({ ...deps, pool: w2.pool, clientService: w2.clientService, mailProvider: w2.mailProvider, inbound: w2.inbound, sendEmail: w2.sendEmail });
    assert.strictEqual(r.alerted, 1, 'still reported');
    assert.strictEqual(w2.sent.filter((s) => s.to === 'guy@coach.com').length, 1, 'the client is told');
    assert.strictEqual(w2.sent.filter((s) => s.to === null).length, 0, 'Guy is not copied');
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
