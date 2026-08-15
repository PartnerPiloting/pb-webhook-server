/**
 * Tests for the queue's honest draft state (services/wingguyMailMcp.js, 2026-08-15) — the
 * one-builder refactor for the Follow-Ups screen. deriveDraftState() is the single answer to
 * "does this item carry a draft?", and draftMarker() renders it for chat. The old rendering
 * fell through to ' [draft ready]' when an item had no draft at all — the Vikas fault: the
 * queue claimed a draft the overnight pass had deliberately not written.
 *
 * Pure functions — no Postgres, no Airtable, no network. ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-queue-draft-state.test.js
 */
const assert = require('assert');
const { deriveDraftState, draftMarker } = require('../services/wingguyMailMcp');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

(async () => {
  console.log('deriveDraftState():');

  await check('a pre-written message is ready', () => {
    assert.equal(deriveDraftState({ draftText: 'Hi Frank,\n\nJust circling back.' }), 'ready');
  });

  await check('draftText outranks a leftover angle (legacy stored payloads)', () => {
    assert.equal(deriveDraftState({ draftText: 'Hi', wgAngle: 'reference the number he shared' }), 'ready');
  });

  await check('a LinkedIn person with only an angle is wg-angle', () => {
    assert.equal(deriveDraftState({ wgAngle: 'reference the number he shared' }), 'wg-angle');
  });

  await check('a failed generation is error', () => {
    assert.equal(deriveDraftState({ draftError: 'model kept inventing meeting times' }), 'error');
  });

  await check('nothing at all is none — never ready', () => {
    assert.equal(deriveDraftState({}), 'none');
    assert.equal(deriveDraftState({ whyLine: 'went quiet', jog: 'someone' }), 'none');
    assert.equal(deriveDraftState(null), 'none');
  });

  await check('empty-string draft fields do not count as content', () => {
    assert.equal(deriveDraftState({ draftText: '', wgAngle: '', draftError: '' }), 'none');
  });

  console.log('draftMarker():');

  await check('ready renders [draft ready] on both surfaces', () => {
    assert.equal(draftMarker('ready', 'today'), ' [draft ready]');
    assert.equal(draftMarker('ready', 'backlog'), ' [draft ready]');
  });

  await check('the Vikas fault is dead: none NEVER claims a draft', () => {
    assert.equal(draftMarker('none', 'today'), ' [no draft — see dossier]');
    assert.ok(!draftMarker('none', 'today').includes('draft ready'));
  });

  await check('backlog reopens mark only a real draft (unchanged behaviour)', () => {
    assert.equal(draftMarker('none', 'backlog'), '');
    assert.equal(draftMarker('error', 'backlog'), '');
  });

  await check('wg-angle points at the thread, not a paste', () => {
    assert.equal(draftMarker('wg-angle', 'today'), ' [LinkedIn — open the thread, type /wg]');
  });

  await check('error points back to chat', () => {
    assert.equal(draftMarker('error', 'today'), ' [no draft — ask in chat]');
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
