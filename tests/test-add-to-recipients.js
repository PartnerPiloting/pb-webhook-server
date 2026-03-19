#!/usr/bin/env node
/**
 * Test parseAddToRecipients - Add to parsing for meeting notes
 * Run: node tests/test-add-to-recipients.js
 */

const { parseAddToRecipients } = require('../utils/addToRecipientsParser');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected: ${expectedStr}`);
    console.error(`   Got:      ${actualStr}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

console.log('\n=== Add to Recipients Parser Test ===\n');

// 1. "add: Clarence Ling" at top (user's exact format)
const body1 = `add: Clarence Ling

---------- Forwarded message ---------
From: no-reply@fathom.video
Subject: Recap for "Impromptu Zoom Meeting"

Fathom recap content here.`;
const result1 = parseAddToRecipients(body1, '');
assert(result1.length === 1, 'add: Clarence Ling at top - finds 1 recipient');
assert(result1[0].name === 'Clarence Ling', 'add: Clarence Ling - extracts name');

// 2. "add: Clarence Ling" INSIDE forwarded content (e.g. in Ask Fathom widget)
const body2 = `---------- Forwarded message ---------
From: no-reply@fathom.video
Subject: Recap for "Impromptu Zoom Meeting"

Impromptu Zoom Meeting
March 18, 2026 • 91 mins

Action Items:
- Download LinkedHelper
- Build Sales Navigator searches

Ask Fathom! [chat mockup]
add: Clarence Ling
Ask about this meeting...`;
const result2 = parseAddToRecipients(body2, '');
assert(result2.length === 1, 'add: Clarence Ling inside forwarded content - finds 1 recipient');
assert(result2[0].name === 'Clarence Ling', 'add: inside content - extracts name');

// 3. "Add to Warwick Malloy" at top
const body3 = `Add to Warwick Malloy

---------- Forwarded message ---------
From: Fathom`;
const result3 = parseAddToRecipients(body3, '');
assert(result3.length === 1 && result3[0].name === 'Warwick Malloy', 'Add to Warwick Malloy - works');

// 4. Multiple: "Add to Warwick Malloy and Eliza Gilbertson"
const body4 = `Add to Warwick Malloy and Eliza Gilbertson

---------- Forwarded message ---------`;
const result4 = parseAddToRecipients(body4, '');
assert(result4.length === 2, 'Add to X and Y - finds 2 recipients');
assert(result4.some(r => r.name === 'Warwick Malloy') && result4.some(r => r.name === 'Eliza Gilbertson'), 'Both names extracted');

// 5. "Add to: james@x.com, olivier@y.com" (emails)
const body5 = `Add to: james@x.com, olivier@y.com

---------- Forwarded message ---------`;
const result5 = parseAddToRecipients(body5, '');
assert(result5.length === 2, 'Add to emails - finds 2');
assert(result5[0].email === 'james@x.com' && result5[1].email === 'olivier@y.com', 'Emails extracted');

// 6. Skip false positives
const body6 = `Add to the meeting notes

---------- Forwarded message ---------`;
const result6 = parseAddToRecipients(body6, '');
assert(result6.length === 0, 'Add to the meeting - skipped (false positive)');

// 7. Subject fallback: [add to: guy@test.com]
const body7 = `---------- Forwarded message ---------
No add to in body`;
const result7 = parseAddToRecipients(body7, 'Fwd: Recap [add to: guy@test.com]');
assert(result7.length === 1 && result7[0].email === 'guy@test.com', 'Subject fallback works');

// 8. "Add to Clarence Ling" (no colon - original format)
const body8 = `Add to Clarence Ling

---------- Forwarded message ---------`;
const result8 = parseAddToRecipients(body8, '');
assert(result8.length === 1 && result8[0].name === 'Clarence Ling', 'Add to Clarence Ling (no colon) works');

console.log('\n✅ All tests passed!\n');
