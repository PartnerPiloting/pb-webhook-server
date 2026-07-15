/**
 * wingguy-thread-draft-test.js — prove reply_to_message_id makes a Nylas draft a REAL threaded reply.
 *
 * The claim being settled: before 2026-07-16 wingguy_create_draft could only write standalone
 * messages, so any conversational reply fell back to the Gmail connector (and its google.com/url
 * link-wrapping). This script finds a real recent message in the coach's mailbox, drafts a reply to
 * it with replyToMessageId set, reads the draft back, and checks the stored draft's thread_id equals
 * the original message's thread_id — threading proven with real bytes from the mailbox.
 *
 * Run on prod (needs NYLAS_API_KEY + the coach's Nylas grant): a one-off Render job.
 *   node scripts/wingguy-thread-draft-test.js [--from someone@example.com]
 * Creates ONE draft (never sends). Leaves it in Drafts so Guy can eyeball the threading; bin it after.
 */

const clientService = require('../services/clientService');
const mailProvider = require('../services/mailProvider');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  console.log(`=== wingguy threaded-reply draft test (tenant=${TENANT}) ===`);
  const coach = await clientService.getClientById(TENANT);
  if (!coach) { console.log(`FAIL: coach "${TENANT}" not found`); process.exit(0); }
  console.log(`coach: ${coach.clientName} · nylasGrantId=${coach.nylasGrantId ? 'set' : '(none)'}`);
  if (!coach.nylasGrantId) { console.log('FAIL: no Nylas grant on the coach record'); process.exit(0); }

  // 1. Find a real message to reply to (any recent inbox message; --from narrows it).
  const from = argValue('--from');
  const found = await mailProvider.findMessages(coach, { from, limit: 3 });
  if (!found.ok) { console.log(`FAIL: message search: ${found.error}`); process.exit(0); }
  if (!found.messages.length) { console.log('FAIL: no messages found to reply to (try --from <email>)'); process.exit(0); }
  const original = found.messages[0];
  console.log(`replying to: messageId=${original.id}`);
  console.log(`  thread=${original.threadId} · from=${original.from}`);
  console.log(`  subject=${original.subject}`);

  // 2. Draft a reply threaded onto it (with a link in it — the clean-link + threading combo is the
  //    exact case that had no path before).
  const created = await mailProvider.createDraft(coach, {
    subject: `Re: ${original.subject || ''}`.trim(),
    html: '<p>Wingguy threaded-reply test (safe to delete). Link check: <a href="https://www.linkedin.com/in/deanhobin/">Dean Hobin</a></p>',
    to: [{ email: coach.googleCalendarEmail || 'guyralphwilson@gmail.com', name: coach.clientName || 'Guy' }],
    replyToMessageId: original.id,
  });
  if (!created.ok) { console.log(`FAIL: create draft: ${created.error}`); process.exit(0); }
  console.log(`created draftId=${created.draftId} · draft thread=${created.threadId}`);

  // 3. Read it back and compare thread ids.
  const read = await mailProvider.getDraft(coach, created.draftId);
  if (!read.ok) { console.log(`FAIL: read draft back: ${read.error}`); process.exit(0); }
  const storedThread = read.draft && read.draft.thread_id;
  const storedReplyTo = read.draft && read.draft.reply_to_message_id;
  console.log(`stored: thread_id=${storedThread} · reply_to_message_id=${storedReplyTo}`);

  const wrapped = /google\.com\/url/i.test((read.draft && read.draft.body) || '');
  if (storedThread && storedThread === original.threadId) {
    console.log(`VERDICT: THREADED ✅ — the draft sits on the original message's thread.${wrapped ? ' (BUT a link got wrapped?!)' : ' Links clean too.'}`);
  } else {
    console.log(`VERDICT: NOT THREADED ❌ — draft thread_id=${storedThread} vs original=${original.threadId}.`);
  }
})().catch((e) => { console.log(`ERROR: ${e.message}`); process.exit(0); });
