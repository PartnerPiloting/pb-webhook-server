/**
 * Wingguy "set up your own" page — the CLIENT-FACING field list.
 *
 * The rules store keeps variables by key (`owner_first_name`, `call_platform`) with a short
 * catalog description written for whoever is editing rules. That is not what a client should be
 * reading on a setup page, and the store has no title column to put a better name in. This module
 * is that missing layer: for each variable we expose, the question to ask a human, in their words.
 *
 * DELIBERATELY A CURATED LIST, NOT THE WHOLE CATALOG. The catalog also holds plumbing
 * (`tracking_bcc`, `smoke_floor`) that a client must never be handed. Anything not named here is
 * simply not editable from the page — the GET/PUT handlers both filter against this list, so
 * adding a field here is the only way to expose one, and an unknown key from a tampered request
 * is rejected rather than written.
 *
 * ORDER MATTERS: the page renders groups and fields in exactly this order.
 *
 * Every variable named here must actually be referenced by a live rule, or the field is a lie —
 * the client fills it in and nothing changes. Check with `wingguy_rules_list` before adding one.
 */

/**
 * type:
 *   text   — single-line free text
 *   long   — multi-line free text
 *   choice — pick one of `options` (rendered as buttons, and a client may still type their own)
 */
const VARIABLE_FIELDS = [
  // --- Who you are -----------------------------------------------------------------------------
  {
    key: 'owner_first_name',
    group: 'Who you are',
    label: 'Your first name, as it should appear in messages',
    hint: 'Just the name people call you.',
    example: 'Guy',
    type: 'text',
  },
  {
    key: 'signoff',
    group: 'Who you are',
    label: 'How do you sign off a message?',
    hint: 'Exactly as you would write it - this goes out letter for letter.',
    example: 'Cheers, Guy',
    type: 'text',
  },
  {
    key: 'region',
    group: 'Who you are',
    label: 'Where are you based?',
    hint: 'So it can mention where you are when that helps, and never offers someone a time in the middle of their night.',
    example: 'Brisbane, Australia',
    type: 'text',
  },
  {
    key: 'owner_phone',
    group: 'Who you are',
    label: 'Your phone number',
    hint: 'Optional. It goes on calendar invites so people can reach you if something goes wrong.',
    example: '0414 975 509',
    type: 'text',
  },

  // --- What you say you do ---------------------------------------------------------------------
  {
    key: 'core_framing',
    group: 'What you say you do',
    label: 'When someone asks what you do, what is your answer?',
    hint: 'One sentence, the way you would actually say it out loud. "I am still working that out" is a fine answer for now - you can sharpen it later.',
    example: 'I run an advocacy network where independent advisers recommend each other to their clients',
    type: 'long',
  },
  {
    key: 'target_verticals',
    group: 'What you say you do',
    label: 'Who are you hoping to meet?',
    hint: 'The kind of people, not a list of names.',
    example: 'financial planners, brokers and accountants',
    type: 'text',
  },
  {
    key: 'network_explainer_line',
    group: 'What you say you do',
    label: 'If you had one line to explain how it works, what would it be?',
    hint: 'Optional. If you already have a line you use and like, put it here and Wingguy will use yours instead of writing its own.',
    example: 'A simple idea - professionals who refer each other, rather than everyone waving their own flag',
    type: 'long',
  },

  // --- How you talk ----------------------------------------------------------------------------
  {
    key: 'call_platform',
    group: 'How you talk',
    label: 'What do you call a video call?',
    hint: 'This matters more than it looks - the word goes into messages exactly as you pick it.',
    example: 'Zoom',
    type: 'choice',
    options: ['Zoom', 'call', 'Teams call', 'Google Meet', 'chat'],
  },
  {
    // Read by the `never-say-words` instruction via an OPTIONAL placeholder ({{?never_say_words}}),
    // so a client who leaves this blank gets no instruction at all rather than a dangling
    // "Never use these words:" with nothing after it. See stripOptionalPlaceholders.
    key: 'never_say_words',
    group: 'How you talk',
    label: 'Any words or phrases you would never be caught using?',
    hint: 'The ones that make you wince. Separate them with commas. Leave it blank if nothing springs to mind - you will think of some the first time it writes one.',
    example: 'reach out, touch base, circle back, folks, synergy',
    type: 'long',
  },

  // --- Meetings --------------------------------------------------------------------------------
  {
    key: 'default_meeting_length',
    group: 'Meetings',
    label: 'How long is a first meeting?',
    hint: 'What it puts in the calendar invite unless you say otherwise.',
    example: '30 minutes',
    type: 'choice',
    options: ['15 minutes', '30 minutes', '45 minutes', '1 hour'],
  },
  {
    key: 'earliest_meeting_time',
    group: 'Meetings',
    label: 'What is the earliest you would ever take one?',
    hint: 'A hard floor - it will never offer anyone a time before this, and will check with you first if you try to book earlier yourself.',
    example: '9:30am',
    type: 'text',
  },
  {
    key: 'preferred_start_time',
    group: 'Meetings',
    label: 'And what would you rather it offered?',
    hint: 'Optional. The one above is the at-a-pinch floor - this is your normal start. It only drops below this when the week cannot be filled otherwise.',
    example: '10:00am',
    type: 'text',
  },
  {
    key: 'max_meetings_per_day',
    group: 'Meetings',
    label: 'How many meetings in a day is too many?',
    hint: 'A preference, not a cap. It spreads calls across the week rather than stacking one day, and tells you when a day is getting full.',
    example: '4',
    type: 'choice',
    options: ['2', '3', '4', '5', '6'],
  },
  {
    key: 'timezone',
    group: 'Meetings',
    label: 'Your timezone',
    hint: 'Calendar invites go on your clock. Times written to other people go on theirs.',
    example: 'Australia/Brisbane (AEST, UTC+10, no daylight saving)',
    type: 'text',
  },
];

/**
 * Assets (the {{asset:key}} links rules send out) that the page may edit.
 *
 * Same rule as above and it bites harder here: only expose a key some live rule actually
 * references, or the client pastes a link into a box that nothing reads. `zoom_room` is safe —
 * the booking defaults put it on every invite. Everything else stays in chat for now, where
 * adding a link and wiring a rule to use it happen together.
 */
const ASSET_FIELDS = [
  {
    key: 'zoom_room',
    group: 'Meetings',
    label: 'Your meeting room link',
    hint: 'Your standing Zoom or Teams room. It goes on every invite, so it never has to create a new one.',
    example: 'https://us04web.zoom.us/j/9892817976',
    kind: 'url',
    type: 'text',
  },
];

const VARIABLE_KEYS = new Set(VARIABLE_FIELDS.map((f) => f.key));
const ASSET_KEYS = new Set(ASSET_FIELDS.map((f) => f.key));

/** Group order for the page, derived from the field order so there is one source of truth. */
function groupOrder() {
  const seen = [];
  [...VARIABLE_FIELDS, ...ASSET_FIELDS].forEach((f) => {
    if (!seen.includes(f.group)) seen.push(f.group);
  });
  return seen;
}

module.exports = {
  VARIABLE_FIELDS,
  ASSET_FIELDS,
  VARIABLE_KEYS,
  ASSET_KEYS,
  groupOrder,
};
