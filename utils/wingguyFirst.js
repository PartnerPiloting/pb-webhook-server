/**
 * "Wingguy first" - the texts that go into a client's Claude on onboarding day so it asks Wingguy
 * before answering from its own memory. The one copy is content/wingguy-first.json; this module
 * reads and validates it. Everything that shows the texts to a person (the run-sheet page, the
 * onboarding docs) draws from here or is checked against it by tests/wingguy-first.test.js.
 *
 * Why it is a file and not a paragraph in a doc: on 19 Sep 2026 the machine doctrine was found
 * living, out of date, in a Claude memory page nobody had looked at for a month. The whole point
 * of this text is that memory holds pointers, never content - and the same goes for the text
 * itself. One copy, minted where it is needed, tested against every doc that repeats it.
 */

const fs = require('fs');
const path = require('path');

const TEXTS_PATH = path.join(__dirname, '..', 'content', 'wingguy-first.json');

let cache = null;

/** The validated texts: { preferences, preferences_short, memory_pointer, opener, canary:{phrase, first_line, bad_first_line}, where }. */
function load() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(TEXTS_PATH, 'utf8'));
  for (const k of ['preferences', 'preferences_short', 'memory_pointer', 'opener']) {
    if (typeof raw[k] !== 'string' || !raw[k].trim()) throw new Error(`wingguy-first.json: ${k} must be a non-empty string`);
  }
  if (!raw.canary || typeof raw.canary.phrase !== 'string' || typeof raw.canary.first_line !== 'string') {
    throw new Error('wingguy-first.json: canary needs phrase and first_line');
  }
  cache = raw;
  return cache;
}

/**
 * The rows the run-sheet page shows on the "Wingguy first" step, in the order they are done:
 * [{ label, text, key }]. Each renders as a box with a Copy button, like the connector link.
 */
function runSheetRows(texts = load()) {
  return [
    { key: 'preferences', label: 'Paste this at the END of the preferences box (Settings, then Customize) - never replace what is there', text: texts.preferences },
    { key: 'preferences_short', label: 'If the box is full, the short form instead', text: texts.preferences_short },
    { key: 'memory_pointer', label: 'Type this in the chat, word for word', text: texts.memory_pointer },
    { key: 'canary', label: `Then open a NEW chat and type this - the first line of the reply must read "${texts.canary.first_line}"`, text: texts.canary.phrase },
  ];
}

module.exports = { load, runSheetRows, TEXTS_PATH };
