/**
 * Tests for "Network building, rethought" - the weekly email to Guy's list (services/listEditions.js).
 * Pure parts only - no Airtable, no Postgres, no Mailgun, no Claude. ⚠ Synthetic people only.
 *
 * Run: node tests/list-editions.test.js
 */
const assert = require('assert');
const L = require('../services/listEditions');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};
const at = (s) => new Date(s).getTime();

console.log('when it goes');
check('the Wednesday it works towards: never before the launch; after 1pm on a Wednesday it is next week', () => {
  assert.strictEqual(L.nextSendDate(at('2026-10-26T06:00:00Z')), L.LAUNCH);
  assert.strictEqual(L.nextSendDate(at('2026-11-04T01:00:00Z')), '2026-11-04'); // Wed 11am Brisbane
  assert.strictEqual(L.nextSendDate(at('2026-11-04T04:00:00Z')), '2026-11-11'); // Wed 2pm Brisbane
  assert.strictEqual(L.nextSendDate(at('2026-11-06T00:00:00Z')), '2026-11-11');
});

console.log('the words');
check('a regular gets the idea, the closer with the I Know A Guy link, the sign-off and the unsubscribe line - no header', () => {
  const r = L.render({ edition: { kind: 'idea', title: 'Dig the well', paragraphs: ['First.', 'Second.'], source: 'book' }, variant: 'regular', firstName: 'Sarah', siteUrl: 'https://example.com/' });
  assert.strictEqual(r.subject, 'Network building, rethought - Dig the well');
  assert.ok(r.html.indexOf('<p>Hi Sarah,</p>') < r.html.indexOf('First.'));
  assert.ok(r.html.includes('<a href="https://example.com/">I Know A Guy</a>'));
  assert.ok(r.html.includes('reply &quot;unsubscribe&quot;'));
  assert.ok(!/Weekly Edition|Mindset Mastery/.test(r.html), 'no header block');
  assert.ok(!/[–—]/.test(r.html));
});
check('a Beth idea carries her P.S. credit after the sign-off; a book does not', () => {
  const beth = L.render({ edition: { kind: 'idea', title: 'T', paragraphs: ['x'], source: 'beth' }, variant: 'regular', firstName: 'Sam' }).html;
  assert.ok(beth.indexOf('(I know a) Guy') < beth.indexOf('P.S. This week'));
  assert.ok(!L.render({ edition: { kind: 'idea', title: 'T', paragraphs: ['x'], source: 'book' }, variant: 'regular' }).html.includes('P.S.'));
});
check('a first email is the "what does better mean?" piece: the welcome line for the new, the "it\'s back" line for the old list', () => {
  const welcome = L.render({ edition: { kind: 'idea', title: 'T', paragraphs: ['NOT THIS'] }, variant: 'welcome', firstName: 'Ann' });
  assert.strictEqual(welcome.subject, L.INTRO_SUBJECT);
  assert.ok(welcome.html.includes("I'm starting a short weekly email") && !welcome.html.includes('NOT THIS'));
  const back = L.render({ edition: { kind: 'intro' }, variant: 'back', firstName: 'Ann' }).html;
  assert.ok(back.includes('Mindset Mastery is back, with a new name') && !back.includes("I'm starting"));
  assert.ok(back.includes('Ask most people what a better network looks like'));
  assert.ok(L.render({ edition: null, variant: 'welcome', firstName: '' }).html.includes('<p>Hi there,</p>'));
});
check('first names: a clean first word, nothing odd', () => {
  assert.strictEqual(L.firstNameOf('sarah jones'), 'Sarah');
  assert.strictEqual(L.firstNameOf('info@x.com'), '');
  assert.strictEqual(L.firstNameOf(''), '');
});

console.log('which idea');
check('Who, not how comes first, then best-rated books and Beth in turn; never Guy\'s own editions; never one already used', () => {
  const q = L.ideaQueue([]);
  assert.strictEqual(q[0].id, 'book-who-not-how');
  assert.ok(!q.some((i) => i.source === 'mindset-mastery'));
  assert.deepStrictEqual(q.slice(1, 5).map((i) => i.source), ['book', 'beth', 'book', 'beth']);
  const after = L.ideaQueue(['book-who-not-how', q[1].id]);
  assert.ok(!after.some((i) => i.id === 'book-who-not-how' || i.id === q[1].id));
});
check('the drafter is told the idea, Guy\'s direction and what has gone before', () => {
  const p = L.draftPrompt({ source: 'book', title: 'Never Eat Alone by Keith Ferrazzi', idea: 'Build relationships before you need them.', angle: 'A manual for the method.' }, { sentTitles: ['Who, not how'], direction: 'mention my Thailand trip' });
  assert.ok(p.includes('Never Eat Alone') && p.includes("GUY'S DIRECTION") && p.includes('- Who, not how'));
});

