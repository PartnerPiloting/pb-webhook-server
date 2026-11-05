/**
 * An email drafted in chat is refused when it uses a word on the client's banned list (6 Nov 2026).
 * The LinkedIn half is tests/wingguy-banned-words.test.js.
 *
 * Contracts:
 *   1. The subject and the body the coach is sending are checked; markup is ignored.
 *   2. Quoted material (<blockquote>), web addresses and email addresses are NOT checked.
 *   3. A word in a recipient's own name is allowed.
 *   4. wingguy_create_draft refuses BEFORE anything reaches the mailbox, and says how to proceed.
 *   5. banned_words_ok lets the human's own wording through.
 *   6. A clean email, an empty list and an unreadable list all reach the mailbox as before.
 *   7. Scheduled sends are untouched: prepareOutbound (their door) does not run the check.
 *   8. The draft page's Push button passes banned_words_ok (a person pressing a button, no writer).
 *
 * No network. Run: node tests/wingguy-banned-words-email.test.js
 */
const assert = require('assert');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test-only/never-connected';

const { emailCheckText, findBannedWord } = require('../utils/bannedWords');
const store = require('../services/wingguyRulesStore');
const clientService = require('../services/clientService');
const mailProvider = require('../services/mailProvider');
const mail = require('../services/wingguyMailMcp');

let failed = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

