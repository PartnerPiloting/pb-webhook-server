/**
 * wingguy_code_jobs - the hand-off list from Claude Chat to Claude Code.
 *
 * WHY (Guy, 20 Nov 2026): Guy plans in Claude Chat with the Wingguy connector, and jobs keep coming
 * up there that only Claude Code can do - a new piece for the weekly-email library, a line in the
 * onboarding script, a sweep of his old group emails. Chat cannot write to the repo. Until now the
 * job went by email and Guy pasted it in, and jobs got lost. The two Claudes do NOT share a memory
 * (Chat's lives on claude.ai, Code's is files on Guy's PC - checked 20 Nov), but both reach this
 * connector. So the list lives here, in Postgres:
 *
 *   - Chat files a job ("send that to Claude Code") with everything Code needs to do it without
 *     going back to Guy: the exact wording and whether Guy approved it, when it should be used, the
 *     source emails, what to avoid, how to tell it is done.
 *   - Claude Code reads the list at the start of every session in the Wingguy repo (a SessionStart
 *     hook in .claude/settings.json tells it to), shows Guy what is waiting, and ticks each job off
 *     with a note of what changed - which Chat can then read back to him.
 *   - The Monday email review and "go through my inbox" add one line when jobs are waiting, so the
 *     list is in front of Guy even on days he does not open Claude Code.
 *
 * OWNER ONLY. These jobs are Guy's own build notes; the tool is registered only for the owner
 * tenant, so no client's Claude ever sees it.
 *
 * One definition, both transports (same shape as machineClipboardMcp).
 */
const { z } = require('zod');

const OWNER = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const KINDS = ['library_email', 'onboarding_script', 'playbook', 'research', 'code', 'other'];
const KIND_WORDS = {
  library_email: 'weekly-email library piece',
  onboarding_script: 'onboarding script',
  playbook: 'playbook topic',
  research: 'research',
  code: 'code change',
  other: 'other',
};
const STALE_DAYS = 3;
const MS_DAY = 86400000;

// ---------------------------------------------------------------------------
// Store (Postgres). Injected in tests.
// ---------------------------------------------------------------------------

let pool;
function getPool() {
  if (pool) return pool;
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return pool;
}

let schemaReady = false;
async function q(sql, params) {
  const p = getPool();
  if (!p) throw new Error('the database is not configured (DATABASE_URL)');
  if (!schemaReady) {
    await p.query(`
      CREATE TABLE IF NOT EXISTS wingguy_code_jobs (
        id          SERIAL PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        status      TEXT NOT NULL DEFAULT 'open',
        kind        TEXT NOT NULL DEFAULT 'other',
        title       TEXT NOT NULL,
        payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
        closed_at   TIMESTAMPTZ,
        close_note  TEXT
      );
      CREATE INDEX IF NOT EXISTS wingguy_code_jobs_open ON wingguy_code_jobs (tenant_id, status);
    `);
    schemaReady = true;
  }
  return p.query(sql, params);
}