console.log('who gets it');
check('clients, unsubscribed, bounced, no email, Guy himself and duplicates are left off - with the reason', () => {
  const tag = L.LIST_TAG;
  const leads = [
    { id: 'r1', name: 'Ann Lee', firstName: 'Ann', email: 'ann@x.com', tags: [tag] },
    { id: 'r2', name: 'Ann Lee', email: 'ANN@x.com', tags: [tag] },
    { id: 'r3', name: 'Client Carl', email: 'carl@x.com', tags: [tag] },
    { id: 'r4', name: 'Una', email: 'una@x.com', tags: [tag, 'unsubscribed'] },
    { id: 'r5', name: 'Bo', email: 'bo@x.com', tags: [tag] },
    { id: 'r6', name: 'No Mail', email: '', tags: [tag] },
    { id: 'r7', name: 'Not listed', email: 'nl@x.com', tags: ['other'] },
    { id: 'r8', name: 'Guy', email: 'me@x.com', tags: [tag] },
  ];
  const { go, off } = L.pickRecipients(leads, { clientEmails: new Set(['carl@x.com']), bounced: new Set(['bo@x.com']), selfEmails: new Set(['me@x.com']) });
  assert.deepStrictEqual(go.map((p) => p.email), ['ann@x.com']);
  assert.strictEqual(go[0].firstName, 'Ann');
  assert.deepStrictEqual(off.client, ['Client Carl']); assert.deepStrictEqual(off.unsubscribed, ['Una']);
  assert.deepStrictEqual(off.bounced, ['Bo']); assert.deepStrictEqual(off.noEmail, ['No Mail']); assert.deepStrictEqual(off.self, ['Guy']);
});
check('first email or not: regulars get the idea; at the launch the old list gets "it\'s back"; Weekly-button adds and later newcomers get the welcome', () => {
  const sentBefore = new Set(['old@x.com']);
  assert.strictEqual(L.variantFor('old@x.com', { sentBefore }), 'regular');
  assert.strictEqual(L.variantFor('list@x.com', { isLaunch: true }), 'back');
  assert.strictEqual(L.variantFor('btn@x.com', { isLaunch: true, buttonAdds: new Set(['btn@x.com']) }), 'welcome');
  assert.strictEqual(L.variantFor('new@x.com', { isLaunch: false }), 'welcome');
});

console.log('unsubscribes');
check('a reply that is only an unsubscribe is handled; anything with more in it goes to Guy', () => {
  assert.ok(L.isUnsubscribeReply('Unsubscribe'));
  assert.ok(L.isUnsubscribeReply('Please unsubscribe me. Thanks\n\nOn Wed, Guy wrote: > Hi'));
  assert.ok(L.isUnsubscribeReply('remove me'));
  assert.ok(!L.isUnsubscribeReply('Loved this one. I might unsubscribe from the others but not yours'));
  assert.ok(!L.isUnsubscribeReply('Unsubscribe my colleague Bob please, he left the company last month and his inbox is still forwarding to me so I keep seeing these'));
  assert.ok(!L.isUnsubscribeReply(''));
});
check('a real send carries the unsubscribe link in the footer, beside the reply line; a preview keeps the reply line only', () => {
  const ed = { kind: 'idea', title: 'T', paragraphs: ['x'], source: 'book' };
  const url = L.unsubUrlFor('tok_abcdefghijklmnopqrstuvwx');
  assert.strictEqual(url, 'https://knowaguy.com.au/series/unsubscribe?t=tok_abcdefghijklmnopqrstuvwx');
  for (const variant of ['regular', 'back', 'welcome']) {
    const h = L.render({ edition: ed, variant, firstName: 'Sam', unsubUrl: url }).html;
    assert.ok(h.includes(`<a href="${url}" style="color:#777">unsubscribe here</a>`), variant);
    assert.ok(h.includes('reply &quot;unsubscribe&quot;'), variant);
    assert.ok(!/[–—]/.test(h), variant);
  }
  assert.ok(!L.render({ edition: ed, variant: 'regular' }).html.includes('/series/unsubscribe'));
});
check('anyone we recorded as unsubscribed is left off even when their lead still has no unsubscribed tag', () => {
  const { go, off } = L.pickRecipients([{ id: 'r1', name: 'Tag Failed', email: 'tf@x.com', tags: [L.LIST_TAG] }], { unsubscribed: new Set(['tf@x.com']) });
  assert.strictEqual(go.length, 0);
  assert.deepStrictEqual(off.unsubscribed, ['Tag Failed']);
});