(async () => {
  console.log('emailCheckText - what the ban applies to');
  const terms = ['folks', 'reach out', 'honest'];
  await check('a banned word in the body is found through the markup', () => {
    const t = emailCheckText('Catching up', '<p>Hi Barrie,</p><p>A few <b>folks</b> asked after you.</p>', mail.htmlToText);
    assert.strictEqual(findBannedWord(t, terms).found, 'folks');
  });
  await check('a banned word in the subject is found', () => {
    assert.ok(findBannedWord(emailCheckText('To be honest', '<p>Hi</p>', mail.htmlToText), terms));
  });
  await check('quoted material is not the coach speaking', () => {
    const html = '<p>Hi Barrie, good to hear from you.</p><blockquote><p>Say hi to the folks for me</p></blockquote>';
    assert.strictEqual(findBannedWord(emailCheckText('Re: hello', html, mail.htmlToText), terms), null);
  });
  await check('a web address or email address containing the word is not checked', () => {
    const html = '<p>Here it is: <a href="https://example.com/folks/page">the page</a> and https://honest.example.com or mail honest@example.com</p>';
    assert.strictEqual(findBannedWord(emailCheckText('Link', html, mail.htmlToText), terms), null);
  });
  await check('a clean email passes', () => {
    assert.strictEqual(findBannedWord(emailCheckText('Catching up', '<p>Hi Barrie, a few people asked after you.</p>', mail.htmlToText), terms), null);
  });

  // ---- wired through the real draft door, mailbox and stores faked ------------------------
  const real = {
    getVariables: store.getVariables, getAssets: store.getAssets,
    getClientById: clientService.getClientById,
    hasMailbox: mailProvider.hasMailbox, createDraft: mailProvider.createDraft,
  };
  let list = 'folks, flick';
  let reached = [];
  store.getVariables = async () => [{ var_key: 'never_say_words', value: list }];
  store.getAssets = async () => [];
  clientService.getClientById = async (id) => ({ clientId: id, clientName: 'David Gould', timezone: 'Australia/Brisbane' });
  mailProvider.hasMailbox = () => true;
  // Stop at the mailbox: reaching createDraft is the proof the door let the email through.
  mailProvider.createDraft = async (coach, d) => { reached.push(d); return { ok: false, error: 'TEST STOP at the mailbox' }; };
  const def = mail.TOOL_DEFS.find((d) => d.name === 'wingguy_create_draft');
  const to = [{ email: 'barrie@example.com', name: 'Barrie East' }];
  const dirty = '<p>Hi Barrie,</p><p>A few folks asked after you.</p><p>David</p>';
  const cleanBody = '<p>Hi Barrie,</p><p>A few people asked after you.</p><p>David</p>';

  try {
    console.log('wingguy_create_draft');
    await check('an email with a banned word is refused and never reaches the mailbox', async () => {
      reached = [];
      const out = await def.run({ to, subject: 'Catching up', html_body: dirty }, 'David-Gould');
      assert.strictEqual(out.isError, true);
      assert.ok(/Draft NOT created/.test(out.text) && /"folks"/.test(out.text) && /banned-words list/.test(out.text), out.text);
      assert.ok(/banned_words_ok/.test(out.text), 'the refusal names the way through for the human\'s own wording');
      assert.strictEqual(reached.length, 0);
    });
    await check('the reworded email reaches the mailbox', async () => {
      reached = [];
      const out = await def.run({ to, subject: 'Catching up', html_body: cleanBody }, 'David-Gould');
      assert.strictEqual(reached.length, 1);
      assert.ok(/TEST STOP/.test(out.text));
    });
    await check('banned_words_ok lets the human\'s own wording through', async () => {
      reached = [];
      await def.run({ to, subject: 'Catching up', html_body: dirty, banned_words_ok: true }, 'David-Gould');
      assert.strictEqual(reached.length, 1);
    });
    await check('a banned word only in the recipient\'s own name is allowed', async () => {
      reached = [];
      await def.run({ to: [{ email: 'g@example.com', name: 'Gina Folks' }], subject: 'Hello', html_body: '<p>Hi Gina, is it Folks or Fawkes?</p>' }, 'David-Gould');
      assert.strictEqual(reached.length, 1);
    });
    await check('an empty list checks nothing', async () => {
      list = '';
      reached = [];
      await def.run({ to, subject: 'Catching up', html_body: dirty }, 'David-Gould');
      assert.strictEqual(reached.length, 1);
      list = 'folks, flick';
    });
    await check('a list that cannot be read never blocks an email', async () => {
      const keep = store.getVariables;
      store.getVariables = async () => { throw new Error('db down'); };
      reached = [];
      await def.run({ to, subject: 'Catching up', html_body: dirty }, 'David-Gould');
      store.getVariables = keep;
      assert.strictEqual(reached.length, 1);
    });
    await check('the tool tells Claude about banned_words_ok', () => {
      assert.ok(def.jsonSchema.properties.banned_words_ok);
      assert.ok(def.zodSchema.banned_words_ok);
    });

    console.log('scheduled sends are untouched');
    await check('prepareOutbound (the scheduled-send door) passes an email with a banned word', async () => {
      const p = await mail.prepareOutbound({ to, subject: 'Catching up', html_body: dirty }, 'David-Gould');
      assert.ok(!p.error, p.error);
    });
    await check('the schedule tool has no banned-words option to trip on', () => {
      const sched = mail.TOOL_DEFS.find((d) => d.name === 'wingguy_schedule_email');
      assert.ok(sched && !sched.jsonSchema.properties.banned_words_ok);
    });

    console.log('the draft page Push button');
    await check('passes banned_words_ok - a person pressing a button, nobody to reword', async () => {
      const { pushEntry } = require('../routes/wingguyDraftRoutes');
      const calls = [];
      const tools = [{ name: 'wingguy_create_draft', run: async (args) => { calls.push(args); return { text: 'Draft created' }; } }];
      const it = { name: 'Erin Email', channel: 'email', email: 'erin@example.com', draftText: 'Hi Erin, a few folks asked.', draftHtml: '<p>Hi Erin, a few folks asked.</p>', pushSubject: 'Re: hello' };
      const r = await pushEntry('David-Gould', it, { mailTools: tools, store: { findAwaitingDraftTo: async () => null } });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(calls[0].banned_words_ok, true);
    });
  } finally {
    store.getVariables = real.getVariables; store.getAssets = real.getAssets;
    clientService.getClientById = real.getClientById;
    mailProvider.hasMailbox = real.hasMailbox; mailProvider.createDraft = real.createDraft;
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
