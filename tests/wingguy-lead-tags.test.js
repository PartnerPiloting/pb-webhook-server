/**
 * Tests for the lead TAG merge (2026-09-17) - services/wingguyLeadTags.mergeTags.
 *
 * The Martin Kearns lesson: the tags are list membership, so a botched merge either leaves someone on
 * a list they asked to leave or quietly drops tags they should have kept. Four things must hold:
 *   1. removing a tag takes out ONLY that tag, whatever case it was asked in, and keeps the rest in order;
 *   2. the display cell keeps the casing already on the record, and canonical stays lowercased - the
 *      two fields are what the search formulae and the coach's eyes read, and they must agree;
 *   3. a record with no canonical cell yet still merges, off the display cell;
 *   4. the 15-tag cap REPORTS what it refused instead of silently swallowing it.
 *
 * Then runTagLead itself against a stubbed Airtable base - that the address it files lands under
 * {Alt Emails} and NEVER becomes the primary is the one that matters most: promoting a newsletter
 * reply-from address would silently repoint everything the coach sends that person.
 *
 * No network.
 * Run: node tests/wingguy-lead-tags.test.js
 */
const assert = require('assert');
const { mergeTags, asList, MAX_TAGS } = require('../services/wingguyLeadTags');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// The record as it stood when he asked to come off the list.
const martin = { displayRaw: 'Mindset Mastery, coaching, melbourne', canonicalRaw: 'mindset mastery, coaching, melbourne' };

console.log('the unsubscribe - off one list, tagged with why:');
check('removes the list tag and adds unsubscribed', () => {
  const r = mergeTags({ ...martin, remove: ['mindset mastery'], add: ['unsubscribed'] });
  assert.deepStrictEqual(r.tokens, ['coaching', 'melbourne', 'unsubscribed']);
  assert.deepStrictEqual(r.removed, ['mindset mastery']);
  assert.deepStrictEqual(r.added, ['unsubscribed']);
  assert.ok(r.changed);
});
check('the other tags survive untouched, in their original order and casing', () => {
  const r = mergeTags({ ...martin, remove: ['mindset mastery'] });
  assert.strictEqual(r.display, 'coaching, melbourne');
});
check('removal is case-insensitive - "Mindset Mastery" comes off too', () => {
  const r = mergeTags({ ...martin, remove: ['Mindset Mastery'] });
  assert.ok(!r.tokens.includes('mindset mastery'));
});
check('a tag that was never there is a no-op, not an error', () => {
  const r = mergeTags({ ...martin, remove: ['newsletter'] });
  assert.deepStrictEqual(r.removed, []);
  assert.ok(!r.changed);
});

console.log('the two cells stay in step:');
check('display keeps the casing on the record, canonical is lowercased', () => {
  const r = mergeTags({ ...martin, add: ['Referral'] });
  assert.strictEqual(r.display, 'Mindset Mastery, coaching, melbourne, Referral');
  assert.strictEqual(r.canonical, 'mindset mastery, coaching, melbourne, referral');
});
check('re-adding an existing tag does NOT duplicate it or restyle it', () => {
  const r = mergeTags({ ...martin, add: ['MINDSET MASTERY'] });
  assert.strictEqual(r.display, 'Mindset Mastery, coaching, melbourne');
  assert.ok(!r.changed);
});
check('remove then add in one call ends with the tag PRESENT', () => {
  const r = mergeTags({ ...martin, remove: ['coaching'], add: ['coaching'] });
  assert.ok(r.tokens.includes('coaching'));
});
check('whitespace and blank entries are cleaned, not stored', () => {
  const r = mergeTags({ displayRaw: '', canonicalRaw: '', add: ['  spaced   out  ', '', '   '] });
  assert.deepStrictEqual(r.tokens, ['spaced out']);
});

console.log('records that have never had a canonical cell written:');
check('falls back to the display cell rather than wiping the tags', () => {
  const r = mergeTags({ displayRaw: 'Mindset Mastery, coaching', canonicalRaw: '', remove: ['mindset mastery'] });
  assert.deepStrictEqual(r.tokens, ['coaching']);
  assert.strictEqual(r.display, 'coaching');
});
check('an array cell (multi-select base) merges the same way', () => {
  const r = mergeTags({ displayRaw: ['Mindset Mastery', 'coaching'], canonicalRaw: '', remove: ['coaching'] });
  assert.deepStrictEqual(r.tokens, ['mindset mastery']);
});
check('a duplicated tag on the record is de-duped on the way through', () => {
  const r = mergeTags({ displayRaw: 'coaching, coaching', canonicalRaw: 'coaching, coaching', add: ['x'] });
  assert.deepStrictEqual(r.tokens, ['coaching', 'x']);
});

