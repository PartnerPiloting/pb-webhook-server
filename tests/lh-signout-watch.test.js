/**
 * Tests for the LinkedIn sign-out alert (services/lhSignoutWatch.js, 8 Oct 2026).
 *
 * A Linked Helper machine that has been signed in before and then reads LOGGED OUT / RESTRICTED /
 * CHALLENGE for over an hour tells the coach once, shows on the queue's Machine check while it
 * lasts, and sends an all-clear when it reads signed in again. "unknown" (Linked Helper closed for
 * an update) changes nothing. A machine never signed in never alerts.
 *
 * Pure functions plus injected senders - no Airtable, no Mailgun. ⚠ Synthetic clients only.
 *
 * Run: node tests/lh-signout-watch.test.js
 */
const assert = require('assert');
const w = require('../services/lhSignoutWatch');

let failures = 0;
const pending = [];
const check = (name, fn) => {
  const done = (e) => {
    if (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } else console.log(`  ✓ ${name}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => done(), done));
    else done();
  } catch (e) { done(e); }
};

const NOW = Date.parse('2026-10-06T05:30:00Z');           // Tue 6 Oct, 4:30pm Sydney
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const F = w.FIELDS;

console.log('signoutStep():');

check('LinkedIn ok stamps Last Signed In and is not an alert', () => {
  const r = w.signoutStep({ linkedin: 'ok', now: NOW });
  assert.deepEqual(r.fields, { [F.lastSignedIn]: new Date(NOW).toISOString() });
  assert.equal(r.alert, false);
  assert.equal(r.recovered, false);
});

check('signed out for under an hour - nothing yet', () => {
  const r = w.signoutStep({ linkedin: 'LOGGED OUT', lastSignedIn: minsAgo(59), now: NOW });
  assert.deepEqual(r.fields, {});
  assert.equal(r.alert, false);
});

check('signed out for an hour - alert once, and stamp it', () => {
  const r = w.signoutStep({ linkedin: 'LOGGED OUT', lastSignedIn: minsAgo(65), now: NOW });
  assert.equal(r.alert, true);
  assert.deepEqual(r.fields, { [F.alerted]: new Date(NOW).toISOString() });
});

check('already alerted - never again in the same episode', () => {
  const r = w.signoutStep({ linkedin: 'LOGGED OUT', lastSignedIn: minsAgo(600), alertedAt: minsAgo(500), now: NOW });
  assert.equal(r.alert, false);
  assert.deepEqual(r.fields, {});
});

check('RESTRICTED and CHALLENGE alert too', () => {
  for (const s of ['RESTRICTED', 'CHALLENGE']) {
    assert.equal(w.signoutStep({ linkedin: s, lastSignedIn: minsAgo(90), now: NOW }).alert, true, s);
  }
});

check('a machine never signed in (new client, login page by design) never alerts', () => {
  const r = w.signoutStep({ linkedin: 'LOGGED OUT', lastSignedIn: null, now: NOW });
  assert.equal(r.alert, false);
  assert.deepEqual(r.fields, {});
});

check('unknown (Linked Helper closed for an update) neither starts nor ends anything', () => {
  for (const s of ['unknown', '', undefined]) {
    const r = w.signoutStep({ linkedin: s, lastSignedIn: minsAgo(300), alertedAt: minsAgo(200), now: NOW });
    assert.deepEqual(r.fields, {}, String(s));
    assert.equal(r.alert, false);
    assert.equal(r.recovered, false);
  }
});

check('signed in again after an alert - clears the stamp and says recovered', () => {
  const r = w.signoutStep({ linkedin: 'ok', lastSignedIn: minsAgo(300), alertedAt: minsAgo(200), now: NOW });
  assert.equal(r.recovered, true);
  assert.equal(r.fields[F.alerted], null);
  assert.equal(r.fields[F.lastSignedIn], new Date(NOW).toISOString());
});

check('Rick on 6 Oct: last fine 3:20pm Sydney, a report at 4:30pm alerts', () => {
  const r = w.signoutStep({ linkedin: 'LOGGED OUT', lastSignedIn: '2026-10-06T04:20:00Z', now: NOW });
  assert.equal(r.alert, true);
});

console.log('wording:');

check('the coach line names who, since when (in their time zone) and the link', () => {
  const line = w.coachLine({
    clientName: 'Client A', state: 'LOGGED OUT', lastSignedIn: '2026-10-06T04:20:00Z',
    machineLink: 'https://client-a.example.com', timeZone: 'Australia/Sydney',
  });
  assert.match(line, /^Client A's Linked Helper machine has been signed out of LinkedIn since about Tue 6 Oct, 3:20pm\./);
  assert.match(line, /until they sign in again at https:\/\/client-a\.example\.com\.$/);
});

check('the coach\'s own machine is worded to them', () => {
  const line = w.coachLine({ clientName: 'Coach', state: 'LOGGED OUT', lastSignedIn: minsAgo(90), self: true });
  assert.match(line, /^Your Linked Helper machine has been signed out/);
  assert.match(line, /until you sign in again\.$/);
});

check('RESTRICTED says it needs a look, not a sign-in', () => {
  assert.match(w.coachLine({ clientName: 'Client A', state: 'RESTRICTED', lastSignedIn: minsAgo(90) }), /needs a look on LinkedIn itself/);
});

check('the client email: first name, the link, two steps, signed by the coach', () => {
  const m = w.buildClientEmail({ clientFirstName: 'Alex', coachName: 'Guy Wilson', machineLink: 'https://client-a.example.com', state: 'LOGGED OUT' });
  assert.equal(m.subject, 'Your LinkedIn needs you to sign in again');
  assert.match(m.text, /^Hi Alex,/);
  assert.match(m.text, /1\. Open your machine: https:\/\/client-a\.example\.com/);
  assert.match(m.text, /2\. Sign in to LinkedIn there/);
  assert.match(m.text, /Cheers,\nGuy$/);
  assert.ok(!/[–—]/.test(m.text + m.subject), 'house style: no en or em dash');
});

check('no en or em dash anywhere in the coach lines', () => {
  for (const state of ['LOGGED OUT', 'RESTRICTED', 'CHALLENGE']) {
    for (const self of [true, false]) {
      const line = w.coachLine({ clientName: 'Client A', state, lastSignedIn: minsAgo(90), machineLink: 'https://x.example.com', self });
      assert.ok(!/[–—]/.test(line), `${state} self=${self}`);
    }
  }
});

check('the Machine Status line is read back to its LinkedIn part', () => {
  assert.equal(w.linkedinFromStatus('RUNNING | LinkedIn LOGGED OUT | LH 2.130.58 | Launcher 2.130.53'), 'LOGGED OUT');
  assert.equal(w.linkedinFromStatus('IDLE | LinkedIn ok | LH 2.130.58'), 'ok');
  assert.equal(w.linkedinFromStatus('NOT OPEN | LH 2.130.58'), null);
});

console.log('signedOutMachineAlerts():');

const COACH = 'Coach-One';
const client = (over) => ({
  clientId: 'Client-A', clientName: 'Client A', coach: COACH, status: 'Active', coachingStatus: 'Graduated',
  machineStatus: 'RUNNING | LinkedIn LOGGED OUT | LH 2.130.58', linkedinLastSignedIn: minsAgo(120),
  linkedinSignOutAlerted: minsAgo(60), machineLink: 'https://client-a.example.com', ...over,
});

check('an alerted, still signed-out machine is on the coach\'s list', () => {
  const out = w.signedOutMachineAlerts({ coachClientId: COACH, clients: [client()] });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'signed-out');
  assert.match(out[0].line, /Client A's Linked Helper machine has been signed out/);
});

check('not yet alerted (under an hour) - not on the list', () => {
  assert.equal(w.signedOutMachineAlerts({ coachClientId: COACH, clients: [client({ linkedinSignOutAlerted: null })] }).length, 0);
});

check('signed in again since (status ok, stamp not cleared yet) - not on the list', () => {
  assert.equal(w.signedOutMachineAlerts({ coachClientId: COACH, clients: [client({ machineStatus: 'RUNNING | LinkedIn ok | LH 2.130.58' })] }).length, 0);
});

check('another coach\'s client, a paused client, an inactive client - none listed', () => {
  const out = w.signedOutMachineAlerts({
    coachClientId: COACH,
    clients: [client({ coach: 'Coach-Two' }), client({ coachingStatus: 'Paused' }), client({ status: 'Paused' })],
  });
  assert.equal(out.length, 0);
});

check('the coach\'s own machine is listed, worded to them', () => {
  const out = w.signedOutMachineAlerts({ coachClientId: COACH, clients: [client({ clientId: COACH, coach: null })] });
  assert.equal(out.length, 1);
  assert.match(out[0].line, /^Your Linked Helper machine/);
});

console.log('sendSignoutAlert():');

check('client email held (switch off): coach is emailed, with the message ready to forward', async () => {
  const sent = [];
  const r = await w.sendSignoutAlert({
    client: client(), state: 'LOGGED OUT', lastSignedIn: minsAgo(120),
    deps: {
      getClientById: async () => ({ clientName: 'Coach One', clientEmailAddress: 'coach@example.com', timezone: 'Australia/Brisbane' }),
      sendAlertEmail: async (subject, html, to, opts) => { sent.push({ subject, text: opts.text }); },
      sendClientEmail: async () => { throw new Error('must not email the client while the switch is off'); },
    },
  });
  assert.equal(w.EMAIL_CLIENT, false);
  assert.equal(r.clientEmailed, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Client A's Linked Helper machine: LinkedIn signed out");
  assert.match(sent[0].text, /They have NOT been emailed: the client email is switched off/);
  assert.match(sent[0].text, /The message, ready to forward:\n\nSubject: Your LinkedIn needs you to sign in again/);
});

check('a mail failure never throws out of the alert', async () => {
  const r = await w.sendSignoutAlert({
    client: client(), state: 'LOGGED OUT', lastSignedIn: minsAgo(120),
    deps: { getClientById: async () => null, sendAlertEmail: async () => { throw new Error('mailgun down'); } },
  });
  assert.equal(r.coachEmailError, 'mailgun down');
});

check('the all-clear goes to the coach', async () => {
  const sent = [];
  await w.sendRecoveredNote({ client: client(), deps: { sendAlertEmail: async (subject) => { sent.push(subject); } } });
  assert.deepEqual(sent, ["Client A's Linked Helper machine is signed in again"]);
});

Promise.all(pending).then(() => {
  if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
  console.log('\nall passing');
});
