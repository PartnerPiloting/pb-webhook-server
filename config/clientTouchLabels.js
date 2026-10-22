// config/clientTouchLabels.js
//
// The labels the weekly client touch planner (docs/CLIENT-TOUCH-PLANNER.md)
// picks by. Each one-pager carries its own labels in its frontmatter
// (content/one-pagers/*.md - read them through onePagerContent.listPieces):
//
//   kind:     way-of-thinking | mindset | how | habit | tune-up | event
//   stops:    journey stop keys from content/client-journey.json, or "any"
//   problems: keys from PROBLEMS below
//   resend:   yes | no - can it go out again later in short form
//   event:    what sets it off early, or "none"
//   teases:   yes | no - the client ending promises "that's next"
//
// This file holds what has no frontmatter: the problem list itself, and the
// labels for the orientation email, which lives in services/onePagerEmail.js.
// Reviewed by Guy 2026-10-22 (labels only - no ending wording changed).

// The misconceptions a piece can answer, in the client's own words. A starting
// list from real calls; add to it as calls show new ones (the planner's "a call
// problem" rule tags a call with one of these keys).
const PROBLEMS = {
  'pitch': "The first call is a pitch I can fail",
  'no-time': "Networking is for when the work's quiet",
  'too-slow': "Three months in and nothing to show - it doesn't work",
  'buyers': "I should be reaching out to people who'd buy from me",
  'small-talk': "I'm not a people person / hopeless at small talk",
  'fizzle': "Great conversation, then nothing came of it",
  'earn-it': "Introductions are something you earn over years",
  'solo': "My network is just the people I happen to know",
};

const KINDS = ['way-of-thinking', 'mindset', 'how', 'habit', 'tune-up', 'event'];

// The things that can happen to a client and set an email off early ("Emails set off by
// something that happened" in the design doc). The planner's facts name them by KEY; a piece's
// `event:` frontmatter is free text, so each key carries the words that identify it there.
// A piece can answer several events.
const EVENTS = {
  'today-first-records':      { label: "The client's Today tab first has records", test: /today tab first fills/i },
  'campaign-running-low':     { label: 'Their campaign is running low on people', test: /campaign run(s|ning) (low|out)/i },
  'acceptances-slow':         { label: 'Acceptances are slow', test: /acceptances slow/i },
  'before-campaign':          { label: 'Their campaign is about to start', test: /before the campaign starts/i },
  'first-call-booked':        { label: 'Their first discovery call is booked', test: /first discovery call booked/i },
  'first-call-happened':      { label: 'Their first discovery call has happened', test: /after the first discovery call/i },
  'first-yes':                { label: 'A lead said yes for the first time', test: /first lead says yes/i },
  'first-intro-made':         { label: 'They made their first introduction', test: /first introduction made/i },
  'first-intro-received':     { label: 'They received their first introduction from the circle', test: /first introduction received/i },
  'followups-first':          { label: 'Their follow-up list first has people', test: /follow-up list first has people/i },
  'first-acceptances-scored': { label: 'Their first acceptances have been scored', test: /first acceptances scored/i },
  'busy':                     { label: 'A busy stretch - no logins, campaign still running', test: /busy stretch/i },
  'drifting':                 { label: 'Drifting - quiet for weeks while still paying', test: /client drifting/i },
  'not-working':              { label: "Week 8-12, or an 'it's not working' reply", test: /it's not working|week 8-12/i },
  'setup-step-done':          { label: 'The previous setup step is done', test: /previous setup step/i },
};

/** Which event keys a piece's free-text `event:` label answers. */
function eventKeysFor(eventText) {
  const text = String(eventText || '');
  if (!text) return [];
  return Object.keys(EVENTS).filter((k) => EVENTS[k].test.test(text));
}

// Email #1 of the client run - "What you've actually joined" - is built in
// onePagerEmail.js, not from a markdown piece, so its labels live here.
const ORIENTATION = {
  slug: '(orientation)',
  kind: 'way-of-thinking',
  stops: ['any'],
  problems: ['solo'],
  resend: false,
  event: 'opening run starts (first invitations out)',
  teases: true,
};

// Parse a comma-separated frontmatter value into a list of keys.
function splitList(val) {
  return String(val || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Normalise one piece's frontmatter labels into the shape the planner reads.
function labelsFrom(meta) {
  const yes = v => /^(yes|true)$/i.test(String(v || '').trim());
  return {
    kind: meta.kind || '',
    stops: splitList(meta.stops),
    problems: splitList(meta.problems),
    resend: yes(meta.resend),
    event: meta.event && meta.event !== 'none' ? meta.event : null,
    teases: yes(meta.teases),
  };
}

module.exports = { PROBLEMS, KINDS, EVENTS, ORIENTATION, labelsFrom, splitList, eventKeysFor };
