#!/usr/bin/env node
/**
 * Test harness for notes display formatting utilities.
 * Run: node scripts/test-email-formatting.js
 * No env vars required.
 */

const {
  collapseImagePlaceholders,
  collapseEmailHeaders,
  stripFooter,
  splitIntoSentences,
  splitQuotedSections,
  processForDisplay
} = require('../utils/notesDisplayUtils');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

function assertContains(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected to find "${needle}" in output`);
    console.error(`   Got: ${haystack.slice(0, 200)}...`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

function assertNotContains(haystack, needle, message) {
  if (haystack.includes(needle)) {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected NOT to find "${needle}" in output`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

console.log('\n=== Notes Display Formatting Test Harness ===\n');

// --- collapseImagePlaceholders ---
console.log('--- collapseImagePlaceholders ---');
const imgResult = collapseImagePlaceholders('Check [image: Paul Faix] and [image: Document]');
assertContains(imgResult, '[📷 Paul Faix]', 'Image placeholders collapsed');
assertNotContains(imgResult, '[image: Paul Faix]', 'Original placeholder removed');

// --- stripFooter ---
console.log('\n--- stripFooter ---');
const footerInput = 'Main content here.\n\nThis email and any attachments may contain confidential information.';
const footerResult = stripFooter(footerInput);
assertContains(footerResult, 'Main content here', 'Footer stripped, main content kept');
assertNotContains(footerResult, 'confidential', 'Footer text removed');

// --- splitIntoSentences ---
console.log('\n--- splitIntoSentences ---');
const sentenceInput = 'Hi Guy. Great catching up. As promised, meeting minutes below.';
const sentenceResult = splitIntoSentences(sentenceInput);
assert(sentenceResult.includes('\n'), 'Sentences split onto new lines');
assertContains(sentenceResult, 'Hi Guy.', 'First sentence preserved');
assertContains(sentenceResult, 'Great catching up.', 'Second sentence preserved');
const drInput = 'Dr. Smith went home. I missed him.';
const drResult = splitIntoSentences(drInput);
assertContains(drResult, 'Dr. Smith', 'Abbreviation Dr. preserved');
assert(drResult.split('\n').length >= 2, 'Still splits at sentence boundary');

// --- splitQuotedSections ---
console.log('\n--- splitQuotedSections ---');
const quotedInput = 'My reply\n\nOn Mon, 10 Feb 2026, John wrote:\nQuoted content here';
const { main, quoted } = splitQuotedSections(quotedInput);
assert(main.includes('My reply'), 'Main section extracted');
assert(quoted.length > 0, 'Quoted section detected');
assert(quoted[0].body.includes('Quoted content'), 'Quoted body preserved');

// --- collapseEmailHeaders: MUST have Forwarded message separator ---
console.log('\n--- collapseEmailHeaders (with Forwarded message separator) ---');
const forwardedInput = `14-02-26 7:19 AM - Guy Wilson - Hi, here are the notes.

---------- Forwarded message ----------
From: Paul Faix <paul@fortix.com.au>
Date: Fri, 13 Feb 2026 at 21:19
Subject: Fwd: Notes: 'Paul & Guy Catch Up' 13 Feb 2026
To: Guy Wilson <guyralphwilson@gmail.com>

Hi Guy, Great catching up. Meeting minutes below.`;

const collapseResult = processForDisplay(forwardedInput);

// Should collapse the header block to [Forwarded: ...]
assertContains(collapseResult, '[Forwarded:', 'Forwarded header collapsed');
assertContains(collapseResult, 'Paul Faix', 'From name preserved');
assertContains(collapseResult, 'Fri, 13 Feb 2026', 'Date preserved');
assertNotContains(collapseResult, 'Subj', 'No "Subj" truncation in output');

// CRITICAL: Message content must be preserved
assertContains(collapseResult, 'Hi Guy, Great catching up', 'Message content preserved');
assertContains(collapseResult, 'Meeting minutes below', 'Message content preserved');
assertContains(collapseResult, '14-02-26 7:19 AM - Guy Wilson', 'Original message line preserved');

// --- collapseEmailHeaders: MUST NOT replace content that looks like headers but isn't ---
console.log('\n--- collapseEmailHeaders (body content with From:/Date: - must NOT be replaced) ---');
const bodyWithFromDate = `Subject: Meeting Notes

The meeting discussed:
- From: Campaign 2 we need to review results
- Date: next meeting will be Friday
- To: summarize the key points

This is actual meeting content.`;

const noForwardedResult = processForDisplay(bodyWithFromDate);

// Content must NOT be replaced - no "Forwarded message" separator, so no collapse
assertContains(noForwardedResult, 'From: Campaign 2 we need to review results', 'Body "From:" line preserved');
assertContains(noForwardedResult, 'Date: next meeting will be Friday', 'Body "Date:" line preserved');
assertContains(noForwardedResult, 'To: summarize the key points', 'Body "To:" line preserved');
assertContains(noForwardedResult, 'This is actual meeting content', 'Meeting content preserved');
assertNotContains(noForwardedResult, '[Forwarded:', 'No false collapse when no Forwarded message separator');

// --- Date and Subject on same line: no "Subj" in output ---
console.log('\n--- collapseEmailHeaders (Date and Subject on same line) ---');
const dateSubjectSameLine = `---------- Forwarded message ----------
From: Gemini <gemini-notes@google.com>
Date: Fri, 13 Feb 2026 at 14:08 Subject: Notes: Paul & Guy Catch Up
To: <paul@fortix.com.au>

Meeting notes content here.`;

const sameLineResult = processForDisplay(dateSubjectSameLine);
assertContains(sameLineResult, '[Forwarded:', 'Header collapsed');
assertContains(sameLineResult, 'Fri, 13 Feb 2026 at 14:08', 'Date extracted correctly');
assertNotContains(sameLineResult, 'Subj', 'No "Subj" when Date and Subject on same line');
assertContains(sameLineResult, 'Meeting notes content here', 'Content preserved');

// --- Full pipeline ---
console.log('\n--- Full pipeline (realistic email) ---');
const fullEmail = `Subject: Fwd: Notes: 'Paul & Guy Catch Up' 13 Feb 2026

14-02-26 7:19 AM - Guy Wilson - Here are the notes.

---------- Forwarded message ----------
From: Paul Faix <paul@fortix.com.au>
Date: Fri, 13 Feb 2026 at 21:19
Subject: Fwd: Notes: 'Paul & Guy Catch Up' 13 Feb 2026
To: Guy Wilson <guyralphwilson@gmail.com>

Hi Guy, Great catching up. [image: Meeting records] Key points: Campaign 2, LinkedIn strategy.

This email and any attachments may contain confidential information.`;

const fullResult = processForDisplay(fullEmail);
assertContains(fullResult, 'Subject: Fwd: Notes:', 'Subject line at top preserved');
assertContains(fullResult, '14-02-26 7:19 AM - Guy Wilson', 'Message line preserved');
assertContains(fullResult, '[Forwarded:', 'Forwarded block collapsed');
assertContains(fullResult, 'Hi Guy, Great catching up', 'Message body preserved');
assertContains(fullResult, '[📷 Meeting records]', 'Image placeholder collapsed');
assertNotContains(fullResult, 'confidential', 'Footer stripped');

console.log('\n=== All tests passed ===\n');
