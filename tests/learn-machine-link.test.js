/**
 * "Open my machine" asked of Wingguy Learning (services/wingguyGetStartedMcp.js).
 *
 * 29 Sep 2026: Guy typed "open my vps" the night his web link went live and was served the
 * desktop-icon topic. A client with a Machine Link must get their link; a client without one
 * must still get the written topic.
 *
 * Run: node tests/learn-machine-link.test.js
 */
const assert = require('assert');

process.env.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'test';
process.env.MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID || 'appTest';

const clientService = require('../services/clientService');
const learning = require('../services/wingguyLearningStore');
learning.stamp = async () => {};
learning.markNudgeDoneIfTopicMatches = async () => {};
const { legacyToolCall, MEMORY_FOOTER } = require('../services/wingguyGetStartedMcp');

let failures = 0;
const pending = [];
const check = (name, fn) => {
  pending.push(Promise.resolve().then(fn).then(
    () => console.log(`  ✓ ${name}`),
    (e) => { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); },
  ));
};

const ask = async (client, topic) => {
  clientService.getClientById = async () => client;
  const out = await legacyToolCall('wingguy_learn', { topic }, client.clientId);
  return out.content[0].text;
};

const LINK = 'https://roland-illyes.mywingguy.com';
const withLink = { clientId: 'Roland-Illyes', clientName: 'Roland Illyes', machineLink: LINK, machineLastSeen: new Date().toISOString() };
const onIcon = { clientId: 'Sam-Noble', clientName: 'Sam Noble', machineLastSeen: new Date().toISOString() };

(async () => {
  // One at a time: each ask swaps the stubbed client.
  const linked = await ask(withLink, 'open my linked helper machine');
  const linkedVps = await ask(withLink, 'how do I open my machine');
  const wordings = ['open my vps', 'get into my machine', 'access my server', 'open linked helper', 'log into my VPS'];
  const byWording = [];
  for (const w of wordings) byWording.push([w, await ask(withLink, w)]);
  const setup = await ask(withLink, 'help me set up my Linked Helper machine');
  const iconVps = await ask(onIcon, 'get into my machine');
  const icon = await ask(onIcon, 'open my linked helper machine');
  const other = await ask(withLink, 'big picture');

  check('a client with a link is given their link', () => {
    assert.ok(linked.includes(LINK), 'the link is missing');
    assert.ok(!/Tailscale/i.test(linked), 'still talks about Tailscale');
    assert.ok(!/icon on your desktop/i.test(linked), 'still talks about the desktop icon');
  });
  check('however they word it', () => {
    assert.ok(linkedVps.includes(LINK));
    for (const [w, text] of byWording) assert.ok(text.includes(LINK), `"${w}" did not get the link`);
  });
  check('setting the machine UP is a different question and keeps its own topic', () => {
    assert.ok(/^## YOUR LINKED HELPER MACHINE - SETTING IT UP/.test(setup));
    assert.ok(!setup.includes(LINK));
  });
  check('the wider wordings change nothing for a client without a link', () => {
    assert.ok(!iconVps.includes('mywingguy.com'));
  });
  check('the answer still carries the do-not-remember line', () => {
    assert.ok(linked.includes(MEMORY_FOOTER));
  });
  check('a client still on the icon gets the written topic, unchanged', () => {
    assert.ok(/^## OPEN YOUR LINKED HELPER MACHINE/.test(icon));
    assert.ok(!icon.includes('mywingguy.com'));
  });
  check('every other topic is untouched for a client with a link', () => {
    assert.ok(!other.includes(LINK));
    assert.ok(/^## /.test(other));
  });

  await Promise.all(pending);
  if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
