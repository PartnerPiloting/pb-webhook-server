/**
 * Client phrases - does every sentence a client is told to type actually reach its tool?
 *
 * 19 Sep 2026: Guy typed "Help me set up my LinkedHelper machine" - the exact words Steve Nelson's
 * onboarding email told him to type - and got the August Windows-laptop doctrine back, answered
 * from memory. wingguy_learn was never called. Its description claimed "networking, outreach,
 * LinkedIn, meetings, follow-up"; machine setup was none of those, so there was nothing to route
 * on. The answer was confident, coherent, a month out of date, and a client could not have told.
 *
 * This pins what can be checked without a live chat:
 *   1.  every phrase in content/client-phrases.json is quoted, word for word, in the description of
 *       the tool that must answer it - through the REAL loaded module, after applyClientPhrases ran;
 *   2.  every wingguy_learn phrase lands where it should through the REAL matcher: the named
 *       playbook topic, the tour, or "everything";
 *   2b. near misses - sentences a client might type that are in no doc - are never served the
 *       named WRONG topic (a miss is fine: it is logged as a gap and the client is told to ask Guy);
 *   3.  every doc the registry says carries the phrase still does - so a reworded email fails here,
 *       not in a client's chat six weeks later;
 *   4.  the /mcp2 server carries server-level instructions that name wingguy_learn - the signal
 *       that sits above every tool description.
 *
 * What it cannot check: whether a client's Claude will CHOOSE the tool. Nothing can, from here.
 * Type the sentence into a fresh chat once before it ships. This test is what makes that the
 * only thing left to check.
 *
 * Run: node tests/client-phrases.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { load, normalise, SENTINEL } = require('../utils/clientPhrases');

let failures = 0;
const pass = (name) => console.log(`  ✓ ${name}`);
const fail = (name, e) => { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); };
const check = (name, fn) => {
  try { fn(); pass(name); }
  catch (e) { fail(name, e); }
};

// The modules that own client-facing tools. Loading them runs applyClientPhrases, which is the
// point: we test what a chat would actually be handed, not the source text.
const MODULES = {
  'services/wingguyGetStartedMcp.js': require('../services/wingguyGetStartedMcp'),
  'services/wingguyMailMcp.js': require('../services/wingguyMailMcp'),
  'services/wingguyBookingMcp.js': require('../services/wingguyBookingMcp'),
  'services/wingguyRulesMcp.js': require('../services/wingguyRulesMcp'),
  'services/machineClipboardMcp.js': require('../services/machineClipboardMcp'),
  'services/wingguyScoringMcp.js': require('../services/wingguyScoringMcp'),
  'services/wingguyReconnectMcp.js': require('../services/wingguyReconnectMcp'),
  'services/wingguyInboxMcp.js': require('../services/wingguyInboxMcp'),
  'services/wingguyTopUpMcp.js': require('../services/wingguyTopUpMcp'),
  'services/wingguyCampaignSettingsMcp.js': require('../services/wingguyCampaignSettingsMcp'),
  'services/wingguyLeadsMcp.js': require('../services/wingguyLeadsMcp'),
  'services/wingguyContactsMcp.js': require('../services/wingguyContactsMcp'),
  'services/recallImportMcp.js': require('../services/recallImportMcp'),
  'services/captureControlMcp.js': require('../services/captureControlMcp'),
  'services/wisprMcp.js': require('../services/wisprMcp'),
};

function findTool(name) {
  for (const [file, mod] of Object.entries(MODULES)) {
    const def = (mod.TOOL_DEFS || []).find((d) => d.name === name);
    if (def) return { file, def };
  }
  return null;
}

const learn = MODULES['services/wingguyGetStartedMcp.js'];
const { phrases } = load();
const rawRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'client-phrases.json'), 'utf8'));

console.log(`\nclient phrases - ${phrases.length} sentence(s) clients are told to type\n`);

check('registry has at least one phrase and no duplicates', () => {
  assert.ok(phrases.length > 0, 'content/client-phrases.json has no phrases');
  const seen = new Set();
  for (const p of phrases) {
    const k = normalise(p.phrase);
    assert.ok(!seen.has(k), `duplicate phrase: "${p.phrase}"`);
    seen.add(k);
  }
});

// ---- 1. the description claims the phrase ------------------------------------------------------
console.log('\n1. the tool description quotes the phrase');
for (const p of phrases) {
  check(`"${p.phrase}" -> ${p.tool}`, () => {
    const found = findTool(p.tool);
    assert.ok(found, `no tool named ${p.tool} in any loaded module - wrong name in the registry, or the module that owns it is not in MODULES`);
    const desc = normalise(found.def.description);
    assert.ok(desc.includes(SENTINEL.toLowerCase()), `${p.tool} (${found.file}) has no client-phrase block - is applyClientPhrases(TOOL_DEFS) called before that file's module.exports?`);
    assert.ok(desc.includes(normalise(p.phrase)), `${p.tool} description does not contain "${p.phrase}"`);
  });
}

// ---- 2. the real matcher lands it -----------------------------------------------------------------
console.log('\n2. wingguy_learn routes the phrase where the registry says');
const pb = learn.loadPlaybook();
for (const p of phrases.filter((x) => x.tool === 'wingguy_learn')) {
  check(`"${p.phrase}" -> ${p.tour ? `tour ${p.tour}` : p.everything ? 'everything' : p.report ? 'explain-better report' : p.topic}`, () => {
    if (p.tour === 'status') {
      assert.ok(learn.wantsTourStatus(p.phrase), 'wantsTourStatus() rejected it');
      return;
    }
    if (p.tour === 'advance') {
      assert.ok(learn.wantsTourAdvance(p.phrase), 'wantsTourAdvance() rejected it');
      return;
    }
    if (p.everything) {
      assert.ok(learn.wantsEverything(p.phrase), 'wantsEverything() rejected it');
      return;
    }
    if (p.report) {
      // "can you ask Guy to explain this better in future?" - must reach the explain-better door,
      // and must be the very sentence every topic answer offers.
      assert.ok(learn.wantsExplainBetter(p.phrase), 'wantsExplainBetter() rejected it - it would be served a topic or logged as a gap');
      assert.ok(!learn.wantsTourStatus(p.phrase) && !learn.wantsTourAdvance(p.phrase) && !learn.wantsEverything(p.phrase), 'a tour/everything door would catch this first');
      assert.strictEqual(normalise(p.phrase), normalise(learn.EXPLAIN_BETTER_SAY), 'the registry and EXPLAIN_BETTER_SAY have drifted apart');
      return;
    }
    assert.ok(p.topic, 'a wingguy_learn phrase needs topic, tour, everything or report');
    // Neither special door may swallow a topic phrase on the way in.
    assert.ok(!learn.wantsTourStatus(p.phrase) && !learn.wantsTourAdvance(p.phrase) && !learn.wantsEverything(p.phrase), 'a special door (tour/everything) would catch this before the topic matcher');
    const hit = learn.findPlaybookTopic(pb.topics, p.phrase);
    assert.ok(hit, `findPlaybookTopic() found nothing for "${p.phrase}" - that phrase would be logged as a GAP and the client told to ask Guy`);
    assert.ok(
      normalise(hit.title).startsWith(normalise(p.topic)),
      `resolved to "${hit.title}" but the registry expects a title starting "${p.topic}"`,
    );
  });
}

// ---- 2b. near misses must not be served the wrong topic --------------------------------------
console.log('\n2b. near misses: a miss is fine, the wrong topic is not');
for (const nm of rawRegistry.near_misses || []) {
  check(`"${nm.phrase}" must not -> ${nm.not}${nm.expect ? ` (and should -> ${nm.expect})` : ''}`, () => {
    const hit = learn.findPlaybookTopic(pb.topics, nm.phrase);
    if (nm.expect) {
      // The registry knows where this one belongs - a gap is a failure here, not a safe miss.
      assert.ok(hit, `found nothing, but the registry expects "${nm.expect}"`);
      assert.ok(
        normalise(hit.title).startsWith(normalise(nm.expect)),
        `resolved to "${hit.title}" but the registry expects a title starting "${nm.expect}"`,
      );
      return;
    }
    if (!hit) return; // a gap: logged, and the client is told to ask Guy - the right answer for an uncovered question
    assert.ok(
      !normalise(hit.title).startsWith(normalise(nm.not)),
      `served "${hit.title}" - a confident wrong topic, which is exactly the failure this file exists to stop`,
    );
  });
}

// ---- 3. the docs still say it -------------------------------------------------------------------
console.log('\n3. every doc the registry names still carries the phrase');
for (const p of phrases) {
  for (const rel of p.where || []) {
    check(`"${p.phrase}" in ${rel}`, () => {
      const abs = path.join(ROOT, rel);
      assert.ok(fs.existsSync(abs), `${rel} does not exist`);
      const text = normalise(fs.readFileSync(abs, 'utf8'));
      assert.ok(text.includes(normalise(p.phrase)), `${rel} no longer contains "${p.phrase}" - reworded? Update the doc or the registry, they must agree`);
    });
  }
}

// ---- 4. the server-level instructions -----------------------------------------------------------
console.log('\n4. the /mcp2 server tells the model where these questions go');
check('mcpRecallServer.js passes instructions naming wingguy_learn', () => {
  const src = fs.readFileSync(path.join(ROOT, 'services', 'mcpRecallServer.js'), 'utf8');
  const m = src.match(/new McpServer\(\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(m, 'could not find the McpServer construction');
  assert.ok(/instructions\s*:/.test(m[0]), 'McpServer is constructed without instructions - the model gets no server-level steer at all');
  assert.ok(/wingguy_learn/.test(m[0]), 'the instructions do not name wingguy_learn');
});
// 2 Nov 2026: "go through my inbox" in a fresh chat went to the Gmail connector ("Used Gmail") -
// the inbox tool was never looked at. The steer above every tool is what makes a chat reach for it.
check('mcpRecallServer.js instructions send inbox requests to wingguy_inbox, not a mail connector', () => {
  const src = fs.readFileSync(path.join(ROOT, 'services', 'mcpRecallServer.js'), 'utf8');
  const start = src.indexOf('instructions:');
  const block = start < 0 ? '' : src.slice(start, src.indexOf('server.registerTool(', start));
  const inbox = block.indexOf('INBOX:');
  assert.ok(inbox > 0, 'the server instructions have no INBOX line');
  const line = block.slice(inbox);
  assert.ok(line.includes('call wingguy_inbox') && line.includes('never a Gmail or Outlook connector'),
    'the INBOX line no longer sends inbox requests to wingguy_inbox over a mail connector');
});

// 10 Nov 2026: "what can wingguy do" in a fresh chat got "Planning how to describe Wingguy's tools" - the
// chat summarised the tool list itself (a wall of text, coach-only tools included) and never called
// wingguy_vision. A tool description cannot stop that; only the steer above every tool can.
check('mcpRecallServer.js instructions send "what can Wingguy do" to wingguy_vision, never a self-written tool summary', () => {
  const src = fs.readFileSync(path.join(ROOT, 'services', 'mcpRecallServer.js'), 'utf8');
  const start = src.indexOf('instructions:');
  const block = start < 0 ? '' : src.slice(start, src.indexOf('server.registerTool(', start));
  const at = block.indexOf('WHAT IT CAN DO:');
  assert.ok(at > 0, 'the server instructions have no WHAT IT CAN DO line');
  const line = block.slice(at);
  assert.ok(line.includes('call wingguy_vision'), 'the line no longer names wingguy_vision');
  assert.ok(/NEVER answer by describing or listing these tools yourself/.test(line), 'the line no longer forbids describing the tool list');
});

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}\n`);
process.exit(failures ? 1 : 0);
