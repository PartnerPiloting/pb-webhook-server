/**
 * Wingguy scoring MCP tools - "rebuild my scoring" from chat (2026-10-05).
 *
 * WHY: clients could only edit their scoring attributes one row at a time in the portal, and could
 * not test the result. Dean Hobin's rebuild (a ChatGPT brief -> a whole new set) showed the real job:
 * the client describes who they are looking for, the model drafts the WHOLE set, the client sees
 * exactly what would change, and only then is it written - backed up first, and tested after on a
 * sample of their own leads.
 *
 *   wingguy_scoring_get     - read the current set (summary or full text)
 *   wingguy_scoring_propose - check a proposed set; writes NOTHING; returns the changes + a fingerprint
 *   wingguy_scoring_commit  - write it (requires the fingerprint + an explicit yes), backup first
 *   wingguy_scoring_revert  - put back a backup (and back up what it replaces)
 *   wingguy_scoring_test    - "Test on sample": rescore N existing leads, write nothing, show the order
 *
 * Same LLM-proposes / code-writes / human-confirms split as the rules door (wingguyRulesMcp).
 * One definition, BOTH transports (same pattern as wingguyLeadsMcp).
 */

const { z } = require('zod');
const core = require('./scoringAttributes');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();

// The method, handed to the model with the tools. Guy's settled view (5 Oct 2026, Dean's rebuild).
const METHOD =
  ' HOW A GOOD SET IS BUILT: the score now decides the ORDER the client follows up new connections, not who gets a connection request - so (1) no minimums: set min_to_qualify 0, because a lead under a minimum scores 0 overall and loses its place; keep disqualifying negatives for people the client would genuinely never message. (2) Weight by what matters most: the final score is points awarded / points possible, so the attribute that defines their ideal person needs the biggest share of the points. A client\'s own weighting (e.g. "30% health alignment") maps straight onto max_points. (3) Few broad attributes beat many narrow ones - a long list of the client\'s ideas becomes the SIGNALS inside 4-6 main attributes. Nice-to-haves become bonus rows (bonus=true counts 25% in the total possible). (4) Every positive row gets: instructions (what to look for, strongest signals first) ending in score bands headed "Score bands" that cover the WHOLE range with a plain description per band; examples (3-4 short made-up profiles with the score each should get); signals (words and phrases to scan for, local terms included). (5) The scorer sees ONLY the profile headline, About section (often cut short) and job history - never posts or activity - so judge things like curiosity from how people describe their work and career moves, and don\'t lean on post-based signals. (6) The purpose row is the client\'s own statement - whose business this is, who they want to find and why, what a valuable conversation looks like, plus any guiding principles. It must NOT contain scoring mechanics (disqualifier check, formula, score bands): the scoring workflow is fixed in code and added after the purpose automatically, and a purpose that includes it is refused. The client can also edit the purpose themselves at the top of Settings > Profile Scoring Attributes in their portal. (7) Fixed slots: repurpose existing rows and switch unwanted ones off (active=false); you cannot add or delete rows. (8) CAMPAIGNS: when the client reaches two different audiences through different Linked Helper campaigns (e.g. two businesses), an attribute can count for some campaigns only - campaign_scope "only" + campaign_ids, or "except" + campaign_ids; "all" (the default) for everything else. A lead is scored only on the attributes that apply to its campaign, so its total possible is its own. Keep the shared attributes on all campaigns and scope only what is specific to one audience; every audience must keep at least one main attribute. Leads with no campaign (added by hand or the extension) get "all" and "except" rows only. Use the campaign NUMBERS wingguy_scoring_get lists - never guess one from a name. Clients with one campaign never need this - do not raise it with them. (9) WHAT-IF: wingguy_scoring_test can score a sample with a draft (the same purpose/rows a proposal takes) WITHOUT saving it - offer that before committing a change the client is unsure about.';

async function clientBase(tenant) {
  const clientService = require('./clientService');
  const client = await clientService.getClientById(tenant);
  if (!client || !client.airtableBaseId) return { error: "No leads base is set up for this client, so there are no scoring attributes to work on." };
  return { client, baseId: client.airtableBaseId, base: clientService.getClientBase(client.airtableBaseId) };
}

