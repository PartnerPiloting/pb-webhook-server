/**
 * Wingguy "set up your own" page — the CLIENT-FACING field list.
 *
 * The rules store keeps variables by key (`owner_first_name`, `call_platform`) with a short
 * catalog description written for whoever is editing rules. That is not what a client should be
 * reading on a setup page, and the store has no title column to put a better name in. This module
 * is that missing layer: for each variable we expose, the question to ask a human, in their words.
 *
 * DELIBERATELY A CURATED LIST, NOT THE WHOLE CATALOG. The catalog also holds plumbing
 * (`tracking_bcc`, `smoke_floor`) that a client must never be handed — those are filled from the
 * client's own record instead (see ensureCoachManagedVariables). Anything not named here is simply
 * not editable from the page: the GET/PUT handlers both filter against this list, so adding a field
 * here is the only way to expose one, and an unknown key from a tampered request is rejected.
 *
 * TIERS (Guy's call 2026-08-06) — the page is split in two, and the split is EARNED, not cosmetic:
 *   'essential' — leaving it blank leaves something visibly wrong, and only they can supply it.
 *   'glance'    — a real fallback exists (config/wingguyVariableDefaults.js) or the reference is
 *                 optional, so blank is genuinely safe. The page says so, and points them at
 *                 changing these later in chat once they have seen a draft worth improving.
 * Before moving a field to 'glance', make sure blank really is safe — tests/wingguy-setup-fields
 * pins that every glance field either has a default or is referenced optionally.
 *
 * ORDER MATTERS: the page renders tiers, then groups, then fields in exactly this order.
 *
 * Every variable named here must actually be read by a live instruction, or the field is a lie —
 * the client fills it in and nothing changes.
 */

/**
 * type:
 *   text   — single-line free text
 *   long   — multi-line free text
 *   choice — pick one of `options` (rendered as buttons, and a client may still type their own)
 */
