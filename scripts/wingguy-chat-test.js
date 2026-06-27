// scripts/wingguy-chat-test.js
// Cloud test for the Wingguy chat AGENT (Slice 2 BIG half). Runs the REAL agent loop
// (services/wingguyChat.runWingguyChatTurn) with the REAL Claude + REAL calendar read, but STUBS
// book_meeting so it never creates a live event. Proves: check_availability works, the agent keeps a
// LinkedIn draft via propose_message, it CONFIRMS before booking, and it calls book_meeting only
// after Guy says yes.
//
// Run as a Render one-off job (prod has ANTHROPIC_API_KEY + Airtable + the calendar service account):
//   node scripts/wingguy-chat-test.js
//
// Single-tenant Guy: coach = Guy-Wilson.

const { runWingguyChatTurn } = require('../services/wingguyChat');

const COACH = { clientId: 'Guy-Wilson', clientName: 'Guy Wilson' };
const LEAD_EMAIL = 'taniaadelewilson@gmail.com'; // a test guest (no real invite — booking is stubbed)

const PROFILE = {
  name: 'Tania Wilson',
  headline: 'Founder at Wilfreed',
  location: 'Melbourne, Australia',
  profileUrl: 'https://www.linkedin.com/in/tania-wilson-example/',
};

// A realistic warm thread where the lead is up for a Zoom (the "suggest times" trigger).
const CONVERSATION = [
  { sender: 'Guy', text: 'Thanks for connecting Tania — what you’re building at Wilfreed looks great.' },
  { sender: 'Tania', text: 'Thanks Guy! Yeah I’d be happy to jump on a quick Zoom to compare notes. When suits you?' },
];

// Stub: pretend the booking succeeded, but DON'T create a real event.
async function stubBook(coach, details) {
  console.log(`\n   [stub book_meeting] startISO=${details.startISO} guest=${details.leadEmail} len=${details.durationMins || 'default'}`);
  return { ok: true, eventId: 'evt_TEST_STUB', title: `${details.leadName} & ${coach.clientName}`, start: details.startISO, durationMins: details.durationMins || 30 };
}

const deps = { createBookingEvent: stubBook };

function toolCallsIn(messages) {
  const calls = [];
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && b.type === 'tool_use') calls.push(b.name);
      }
    }
  }
  return calls;
}

function show(label, result) {
  console.log(`\n================ ${label} ================`);
  if (!result.ok) { console.log('ERROR:', result.error); return; }
  console.log('TOOLS CALLED:', toolCallsIn(result.messages).join(', ') || '(none)');
  console.log('\nWINGGUY (chat to Guy):\n  ' + (result.reply || '(no text)').replace(/\n/g, '\n  '));
  console.log('\nLINKEDIN DRAFT (propose_message):\n  ' + (result.draft ? result.draft.replace(/\n/g, '\n  ') : '(none this turn)'));
  console.log('\nBOOKED:', result.booked ? `${result.booked.eventId} @ ${result.booked.start}` : 'no');
}

async function main() {
  const profileBlock =
    `Name: ${PROFILE.name}\nHeadline: ${PROFILE.headline}\nLocation: ${PROFILE.location}\nLinkedIn URL: ${PROFILE.profileUrl}`;
  const convoBlock = CONVERSATION.map((m) => `${m.sender}: ${m.text}`).join('\n');

  const base = { coach: COACH, profile: PROFILE, conversation: CONVERSATION, leadEmail: LEAD_EMAIL, profileBlock, convoBlock, deps };

  // Turn 1 — Guy asks it to suggest times. Expect: check_availability + propose_message (times offer).
  let messages = [{ role: 'user', content: 'She’s keen to meet — suggest a few times we could do and draft the LinkedIn reply.' }];
  let r1 = await runWingguyChatTurn({ ...base, messages });
  show('TURN 1 — suggest times', r1);
  if (!r1.ok) return;

  // Turn 2 — Guy picks one and says book it. Expect: it CONFIRMS first (no book_meeting yet).
  messages = r1.messages.concat([{ role: 'user', content: 'Great — book the first one.' }]);
  let r2 = await runWingguyChatTurn({ ...base, messages });
  show('TURN 2 — "book the first one" (expect a confirm, NOT a booking yet)', r2);
  if (!r2.ok) return;

  // Turn 3 — Guy confirms. Expect: book_meeting (stub) + a past-tense "invite’s on its way" draft.
  messages = r2.messages.concat([{ role: 'user', content: 'Yes, do it.' }]);
  let r3 = await runWingguyChatTurn({ ...base, messages });
  show('TURN 3 — "yes, do it" (expect book_meeting + confirmation draft)', r3);

  console.log('\n\n=== SUMMARY ===');
  console.log('Turn 1 offered times:', r1.draft ? 'yes' : 'NO');
  console.log('Turn 2 held back booking (confirm-first):', !(r2.booked) ? 'yes' : 'NO — it booked without explicit confirm!');
  console.log('Turn 3 booked after confirm:', r3.booked ? 'yes' : 'NO');
}

main().then(() => process.exit(0)).catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
