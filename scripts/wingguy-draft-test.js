/**
 * wingguy-draft-test.js — prove Nylas-created drafts keep hyperlinks CLEAN (no google.com/url wrap).
 *
 * Creates a draft in the coach's mailbox via services/mailProvider (the same path the
 * wingguy_create_draft MCP tool uses), reads it back, and inspects the stored href of each link.
 * The whole reason the tool exists is this claim — this settles it with real bytes from the mailbox.
 *
 * Run on prod (needs NYLAS_API_KEY + the coach's Nylas grant): a one-off Render job.
 *   node scripts/wingguy-draft-test.js
 * Creates ONE draft (never sends). Leaves it in Drafts so Guy can eyeball it; bin it after.
 */

const clientService = require('../services/clientService');
const mailProvider = require('../services/mailProvider');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

const HTML = [
  '<p>Clean-link test. These should point straight at their targets:</p>',
  '<p>LinkedIn: <a href="https://www.linkedin.com/in/deanhobin/">Dean Hobin</a></p>',
  '<p>LinkedIn: <a href="https://www.linkedin.com/in/neville-starick-sail-to-a-brighter-future/">Neville Starick</a></p>',
  '<p>Email: <a href="mailto:dean@timeandfocus.com.au">dean@timeandfocus.com.au</a></p>',
].join('\n');

function extractHrefs(html) {
  const out = [];
  const re = /href="([^"]*)"/gi;
  let m;
  while ((m = re.exec(html || '')) !== null) out.push(m[1]);
  return out;
}

(async () => {
  console.log(`=== wingguy draft clean-link test (tenant=${TENANT}) ===`);
  const coach = await clientService.getClientById(TENANT);
  if (!coach) { console.log(`FAIL: coach "${TENANT}" not found`); process.exit(0); }
  console.log(`coach: ${coach.clientName} · nylasGrantId=${coach.nylasGrantId ? 'set' : '(none)'}`);
  if (!coach.nylasGrantId) { console.log('FAIL: no Nylas grant on the coach record'); process.exit(0); }

  const created = await mailProvider.createDraft(coach, {
    subject: 'Wingguy clean-link test (safe to delete)',
    html: HTML,
    to: [{ email: coach.googleCalendarEmail || 'guyralphwilson@gmail.com', name: coach.clientName || 'Guy' }],
  });
  if (!created.ok) { console.log(`FAIL: create draft: ${created.error}`); process.exit(0); }
  console.log(`created draftId=${created.draftId}`);

  const read = await mailProvider.getDraft(coach, created.draftId);
  if (!read.ok) { console.log(`FAIL: read draft back: ${read.error}`); process.exit(0); }

  const hrefs = extractHrefs(read.draft && read.draft.body);
  console.log(`stored hrefs (${hrefs.length}):`);
  hrefs.forEach((h) => console.log(`  - ${h}`));

  const wrapped = hrefs.filter((h) => /google\.com\/url/i.test(h));
  if (!hrefs.length) {
    console.log('VERDICT: INCONCLUSIVE — no hrefs found in the stored body (check the draft manually).');
  } else if (wrapped.length) {
    console.log(`VERDICT: WRAPPED — ${wrapped.length} link(s) went through google.com/url. Nylas did NOT keep them clean.`);
  } else {
    console.log('VERDICT: CLEAN ✅ — every stored href points straight at its target. No google.com/url wrapping. Hand-fixing is dead.');
  }
})().catch((e) => { console.log(`ERROR: ${e.message}`); process.exit(0); });
