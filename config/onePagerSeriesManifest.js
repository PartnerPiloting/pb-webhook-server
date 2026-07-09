// config/onePagerSeriesManifest.js
//
// The SEND ORDER for each audience. This is NOT the frontmatter `order` (that's
// the arc position). Source of truth = content/one-pagers/PROSPECT-SERIES-PLAN.md
// (prospect run = 18, client run = 21). The drip walks these arrays: a person
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

const client = [
  'the-process',                 // 1  the map - orientation
  'revisit-your-big-picture',    // 2  why you're here
  'feast-or-famine',             // 3  core paradigm
  'choose-the-room',             // 4  step 1
  'who-do-i-reach-out-to',       // 5  step 2 (craft)
  'introduction-before-we-spoke',// 6  proof - breather
  'score-on-attitude',           // 7  step 3 (craft)
  'twenty-second-thank-you',     // 8  step 4
  'patience-curve',              // 9  expectations
  'never-send-calendly',         // 10 step 5
  'first-discovery-call',        // 11 step 6
  'connection-isnt-charm',       // 12 how to open the call (craft)
  'discovery-call-craft',        // 13 step 6 (craft)
  'reason-to-follow-up',         // 14 step 7
  'pleasing-methods',            // 15 reinforcement
  'four-hours-not-forty',        // 16 feasibility
  'you-could-build-this',        // 17 objection
  'builders-not-blobs',          // 18 vision setup
  'nodes',                       // 19 step 8
  'i-know-a-guy-principle',      // 20 step 9
  'increase-your-intelligence',  // 21 step 10 (Wingguy)
];

module.exports = { prospect, client };
