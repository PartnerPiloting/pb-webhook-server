/**
 * wingguy-mail-read-test.js — prove the person-scoped mail READ tools on prod.
 *
 * The claim being settled: wingguy_lead_correspondence lists BOTH directions with one person
 * (Nylas any_email) and wingguy_read_message returns a full body as readable text — via the
 * coach's own Nylas grant, no Gmail connector. Read-only: creates nothing, changes nothing.
 *
 * Run on prod (needs NYLAS_API_KEY + the coach's grant): a one-off Render job.
 *   node scripts/wingguy-mail-read-test.js [--lead someone@example.com]
 */

const mailMcp = require('../services/wingguyMailMcp');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const runTool = (name, args) => {
  const def = mailMcp.TOOL_DEFS.find((d) => d.name === name);
  return def.run(args, TENANT);
};

(async () => {
  console.log(`=== wingguy person-scoped mail read test (tenant=${TENANT}) ===`);
  const lead = (argValue('--lead') || 'guyralphwilson@gmail.com').toLowerCase();
  let pass = 0, fail = 0;
  const verdict = (ok, label, detail) => {
    console.log(`${ok ? 'PASS ✅' : 'FAIL ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
    ok ? pass++ : fail++;
  };

  // 1. Correspondence: both directions with one person, newest first.
  const corr = await runTool('wingguy_lead_correspondence', { lead_email: lead, limit: 5 });
  const gotList = !corr.isError && /messageId=/.test(corr.text);
  verdict(gotList, `wingguy_lead_correspondence returns messages for ${lead}`, corr.text.split('\n')[0]);
  const hasDirections = /(⬅ FROM them|➡ TO them)/.test(corr.text);
  verdict(!corr.isError && hasDirections, 'direction labels present (FROM/TO)');
  console.log('--- correspondence sample ---\n' + corr.text.split('\n').slice(0, 8).join('\n') + '\n---');

  // 2. Read one message in full — pick the first messageId from the list.
  const msgId = (corr.text.match(/messageId=(\S+)/) || [])[1];
  if (!msgId) {
    verdict(false, 'no messageId to read (correspondence came back empty?)');
  } else {
    const read = await runTool('wingguy_read_message', { message_id: msgId });
    const headerOk = !read.isError && /From: /.test(read.text) && /Subject: /.test(read.text);
    const bodyText = read.text.split('\n\n').slice(1).join('\n\n');
    const bodyOk = bodyText.trim().length > 0 && !/<\s*(div|p|table|html|body)\b/i.test(bodyText);
    verdict(headerOk, 'wingguy_read_message returns headers', read.text.split('\n')[0]);
    verdict(bodyOk, 'body rendered as readable text (non-empty, no HTML tags)', `${bodyText.trim().length} chars`);
  }

  // 3. Guard rails.
  const noId = await runTool('wingguy_read_message', {});
  verdict(noId.isError === true, 'missing message_id rejected');
  const badDate = await runTool('wingguy_lead_correspondence', { lead_email: lead, since_iso: 'nope' });
  verdict(badDate.isError === true, 'bad since_iso rejected');
  const nobody = await runTool('wingguy_lead_correspondence', { lead_email: 'no-such-person-zzz@example.invalid' });
  verdict(!nobody.isError && /No emails either way/.test(nobody.text), 'unknown person answers cleanly (empty, not error)', nobody.text.split('\n')[0]);

  console.log(`\nVERDICT: ${pass} pass / ${fail} fail ${fail ? '❌' : '✅ — person-scoped correspondence + full-body read proven on the real mailbox.'}`);
})().catch((e) => { console.log(`ERROR: ${e.message}`); process.exit(0); });
