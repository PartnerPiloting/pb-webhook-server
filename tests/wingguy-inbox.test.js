/**
 * wingguy_inbox (services/wingguyInboxMcp.js) - the pure parts: reading a Gmail message's text,
 * cutting the quoted thread, and telling Claude who the sender is. Run: node tests/wingguy-inbox.test.js
 */
const assert = require('assert');
const { _test, runInbox, TOOL_DEFS } = require('../services/wingguyInboxMcp');
const { cleanBody, bodyText, senderTags, senderAddress, attachmentNames } = _test;

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`FAIL - ${name}\n  ${e.message}`); }
}
const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

(async () => {
  await t('a reply loses the quoted thread below it', () => {
    const out = cleanBody('Thanks Guy, Thursday works.\n\nOn Mon, 2 Nov 2026 at 9:01 am Guy Wilson <guy@x.com> wrote:\n> Does Thursday suit?\n> Guy');
    assert.strictEqual(out, 'Thanks Guy, Thursday works.');
  });

  await t('text/plain is preferred over HTML', () => {
    const payload = { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
      { mimeType: 'text/plain', body: { data: b64('plain version') } },
    ] };
    assert.strictEqual(bodyText(payload), 'plain version');
  });

  await t('HTML-only mail is made plain', () => {
    const out = bodyText({ mimeType: 'text/html', body: { data: b64('<style>.x{}</style><p>Hi&nbsp;Guy</p><p>Two &amp; three</p>') } });
    assert.ok(/Hi Guy/.test(out) && /Two & three/.test(out) && !/\.x\{\}/.test(out), out);
  });

  await t('own-system senders are flagged as snapshots to check live', () => {
    const tags = senderTags('guy <guy@knowaguy.com.au>', 'guyralphwilson@gmail.com', new Map());
    assert.ok(tags.some((x) => /own system/.test(x) && /check/.test(x)), tags.join('; '));
  });

  await t('a mail Guy sent himself is flagged too', () => {
    const tags = senderTags('Guy Wilson <guyralphwilson@gmail.com>', 'guyralphwilson@gmail.com', new Map());
    assert.ok(tags.some((x) => /to yourself/.test(x)), tags.join('; '));
  });

  await t("Guy's own email to someone else is marked as his", () => {
    const tags = senderTags('Guy Wilson <guyralphwilson@gmail.com>', 'Jeremiah <j@x.com>', new Map());
    assert.ok(tags.some((x) => /your own email to Jeremiah/.test(x)), tags.join('; '));
  });

  await t('a client is named by their record email', () => {
    const tags = senderTags('Roland <Roland@GraceX.io>', 'guyralphwilson@gmail.com', new Map([['roland@gracex.io', 'Roland Illyes']]));
    assert.deepStrictEqual(tags, ['from your client Roland Illyes']);
    assert.strictEqual(senderAddress('Roland <Roland@GraceX.io>'), 'roland@gracex.io');
  });

  await t('inline signature images are not listed as attachments', () => {
    const names = attachmentNames({ parts: [{ filename: 'image.png' }, { filename: 'image001.jpg' }, { filename: '2026 Queries.xlsx' }] });
    assert.deepStrictEqual(names, ['2026 Queries.xlsx']);
  });

  await t("a client's connector is refused - it is Guy's own Gmail", async () => {
    const out = await runInbox({ action: 'list' }, 'Roland-Illyes');
    assert.ok(out.isError && /Guy's own inbox/.test(out.text), out.text);
  });

  await t('the description says to archive only on his yes and to check live', () => {
    const d = TOOL_DEFS[0].description;
    assert.ok(/only the thread_ids Guy has said yes to/.test(d));
    assert.ok(/CHECK BEFORE YOU PASS IT ON/.test(d));
    assert.ok(!/—|–/.test(d), 'no em or en dash');
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
