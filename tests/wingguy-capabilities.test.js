/**
 * Wingguy capabilities - is the "what can I do with Wingguy?" answer complete and current?
 *
 * 9 Nov 2026: the answer a brand-new client got on onboarding day never mentioned their Linked
 * Helper machine, still said leads arrive by copy and paste, and was missing most of what had been
 * built since July. It was hand-written prose, so nothing made it keep up.
 *
 * The answer is now generated from content/wingguy-capabilities.json. This pins:
 *   1. every tool the connector really registers is either on the list or in not_shown with a
 *      reason - so a NEW tool fails here until someone writes its line (this is the self-updating
 *      part: the build breaks instead of the answer going stale);
 *   2. every tool the list names really exists - so a renamed or deleted tool fails here too;
 *   3. every sentence the answer tells a client to type is in content/client-phrases.json against
 *      the same tool (the house rule; tests/client-phrases.test.js then proves the description
 *      quotes it);
 *   4. house style: short dash, "instructions" not "rules", and none of the retired copy-and-paste
 *      story;
 *   5. the rendered answer carries every line, adapts to what the client has connected, and the
 *      New flag switches itself off after new_for_days.
 *
 * Run: node tests/wingguy-capabilities.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const caps = require('../utils/wingguyCapabilities');
const { load: loadPhrases, normalise } = require('../utils/clientPhrases');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const list = caps.load();
const items = list.sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.id })));

// ---- what the connector REALLY registers ---------------------------------------------------------
// Read from mcpRecallServer.js itself, so a new tool module wired into the server is picked up here
// without anyone remembering to add it to a list in this test.
const serverSrc = fs.readFileSync(path.join(ROOT, 'services', 'mcpRecallServer.js'), 'utf8');
const real = new Map(); // tool name -> where it comes from
for (const m of serverSrc.matchAll(/const\s*\{\s*register\w+Tools\s*\}\s*=\s*require\('\.\/(\w+)'\)/g)) {
  const mod = require(path.join(ROOT, 'services', m[1]));
  assert.ok(Array.isArray(mod.TOOL_DEFS), `services/${m[1]}.js does not export TOOL_DEFS`);
  for (const d of mod.TOOL_DEFS) real.set(d.name, `services/${m[1]}.js`);
}
for (const m of serverSrc.matchAll(/server\.registerTool\(\s*'([a-z_]+)'/g)) real.set(m[1], 'services/mcpRecallServer.js');

const { shown, notShown } = caps.allListedTools();

console.log(`\nwingguy capabilities - ${items.length} lines in ${list.sections.length} sections, ${real.size} real tools\n`);

console.log('1. every real tool has a line (or a reason it has none)');
check('found the connector\'s tools', () => assert.ok(real.size > 40, `only found ${real.size} tools - has mcpRecallServer.js changed shape?`));
for (const [name, from] of real) {
  check(name, () => assert.ok(
    shown.has(name) || notShown.has(name),
    `${name} (${from}) is on the connector but not in content/wingguy-capabilities.json. Add it to the tools of the line that describes it (or write a new line, with "added": today's date so it shows as New), or put it in not_shown with the reason.`,
  ));
}

console.log('\n2. every tool the list names is real');
for (const name of [...shown, ...notShown]) {
  check(name, () => assert.ok(real.has(name), `${name} is in content/wingguy-capabilities.json but no such tool is registered - renamed or removed?`));
}
check('no tool is both shown and not_shown', () => {
  const both = [...shown].filter((t) => notShown.has(t));
  assert.deepStrictEqual(both, []);
});

console.log('\n3. every sentence is registered against its tool');
const registry = new Map(loadPhrases().phrases.map((p) => [normalise(p.phrase), p]));
check('no sentence appears twice', () => {
  const seen = new Set();
  for (const i of items) { const k = normalise(i.say); assert.ok(!seen.has(k), `"${i.say}" is on two lines`); seen.add(k); }
});
for (const i of items.filter((x) => (x.tools || []).length)) {
  check(`"${i.say}" -> ${i.tools[0]}`, () => {
    const hit = registry.get(normalise(i.say));
    assert.ok(hit, `"${i.say}" is not in content/client-phrases.json - add it there (tool: ${i.tools[0]})`);
    assert.ok(i.tools.includes(hit.tool), `client-phrases.json sends "${i.say}" to ${hit.tool}, which this line does not list`);
  });
}

console.log('\n4. house style');
const allText = JSON.stringify(list.sections);
check('no em or en dash', () => assert.ok(!/[–—]/.test(allText), 'use the short spaced dash " - "'));
check('"instructions", never "rules"', () => {
  for (const s of list.sections) for (const t of [s.title, s.lead, ...s.items.flatMap((i) => [i.say, i.does])]) {
    assert.ok(!/\brules?\b/i.test(t || ''), `"${t}" says rules - client wording is "instructions"`);
  }
});
check('every line has a sentence and says what it does', () => {
  for (const i of items) {
    assert.ok(i.say && i.say.trim(), `a line in ${i.section} has no say`);
    assert.ok(i.does && i.does.trim().length > 15, `"${i.say}" does not say what it does`);
    if (i.added) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(i.added), `"${i.say}" has a bad added date`);
    if (i.needs) assert.ok(caps.NEEDS[i.needs], `"${i.say}" needs "${i.needs}", which is not a known connection`);
  }
  for (const s of list.sections) if (s.needs) assert.ok(caps.NEEDS[s.needs], `section ${s.id} needs "${s.needs}"`);
});

console.log('\n5. the rendered answer');
const FULL = { name: 'Josh', hasMachine: true, hasMailbox: true, hasCalendar: true, hasFathom: true, rulesSeeded: true };
const NOW = new Date('2026-11-09T00:00:00Z');
const full = caps.renderVision(FULL, NOW);
check('carries every sentence', () => { for (const i of items) assert.ok(full.includes(`"${i.say}"`), `missing "${i.say}"`); });
check('leads with the machine and Linked Helper', () => {
  assert.ok(full.indexOf('Linked Helper') > 0 && full.indexOf('Linked Helper') < full.indexOf('follow-ups'), 'Linked Helper should come before follow-ups');
});
check('the retired copy-and-paste story is gone', () => assert.ok(!/copy a lead|copy\/paste|paste them to me/i.test(full)));
check('never praises its own drafting, never says it sends', () => {
  assert.ok(/I never send/.test(full));
  assert.ok(!/\b(amazing|brilliant|best-in-class|world-class)\b/i.test(full));
});
check('a fully connected client is told everything is live', () => {
  assert.ok(full.includes('everything is connected'));
  assert.ok(!full.includes('Still to switch on'));
  assert.ok(!/\*\(once your/.test(full));
});
check('a brand-new client sees what is still to switch on', () => {
  const fresh = caps.renderVision({ name: 'Josh', hasMachine: false, hasMailbox: false, hasCalendar: false, hasFathom: false, rulesSeeded: false }, NOW);
  for (const w of ['machine', 'mailbox', 'calendar', 'note-taker', 'instructions']) assert.ok(fresh.split('Still to switch on')[1].includes(w), `no mention of ${w}`);
  assert.ok(fresh.includes('once your machine is switched on'));
  for (const i of items) assert.ok(fresh.includes(`"${i.say}"`), `a new client must still see "${i.say}"`);
});
check('survives a client record that could not be read', () => assert.ok(caps.renderVision(null, NOW).includes('Still to switch on')));
check('New flag shows inside the window and drops off after it', () => {
  const dated = items.filter((i) => i.added);
  if (!dated.length) return;
  const newest = dated.map((i) => i.added).sort().pop();
  const inside = caps.renderVision(FULL, new Date(`${newest}T12:00:00Z`));
  assert.ok(inside.includes('**New** - '), 'a line added today should be marked New');
  const later = new Date(Date.parse(`${newest}T00:00:00Z`) + (list.new_for_days + 2) * 86400000);
  assert.ok(!caps.renderVision(FULL, later).includes('**New** - '), 'New should drop off by itself');
});
check('wingguy_vision serves the generated answer, not hand-written lines', () => {
  const src = fs.readFileSync(path.join(ROOT, 'services', 'wingguyGetStartedMcp.js'), 'utf8');
  const a = src.indexOf('async function runVision(');
  const body = src.slice(a, src.indexOf('\n}\n', a));
  assert.ok(body.includes('renderVision('), 'runVision no longer calls renderVision');
  assert.ok(!body.includes('parts.push'), 'runVision is building text by hand again - the words belong in content/wingguy-capabilities.json');
});

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}\n`);
process.exit(failures ? 1 : 0);
