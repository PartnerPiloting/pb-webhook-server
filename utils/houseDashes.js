// utils/houseDashes.js
// ONE definition of Guy's house dash rule: reader-facing text uses a spaced hyphen " - ",
// never an em (U+2014) or en (U+2013) dash. An em dash is the single loudest AI tell in
// Australian business writing - nobody here types one, so the moment one appears the reader
// decides a machine wrote it, and everything around it is read that way too.
//
// WHY THIS IS CODE AND NOT AN INSTRUCTION (2026-09-16, after ~10 attempts):
// The rule has been written in prose everywhere it could be written - the Postgres rules store,
// the voice/writing-style docs, CLAUDE.md, the drafting prompts - and it still lost to the model's
// generation default, over and over, in real sends (Phil Purcell, Steven Gabris, James
// Bennett-Ackland) and in the /wg panel. Two services had already grown their own private copy of
// this function for exactly that reason; the panel that writes LinkedIn messages had neither, which
// is why Guy was still watching em dashes appear in drafts on his screen.
// Same lesson as sign-offs, dates, time lists and the stage-1 opener: a must-never-happen is a code
// check, not a request. An instruction depends on the author's attention every single time; a
// chokepoint depends on nothing.
//
// SCOPE: only em and en dashes and their HTML entity forms. The ordinary hyphen-minus (U+002D) that
// real compounds and URLs use ("old-style", "3-min", "pb-webhook-server") is untouched, so nothing
// that needs a hyphen is affected.

/** Replace em/en dashes (literal or HTML entity) with Guy's spaced hyphen. */
function houseDashes(s) {
  if (!s) return s;
  return String(s)
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '—')   // entity forms -> literal em
    .replace(/&ndash;|&#8211;|&#x2013;/gi, '–')   // entity forms -> literal en
    .replace(/\s*[–—]\s*/g, ' - ');          // dash (plus any surrounding space) -> " - "
}

/**
 * Sweep every string inside an arbitrary value (object / array / string). Returns the SAME value
 * when nothing needed changing - the overwhelmingly common case - so the sweep costs one scan and
 * no allocation. Mirrors withoutLoneSurrogates in config/anthropicClient.js.
 */
function withHouseDashes(value) {
  if (typeof value === 'string') {
    const cleaned = houseDashes(value);
    return cleaned === value ? value : cleaned;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => { const c = withHouseDashes(v); if (c !== v) changed = true; return c; });
    return changed ? out : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = withHouseDashes(v);
      if (c !== v) changed = true;
      out[k] = c;
    }
    return changed ? out : value;
  }
  return value;
}

/** True if the text still carries an em/en dash - the check the tests assert on. */
function hasLongDash(s) {
  return /[–—]|&mdash;|&ndash;|&#8212;|&#8211;|&#x201[34];/i.test(String(s || ''));
}

module.exports = { houseDashes, withHouseDashes, hasLongDash };