console.log(`the ${MAX_TAGS}-tag cap:`);
const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`).join(', ');
check('refuses the overflow and NAMES it rather than swallowing it', () => {
  const r = mergeTags({ displayRaw: full, canonicalRaw: full, add: ['one-too-many'] });
  assert.strictEqual(r.tokens.length, MAX_TAGS);
  assert.deepStrictEqual(r.overflow, ['one-too-many']);
  assert.deepStrictEqual(r.added, []);
  assert.ok(!r.changed);
});
check('removing first makes room, so a swap on a full record works', () => {
  const r = mergeTags({ displayRaw: full, canonicalRaw: full, remove: ['t0'], add: ['unsubscribed'] });
  assert.strictEqual(r.tokens.length, MAX_TAGS);
  assert.deepStrictEqual(r.overflow, []);
  assert.ok(r.tokens.includes('unsubscribed'));
  assert.ok(!r.tokens.includes('t0'));
});

console.log('the caller may pass a list or one comma-separated string:');
check('comma string splits', () => assert.deepStrictEqual(asList('a, b ,c'), ['a', 'b', 'c']));
check('array passes through cleaned', () => assert.deepStrictEqual(asList([' a ', '', 'b']), ['a', 'b']));
check('nothing is an empty list, never a crash', () => assert.deepStrictEqual(asList(undefined), []));
check('a string of tags removes as several tags', () => {
  const r = mergeTags({ ...martin, remove: 'mindset mastery, coaching' });
  assert.deepStrictEqual(r.tokens, ['melbourne']);
});

// The live failure on Martin Kearns, 2026-09-17: the caller wrote a LIST into a text argument, so
// `["unsubscribed"]` arrived as a string. It was stored verbatim - brackets and quote marks became
// part of the tag - and the matching remove matched nothing and silently did nothing.
console.log('a list written INTO a text argument (the Martin Kearns bug):');
check('a bracketed string is unwrapped, not stored as punctuation', () => {
  assert.deepStrictEqual(asList('["unsubscribed"]'), ['unsubscribed']);
});
check('several tags inside the brackets', () => {
  assert.deepStrictEqual(asList('["unsubscribed", "referral"]'), ['unsubscribed', 'referral']);
});
check('single quotes are not valid JSON but still peel', () => {
  assert.deepStrictEqual(asList("['mindset mastery']"), ['mindset mastery']);
});
check('an unterminated list still peels rather than storing a bracket', () => {
  assert.deepStrictEqual(asList('["unsubscribed", ]'), ['unsubscribed']);
});
check('a bare quoted tag loses the quotes', () => {
  assert.deepStrictEqual(asList('"mindset mastery"'), ['mindset mastery']);
});
check("an apostrophe INSIDE a tag survives", () => {
  assert.deepStrictEqual(asList("guy's list"), ["guy's list"]);
});
check('the failed remove now actually removes', () => {
  const r = mergeTags({ ...martin, remove: '["mindset mastery"]' });
  assert.deepStrictEqual(r.removed, ['mindset mastery']);
  assert.ok(!r.tokens.includes('mindset mastery'));
});
check('the failed add now writes a clean tag', () => {
  const r = mergeTags({ ...martin, add: '["unsubscribed"]' });
  assert.ok(r.tokens.includes('unsubscribed'), JSON.stringify(r.tokens));
  assert.ok(!r.display.includes('['), r.display);
  assert.ok(!r.display.includes('"'), r.display);
});
check('a tag that genuinely contains a bracket is left alone', () => {
  assert.deepStrictEqual(asList('coaching [au]'), ['coaching [au]']);
});

// ---------------------------------------------------------------------------
// The tool itself, against a stubbed Airtable base (same harness style as
// tests/wingguy-update-lead.test.js) - no network.
// ---------------------------------------------------------------------------

const clientService = require('../services/clientService');
const { runTagLead } = require('../services/wingguyLeadsMcp');

const acheck = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

function stubBase({ record = null, matches = [] } = {}) {
  const updates = [];
  const selects = [];
  const table = () => ({
    find: async () => record,
    update: async (rows) => { updates.push(...rows); return rows; },
    select: (opts) => { selects.push(opts); return { all: async () => matches, firstPage: async () => matches }; },
  });
  return { table, _updates: updates, _selects: selects };
}

// Martin as he stood this morning: on the list, and the address he wrote in from is nowhere on file.
const martinRec = {
  id: 'rec4HCocz6oAQFV99',
  fields: {
    'First Name': 'Martin',
    'Last Name': 'Kearns',
    'Email': 'martin@thunderlabs.com.au',
    'Search Terms': 'Mindset Mastery, coaching',
    'Search Tokens (canonical)': 'mindset mastery, coaching',
  },
};

(async () => {
  console.log('runTagLead - the unsubscribe, end to end:');
  {
    const base = stubBase({ record: martinRec, matches: [martinRec] });
    const origBase = clientService.getClientBase;
    const origById = clientService.getClientById;
    clientService.getClientBase = () => base.table;
    clientService.getClientById = async () => ({ airtableBaseId: 'baseX' });
    try {
      const r = await runTagLead({
        lead_name: 'Martin Kearns',
        remove_tags: ['mindset mastery'],
        add_tags: ['unsubscribed'],
        file_email: 'kearnsey@gmail.com',
      });
      await acheck('no error', () => assert.ok(!r.isError, r.text));
      await acheck('names the person and the record, so a wrong write is obvious', () => {
        assert.ok(/Martin Kearns/.test(r.text) && /rec4HCocz6oAQFV99/.test(r.text), r.text);
      });
      await acheck('reports the tags old → new', () => {
        assert.ok(/"Mindset Mastery, coaching" → "coaching, unsubscribed"/.test(r.text), r.text);
      });
      await acheck('tag write sets BOTH cells in step', () => {
        const tagWrite = base._updates.find((u) => u.fields['Search Terms']);
        assert.ok(tagWrite, 'no tag write');
        assert.strictEqual(tagWrite.fields['Search Terms'], 'coaching, unsubscribed');
        assert.strictEqual(tagWrite.fields['Search Tokens (canonical)'], 'coaching, unsubscribed');
      });
      await acheck('the address is filed as an ALTERNATE, never the primary', () => {
        const mailWrite = base._updates.find((u) => u.fields['Alt Emails']);
        assert.ok(mailWrite, 'no email write');
        assert.ok(/kearnsey@gmail\.com/.test(mailWrite.fields['Alt Emails']), JSON.stringify(mailWrite.fields));
        assert.ok(!('Email' in mailWrite.fields), 'primary must not be touched');
      });
      await acheck('says the primary is untouched, so the coach can see it', () => {
        assert.ok(/martin@thunderlabs\.com\.au, is untouched/.test(r.text), r.text);
      });
    } finally { clientService.getClientBase = origBase; clientService.getClientById = origById; }
  }

  console.log('runTagLead - lookup:');
  {
    const base = stubBase({ record: martinRec, matches: [martinRec] });
    const origBase = clientService.getClientBase;
    const origById = clientService.getClientById;
    clientService.getClientBase = () => base.table;
    clientService.getClientById = async () => ({ airtableBaseId: 'baseX' });
    try {
      await runTagLead({ lead_email: 'kearnsey@gmail.com', remove_tags: ['mindset mastery'] });
      await acheck('an email is matched against Alt Emails as well as the primary', () => {
        const f = base._selects[0] && base._selects[0].filterByFormula;
        assert.ok(/\{Alt Emails\}/.test(f || ''), `formula was: ${f}`);
      });
    } finally { clientService.getClientBase = origBase; clientService.getClientById = origById; }
  }
  {
    const two = [
      { id: 'recA', fields: { 'First Name': 'Martin', 'Last Name': 'Kearns' } },
      { id: 'recB', fields: { 'First Name': 'Martin', 'Last Name': 'Keane' } },
    ];
    const base = stubBase({ record: two[0], matches: two });
    const origBase = clientService.getClientBase;
    const origById = clientService.getClientById;
    clientService.getClientBase = () => base.table;
    clientService.getClientById = async () => ({ airtableBaseId: 'baseX' });
    try {
      const r = await runTagLead({ lead_name: 'Martin', remove_tags: ['mindset mastery'] });
      await acheck('two Martins = a list back, and NOTHING written', () => {
        assert.ok(/More than one lead matches/.test(r.text), r.text);
        assert.strictEqual(base._updates.length, 0);
      });
    } finally { clientService.getClientBase = origBase; clientService.getClientById = origById; }
  }

  console.log('runTagLead - guards:');
  {
    const r = await runTagLead({ remove_tags: ['mindset mastery'] });
    await acheck('no identifier = error before anything is touched', () => assert.ok(r.isError, r.text));
    const r2 = await runTagLead({ lead_name: 'Martin Kearns' });
    await acheck('nothing to change = error, never a blank write', () => assert.ok(r2.isError, r2.text));
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
