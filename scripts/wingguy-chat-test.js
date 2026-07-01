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
const { detectTemplate, getTemplate } = require('../config/wingguyTemplates');

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

  const campaignTemplate = getTemplate(detectTemplate(PROFILE, CONVERSATION));
  const base = { coach: COACH, profile: PROFILE, conversation: CONVERSATION, leadEmail: LEAD_EMAIL, profileBlock, convoBlock, campaignTemplate, deps };

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

  console.log('\n\n=== SUMMARY (booking flow) ===');
  console.log('Turn 1 offered times:', r1.draft ? 'yes' : 'NO');
  console.log('Turn 2 held back booking (confirm-first):', !(r2.booked) ? 'yes' : 'NO — it booked without explicit confirm!');
  console.log('Turn 3 booked after confirm:', r3.booked ? 'yes' : 'NO');

  // ── Scenario B: Greg — warm reply from a fractional pro who shared LinkedIn URLs.
  // Expect a fractional-style FOLLOW-UP that nods to the marketing topic from the link slug,
  // WITHOUT pushing specific times (no calendar tool on this turn).
  const gregProfile = {
    name: 'Greg Abbey',
    headline: 'Founder and Fractional CMO | Strategic Marketing Partner',
    location: 'Australia',
    profileUrl: 'https://www.linkedin.com/in/gregabbey1/',
  };
  const gregConvo = [
    { sender: 'Guy', text: "Hi Greg, I'm building a network of Fractional Professionals who only recommend others they trust. Looking at your profile - I think you'd be easy to recommend. (I know a) Guy" },
    { sender: 'Greg', text: "Hi Guy, Thanks for reaching out and it's great to connect. I really like you (I know a)... very memorable! Here are a few of my latest musings on LinkedIn... https://www.linkedin.com/posts/gregabbey1_marketingthatmeansbusiness-activity-7475733258148909058-yRQ7 https://www.linkedin.com/pulse/youre-already-doing-marketing-greg-abbey-7bfnc/ Take care and speak soon. Cheers, Greg" },
  ];
  const gregProfileBlock = `Name: ${gregProfile.name}\nHeadline: ${gregProfile.headline}\nLocation: ${gregProfile.location}\nLinkedIn URL: ${gregProfile.profileUrl}`;
  const gregConvoBlock = gregConvo.map((m) => `${m.sender}: ${m.text}`).join('\n');
  const gregTpl = getTemplate(detectTemplate(gregProfile, gregConvo));
  const rg = await runWingguyChatTurn({
    coach: COACH, profile: gregProfile, conversation: gregConvo, leadEmail: LEAD_EMAIL,
    profileBlock: gregProfileBlock, convoBlock: gregConvoBlock, campaignTemplate: gregTpl, deps,
    messages: [{ role: 'user', content: '(Opened from the LinkedIn conversation above. Read where things stand and give me the best next message to send — and if it\'s time to offer a meeting, suggest some times.)' }],
  });
  show('SCENARIO B — Greg warm reply + shared URL (expect fractional follow-up, weaves the topic, NO time-pushing)', rg);
  console.log('\n=== SUMMARY (Greg) ===');
  console.log('Detected template:', gregTpl ? gregTpl.id : '(none)');
  console.log('Produced a draft:', rg.draft ? 'yes' : 'NO');
  console.log('Did NOT call calendar:', !toolCallsIn(rg.messages).includes('check_availability') ? 'yes' : 'NO — it checked the calendar unprompted');
  console.log('Nods to the link topic:', /market/i.test(rg.draft || '') ? 'yes (mentions marketing)' : 'maybe not — check the draft');

  // ── Scenario C: CONNECTED, HANDSHAKE NOTE ONLY, no reply (Matthew/Vanessa-like — panel opened on a
  // connection whose thread holds ONLY Guy's connection-request note, which never asked for a meeting).
  // The Matthew fix: the handshake note is NOT the pitch, so Wingguy must draft the FULL opener (the frac
  // beats + the Zoom ask), NOT a bare "your note got buried" nudge. (Supersedes the old 2026-06-16 rule
  // that treated the handshake note as "opener already sent → nudge".)
  const vanProfile = {
    name: 'Vanessa Wilton',
    headline: 'Commercial & Creative Leader · Operations, Brand, NPD, Marketing/Design · Ex-Founder',
    location: 'Sydney, New South Wales, Australia',
    profileUrl: 'https://www.linkedin.com/in/vanessawilton/',
  };
  const vanConvo = [
    { sender: 'Guy', text: "Hi Vanessa, I'm building a network of Fractional Professionals who only recommend others they trust. Looking at your profile - I think you'd be easy to recommend. (I know a) Guy" },
  ];
  const vanProfileBlock = `Name: ${vanProfile.name}\nHeadline: ${vanProfile.headline}\nLocation: ${vanProfile.location}\nLinkedIn URL: ${vanProfile.profileUrl}`;
  const vanConvoBlock = vanConvo.map((m) => `${m.sender}: ${m.text}`).join('\n');
  const vanTpl = getTemplate(detectTemplate(vanProfile, vanConvo));
  const rv = await runWingguyChatTurn({
    coach: COACH, profile: vanProfile, conversation: vanConvo, leadEmail: LEAD_EMAIL,
    profileBlock: vanProfileBlock, convoBlock: vanConvoBlock, campaignTemplate: vanTpl, deps,
    // The exact kickoff the extension sends when the thread has messages (Guy's own handshake note).
    messages: [{ role: 'user', content: '(Opened from the LinkedIn conversation above. Read where things stand and give me the best next message to send — and if it\'s time to offer a meeting, suggest some times.)' }],
  });
  show('SCENARIO C — connected, handshake note only (expect the FULL frac opener WITH a Zoom ask, NOT a nudge)', rv);
  console.log('\n=== SUMMARY (Vanessa / handshake note only — the Matthew fix) ===');
  console.log('Produced a draft:', rv.draft ? 'yes' : 'NO — no draft!');
  console.log('Drafted the real opener (asks for a Zoom/call, not a bare nudge):',
    /\b(zoom|call|chat|catch up|catch-up)\b/i.test(rv.draft || '') ? 'yes' : 'NO — looks like a nudge, not the opener');
  console.log('Did NOT call calendar:', !toolCallsIn(rv.messages).includes('check_availability') ? 'yes' : 'NO — checked the calendar unprompted');

  // ── Scenario E: PITCHED BUT QUIET — Guy's REAL opener (which already asked for a Zoom) has gone out
  // and there's still no reply. THIS is the genuine nudge case: draft a light follow-up nudge (don't
  // re-send the whole pitch, don't hedge with "want me to wait?"). Distinguishes stage 2 from stage 1.
  const quietProfile = {
    name: 'Owen Blake',
    headline: 'Fractional COO | Operations & Scale for founder-led SMEs',
    location: 'Brisbane, Australia',
    profileUrl: 'https://www.linkedin.com/in/owen-blake-example/',
  };
  const quietConvo = [
    { sender: 'Guy', text: "Hi Owen, great to connect. Your operations-and-scale background with founder-led SMEs is exactly what makes someone easy to recommend. The network is a simple idea: fractional pros who refer each other rather than everyone waving their own flag - I reckon you'd fit it well. Worth a quick Zoom in the next couple of weeks? (I know a) Guy" },
  ];
  const quietTpl = getTemplate(detectTemplate(quietProfile, quietConvo));
  const re = await runWingguyChatTurn({
    coach: COACH, profile: quietProfile, conversation: quietConvo, leadEmail: LEAD_EMAIL,
    profileBlock: `Name: ${quietProfile.name}\nHeadline: ${quietProfile.headline}\nLocation: ${quietProfile.location}\nLinkedIn URL: ${quietProfile.profileUrl}`,
    convoBlock: quietConvo.map((m) => `${m.sender}: ${m.text}`).join('\n'), campaignTemplate: quietTpl, deps,
    messages: [{ role: 'user', content: '(Opened from the LinkedIn conversation above. Read where things stand and give me the best next message to send — and if it\'s time to offer a meeting, suggest some times.)' }],
  });
  show('SCENARIO E — pitched but quiet (real Zoom-ask opener sent, no reply → expect a light NUDGE)', re);
  console.log('\n=== SUMMARY (Owen / pitched but quiet) ===');
  console.log('Produced a draft (did NOT hedge):', re.draft ? 'yes' : 'NO — it hedged instead of drafting!');
  console.log('Did NOT call calendar:', !toolCallsIn(re.messages).includes('check_availability') ? 'yes' : 'NO — checked the calendar unprompted');
  console.log('   (eyeball: should be a short nudge, not a re-send of the full pitch)');

  // ── Scenario D: VOICE — greeting + "match the previous" sign-off. Deepti-like thread where Guy's LAST
  // message was signed off PLAIN "Guy" (no tagline). Expect: draft greets her by first name AND signs off
  // plain "Guy" (NOT "(I know a) Guy"), per the trim-don't-re-add rule (config/wingguyVoicePrefs.js).
  const deeptiProfile = { name: 'Deepti Vittal', headline: 'Managing Director', location: 'Australia', profileUrl: 'https://www.linkedin.com/in/deepti-vittal-example/' };
  const deeptiConvo = [
    { sender: 'Guy', text: "Hi Deepti, thanks so much - I'll look Lavinia up! Would you be up for a quick 30 min Zoom in the next couple of weeks? Guy" },
    { sender: 'Deepti', text: 'Hi Guy, yes would love to connect to explore options! Can we schedule something over the next week?' },
  ];
  const dTpl = getTemplate(detectTemplate(deeptiProfile, deeptiConvo));
  const rd = await runWingguyChatTurn({
    coach: COACH, profile: deeptiProfile, conversation: deeptiConvo, leadEmail: LEAD_EMAIL,
    profileBlock: `Name: ${deeptiProfile.name}\nHeadline: ${deeptiProfile.headline}`,
    convoBlock: deeptiConvo.map((m) => `${m.sender}: ${m.text}`).join('\n'), campaignTemplate: dTpl, deps,
    messages: [{ role: 'user', content: 'Draft a warm reply moving us toward a Zoom.' }],
  });
  show('SCENARIO D — voice: greeting + match-previous sign-off (previous message was plain "Guy")', rd);
  const dDraft = (rd.draft || '').trim();
  console.log('\n=== SUMMARY (Deepti / voice) ===');
  console.log('Greets by first name:', /deepti/i.test(dDraft) ? 'yes' : 'NO — no first-name greeting');
  console.log('Signs off plain "Guy" (matched previous, no tagline):',
    /\bGuy\s*$/.test(dDraft) && !/\(I know a\)\s*Guy\s*$/i.test(dDraft) ? 'yes' : 'NO — check the sign-off');
  // ── Scenario F: GENERAL (\tks) opener — non-fractional fresh connection, handshake note only, no reply.
  // The \tks campaign keeps its OWN sign-off "Talk soon / I know a (Guy)" (Guy's call 2026-07-01), which must
  // WIN over the unified voice-prefs "(I know a) Guy". Expect a tks opener signing off with "Talk soon".
  const genProfile = { name: 'Sam Carter', headline: 'Operations Manager at Northwind Logistics', location: 'Sydney, Australia', profileUrl: 'https://www.linkedin.com/in/sam-carter-example/' };
  const genConvo = [{ sender: 'Guy', text: "Hi Sam, thanks for connecting - looks like you've built up real depth at Northwind. Talk soon\nI know a (Guy)" }];
  const genTpl = getTemplate(detectTemplate(genProfile, genConvo));
  const rf = await runWingguyChatTurn({
    coach: COACH, profile: genProfile, conversation: genConvo, leadEmail: LEAD_EMAIL,
    profileBlock: `Name: ${genProfile.name}\nHeadline: ${genProfile.headline}\nLocation: ${genProfile.location}\nLinkedIn URL: ${genProfile.profileUrl}`,
    convoBlock: genConvo.map((m) => `${m.sender}: ${m.text}`).join('\n'), campaignTemplate: genTpl, deps,
    messages: [{ role: 'user', content: '(Opened from the LinkedIn conversation above. Read where things stand and give me the best next message to send.)' }],
  });
  show('SCENARIO F — general (\\tks) opener (expect the \\tks sign-off "Talk soon / I know a (Guy)", NOT "(I know a) Guy")', rf);
  const fDraft = (rf.draft || '').trim();
  console.log('\n=== SUMMARY (Sam / \\tks sign-off) ===');
  console.log('Detected template:', genTpl ? genTpl.id : '(none)');
  console.log('Signs off with "Talk soon":', /talk soon/i.test(fDraft) ? 'yes' : 'NO — tks sign-off not applied');
  console.log('Uses "I know a (Guy)" form:', /I know a \(Guy\)/i.test(fDraft) ? 'yes' : 'NO — check the sign-off form');
}

main().then(() => process.exit(0)).catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
