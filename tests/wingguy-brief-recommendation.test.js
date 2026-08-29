/**
 * Tests for recommendation-first, drop-biased, call-aware triage (Guy 2026-08-29, the Nea Dhillon
 * morning). Three contracts:
 *   1. formatBrief leads every line with the triage's `recommendation` (advice in the coach's
 *      ear), falling back to why_line for pre-change payloads; the new "drop" verdict renders as
 *      a RECOMMENDED DROPS pile with confirm-before-ceasing language — NOTHING automatic.
 *   2. gatherPersonContext rides a stored dossier's call recaps / standing / promises / sent-email
 *      record into the triage context as ground truth (the Nea fault: triage read the clipped
 *      message shadow of a call the deep read already understood).
 *   3. Degrade paths: no dossier / store down / no tenant = empty callOutcome, triage reads the
 *      messages alone, exactly as before.
 *
 * Pure — no network, no Postgres (the dossier store is stubbed in-place). ⚠ Synthetic content only.
 *
 * Run: node tests/wingguy-brief-recommendation.test.js
 */
const assert = require('assert');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const { formatBrief, gatherPersonContext } = require('../services/wingguyFollowupBrief');
const dossier = require('../services/wingguyDossier');

const row = {
  payload: {
    preparedAt: new Date().toISOString(),
    totalSurfaced: 4,
    counts: {},
    items: [
      { name: 'Nea Example', verdict: 'drop', whyLine: 'said not right now, app is months out',
        recommendation: "I'd drop her — loved the model but she's product-first and months from budget; let her come back to you",
        jog: 'Call 13 Aug went well, but she was clear she is not buying now.' },
      { name: 'Rex Reply', verdict: 'draft', whyLine: 'asked which podcast episode you meant',
        recommendation: "I'd answer him today — he asked a direct question and the thread is warm",
        draftText: 'Hi Rex, it was episode 12.', email: 'rex@example.com', replyToMessageId: 'm1', pushSubject: 'Re: podcast' },
      { name: 'Olive Oldpayload', verdict: 'draft', whyLine: 'she said the deck landed well', email: 'olive@example.com' },
      { name: 'Petra Park', verdict: 'park', whyLine: 'asked you to try again after the audit',
        recommendation: "I'd park her to mid-October — she asked you to come back after the audit",
        parkDate: '2099-10-15', parked: false, parkError: null },
    ],
  },
};

(async () => {
  const text = formatBrief(row);

  console.log('formatBrief() recommendation-first + drop pile');
  await check('drop verdict renders as a RECOMMENDED DROPS pile led by the advice line', () => {
    assert.ok(text.includes('RECOMMENDED DROPS (1)'));
    assert.ok(text.includes("Nea Example — I'd drop her — loved the model but she's product-first"));
    assert.ok(text.includes('jog: Call 13 Aug went well'));
  });
  await check('drop pile carries the nothing-automatic contract for the chat', () => {
    assert.ok(text.includes('never drop unconfirmed'));
    assert.ok(text.includes('a new message from them still surfaces'));
  });
  await check('draft line leads with the recommendation when the triage wrote one', () => {
    assert.ok(text.includes("Rex Reply — I'd answer him today — he asked a direct question"));
  });
  await check('pre-change payload (no recommendation) falls back to why_line', () => {
    assert.ok(text.includes('Olive Oldpayload — she said the deck landed well'));
  });
  await check('park renders as a recommendation to confirm, never a done deed', () => {
    assert.ok(text.includes('RECOMMENDED PARKS (1)'));
    assert.ok(text.includes("Petra Park — I'd park her to mid-October — she asked you to come back after the audit → park until 2099-10-15"));
    assert.ok(!text.includes('PARKED FOR YOU'));
  });

  console.log('gatherPersonContext() call-aware ground truth');
  const failMail = { findMessages: async () => ({ ok: false }) };
  const item = { key: 'nea@example.com', lead: { first: 'Nea', last: 'Example', email: 'nea@example.com', notes: '' } };
  const realGet = dossier.getDossierRow;
  const realFind = dossier.findDossierByName;

  dossier.getDossierRow = async (tenant, key) => (key === 'nea@example.com' ? {
    payload: {
      name: 'Nea Example',
      meetingRecaps: [{ date: '2099-08-13', about: 'First discovery call.', ended: 'She said she would read the material and come back; not actively looking now.' }],
      standing: 'Warm but resolved — ball in her court, her app is months from market.',
      commitmentsYou: ['Send the model email (13 Aug)'],
      commitmentsThem: ['Read the material and get back to you'],
      emailRecord: {
        outbound: [{ date: '2099-08-13', subject: 'Great to catch up today, Nea', links: ['https://example.com/a', 'https://example.com/b'] }],
        lastOutbound: { date: '2099-08-13', subject: 'Great to catch up today, Nea', text: 'Hi Nea, as promised here is the fuller picture of the model and the pricing links.' },
      },
    },
  } : null);
  dossier.findDossierByName = async () => null;
  try {
    const ctx = await gatherPersonContext(failMail, {}, item, 'guy-wilson');
    await check('call recap rides in with how the call was left', () => {
      assert.ok(ctx.callOutcome.some((l) => l.includes('CALL 2099-08-13') && l.includes('HOW IT WAS LEFT: She said she would read the material')));
    });
    await check('standing + both sides\' promises ride in', () => {
      assert.ok(ctx.callOutcome.some((l) => l.startsWith('WHERE IT STANDS: Warm but resolved')));
      assert.ok(ctx.callOutcome.some((l) => l.startsWith('COACH PROMISED: Send the model email')));
      assert.ok(ctx.callOutcome.some((l) => l.startsWith('THEY PROMISED: Read the material')));
    });
    await check('the sent-email record rides in with dates, subjects and link counts', () => {
      assert.ok(ctx.callOutcome.some((l) => l.includes('ALREADY SENT') && l.includes('2099-08-13 "Great to catch up today, Nea" [2 links in the body]')));
    });
    await check('the last outbound rides in as text — the delivered-promise evidence (Nea rerun 1 miss)', () => {
      assert.ok(ctx.callOutcome.some((l) => l.includes("THE COACH'S LAST EMAIL TO THEM") && l.includes('fuller picture of the model')));
    });

    dossier.getDossierRow = async () => { throw new Error('store down'); };
    const degraded = await gatherPersonContext(failMail, {}, item, 'guy-wilson');
    await check('dossier store down degrades to messages-only, never throws', () => {
      assert.deepEqual(degraded.callOutcome, []);
    });

    dossier.getDossierRow = async () => null;
    const noTenant = await gatherPersonContext(failMail, {}, item);
    await check('no tenant = no dossier lookup (old call shape still works)', () => {
      assert.deepEqual(noTenant.callOutcome, []);
    });
  } finally {
    dossier.getDossierRow = realGet;
    dossier.findDossierByName = realFind;
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
