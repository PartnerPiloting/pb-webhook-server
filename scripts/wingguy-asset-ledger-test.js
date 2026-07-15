/**
 * wingguy-asset-ledger-test.js — prove the asset ledger + usage gate + inbound check on prod.
 *
 * The claim being settled: the asset-usage-gates rules ("check email history before sending
 * anything twice") were unenforceable because Wingguy was write-only for email. Now
 * wingguy_create_draft logs asset links per-lead at draft time, refuses a repeat without
 * resend_ok, wingguy_lead_history reads it back, and wingguy_lead_replied_since answers "did
 * they reply?" via the coach's own Nylas grant. This script exercises ALL of it against the
 * real store + mailbox, then deletes its own ledger rows (drafts stay for Guy to bin).
 *
 * Run on prod (needs DATABASE_URL + NYLAS_API_KEY + the coach's grant): a one-off Render job.
 *   node scripts/wingguy-asset-ledger-test.js [--lead someone@example.com] [--since 2026-06-01]
 * Creates TWO drafts to the coach's own address (never sends). Leaves them in Drafts; bin after.
 */

const store = require('../services/wingguyRulesStore');
const mailMcp = require('../services/wingguyMailMcp');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const TEST_ASSET_KEY = 'ledger-smoke-test';
const TEST_ASSET_URL = 'https://example.com/wingguy-ledger-smoke';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const runTool = (name, args) => {
  const def = mailMcp.TOOL_DEFS.find((d) => d.name === name);
  return def.run(args, TENANT);
};

(async () => {
  console.log(`=== wingguy asset-ledger + inbound-check test (tenant=${TENANT}) ===`);
  const clientService = require('../services/clientService');
  const coach = await clientService.getClientById(TENANT);
  if (!coach) { console.log(`FAIL: coach "${TENANT}" not found`); process.exit(0); }
  const selfEmail = coach.googleCalendarEmail || 'guyralphwilson@gmail.com';
  const lead = (argValue('--lead') || selfEmail).toLowerCase();
  let pass = 0, fail = 0;
  const verdict = (ok, label, detail) => {
    console.log(`${ok ? 'PASS ✅' : 'FAIL ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
    ok ? pass++ : fail++;
  };

  // 0. A throwaway asset so the test never touches real library entries. Retired at the end.
  await store.setAsset({ tenantId: TENANT, assetKey: TEST_ASSET_KEY, kind: 'test', url: TEST_ASSET_URL, actor: 'ledger-smoke' });
  console.log(`test asset "${TEST_ASSET_KEY}" registered → ${TEST_ASSET_URL}`);
  const draftIds = [];

  try {
    // 1. Draft with an {{asset:key}} token → draft created + ledger row written.
    const first = await runTool('wingguy_create_draft', {
      to: [{ email: lead, name: 'Ledger Smoke' }],
      subject: 'Wingguy ledger smoke test (safe to delete)',
      html_body: `<p>Ledger test. Asset link: <a href="{{asset:${TEST_ASSET_KEY}}}">the thing</a></p>`,
    });
    const draftId1 = (first.text.match(/draftId=(\S+)/) || [])[1];
    if (draftId1) draftIds.push(draftId1);
    verdict(!first.isError && /Asset ledger: logged ledger-smoke-test/.test(first.text), 'draft 1 created + asset logged', first.text.split('\n')[0]);

    // 2. Same asset, same lead, no resend_ok → the gate must refuse.
    const repeat = await runTool('wingguy_create_draft', {
      to: [{ email: lead }],
      subject: 'Wingguy ledger smoke repeat (should be refused)',
      html_body: `<p>Repeat: ${TEST_ASSET_URL}</p>`, // literal URL form this time
    });
    verdict(repeat.isError === true && /asset-usage gate/.test(repeat.text), 'repeat WITHOUT resend_ok refused by the gate', repeat.text.split('\n')[0]);

    // 3. Same again WITH resend_ok → allowed, second ledger row.
    const override = await runTool('wingguy_create_draft', {
      to: [{ email: lead }],
      subject: 'Wingguy ledger smoke resend_ok (safe to delete)',
      html_body: `<p>Deliberate resend: ${TEST_ASSET_URL}</p>`,
      resend_ok: true,
    });
    const draftId2 = (override.text.match(/draftId=(\S+)/) || [])[1];
    if (draftId2) draftIds.push(draftId2);
    verdict(!override.isError && /Asset ledger: logged/.test(override.text), 'resend_ok override drafts + logs', override.text.split('\n')[0]);

    // 4. Unknown token → refused with the library listed.
    const unknown = await runTool('wingguy_create_draft', {
      to: [{ email: lead }],
      subject: 'x',
      html_body: '<p>{{asset:does-not-exist}}</p>',
    });
    verdict(unknown.isError === true && /unknown \{\{asset/.test(unknown.text), 'unknown {{asset:...}} refused', unknown.text.split('\n')[0]);

    // 5. wingguy_lead_history shows both entries.
    const history = await runTool('wingguy_lead_history', { lead_email: lead });
    const entryCount = (history.text.match(/ledger-smoke-test/g) || []).length;
    verdict(!history.isError && entryCount === 2, 'wingguy_lead_history shows the 2 entries', `${entryCount} entries`);

    // 6. wingguy_lead_replied_since — real Nylas read via the coach's grant.
    const since = argValue('--since') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const replied = await runTool('wingguy_lead_replied_since', { lead_email: lead, since_iso: since });
    verdict(!replied.isError && /^(YES|NO)/.test(replied.text), `wingguy_lead_replied_since answers cleanly (lead=${lead}, since=${since})`, replied.text.split('\n')[0]);
    const badDate = await runTool('wingguy_lead_replied_since', { lead_email: lead, since_iso: 'not-a-date' });
    verdict(badDate.isError === true, 'bad since_iso rejected');
  } finally {
    // Cleanup: retire the throwaway asset + delete this run's ledger rows (drafts left to bin).
    await store.setAsset({ tenantId: TENANT, assetKey: TEST_ASSET_KEY, status: 'retired', actor: 'ledger-smoke' });
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const del = await pool.query(
      `DELETE FROM wingguy_asset_ledger WHERE tenant_id = $1 AND asset_key = $2`,
      [TENANT, TEST_ASSET_KEY],
    );
    await pool.end();
    console.log(`cleanup: test asset retired · ${del.rowCount} ledger row(s) deleted · drafts left in Drafts to bin: ${draftIds.join(', ') || '(none)'}`);
  }

  console.log(`\nVERDICT: ${pass} pass / ${fail} fail ${fail ? '❌' : '✅ — ledger, gate, history and inbound check all proven on the real stack.'}`);
})().catch((e) => { console.log(`ERROR: ${e.message}`); process.exit(0); });