async function campaignsFor(tenant, base) {
  try {
    return (await require('./lhCampaignList').listCampaigns(tenant, { base, withLeads: true })).campaigns;
  } catch (_) {
    return [];
  }
}

function rowBlock(r, full, namesById = {}) {
  const kind = r.category.toLowerCase() === 'positive'
    ? `${r.bonus ? 'bonus, ' : ''}max ${r.maxPoints}${r.minToQualify ? `, min ${r.minToQualify}` : ''}`
    : (r.disqualifying ? 'disqualifying (score set to 0)' : `penalty ${r.penalty}`);
  const scope = r.campaignScope && r.campaignScope !== 'all' ? `, ${require('./campaignScope').describeScope({ mode: r.campaignScope, ids: r.campaignIds }, namesById)}` : '';
  const head = `${r.id} - ${r.heading} [${r.category}, ${r.active ? 'ON' : 'off'}, ${kind}${scope}]`;
  if (!full) return `${head}\n  ${core.shortText(r.instructions, 160)}`;
  return [
    head,
    `  Instructions:\n${r.instructions || '(empty)'}`,
    `  Examples:\n${r.examples || '(empty)'}`,
    `  Signals:\n${r.signals || '(empty)'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Executors - return { text, isError? }
// ---------------------------------------------------------------------------

async function runGet(args = {}, tenant = TENANT) {
  const c = await clientBase(tenant);
  if (c.error) return { text: c.error, isError: true };
  const { rows } = await core.readTable(c.base);
  const campaigns = await campaignsFor(tenant, c.base);
  const names = require('./lhCampaignList').namesById(campaigns);
  const full = args.detail === 'full';
  const purpose = rows.find(core.isPurpose);
  const scoring = rows.filter(core.isScoring);
  const live = campaigns.filter((x) => x.live);
  const out = [
    `SCORING ATTRIBUTES for ${tenant} - ${scoring.length} scoring rows (fixed slots).`,
    '',
    core.describeSet(rows, names),
    '',
    `PURPOSE (the client\'s own statement - the AI reads this first, then the fixed scoring workflow, then the rows):\n${purpose ? (purpose.instructions.trim() ? (full ? purpose.instructions : core.shortText(purpose.instructions, 400)) : '(empty - the scorer runs on the workflow and attributes alone; worth filling in)') : '(no purpose row)'}`,
    '',
    'ROWS:',
    ...scoring.map((r) => rowBlock(r, full, names)),
    '',
    live.length > 1
      ? `LINKED HELPER CAMPAIGNS (for campaign_ids - use the number): ${live.map((x) => `#${x.id} "${x.name}"${x.paused ? ' (paused)' : ''} - ${x.leads || 0} recent leads came in from it`).join('; ')}. A lead's campaign is the one that SENT it to Wingguy - often a profile-visiting campaign rather than the connect campaign - so scope attributes to the campaigns leads actually come in from, and check with the client which audience each one is.`
      : `LINKED HELPER CAMPAIGNS: ${live.length ? `one (#${live[0].id} "${live[0].name}")` : 'none known'} - campaign scope is not needed.`,
  ];
  if (!full) out.push('', 'For the complete text of every row (needed before drafting a rebuild), call again with detail="full".');
  return { text: out.join('\n') };
}

function proposalText(check, fp, namesById = {}) {
  const lines = [];
  const byRow = new Map();
  for (const ch of check.changes) {
    if (!byRow.has(ch.row.recordId)) byRow.set(ch.row.recordId, { row: ch.row, list: [] });
    byRow.get(ch.row.recordId).list.push(ch);
  }
  lines.push(`PROPOSAL - ${byRow.size} row${byRow.size === 1 ? '' : 's'} would change. Nothing has been written.`);
  for (const { row, list } of byRow.values()) {
    lines.push('', core.isPurpose(row) ? 'PURPOSE ROW' : `${row.id} - ${row.heading}`);
    for (const ch of list) {
      if (['instructions', 'examples', 'signals'].includes(ch.field)) {
        lines.push(`  ${core.LABEL[ch.field]} - new text:\n${ch.to || '(empty)'}`);
      } else {
        lines.push(`  ${core.LABEL[ch.field]}: ${core.fmt(ch.field, ch.from)} -> ${core.fmt(ch.field, ch.to)}`);
      }
    }
  }
  lines.push('', 'THE SET AFTER THIS CHANGE:', core.describeSet(check.after, namesById));
  if (check.warnings.length) lines.push('', 'WARNINGS:', ...check.warnings.map((w) => `- ${w}`));
  lines.push('', `fingerprint=${fp}`);
  lines.push('Show this to the human - the full new text, not a summary - and get an explicit yes. Then call wingguy_scoring_commit with the SAME purpose and rows plus this fingerprint. A backup of the current rows is saved automatically before anything is written.');
  return lines.join('\n');
}

async function runPropose(args = {}, tenant = TENANT) {
  const c = await clientBase(tenant);
  if (c.error) return { text: c.error, isError: true };
  const { rows } = await core.readTable(c.base);
  const campaigns = await campaignsFor(tenant, c.base);
  const check = core.checkProposal(rows, args, { campaigns });
  if (check.errors.length) return { text: `The proposal can't be used as it stands:\n${check.errors.map((e) => `- ${e}`).join('\n')}`, isError: true };
  if (!check.changes.length) return { text: 'Nothing in this proposal differs from what is already in the table - there is nothing to write.' };
  return { text: proposalText(check, core.fingerprint(rows), require('./lhCampaignList').namesById(campaigns)) };
}

async function runCommit(args = {}, tenant = TENANT) {
  const c = await clientBase(tenant);
  if (c.error) return { text: c.error, isError: true };
  const { rows, kinds } = await core.readTable(c.base);
  const fp = core.fingerprint(rows);
  if (!args.fingerprint || String(args.fingerprint).trim() !== fp) {
    return { text: 'Refused: the attributes have changed since that proposal (or no fingerprint was given). Run wingguy_scoring_propose again and show the human the fresh result.', isError: true };
  }
  const campaigns = await campaignsFor(tenant, c.base);
  const check = core.checkProposal(rows, args, { campaigns });
  if (check.errors.length) return { text: `Refused:\n${check.errors.map((e) => `- ${e}`).join('\n')}`, isError: true };
  if (!check.changes.length) return { text: 'Nothing to write - the table already matches.' };

  const changed = core.touchedRows(check.changes);
  const before = rows.filter((r) => changed.some((x) => x.recordId === r.recordId));
  const store = require('./scoringBackupStore');
  let backup;
  try {
    backup = await store.saveBackup({ tenantId: tenant, baseId: c.baseId, reason: 'before wingguy_scoring_commit', rows: before });
  } catch (e) {
    return { text: `Not written: the backup could not be saved (${e.message}), and a change is never made without one.`, isError: true };
  }

  await core.writeRows(c.base, core.buildWrites(changed, kinds, require('./lhCampaignList').namesById(campaigns)));
  try { require('../attributeLoader').clearAttributeCache(); } catch (_) { /* cache clears itself within 10 min */ }
  try { require('./rescoreRunner').forgetBaseline(tenant); } catch (_) { /* in-memory only */ }

  return {
    text: [
      `Written: ${changed.length} row${changed.length === 1 ? '' : 's'} updated. Backup #${backup.id} holds the previous version (wingguy_scoring_revert puts it back).`,
      '',
      core.describeSet(check.after, require('./lhCampaignList').namesById(campaigns)),
      '',
      'New leads are scored with this from now on. Leads already scored keep their old score until rescored. Next step: offer wingguy_scoring_test to rescore a sample of their existing leads and see who comes out on top - before re-scoring everyone in the portal.',
    ].join('\n'),
  };
}

async function runRevert(args = {}, tenant = TENANT) {
  const store = require('./scoringBackupStore');
  if (!args.backup_id) {
    const list = await store.listBackups(tenant, 5);
    if (!list.length) return { text: 'There are no saved backups of the scoring attributes yet.' };
    return { text: `Saved backups (newest first):\n${list.map((b) => `- #${b.id} - ${new Date(b.at).toISOString().slice(0, 16).replace('T', ' ')} UTC - ${b.row_count} rows - ${b.reason}`).join('\n')}\nTo restore one, call again with backup_id - after the human confirms which.` };
  }
  const c = await clientBase(tenant);
  if (c.error) return { text: c.error, isError: true };
  const bk = await store.getBackup(tenant, Number(args.backup_id));
  if (!bk) return { text: `No backup #${args.backup_id} for this client.`, isError: true };
  if (bk.base_id !== c.baseId) return { text: `Backup #${bk.id} was taken from a different leads base, so it can't be restored here.`, isError: true };

  const { rows, kinds } = await core.readTable(c.base);
  const restoreIds = new Set(bk.rows.map((r) => r.recordId));
  const current = rows.filter((r) => restoreIds.has(r.recordId));
  const missing = bk.rows.filter((r) => !rows.some((x) => x.recordId === r.recordId));
  let undo;
  try {
    undo = await store.saveBackup({ tenantId: tenant, baseId: c.baseId, reason: `before restoring backup #${bk.id}`, rows: current });
  } catch (e) {
    return { text: `Not restored: the current rows could not be backed up first (${e.message}).`, isError: true };
  }
  // Putting back a row whose campaign scope differs from what is there now has to write the scope too
  // (buildWrites leaves it out otherwise, for bases without the fields).
  const toWrite = bk.rows.filter((r) => restoreIds.has(r.recordId) && !missing.includes(r)).map((r) => {
    const now = current.find((x) => x.recordId === r.recordId);
    const scopeOf = (x) => JSON.stringify([x && x.campaignIds && x.campaignIds.length ? x.campaignScope : 'all', (x && x.campaignIds) || []]);
    return now && scopeOf(now) !== scopeOf(r) ? { ...r, scopeTouched: true } : r;
  });
  await core.writeRows(c.base, core.buildWrites(toWrite, kinds));
  try { require('../attributeLoader').clearAttributeCache(); } catch (_) { /* clears itself */ }
  try { require('./rescoreRunner').forgetBaseline(tenant); } catch (_) { /* in-memory only */ }
  const after = rows.map((r) => toWrite.find((x) => x.recordId === r.recordId) || r);
  return {
    text: [
      `Restored backup #${bk.id}: ${toWrite.length} row${toWrite.length === 1 ? '' : 's'} put back.${missing.length ? ` ${missing.length} row(s) in the backup no longer exist and were skipped.` : ''} What was there before is saved as backup #${undo.id}.`,
      '',
      core.describeSet(after),
    ].join('\n'),
  };
}

function testResultText(job) {
  const r = job.result;
  const rows = (r.rows || []).filter((x) => typeof x.new === 'number');
  const byNew = [...rows].sort((a, b) => b.new - a.new);
  const lines = r.draft ? [
    `WHAT-IF COMPLETE - ${r.count} existing leads scored with the DRAFT attributes. The draft is NOT saved, and no score was saved.`,
  ] : [
    `TEST COMPLETE - ${r.count} existing leads rescored with the current attributes. Nothing was saved; their stored scores are unchanged.`,
    `Moved up: ${r.summary.movedUp}, moved down: ${r.summary.movedDown} (compared with their stored scores).`,
  ];
  if (r.comparedToPreviousTest && r.summary.vsPreviousTest) {
    const v = r.summary.vsPreviousTest;
    lines.push(r.draft
      ? `Compared with the SAVED attributes on the same leads: ${v.movedUp} up, ${v.movedDown} down, ${v.unchanged} unchanged - that difference is purely the draft.`
      : `Compared with the previous test on the same leads: ${v.movedUp} up, ${v.movedDown} down, ${v.unchanged} unchanged - that difference is purely the attribute change.`);
  }
  lines.push('', 'TOP OF THE ORDER NOW (new score, stored score in brackets):');
  for (const x of byNew.slice(0, 15)) lines.push(`  ${Math.round(x.new)} - ${x.name}${typeof x.old === 'number' ? ` (was ${Math.round(x.old)})` : ''}`);
  lines.push('', 'BOTTOM OF THE ORDER:');
  for (const x of byNew.slice(-5)) lines.push(`  ${Math.round(x.new)} - ${x.name}${typeof x.old === 'number' ? ` (was ${Math.round(x.old)})` : ''}`);
  lines.push('', `Credits left: ${r.credits.available}.`);
  if (r.draft) lines.push('Ask the human whether this order is better than what they have now. If yes, the same purpose/rows go to wingguy_scoring_propose then commit (nothing is saved until then). If not, change the draft and run the what-if again - it is compared with the saved attributes on the same leads each time.');
  else lines.push('Ask the human whether the top of the order looks like the people they most want to talk to. If not, adjust the attributes (propose -> commit) and test again - the same sample is used, so the next test shows exactly what the change did. When they are happy, applying it to all their leads is "Re-score & apply" in Settings in their portal.');
  return lines.join('\n');
}

async function runTest(args = {}, tenant = TENANT) {
  const runner = require('./rescoreRunner');
  if (args.job_id) {
    const job = runner.getJob(String(args.job_id));
    if (!job || job.clientId !== tenant) return { text: 'That test was not found - it may have expired (tests are kept for an hour) or the server restarted. Start a new one.', isError: true };
    if (job.status === 'running') return { text: `Still running: ${job.done} of ${job.total} leads scored. Check again in a minute or two with the same job_id.` };
    if (job.status === 'error') return { text: `The test failed: ${job.error}`, isError: true };
    return { text: testResultText(job) };
  }
  const r = await runner.resolveClient(tenant);
  if (r.error) {
    const why = r.code === 403 ? "Testing isn't switched on for this account yet - ask Guy to turn on Re-score." : r.error;
    return { text: why, isError: true };
  }
  const size = Math.max(5, Math.min(runner.SAMPLE_MAX, parseInt(args.size, 10) || runner.SAMPLE_DEFAULT));
  // What-if: a draft (the same purpose/rows a proposal takes), scored without being saved.
  let attributeSet = null;
  const isDraft = (typeof args.purpose === 'string' && args.purpose.trim()) || (Array.isArray(args.rows) && args.rows.length);
  if (isDraft) {
    const { rows } = await core.readTable(r.base);
    const check = core.checkProposal(rows, args, { campaigns: await campaignsFor(tenant, r.base) });
    if (check.errors.length) return { text: `The draft can't be tested as it stands:\n${check.errors.map((e) => `- ${e}`).join('\n')}`, isError: true };
    if (!check.changes.length) return { text: 'That draft is the same as the saved attributes - run the test without a draft instead.' };
    const loader = require('../attributeLoader');
    attributeSet = loader.buildAttributeSet(loader.rowsAsRecords(check.after));
  }
  const out = await runner.startRun(r, { mode: 'preview', scope: 'sample', size, attributeSet });
  if (out.empty) return { text: 'There are no scored leads yet to test against.' };
  if (out.insufficient) return { text: `Not enough credits for this test - it needs ${out.needed} (${out.available} left). Try a smaller size.`, isError: true };
  if (attributeSet) {
    return { text: `What-if started: ${out.total} of their existing leads, scored with the DRAFT${out.creditsNeeded > out.total ? ' (and first with the saved attributes, so the two can be compared - that uses the sample twice)' : ''}. Nothing is saved - not the draft, not any score. ${out.creditsNeeded} credits. Call wingguy_scoring_test again with job_id="${out.jobId}" in a few minutes for the result.` };
  }
  return { text: `Test started: rescoring ${out.total} of their existing leads (a spread from low to high scores) with the current attributes. Nothing is saved. It takes a few minutes - call wingguy_scoring_test again with job_id="${out.jobId}" to get the result.` };
}

// ---------------------------------------------------------------------------
// Tool definitions (one shape, both transports)
// ---------------------------------------------------------------------------

const rowZod = z.object({
  id: z.string().describe('The existing row id, e.g. "A", "N5", "L1".'),
  heading: z.string().optional(),
  active: z.boolean().optional().describe('false switches the row off (the scorer ignores it).'),
  max_points: z.number().optional().describe('Positive rows only: the most a lead can get on this row.'),
  min_to_qualify: z.number().optional().describe('Positive rows only. Normally 0 - see the method.'),
  bonus: z.boolean().optional().describe('Positive rows only: counts 25% in the total possible.'),
  penalty: z.number().optional().describe('Negative rows only: points taken off.'),
  disqualifying: z.boolean().optional().describe('Negative rows only: true sets the whole score to 0.'),
  instructions: z.string().optional().describe('What to look for, ending in "Score bands" covering the whole range.'),
  examples: z.string().optional().describe('3-4 short made-up profiles with the score each should get.'),
  signals: z.string().optional().describe('Words and phrases to scan the profile for.'),
  campaign_scope: z.enum(['all', 'only', 'except']).optional().describe('Which Linked Helper campaigns the row counts for: "all" (default), "only" the listed ones, or all "except" the listed ones.'),
  campaign_ids: z.array(z.number()).optional().describe('The Linked Helper campaign NUMBERS for "only" / "except", as wingguy_scoring_get lists them.'),
});
const rowJson = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'The existing row id, e.g. "A", "N5", "L1".' },
    heading: { type: 'string' },
    active: { type: 'boolean', description: 'false switches the row off (the scorer ignores it).' },
    max_points: { type: 'number', description: 'Positive rows only: the most a lead can get on this row.' },
    min_to_qualify: { type: 'number', description: 'Positive rows only. Normally 0 - see the method.' },
    bonus: { type: 'boolean', description: 'Positive rows only: counts 25% in the total possible.' },
    penalty: { type: 'number', description: 'Negative rows only: points taken off.' },
    disqualifying: { type: 'boolean', description: 'Negative rows only: true sets the whole score to 0.' },
    instructions: { type: 'string', description: 'What to look for, ending in "Score bands" covering the whole range.' },
    examples: { type: 'string', description: '3-4 short made-up profiles with the score each should get.' },
    signals: { type: 'string', description: 'Words and phrases to scan the profile for.' },
    campaign_scope: { type: 'string', enum: ['all', 'only', 'except'], description: 'Which Linked Helper campaigns the row counts for: "all" (default), "only" the listed ones, or all "except" the listed ones.' },
    campaign_ids: { type: 'array', items: { type: 'number' }, description: 'The Linked Helper campaign NUMBERS for "only" / "except", as wingguy_scoring_get lists them.' },
  },
  required: ['id'],
};
const setZod = {
  purpose: z.string().optional().describe('The full new purpose statement: who the client is looking for and why, in their words. Statement only - no scoring steps, formula or bands (those are fixed and added by code). Omit to leave it unchanged.'),
  rows: z.array(rowZod).optional().describe('Only the rows that change, each with only the fields that change.'),
};
const setJson = {
  purpose: { type: 'string', description: 'The full new purpose statement: who the client is looking for and why, in their words. Statement only - no scoring steps, formula or bands (those are fixed and added by code). Omit to leave it unchanged.' },
  rows: { type: 'array', items: rowJson, description: 'Only the rows that change, each with only the fields that change.' },
};

