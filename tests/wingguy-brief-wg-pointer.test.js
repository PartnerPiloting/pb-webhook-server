/**
 * Tests for the LinkedIn /wg pointer in the brief (services/wingguyFollowupBrief.formatBrief) —
 * Guy's 2026-08-01 call: LinkedIn reply-owed people carry NO pre-written message; the brief
 * relays "open the thread and type /wg" plus the overnight ANGLE, while email people keep their
 * in-brief drafts, and pre-change payloads (LinkedIn entries with a stored draftText) still
 * render the legacy paste-ready way.
 *
 * Pure formatting — no network, no stores. ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-brief-wg-pointer.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { formatBrief } = require('../services/wingguyFollowupBrief');

const row = {
  payload: {
    preparedAt: new Date().toISOString(),
    totalSurfaced: 3,
    counts: {},
    items: [
      { name: 'Farhad Malegam', verdict: 'draft', channel: 'linkedin', whyLine: 'agreed to mid-June then went quiet',
        wgAngle: 'Revive the call idea - he agreed to a mid-June slot, then time proposals went unanswered.',
        jog: 'Sydney AI consultant.', linkedin: 'https://linkedin.com/in/farhad', draftText: null },
      { name: 'Erin Email', verdict: 'draft', channel: 'email', whyLine: 'asked which episode you meant',
        draftText: 'Hi Erin,\n\nIt was episode 12.\n\nTalk Soon, (I know a) Guy',
        email: 'erin@example.com', replyToMessageId: 'msg123', pushSubject: 'Re: podcast', jog: 'Podcast intro.' },
      { name: 'Larry Legacy', verdict: 'draft', channel: 'linkedin', whyLine: 'left a live thread',
        draftText: 'Old stored paste-ready message.', jog: 'Pre-change payload entry.' },
    ],
  },
};

(async () => {
  const text = formatBrief(row);

  console.log('formatBrief() LinkedIn /wg pointer');
  await check('LinkedIn angle entry gets the /wg pointer tag + angle line, no draft line', () => {
    assert.ok(text.includes('[LinkedIn — open the thread and type /wg]'));
    assert.ok(text.includes('/wg angle: Revive the call idea'));
    assert.ok(!text.includes('draft: "null"'));
  });
  await check('email entry keeps its in-brief draft + push line', () => {
    assert.ok(text.includes('draft: "Hi Erin,'));
    assert.ok(text.includes('reply_to_message_id=msg123'));
  });
  await check('pre-change LinkedIn entry with stored draftText still renders paste-ready', () => {
    assert.ok(text.includes('[LinkedIn — paste-ready]'));
    assert.ok(text.includes('draft: "Old stored paste-ready message."'));
  });
  await check('jogs still ride every line', () => {
    assert.ok(text.includes('jog: Sydney AI consultant.'));
    assert.ok(text.includes('jog: Podcast intro.'));
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