const VARIABLE_FIELDS = [
  // === ESSENTIAL =================================================================================
  {
    key: 'owner_first_name',
    tier: 'essential',
    group: 'The essentials',
    label: 'Your first name, as it should appear in messages',
    hint: 'Just the name people call you.',
    example: 'Guy',
    type: 'text',
  },
  {
    key: 'signoff',
    tier: 'essential',
    group: 'The essentials',
    label: 'How do you sign off a message?',
    hint: 'Exactly as you would write it - this goes out letter for letter. Leave it and it just uses your first name.',
    example: 'Cheers, Guy',
    type: 'text',
  },
  {
    key: 'timezone',
    tier: 'essential',
    group: 'The essentials',
    label: 'Where are you, time-wise?',
    hint: 'Calendar invites go on your clock, and times written to other people go on theirs. This is the one setting nobody can guess for you.',
    example: 'Brisbane (AEST, no daylight saving)',
    type: 'text',
  },
  {
    key: 'core_framing',
    tier: 'essential',
    group: 'The essentials',
    label: 'When someone asks what you do, what is your answer?',
    hint: 'One sentence, the way you would actually say it out loud. "I am still working that out" is a fine answer for now - you can sharpen it later.',
    example: 'I run an advocacy network where independent advisers recommend each other to their clients',
    type: 'long',
  },

  // === GLANCE: how you talk ======================================================================
  {
    key: 'call_platform',
    tier: 'glance',
    group: 'How you talk',
    label: 'What do you call a video call?',
    hint: 'The word goes into messages exactly as you pick it. Left alone, it just says "call".',
    example: 'Zoom',
    type: 'choice',
    options: ['Zoom', 'call', 'Teams call', 'Google Meet', 'chat'],
  },
  {
    key: 'never_say_words',
    tier: 'glance',
    group: 'How you talk',
    label: 'Any words or phrases you would never be caught using?',
    hint: 'The ones that make you wince. Separate them with commas. Most people leave this blank at first and fill it in the day Wingguy writes one.',
    example: 'reach out, touch base, circle back, folks, synergy',
    type: 'long',
  },

  // === GLANCE: who you are for ===================================================================
  {
    key: 'target_verticals',
    tier: 'glance',
    group: 'Who you are for',
    label: 'Who are you hoping to meet?',
    hint: 'The kind of people, not a list of names. It helps Wingguy read a profile and spot whether someone fits.',
    example: 'financial planners, brokers and accountants',
    type: 'text',
  },
  {
    // The answerable half of the targeting scaffold. The full stack (markets, hooks, what not to
    // say per audience) stays a conversation - it needs experience a new client has not had yet.
    key: 'ideal_fit_traits',
    tier: 'glance',
    group: 'Who you are for',
    label: 'What makes someone a genuinely good fit?',
    hint: 'Two or three things that matter more than their job title - the traits you notice when someone is right for this. Wingguy weighs a profile against these before it drafts anything.',
    example: 'they already get most of their work through referrals · they think in introductions rather than transactions · senior enough to make their own decisions',
    type: 'long',
  },
  {
    key: 'region',
    tier: 'glance',
    group: 'Who you are for',
    label: 'Where are you based?',
    hint: 'Optional. Mentioned when it genuinely helps - a shared city is a real reason to talk.',
    example: 'Brisbane, Australia',
    type: 'text',
  },

  // === GLANCE: meetings ==========================================================================
  {
    key: 'default_meeting_length',
    tier: 'glance',
    group: 'Meetings',
    label: 'How long is a first meeting?',
    hint: 'Left alone: 30 minutes.',
    example: '30 minutes',
    type: 'choice',
    options: ['15 minutes', '30 minutes', '45 minutes', '1 hour'],
  },
  {
    key: 'earliest_meeting_time',
    tier: 'glance',
    group: 'Meetings',
    label: 'What is the earliest you would ever take one?',
    hint: 'A hard floor - it will never offer anyone a time before this. Left alone: 9:00am.',
    example: '9:30am',
    type: 'text',
  },
  {
    key: 'preferred_start_time',
    tier: 'glance',
    group: 'Meetings',
    label: 'And what would you rather it offered?',
    hint: 'The one above is the at-a-pinch floor - this is your normal start. Left alone: 9:00am.',
    example: '10:00am',
    type: 'text',
  },
  {
    key: 'max_meetings_per_day',
    tier: 'glance',
    group: 'Meetings',
    label: 'How many meetings in a day is too many?',
    hint: 'A preference, not a cap. It spreads calls across the week rather than stacking one day. Left alone: 4.',
    example: '4',
    type: 'choice',
    options: ['2', '3', '4', '5', '6'],
  },
  {
    key: 'owner_phone',
    tier: 'glance',
    group: 'Meetings',
    label: 'Your phone number',
    hint: 'Optional. It goes on calendar invites so people can reach you if something goes wrong. Blank just leaves it off.',
    example: '0414 975 509',
    type: 'text',
  },

  // === GLANCE: your material =====================================================================
  {
    // A plain list beats the asset library on day one: the library needs a usage rule per link
    // (when it earns its place, who it is for, who must never get it), and that pairing is a
    // conversation. This is just "the links you already send", stored verbatim so a draft can
    // copy one rather than inventing a URL.
    key: 'your_links',
    tier: 'glance',
    group: 'Your material',
    label: 'Anything else you send people',
    hint: 'One per line, as "what it is - the link". Articles you wrote, a deck, a video. Wingguy only ever uses them where a link genuinely belongs, and never makes a URL up.',
    example: 'Why networking delivers so little - https://linkedin.com/pulse/...',
    type: 'long',
    cap: 1200,
  },
];

/**
 * Assets (the {{asset:key}} links rules send out) that the page may edit.
 *
 * Same rule as above and it bites harder here: only expose a key some live rule actually
 * references, or the client pastes a link into a box that nothing reads. `zoom_room` is safe —
 * the booking defaults put it on every invite, and there is no sensible default for it, so it is
 * essential. Everything else stays in chat, where adding a link and wiring a rule to use it
 * happen together.
 */
const ASSET_FIELDS = [
  {
    key: 'zoom_room',
    tier: 'essential',
    group: 'The essentials',
    label: 'Your meeting room link',
    hint: 'Your standing Zoom or Teams room. It goes on every invite, so it never has to create a new one.',
    example: 'https://us04web.zoom.us/j/9892817976',
    kind: 'url',
    type: 'text',
  },
  {
    // THE most reused link a coach has - the "here's what I do" piece Wingguy falls back to
    // whenever a draft warrants a link and no specific rule names one. Fixed key so the page can
    // ask for it in plain words instead of making a client invent an asset name.
    key: 'default_explainer',
    tier: 'glance',
    group: 'Your material',
    label: 'The one link you would send someone who asked what you do',
    hint: 'A landing page, a one-pager, a short video - whatever you would actually send. Wingguy reaches for this whenever a message wants a link and nothing more specific applies. No link yet? Leave it - it just writes the explanation from scratch each time instead.',
    example: 'https://knowaguy.com.au',
    kind: 'page',
    type: 'text',
  },
  {
    // Calendar invites put this next to your name so the guest can see who they are meeting.
    // Only they know their own URL, but a blank one just leaves the line off the invite.
    key: 'owner_linkedin_profile',
    tier: 'glance',
    group: 'Meetings',
    label: 'Your LinkedIn profile link',
    hint: 'Optional. It goes on calendar invites beside your name, so whoever you are meeting can see who you are. Blank just leaves it off.',
    example: 'https://www.linkedin.com/in/your-name',
    kind: 'url',
    type: 'text',
  },
];

