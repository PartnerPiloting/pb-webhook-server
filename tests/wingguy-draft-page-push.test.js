/**
 * Tests for the draft page's "Push to drafts" button (routes/wingguyDraftRoutes.js) — Guy's
 * 2026-10-03 call: email entries get a button that files the stored reply in the coach's own
 * mailbox through the same wingguy_create_draft the chat uses; LinkedIn entries never do; a
 * second click never files a second draft.
 *
 * No network, no stores — the mail tool and the ledger are faked. ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-draft-page-push.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { canPush, pushArgs, pushEntry, askMessages } = require('../routes/wingguyDraftRoutes');

const email = {
  name: 'Erin Email', channel: 'email', email: 'erin@example.com',
  draftText: 'Hi Erin,\n\nIt was episode 12.\n\nGuy', draftHtml: '<p>Hi Erin,</p><p>It was episode 12.</p><p>Guy</p>',
  replyToMessageId: 'msg123', pushSubject: 'Re: podcast',
};
const linkedin = { name: 'Larry Legacy', channel: 'linkedin', draftText: 'Old paste-ready message.' };

const fakeMail = (result) => {
  const calls = [];
  return { calls, tools: [{ name: 'wingguy_create_draft', run: async (args, tenant) => { calls.push({ args, tenant }); return result || { text: 'Draft created' }; } }] };
};
const fakeStore = (row) => ({ findAwaitingDraftTo: async () => row });

(async () => {
  console.log('draft page - push to drafts');

  await check('email entry with an address and wording is pushable', () => {
    assert.strictEqual(canPush(email), true);
  });

  await check('LinkedIn entry is never pushable', () => {
    assert.strictEqual(canPush(linkedin), false);
  });

  await check('email entry with no address is not pushable', () => {
    assert.strictEqual(canPush({ ...email, email: '' }), false);
  });

  await check('push args come only from the stored entry, threaded', () => {
    const a = pushArgs(email);
    assert.deepStrictEqual(a.to, [{ email: 'erin@example.com', name: 'Erin Email' }]);
    assert.strictEqual(a.subject, 'Re: podcast');
    assert.strictEqual(a.html_body, email.draftHtml);
    assert.strictEqual(a.reply_to_message_id, 'msg123');
  });

  await check('text-only entry is turned into escaped HTML paragraphs', () => {
    const a = pushArgs({ ...email, draftHtml: null, draftText: 'Hi <Erin>,\n\nLine one\nLine two' });
    assert.strictEqual(a.html_body, '<p>Hi &lt;Erin&gt;,</p><p>Line one<br>Line two</p>');
  });

  await check('first click files one draft for the right tenant', async () => {
    const mail = fakeMail();
    const out = await pushEntry('Test-Tenant', email, { mailTools: mail.tools, store: fakeStore(null) });
    assert.deepStrictEqual(out, { ok: true, already: false });
    assert.strictEqual(mail.calls.length, 1);
    assert.strictEqual(mail.calls[0].tenant, 'Test-Tenant');
  });

  await check('an unsent draft already in the ledger means no second draft', async () => {
    const mail = fakeMail();
    const out = await pushEntry('Test-Tenant', email, { mailTools: mail.tools, store: fakeStore({ id: 7 }) });
    assert.deepStrictEqual(out, { ok: true, already: true });
    assert.strictEqual(mail.calls.length, 0);
  });

  await check('a double-click while the first push is in flight files one draft', async () => {
    const mail = fakeMail();
    const deps = { mailTools: mail.tools, store: fakeStore(null) };
    const [a, b] = await Promise.all([pushEntry('Test-Tenant', email, deps), pushEntry('Test-Tenant', email, deps)]);
    assert.strictEqual(mail.calls.length, 1);
    assert.strictEqual([a, b].filter((r) => r.already).length, 1);
  });

  await check('a refusal from the draft tool comes back as an error, not a success', async () => {
    const mail = fakeMail({ text: 'Draft NOT created. asset already sent', isError: true });
    const out = await pushEntry('Test-Tenant', email, { mailTools: mail.tools, store: fakeStore(null) });
    assert.strictEqual(out.ok, false);
    assert.ok(/NOT created/.test(out.error));
  });

  await check('Push again files another copy even with one on record', async () => {
    const mail = fakeMail();
    const out = await pushEntry('Test-Tenant', email, { again: true, mailTools: mail.tools, store: fakeStore({ id: 7 }) });
    assert.deepStrictEqual(out, { ok: true, already: false });
    assert.strictEqual(mail.calls.length, 1);
  });

  await check('wording rewritten in Discuss is what gets pushed, to the stored recipient and thread', async () => {
    const mail = fakeMail();
    await pushEntry('Test-Tenant', email, { again: true, text: 'Hi Erin,\n\nNew wording - see https://example.com/x.\n\nGuy', mailTools: mail.tools, store: fakeStore(null) });
    const a = mail.calls[0].args;
    assert.strictEqual(a.html_body, '<p>Hi Erin,</p><p>New wording - see <a href="https://example.com/x">https://example.com/x</a>.</p><p>Guy</p>');
    assert.deepStrictEqual(a.to, [{ email: 'erin@example.com', name: 'Erin Email' }]);
    assert.strictEqual(a.reply_to_message_id, 'msg123');
  });

  await check('Discuss: the first question carries the draft on screen', () => {
    const m = askMessages(email, [{ role: 'user', content: 'make it shorter' }]);
    assert.strictEqual(m.length, 1);
    assert.ok(m[0].content.includes('It was episode 12.') && m[0].content.endsWith('make it shorter'));
  });

  await check('Discuss: junk roles are dropped and the last turn must be the human', () => {
    assert.deepStrictEqual(askMessages(email, [{ role: 'system', content: 'x' }, { role: 'assistant', content: 'hi' }]), []);
    const m = askMessages(linkedin, [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }]);
    assert.deepStrictEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
  });

  await check('LinkedIn entry is refused without touching the mailbox', async () => {
    const mail = fakeMail();
    const out = await pushEntry('Test-Tenant', linkedin, { mailTools: mail.tools, store: fakeStore(null) });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(mail.calls.length, 0);
  });

  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})();