const pgStore = {
  async list(tenant, { all = false } = {}) {
    const r = await q(
      `SELECT * FROM wingguy_code_jobs WHERE tenant_id = $1 ${all ? '' : "AND status = 'open'"}
       ORDER BY (status = 'open') DESC, id ASC LIMIT 100`, [tenant]);
    return r.rows;
  },
  async get(tenant, id) {
    const r = await q('SELECT * FROM wingguy_code_jobs WHERE tenant_id = $1 AND id = $2', [tenant, id]);
    return r.rows[0] || null;
  },
  async add(tenant, { kind, title, payload }) {
    const r = await q(
      `INSERT INTO wingguy_code_jobs (tenant_id, kind, title, payload) VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenant, kind, title, JSON.stringify(payload)]);
    return r.rows[0];
  },
  async update(tenant, id, { payload, kind, title }) {
    const r = await q(
      `UPDATE wingguy_code_jobs SET payload = $3, kind = $4, title = $5, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenant, id, JSON.stringify(payload), kind, title]);
    return r.rows[0] || null;
  },
  async close(tenant, id, status, note) {
    const r = await q(
      `UPDATE wingguy_code_jobs SET status = $3, close_note = $4, closed_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenant, id, status, note]);
    return r.rows[0] || null;
  },
  async reopen(tenant, id) {
    const r = await q(
      `UPDATE wingguy_code_jobs SET status = 'open', close_note = NULL, closed_at = NULL, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`, [tenant, id]);
    return r.rows[0] || null;
  },
};

// ---------------------------------------------------------------------------
// Pure helpers (tested in tests/wingguy-code-jobs.test.js)
// ---------------------------------------------------------------------------

const FIELDS = ['brief', 'wording', 'wording_approved', 'when_used', 'sources', 'avoid', 'done_when'];

function clean(s) {
  return typeof s === 'string' ? s.trim() : s;
}

/** The payload fields from a call's args (only the ones given). */
function payloadFrom(args) {
  const out = {};
  for (const f of FIELDS) {
    if (args[f] === undefined || args[f] === null) continue;
    out[f] = f === 'wording_approved' ? !!args[f] : clean(String(args[f]));
  }
  return out;
}

/**
 * What a job still lacks for Claude Code to do it without going back to Guy. Not a refusal -
 * Chat is told, so it can ask Guy now while the conversation is fresh.
 */
function missingFor(kind, p) {
  const miss = [];
  if (!p.brief) miss.push('brief (what to do, in a sentence or two)');
  if (kind === 'library_email' || kind === 'onboarding_script' || kind === 'playbook') {
    if (!p.wording) miss.push('wording (the text itself, or "draft it" in brief if Claude Code should write it for Guy to review)');
    else if (p.wording_approved === undefined) miss.push('wording_approved (has Guy approved this wording, yes or no?)');
  }
  if (kind === 'library_email' && !p.when_used) miss.push('when_used (when the planner should pick it - e.g. "once their first campaign gets replies", "mid-Nov to mid-Dec only")');
  if (kind === 'research' && !p.sources) miss.push('sources (where to look - e.g. "my all-client group emails since 1 Oct", with message ids if you have them)');
  if (!p.done_when) miss.push('done_when (how we will know it is done)');
  return miss;
}

function ageDays(job, now = Date.now()) {
  return Math.floor((now - new Date(job.created_at).getTime()) / MS_DAY);
}

function ageWords(job, now) {
  const d = ageDays(job, now);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

function oneLine(job, now) {
  const p = job.payload || {};
  const state = job.status === 'open' ? '' : ` [${job.status.toUpperCase()}]`;
  const appr = p.wording === undefined ? '' : p.wording_approved ? ' - wording approved' : ' - wording NOT yet approved';
  return `#${job.id} ${job.title} (${KIND_WORDS[job.kind] || job.kind}, added ${ageWords(job, now)}${appr})${state}`;
}

function fullText(job, now) {
  const p = job.payload || {};
  const lines = [oneLine(job, now), ''];
  const put = (label, v) => { if (v !== undefined && v !== '') lines.push(`${label}:\n${v}\n`); };
  put('WHAT TO DO', p.brief);
  if (p.wording !== undefined) put(`WORDING (${p.wording_approved ? 'approved by Guy - use as is' : 'NOT approved - a draft for Guy to review'})`, p.wording);
  put('WHEN IT IS USED', p.when_used);
  put('SOURCES', p.sources);
  put('AVOID', p.avoid);
  put('DONE WHEN', p.done_when);
  if (Array.isArray(p.notes) && p.notes.length) put('ADDED LATER', p.notes.map((n) => `- ${n}`).join('\n'));
  if (job.status !== 'open') put(job.status === 'done' ? 'WHAT WAS DONE' : 'WHY DROPPED', job.close_note);
  const miss = missingFor(job.kind, p);
  if (job.status === 'open' && miss.length) lines.push(`STILL MISSING (ask Guy before starting): ${miss.join('; ')}`);
  return lines.join('\n').trim();
}

/** The one line for the Monday review and the inbox, or '' when nothing is waiting. */
function nudgeLine(openJobs, now = Date.now()) {
  if (!openJobs || !openJobs.length) return '';
  const n = openJobs.length;
  const oldest = Math.max(...openJobs.map((j) => ageDays(j, now)));
  const stale = oldest >= STALE_DAYS ? ` - the oldest has been waiting ${oldest} days` : '';
  const titles = openJobs.slice(0, 3).map((j) => `"${j.title}"`).join(', ') + (n > 3 ? `, and ${n - 3} more` : '');
  return `CLAUDE CODE JOBS: ${n} waiting${stale} (${titles}). Tell Guy in one line; they get done when he opens Claude Code on the Wingguy repo.`;
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

function parseId(v) {
  const n = Number(String(v || '').replace(/^#/, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function runCodeJobs(args = {}, tenant = OWNER, deps = {}) {
  const store = deps.store || pgStore;
  const now = deps.now || Date.now();
  if (tenant !== OWNER) return { text: 'This is Guy\'s own build list - it is not available on this connection.', isError: true };
  const action = String(args.action || 'list').trim().toLowerCase();

  if (action === 'list') {
    const rows = await store.list(tenant, { all: !!args.all });
    if (!rows.length) return { text: args.all ? 'No Claude Code jobs on record.' : 'No Claude Code jobs waiting.' };
    const open = rows.filter((j) => j.status === 'open');
    const head = args.all ? `${rows.length} Claude Code jobs (${open.length} open):` : `${open.length} Claude Code job${open.length === 1 ? '' : 's'} waiting:`;
    return { text: `${head}\n${rows.map((j) => oneLine(j, now)).join('\n')}\n\naction=show with id prints a job in full.` };
  }

  if (action === 'add') {
    const title = clean(args.title || '');
    if (!title) return { text: 'A job needs a title - a few words Guy would recognise, e.g. "Library email: Had the edits nag lately?".', isError: true };
    const kind = KINDS.includes(args.kind) ? args.kind : 'other';
    const payload = payloadFrom(args);
    const open = await store.list(tenant, {});
    const dupe = open.find((j) => j.title.toLowerCase() === title.toLowerCase());
    if (dupe) return { text: `There is already an open job #${dupe.id} called "${dupe.title}". Use action=update with id=${dupe.id} to add to it.`, isError: true };
    const job = await store.add(tenant, { kind, title, payload });
    const miss = missingFor(kind, payload);
    const tail = miss.length
      ? `\n\nStill missing for Claude Code to do it without asking Guy: ${miss.join('; ')}. Ask Guy now and add it with action=update id=${job.id}.`
      : '\n\nIt has everything Claude Code needs.';
    return { text: `Queued for Claude Code as job #${job.id}: ${job.title}.${tail}\nTell Guy it is queued - it will be in front of him next time he opens Claude Code on the Wingguy repo.` };
  }

  const id = parseId(args.id);
  if (!id) return { text: `action=${action} needs the job id (the number after #).`, isError: true };
  const job = await store.get(tenant, id);
  if (!job) return { text: `No Claude Code job #${id}.`, isError: true };

  if (action === 'show') return { text: fullText(job, now) };

  if (action === 'update') {
    const p = { ...(job.payload || {}), ...payloadFrom(args) };
    const note = clean(args.note || '');
    if (note) p.notes = [...(p.notes || []), note];
    const kind = KINDS.includes(args.kind) ? args.kind : job.kind;
    const title = clean(args.title || '') || job.title;
    const updated = await store.update(tenant, id, { payload: p, kind, title });
    return { text: `Updated job #${id}.\n\n${fullText(updated, now)}` };
  }

  if (action === 'done' || action === 'drop') {
    if (job.status !== 'open') return { text: `Job #${id} is already ${job.status}.`, isError: true };
    const note = clean(args.note || '');
    if (!note) {
      return {
        text: action === 'done'
          ? 'Say what was done in note - what changed and where (commit, PR, piece name), so Chat can tell Guy.'
          : 'Say why it is dropped in note.',
        isError: true,
      };
    }
    const closed = await store.close(tenant, id, action === 'done' ? 'done' : 'dropped', note);
    return { text: `Job #${id} ${action === 'done' ? 'done' : 'dropped'}: ${closed.title}.\n${note}` };
  }

  if (action === 'reopen') {
    if (job.status === 'open') return { text: `Job #${id} is already open.` };
    await store.reopen(tenant, id);
    return { text: `Job #${id} is open again: ${job.title}.` };
  }

  return { text: `Unknown action "${action}". Use list, add, show, update, done, drop or reopen.`, isError: true };
}

/** For the Monday review and the inbox: one line when jobs are waiting, else ''. Never throws. */
async function nudgeFor(tenant, deps = {}) {
  if (tenant !== OWNER) return '';
  try {
    const rows = await (deps.store || pgStore).list(tenant, {});
    return nudgeLine(rows, deps.now || Date.now());
  } catch (_) {
    return '';
  }
}

const DESCRIPTION =
  'Guy only. The hand-off list from Claude Chat to Claude Code - for jobs that come up in chat but only Claude Code can do, because they change the Wingguy repo: a new piece for the weekly-email library the Monday planner picks from, a line in the onboarding script (wingguy_onboarding_guide), a playbook topic, a sweep of old emails for pieces not yet on the shelf, any code change. Use it when Guy says "send that to Claude Code", "add a Claude Code job", "queue that for Code", "that is one for Claude Code", or "what is waiting for Claude Code?". Chat cannot make these changes itself - never say it is done; file the job and say it is queued. ' +
  'ADDING A JOB (action=add): one job per thing Claude Code would do separately (three new library emails = three jobs). Give it everything Claude Code needs to do it WITHOUT going back to Guy: title (a few words he would recognise), kind, brief (what to do), wording (the text itself - copy Guy\'s words exactly, never a summary - or leave it out and say "draft it" in brief), wording_approved (true ONLY if Guy approved that wording in this chat), when_used (for a library piece: when the planner should pick it, any season or date window, who it is not for), sources (the emails or threads it comes from: subject, date, message id if you have it, and the key lines quoted), avoid (clients, overlaps with existing pieces, words to stay away from), done_when. The reply lists anything still missing - ask Guy then and there and add it with action=update. ' +
  'OTHER ACTIONS: list (open jobs; all=true includes finished ones), show (one job in full), update (add or change fields, or note=a later thought), done (Claude Code only: note = what changed and where - read this back to Guy when he asks), drop (note = why), reopen.';

const TOOL_DEFS = [
  {
    name: 'wingguy_code_jobs',
    description: DESCRIPTION,
    zodSchema: {
      action: z.enum(['list', 'add', 'show', 'update', 'done', 'drop', 'reopen']).optional().describe('list (default) | add | show | update | done | drop | reopen'),
      id: z.union([z.number(), z.string()]).optional().describe('show / update / done / drop / reopen: the job number'),
      all: z.boolean().optional().describe('list: true to include done and dropped jobs'),
      title: z.string().optional().describe('add: a few words Guy would recognise'),
      kind: z.enum(KINDS).optional().describe('add: library_email | onboarding_script | playbook | research | code | other'),
      brief: z.string().optional().describe('add / update: what to do'),
      wording: z.string().optional().describe('add / update: the exact text, in Guy\'s words'),
      wording_approved: z.boolean().optional().describe('add / update: true only if Guy approved this wording'),
      when_used: z.string().optional().describe('add / update: when it is used - trigger, season, who it is not for'),
      sources: z.string().optional().describe('add / update: source emails or threads, with ids and key lines quoted'),
      avoid: z.string().optional().describe('add / update: what to stay away from'),
      done_when: z.string().optional().describe('add / update: how we will know it is done'),
      note: z.string().optional().describe('update: a later thought; done: what changed and where; drop: why'),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'show', 'update', 'done', 'drop', 'reopen'], description: 'list (default) | add | show | update | done | drop | reopen' },
        id: { type: ['number', 'string'], description: 'show / update / done / drop / reopen: the job number' },
        all: { type: 'boolean', description: 'list: true to include done and dropped jobs' },
        title: { type: 'string', description: 'add: a few words Guy would recognise' },
        kind: { type: 'string', enum: KINDS, description: 'add: library_email | onboarding_script | playbook | research | code | other' },
        brief: { type: 'string', description: 'add / update: what to do' },
        wording: { type: 'string', description: 'add / update: the exact text, in Guy\'s words' },
        wording_approved: { type: 'boolean', description: 'add / update: true only if Guy approved this wording' },
        when_used: { type: 'string', description: 'add / update: when it is used - trigger, season, who it is not for' },
        sources: { type: 'string', description: 'add / update: source emails or threads, with ids and key lines quoted' },
        avoid: { type: 'string', description: 'add / update: what to stay away from' },
        done_when: { type: 'string', description: 'add / update: how we will know it is done' },
        note: { type: 'string', description: 'update: a later thought; done: what changed and where; drop: why' },
      },
    },
    run: runCodeJobs,
  },
];

// ---------------------------------------------------------------------------
// Transport adapters - registered for the owner only
// ---------------------------------------------------------------------------

function registerWingguyCodeJobsTools(server, tenant = OWNER) {
  if (tenant !== OWNER) return;
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

/** Legacy endpoint (the /mcp path, which is always Guy). */
function legacyToolList(tenant = OWNER) {
  if (tenant !== OWNER) return [];
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.jsonSchema }));
}

async function legacyToolCall(toolName, args, tenant = OWNER) {
  const def = TOOL_DEFS.find((d) => d.name === toolName);
  if (!def) return null;
  try {
    const out = await def.run(args || {}, tenant);
    return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = {
  registerWingguyCodeJobsTools, legacyToolList, legacyToolCall, TOOL_DEFS, runCodeJobs, nudgeFor,
  _test: { missingFor, nudgeLine, oneLine, fullText, payloadFrom, OWNER },
};