/**
 * VOICE fields — the "In your own words" section. Still plain variables underneath (setVariable,
 * history-logged, referenced by shared method rules via {{?...}} so blank = the generalised
 * wording quietly applies). What makes them a separate list:
 *   - `bullets`: the shape of the thing, shown above the box in the client's language
 *   - `exampleKind`: which live-example prompt the [Show me what Wingguy would write] button runs
 *     (examples are GENERATED from their answers, never printed samples — a printed sample
 *     becomes everyone's message)
 *   - `cap`: these legitimately run longer than a sign-off
 * Slots that exist but are deliberately NOT here: own_anchor_lines (a new client has no lines
 * that land yet — it fills via the edit loop and chat, per Guy's call 2026-08-05).
 */
const VOICE_FIELDS = [
  {
    key: 'canonical_inversion_line',
    tier: 'voice',
    group: 'In your own words',
    label: 'The question at the heart of all of it',
    hint: "There's one question this whole approach turns on: asking someone who THEY know who'd love to have trusted people recommending them - rather than having to recommend themselves. You'll ask it on calls, and Wingguy weaves the same idea into what it writes. How would you phrase it?",
    example: 'people recommending us rather than being the only ones having to recommend ourselves',
    type: 'long',
    cap: 400,
    exampleKind: 'inversion',
  },
  {
    key: 'post_connection_own_message',
    tier: 'voice',
    group: 'In your own words',
    label: 'The thanks-for-connecting message',
    hint: 'The first message someone gets after accepting your connection - the one that decides whether a conversation starts. Wingguy writes it fresh for each person. Happy with how that sounds? Leave this empty - that is a fine answer. Or if you already have a version you love, put it here and Wingguy will treat yours as the reference.',
    bullets: [
      'something true it noticed on their profile',
      "one line hinting at what you're building - a seed, not a pitch",
      'a question to close',
    ],
    type: 'long',
    cap: 1200,
    exampleKind: 'post_connection',
  },
  {
    key: 'advocacy_own_argument',
    tier: 'voice',
    group: 'In your own words',
    label: 'The case for advocacy - in your words',
    hint: 'At some point in a good conversation, you make the case for building advocates rather than collecting contacts. Leave this empty and Wingguy argues it fresh each time - or make the case the way you would actually say it across a table, and yours becomes the version it works from.',
    bullets: [
      'start from what they already know - their best opportunities came through people who vouched for them',
      'name the gap - most networking builds contacts, not advocates',
      'draw the line between the two - a contact knows you, an advocate recommends you unprompted',
      "take the blame off them - it's not effort, it's that normal networking isn't designed for this",
      "why now - the more AI makes everyone's output look polished, the more a trusted recommendation is worth",
      'why it takes a system - advocates are built deliberately, not by accident',
    ],
    type: 'long',
    cap: 2500,
    exampleKind: 'advocacy',
  },
  {
    key: 'advocacy_one_liner',
    tier: 'voice',
    group: 'In your own words',
    label: 'And if you had to make the whole case in one sentence, what would it be?',
    hint: 'Optional. Used sparingly, with space left after it.',
    type: 'long',
    cap: 300,
  },
];

const VARIABLE_KEYS = new Set([...VARIABLE_FIELDS, ...VOICE_FIELDS].map((f) => f.key));
const ASSET_KEYS = new Set(ASSET_FIELDS.map((f) => f.key));

/** Per-field save cap: voice pieces run long; everything else stays at the original 600. */
function capFor(scope, key) {
  if (scope === 'variable') {
    const v = [...VOICE_FIELDS, ...VARIABLE_FIELDS].find((f) => f.key === key && f.cap);
    if (v) return v.cap;
  }
  return 600;
}

/** Group order per tier, derived from field order so there is one source of truth. */
function groupOrder(tier) {
  const seen = [];
  [...VARIABLE_FIELDS, ...ASSET_FIELDS, ...VOICE_FIELDS]
    .filter((f) => !tier || f.tier === tier)
    .forEach((f) => { if (!seen.includes(f.group)) seen.push(f.group); });
  return seen;
}

module.exports = {
  VARIABLE_FIELDS,
  ASSET_FIELDS,
  VOICE_FIELDS,
  VARIABLE_KEYS,
  ASSET_KEYS,
  capFor,
  groupOrder,
};
