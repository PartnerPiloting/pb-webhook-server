/**
 * Campaign-scoped scoring attributes + the what-if test (2026-10-23, Sam Noble).
 *
 *   node tests/campaign-scope.test.js
 *
 * Checks, with no network:
 *   - services/campaignScope.js: reading the cells, who an attribute applies to, campaign off a lead
 *   - attributeLoader.buildAttributeSet: a set with no scoped row is unchanged (no scopes key in the
 *     prompt), and forCampaign() hands that SAME object back
 *   - draft rows (rowsAsRecords) build exactly the set the table would
 *   - services/scoringAttributes.js: checking and writing a scope
 *   - batchScorer.scoreRecordsNow with a fake model: a chunk of mixed campaigns is scored campaign by
 *     campaign, each call sees only its campaign's attributes, and each lead's total possible
 *     counts only those
 */

process.env.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'test';
process.env.AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appTESTTESTTESTTE';
delete process.env.SCORING_PROVIDER; // the Gemini path, with the fake client below

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}`);
  if (!ok) failures++;
}

const scope = require('../services/campaignScope');
const loader = require('../attributeLoader');
const core = require('../services/scoringAttributes');
const { computeFinalScore } = require('../scoring');

// ---------------------------------------------------------------- campaignScope
check('blank cells = all campaigns', scope.scopeFromCells(null, null).mode === 'all');
check('Only + "6 - Barclayss" reads campaign 6', JSON.stringify(scope.scopeFromCells('Only these campaigns', '6 - Barclayss - Reach out')) === JSON.stringify({ mode: 'only', ids: [6] }));
check('several campaigns, any separator, sorted', JSON.stringify(scope.scopeFromCells({ name: 'All except these campaigns' }, '9 - FMF\n6 - Barclayss; 9')) === JSON.stringify({ mode: 'except', ids: [6, 9] }));
check('Only with no campaign listed reads as all (never silently switches a row off)', scope.scopeFromCells('Only these campaigns', '').mode === 'all');
const only6 = { mode: 'only', ids: [6] };
const except6 = { mode: 'except', ids: [6] };
check('only: applies to its campaign', scope.appliesTo(only6, 6) === true);
check('only: not to another campaign', scope.appliesTo(only6, 9) === false);
check('only: not to a lead with no campaign', scope.appliesTo(only6, null) === false);
check('except: not to the listed campaign', scope.appliesTo(except6, 6) === false);
check('except: to a campaign started later', scope.appliesTo(except6, 42) === true);
check('except: to a lead with no campaign', scope.appliesTo(except6, null) === true);
check('campaign off Raw Profile Data (JSON string)', scope.campaignIdOf(JSON.stringify({ campaign_id: 6, campaign_name: 'Barclayss - Reach out' })) === 6);
check('campaign off a clipped cell', scope.campaignIdOf('{"x":1,"campaign_id":6,"campaign_name":"Barcl') === 6);
check('no campaign = null', scope.campaignIdOf(JSON.stringify({ campaign_name: '' })) === null && scope.campaignIdOf('') === null);

// ---------------------------------------------------------------- buildAttributeSet / forCampaign
const rec = (f) => ({ id: f.rid, get: (k) => f[k] });
const plainRecs = [
  rec({ rid: 'r0', 'Attribute Id': 'PREAMBLE', Category: 'Meta', Instructions: 'Find safety leaders.' }),
  rec({ rid: 'r1', 'Attribute Id': 'A', Category: 'Positive', Heading: 'Decision maker', Active: true, 'Max Points': 20, Instructions: 'Seniority.' }),
  rec({ rid: 'r2', 'Attribute Id': 'B', Category: 'Positive', Heading: 'Safety leader', Active: true, 'Max Points': 20, Instructions: 'HSE.' }),
  rec({ rid: 'r3', 'Attribute Id': 'C', Category: 'Positive', Heading: 'Small business owner', Active: true, 'Max Points': 20, Instructions: 'Owner.' }),
  rec({ rid: 'r4', 'Attribute Id': 'N1', Category: 'Negative', Heading: 'Recruiter', Active: true, Penalty: 5, Instructions: 'Recruiters.' }),
];
const plain = loader.buildAttributeSet(plainRecs);
check('no scoped row: no scopes', Object.keys(plain.scopes).length === 0);
check('no scoped row: forCampaign returns the SAME set (scoring unchanged)', scope.forCampaign(plain, 6) === plain && scope.forCampaign(plain, null) === plain);

const scopedRecs = plainRecs.map((r) => {
  const id = r.get('Attribute Id');
  if (id === 'B') return rec({ ...Object.fromEntries(['rid', 'Attribute Id', 'Category', 'Heading', 'Active', 'Max Points', 'Instructions'].map((k) => [k, k === 'rid' ? 'r2' : r.get(k)])), 'Campaign Scope': 'Only these campaigns', 'Scope Campaigns': '6 - Barclayss - Reach out' });
  if (id === 'C') return rec({ ...Object.fromEntries(['rid', 'Attribute Id', 'Category', 'Heading', 'Active', 'Max Points', 'Instructions'].map((k) => [k, k === 'rid' ? 'r3' : r.get(k)])), 'Campaign Scope': 'All except these campaigns', 'Scope Campaigns': '6 - Barclayss - Reach out' });
  return r;
});
const scoped = loader.buildAttributeSet(scopedRecs);
check('scoped rows recorded', JSON.stringify(scoped.scopes) === JSON.stringify({ B: only6, C: except6 }));
const forBarclayss = scope.forCampaign(scoped, 6);
const forFmf = scope.forCampaign(scoped, 9);
const forNone = scope.forCampaign(scoped, null);
check('Barclayss leads: A + B, not C', Object.keys(forBarclayss.positives).join() === 'A,B');
check('other campaign: A + C', Object.keys(forFmf.positives).join() === 'A,C');
check('no campaign: A + C', Object.keys(forNone.positives).join() === 'A,C');
check('the narrowed set never carries scopes into the prompt', forBarclayss.scopes === undefined && !JSON.stringify(forBarclayss.positives).includes('only'));
check('narrowed set keeps the preamble and the negatives', forBarclayss.preamble === 'Find safety leaders.' && !!forBarclayss.negatives.N1);
const pct = (set, pos) => computeFinalScore({ ...pos }, set.positives, {}, set.negatives, false, []);
check('total possible is per lead: a perfect Barclayss lead is 100%, not dragged down by C', pct(forBarclayss, { A: 20, B: 20 }).percentage === 100);
check('total possible is per lead: a perfect Find Me First lead is 100%, not dragged down by B', pct(forFmf, { A: 20, C: 20 }).percentage === 100);

// draft rows -> the same set the table would give
const rows = scopedRecs.map(core.normalize);
const fromDraft = loader.buildAttributeSet(loader.rowsAsRecords(rows));
check('draft rows build exactly the table\'s set (prompt + scopes)', JSON.stringify(fromDraft) === JSON.stringify(scoped));
check('draft rows of an unscoped table build the same set too', JSON.stringify(loader.buildAttributeSet(loader.rowsAsRecords(plainRecs.map(core.normalize)))) === JSON.stringify(plain));

// ---------------------------------------------------------------- scoringAttributes
const ctx = { campaigns: [{ id: 6, name: 'Barclayss - Reach out' }, { id: 9, name: 'Find Me First' }] };
let c = core.checkProposal(plainRecs.map(core.normalize), { rows: [{ id: 'B', campaign_scope: 'only', campaign_ids: [6] }] }, ctx);
check('a scope change is a change', !c.errors.length && c.changes.map((x) => x.field).join() === 'campaignScope,campaignIds');
let w = core.buildWrites(core.touchedRows(c.changes), {}, { 6: 'Barclayss - Reach out' })[0].fields;
check('written as the select label + "6 - name"', w['Campaign Scope'] === 'Only these campaigns' && w['Scope Campaigns'] === '6 - Barclayss - Reach out');
c = core.checkProposal(rows, { rows: [{ id: 'B', campaign_scope: 'all' }] }, ctx);
w = core.buildWrites(core.touchedRows(c.changes), {})[0].fields;
check('back to all clears both cells', w['Campaign Scope'] === null && w['Scope Campaigns'] === '');
c = core.checkProposal(plainRecs.map(core.normalize), { rows: [{ id: 'A', heading: 'Senior decision maker' }] });
w = core.buildWrites(core.touchedRows(c.changes), {})[0].fields;
check('an ordinary edit never writes the scope cells (bases without the fields keep saving)', !('Campaign Scope' in w) && !('Scope Campaigns' in w));
c = core.checkProposal(rows, { rows: [{ id: 'B', campaign_scope: 'only', campaign_ids: [] }] });
check('Only with no campaign is refused', c.errors.length === 1);
c = core.checkProposal(rows, { rows: [{ id: 'A', campaign_scope: 'only', campaign_ids: [6] }, { id: 'C', campaign_scope: 'only', campaign_ids: [6] }] }, ctx);
check('warns when an audience is left with no main attribute', c.warnings.some((x) => /no positive attribute applies to/i.test(x)));
c = core.checkProposal(rows, { rows: [{ id: 'B', campaign_ids: [6, 77] }] }, ctx);
check('warns about a tag that matches no live campaign', c.warnings.some((x) => /#77/.test(x)));
c = core.checkProposal(rows, { rows: [{ id: 'B', campaign_ids: ['six'] }] });
check('refuses something that is not a campaign number', c.errors.length === 1);
check('portal form payload carries the scope', JSON.stringify(core.portalProposal(rows[2], { campaignScope: 'except', campaignIds: [6] })).includes('"campaign_scope":"except"'));

// ---------------------------------------------------------------- batchScorer with a fake model
(async () => {
  const calls = [];
  const fakeModel = {
    getGenerativeModel: ({ systemInstruction }) => ({
      generateContent: async (payload) => {
        const sys = systemInstruction.parts[0].text;
        const leads = JSON.parse(payload.contents[0].parts[0].text.replace(/^[\s\S]*?The leads are: /, '')).leads;
        const sees = ['A', 'B', 'C'].filter((id) => sys.includes(`"${id}": {`));
        calls.push({ sees, n: leads.length });
        // Full marks on every attribute the prompt offered.
        const out = leads.map(() => ({
          positive_scores: Object.fromEntries(sees.map((id) => [id, 20])),
          negative_scores: {}, attribute_reasoning: {}, contact_readiness: false, unscored_attributes: [],
          aiProfileAssessment: 'x', ai_excluded: 'No', exclude_details: '',
        }));
        return { response: { usageMetadata: { totalTokenCount: 1 }, candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] } };
      },
    }),
  };
  const lead = (id, campaignId) => rec({
    rid: id,
    'Profile Full JSON': JSON.stringify({ headline: 'Head of Safety', about: 'Leads safety across sites in WA mining for many years.', experience: [{ title: 'HSE Manager', company: 'Mine Co' }] }),
    'Raw Profile Data': JSON.stringify(campaignId ? { campaign_id: campaignId, campaign_name: `C${campaignId}` } : {}),
    'First Name': id,
  });
  const batchScorer = require('../batchScorer');
  try {
    const res = await batchScorer.scoreRecordsNow({
      records: [lead('l1', 6), lead('l2', 9), lead('l3', 6), lead('l4', null)],
      clientId: 'TEST', clientBase: () => ({ update: async () => {} }),
      dependencies: { vertexAIClient: fakeModel, geminiModelId: 'fake-model' },
      persist: false, attributeSet: scoped,
    });
    const seen = calls.map((x) => `${x.sees.join('')}x${x.n}`).sort().join(' ');
    check('mixed chunk scored campaign by campaign: Barclayss call sees A+B, the rest see A+C', seen === 'ABx2 ACx1 ACx1');
    const byId = Object.fromEntries((res.perLead || []).map((p) => [p.recordId, p.newScore]));
    check('every lead full marks on ITS attributes = 100 (per-lead total possible)', ['l1', 'l2', 'l3', 'l4'].every((id) => byId[id] === 100));
  } catch (e) {
    check(`batchScorer run (${e.message})`, false);
  }
  try {
    await batchScorer.scoreRecordsNow({ records: [], clientId: 'TEST', clientBase: () => ({}), dependencies: { vertexAIClient: fakeModel, geminiModelId: 'x' }, persist: true, attributeSet: scoped });
    check('a draft set can never be written to leads', false);
  } catch (e) {
    check('a draft set can never be written to leads', /preview-only/.test(e.message));
  }

  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