// The link itself, against a fake store: Postgres, the CRM and Mailgun all stubbed.
async function linkTests() {
  console.log('the unsubscribe link');
  const state = new Map([['unsub:test:testtoken_0123456789abcdef', '1']]);
  const sends = [{ tenant_id: 'T1', email: 'sam@x.com', name: 'Sam', unsub_token: 'realtoken_0123456789abcdef' }];
  const members = [];
  const fake = { connect: async () => ({ release() {}, query: async (sql, p = []) => {
    if (/FROM list_state/.test(sql)) return { rows: state.has(p[0]) ? [{ value: state.get(p[0]) }] : [] };
    if (/FROM list_sends WHERE unsub_token/.test(sql)) return { rows: sends.filter((s) => s.unsub_token === p[0]) };
    if (/SELECT 1 FROM list_members/.test(sql)) return { rows: members.filter((m) => m.email === p[1]) };
    if (/INSERT INTO list_members/.test(sql)) { members.push({ email: p[1] }); return { rows: [] }; }
    return { rows: [] };
  } }) };
  L.__setTestPool(fake);
  const tagged = []; const mailed = [];
  const stub = (rel, exp) => { const id = require.resolve(rel); require.cache[id] = { id, filename: id, loaded: true, exports: exp }; };
  stub('../services/wingguyLeadsMcp', { runTagLead: async (a) => { tagged.push(a); return { text: 'tags changed' }; } });
  stub('../services/clientService', { getClientById: async () => ({ clientEmailAddress: 'coach@x.com' }) });
  stub('../services/mailgunCreds', { fromAddress: (n) => `${n} <guy@x.com>`, sendMailgunMessage: async (m) => { mailed.push(m); return { id: 'm1' }; } });

  const acheck = async (name, fn) => {
    try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  };
  await acheck('a short or unknown token takes nobody off', async () => {
    assert.deepStrictEqual(await L.unsubscribeByToken('short'), { ok: false });
    assert.deepStrictEqual(await L.unsubscribeByToken('unknowntoken_0123456789abcdef'), { ok: false });
    assert.strictEqual(tagged.length + members.length + mailed.length, 0);
  });
  await acheck("a test copy's link shows the page and changes nothing", async () => {
    assert.deepStrictEqual(await L.unsubscribeByToken('testtoken_0123456789abcdef'), { ok: true, test: true });
    assert.strictEqual(tagged.length + members.length + mailed.length, 0);
  });
  await acheck('a real link: recorded, tag swapped on the lead, Guy gets one line saying so', async () => {
    assert.deepStrictEqual(await L.unsubscribeByToken('realtoken_0123456789abcdef'), { ok: true });
    assert.deepStrictEqual(members, [{ email: 'sam@x.com' }]);
    assert.deepStrictEqual(tagged, [{ lead_email: 'sam@x.com', remove_tags: L.LIST_TAG, add_tags: 'unsubscribed' }]);
    assert.strictEqual(mailed.length, 1);
    assert.strictEqual(mailed[0].to, 'coach@x.com');
    assert.ok(/Sam unsubscribed from Network building, rethought/.test(mailed[0].subject));
    assert.ok(mailed[0].html.includes('sam@x.com'));
  });
  await acheck('clicking it twice (or Gmail and the link both) tells Guy once', async () => {
    assert.deepStrictEqual(await L.unsubscribeByToken('realtoken_0123456789abcdef'), { ok: true, alreadyUnsubscribed: true });
    assert.strictEqual(mailed.length, 1);
  });
  L.__setTestPool(null);
}

linkTests().then(() => {
  console.log('');
  if (failures) { console.error(`${failures} failing`); process.exit(1); }
  console.log('all passing');
});
