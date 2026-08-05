/**
 * Fallback values for {{variables}} a client has not filled in.
 *
 * WHY: an unset required variable renders as literal `{{earliest_meeting_time}}` inside the
 * instruction the model reads. That is the right signal for something only the client can tell us
 * (their name, their timezone) - but it is wrong for a setting that has an obvious sensible answer,
 * and it made the setup page's promise ("anything you skip keeps its sensible default") false.
 *
 * A key listed here has a real default, so blank is genuinely safe and the page can honestly say
 * "glance through these - they are already set sensibly". A key NOT listed here has no safe answer,
 * so it still renders loudly when unset and belongs in the page's essentials.
 *
 * `alias` borrows another variable's value (sign-off falls back to their first name, which is what
 * most people sign off with anyway). Resolution is one hop only - an alias never chains.
 *
 * DELIBERATELY ABSENT (no safe default - must be answered):
 *   owner_first_name  - nobody can guess it
 *   timezone          - guessing this books people at 3am
 *   core_framing      - already an optional slot; blank means Wingguy writes it fresh
 */

const VARIABLE_DEFAULTS = {
  // How they refer to a video call. "call" is the safe generic - it reads correctly everywhere
  // ("worth a quick call?", "the call link"), unlike a brand name they may not use.
  call_platform: { value: 'call' },

  // Booking shape. These mirror the wording booking-defaults expects, so the sentence still reads
  // naturally with the fallback substituted in.
  default_meeting_length: { value: '30 minutes' },
  earliest_meeting_time: { value: '9:00am' },
  preferred_start_time: { value: '9:00am' },
  max_meetings_per_day: { value: '4' },

  // Sign-off: most people sign with their first name, so borrow it rather than inventing one.
  signoff: { alias: 'owner_first_name' },
};

/**
 * Resolve a variable's effective value: what the tenant set, else its default.
 * @returns {string|undefined} undefined when there is no value and no safe default.
 */
function defaultFor(key, variables = {}) {
  const spec = VARIABLE_DEFAULTS[key];
  if (!spec) return undefined;
  if (spec.alias) {
    const borrowed = variables[spec.alias];
    return borrowed != null && String(borrowed).trim().length ? String(borrowed) : undefined;
  }
  return spec.value;
}

/** Keys that have a safe default - the page's "glance through these" set. */
const DEFAULTED_KEYS = new Set(Object.keys(VARIABLE_DEFAULTS));

module.exports = { VARIABLE_DEFAULTS, defaultFor, DEFAULTED_KEYS };
