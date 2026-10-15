/**
 * A multi-line sign-off keeps its line breaks in a draft (David Gould, 15 Oct 2026: his
 * "Warm regards / David / Chinese saying" came out squashed onto one line).
 *
 * Run: node tests/signoff-layout.test.js
 */
const assert = require('assert');
const { restoreSignoffLayout } = require('../services/wingguyChat');
const fields = require('../config/wingguySetupFields');

const signoff = 'Warm regards\nDavid\n\nChinese saying: "We are like a big fish (tossed) from rapids... something else must be tried".';

// The flattened sign-off is put back exactly, and the rest of the draft is untouched.
const flat = 'Hi Muhunthan,\n\nNo pressure at all.\n\nWarm regards  David   Chinese saying: "We are like a big fish (tossed) from rapids... something else must be tried".';
const fixed = restoreSignoffLayout(flat, signoff);
assert.ok(fixed.startsWith('Hi Muhunthan,\n\nNo pressure at all.\n\n'), 'body kept');
assert.ok(fixed.endsWith(signoff), 'sign-off restored with its line breaks');

// Already right -> unchanged.
const good = `Hi M,\n\nBody.\n\n${signoff}`;
assert.strictEqual(restoreSignoffLayout(good, signoff), good);

// A single-line sign-off is never touched.
assert.strictEqual(restoreSignoffLayout('Hi\n\nCheers,  Guy', 'Cheers, Guy'), 'Hi\n\nCheers,  Guy');

// A draft without the sign-off, or no draft at all, is left alone.
assert.strictEqual(restoreSignoffLayout('Hi\n\nThanks', signoff), 'Hi\n\nThanks');
assert.strictEqual(restoreSignoffLayout(null, signoff), null);

// A "$&" in a sign-off is written literally, not read as a replacement pattern.
const dollars = 'Best\nJane $& Co';
assert.ok(restoreSignoffLayout('Hi\n\nBest Jane $& Co', dollars).endsWith(dollars));

// The setup page offers a multi-line box for the sign-off.
const field = fields.VARIABLE_FIELDS.find((f) => f.key === 'signoff');
assert.strictEqual(field.type, 'long');

console.log('signoff-layout: all passed');