const TOOL_DEFS = [
  {
    name: 'wingguy_scoring_get',
    description: 'Read the client\'s LEAD SCORING ATTRIBUTES - what every new LinkedIn connection is scored against, which decides the order they follow people up. START HERE for "rebuild my scoring", "change my scoring attributes", "here\'s who I\'m looking for - set up my scoring", "why did this person score low?", "what am I scoring on?". Default is a summary; use detail="full" before drafting any rebuild, so the new set is written against the real current text.' + METHOD,
    zodSchema: { detail: z.enum(['summary', 'full']).optional().describe('"full" returns the complete instructions, examples and signals of every row.') },
    jsonSchema: { type: 'object', properties: { detail: { type: 'string', enum: ['summary', 'full'], description: '"full" returns the complete instructions, examples and signals of every row.' } }, required: [] },
    run: runGet,
  },
  {
    name: 'wingguy_scoring_propose',
    description: 'STEP 1 of changing the scoring attributes - a pure check, writes NOTHING. Pass the new purpose text and/or the rows that change (only the fields that change). Returns exactly what would change, the whole set afterwards, any warnings, and the fingerprint wingguy_scoring_commit needs. Draft from the client\'s own words (a brief, a pasted list, or a conversation) - turn a long list of their ideas into signals inside a few weighted rows rather than one row each. Show the human the result in full and get an explicit yes before committing.' + METHOD,
    zodSchema: setZod,
    jsonSchema: { type: 'object', properties: setJson, required: [] },
    run: runPropose,
  },
  {
    name: 'wingguy_scoring_commit',
    description: 'STEP 2 - the write. Only after wingguy_scoring_propose AND the human explicitly saying yes. Pass the SAME purpose and rows as the proposal plus its fingerprint; if the table changed since, it is refused (propose again). Saves a backup of the rows it replaces first, then writes. Afterwards, offer wingguy_scoring_test.',
    zodSchema: { ...setZod, fingerprint: z.string().describe('The fingerprint wingguy_scoring_propose returned.') },
    jsonSchema: { type: 'object', properties: { ...setJson, fingerprint: { type: 'string', description: 'The fingerprint wingguy_scoring_propose returned.' } }, required: ['fingerprint'] },
    run: runCommit,
  },
  {
    name: 'wingguy_scoring_revert',
    description: 'Undo a scoring-attribute change: with no backup_id it lists the saved backups; with backup_id it puts those rows back (after the human confirms which), saving what it replaces as a new backup so the undo can itself be undone.',
    zodSchema: { backup_id: z.number().optional().describe('The backup number to restore. Omit to list backups.') },
    jsonSchema: { type: 'object', properties: { backup_id: { type: 'number', description: 'The backup number to restore. Omit to list backups.' } }, required: [] },
    run: runRevert,
  },
  {
    name: 'wingguy_scoring_test',
    description: '"Test on sample" from chat: rescores a spread of the client\'s EXISTING leads and shows the new order - who comes out on top and bottom - WITHOUT saving any score. Two ways: (1) no purpose/rows = the CURRENT saved attributes (after a commit, or "is my scoring right?"); (2) WHAT-IF - pass purpose and/or rows exactly as for wingguy_scoring_propose, and the sample is scored with that DRAFT while the saved attributes stay untouched ("what if I changed X?", "try it before I save"); the result is compared with the saved attributes on the same leads, so it shows purely what the draft would do. Starting returns a job_id; call again with that job_id after a minute or two for the result. Costs credits (1 per lead) from their Re-score allowance - a what-if with no earlier test on the same sample scores it twice. Applying new scores to all leads stays in the portal ("Re-score & apply").',
    zodSchema: {
      size: z.number().optional().describe('How many leads to test (default 50, max 100).'),
      job_id: z.string().optional().describe('To fetch a running or finished test\'s result.'),
      ...setZod,
    },
    jsonSchema: {
      type: 'object',
      properties: {
        size: { type: 'number', description: 'How many leads to test (default 50, max 100).' },
        job_id: { type: 'string', description: 'To fetch a running or finished test\'s result.' },
        ...setJson,
      },
      required: [],
    },
    run: runTest,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters (same shape as wingguyLeadsMcp)
// ---------------------------------------------------------------------------

function registerWingguyScoringTools(server, tenant = TENANT) {
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { title: def.name.replace(/_/g, ' '), description: def.description, inputSchema: def.zodSchema },
      async (args) => {
        try {
          const out = await def.run(args || {}, tenant);
          return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
        }
      },
    );
  }
}

function legacyToolList() {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.jsonSchema }));
}

async function legacyToolCall(toolName, args, tenant = TENANT) {
  const def = TOOL_DEFS.find((d) => d.name === toolName);
  if (!def) return null;
  try {
    const out = await def.run(args || {}, tenant);
    return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

// Client phrases a client is told to type, stamped into their tool's description
// (content/client-phrases.json). Must run before export - see utils/clientPhrases.js for the why.
require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerWingguyScoringTools, legacyToolList, legacyToolCall, TOOL_DEFS, runGet, runPropose, runCommit, runRevert, runTest };
