// config/onePagerSeriesManifest.js
//
// The SEND ORDER for each audience. This is NOT the frontmatter `order` (that's
// the arc position). Source of truth = content/one-pagers/PROSPECT-SERIES-PLAN.md
// (prospect run = 18, client run = 22). The drip walks these arrays: a person
// with "Series Sent Count" = N is due list[N] next (0-indexed); when N reaches
// the array length, their run is complete.

// Note: email #1 for prospects is a standalone intro (see onePagerEmail.js), so
// this list is emails #2..#19. Feast-or-famine LEADS (recognisable pain is the
// safer cold open than the introspective "revisit your big picture", which is
// moved down to sit just before the patience curve - see 2026-07-09 reorder).
const prospect = [
  'feast-or-famine',             // pain - the see-saw (the lead)
  'introduction-before-we-spoke',// proof - Daniel/Keith
  'pleasing-methods',            // failed default - BNI/breakfast
  'choose-the-room',             // better way - select your network
  'twenty-second-thank-you',     // better way - the thank-you
  'never-send-calendly',         // better way - considered times
  'reason-to-follow-up',         // better way - motion not goodwill
  'first-discovery-call',        // better way - the call is to learn
  'connection-isnt-charm',       // craft - noticing not charm
  'revisit-your-big-picture',    // re-lift - the big picture (prospect ending hands into patience)
  'patience-curve',              // feasibility (time)
  'why-not-buy-a-network',       // objection - buy it
  'four-hours-not-forty',        // feasibility (effort)
  'you-could-build-this',        // objection - build it
  'builders-not-blobs',          // vision setup
  'nodes',                       // vision - the crescendo
  'i-know-a-guy-principle',      // ethos
  'imagine-if',                  // finale (prospect-only)
];

// Clients also get a standalone email #1 first - the orientation, "What you've
// actually joined" (onePagerEmail.js, 2026-09-28) - so this list is emails
// #2..#24. The numbered labels below are the ORIGINAL positions (pre 2026-10-20);
// the opening run was moved to the front that day, so labels no longer match the
// list position. The order of the array is the truth., and the map goes out in short
// form: one line per step, each linked to its piece.
const client = [
  'begin-with-the-end-in-mind',  // OPENING RUN (Guy 2026-10-20): discovery calls first
  'first-discovery-call',        // opening run - What can you discover? (client ending hands on to charm)
  'connection-isnt-charm',       // opening run - DRAFT, Guy must approve before it is ever sent
  'discovery-call-craft',        // opening run - What to say (ends 'what you do in the gap after... next')
  'reason-to-follow-up',         // opening run - the gap after the call
  // [the energy piece slots in after begin-with-the-end once written]. These five keep their
  // original relative order on purpose: their client endings say 'that's next' to each other.
  // The map (the-process) follows them; its email opener now says 'You've got the calls going'.
  'the-process',                 // 1  the map (short form in email)
  'revisit-your-big-picture',    // 2  why you're here
  'feast-or-famine',             // 3  core paradigm
  'choose-the-room',             // 4  step 1
  'who-do-i-reach-out-to',       // 5  step 2 (craft)
  'introduction-before-we-spoke',// 6  proof - breather
  'score-on-attitude',           // 7  step 3 (craft)
  'twenty-second-thank-you',     // 8  step 4
  'patience-curve',              // 9  expectations
  'never-send-calendly',         // 10 step 5
  'every-link-is-homework',      // 15 step 7 (craft) - the right link at the right moment
  'four-hours-not-forty',        // 16 feasibility (client ending: a this-week action, no build-it tease)
  'builders-not-blobs',          // 17 vision setup
  'nodes',                       // 18 step 8
  'i-know-a-guy-principle',      // 19 step 9
  'ten-thousand-people',         // 20 the inner circle + wider network
  'introductions-that-land',     // 21 step 9 (craft) - writing an introduction
  'increase-your-intelligence',  // 22 step 10 (Wingguy)
];
// 2026-09-25 (Guy): pleasing-methods and you-could-build-this CUT from the
// client run - both argue a prospect out of an option a client has already
// ruled out. They stay in the prospect run and the library.

module.exports = { prospect, client };
