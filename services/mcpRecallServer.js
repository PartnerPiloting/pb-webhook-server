/**
 * Recall transcripts MCP server — modern Streamable HTTP transport for claude.ai chats.
 *
 * WHY THIS EXISTS (2026-07-03): the legacy hand-rolled JSON-RPC endpoint
 * (routes/recallWebhookRoutes.js POST /mcp/:token) registers fine in claude.ai settings but
 * chats never surface its tools — while a reference connector built on the official MCP SDK
 * (Cloudflare docs) works in the same chats. claude.ai's chat runtime now effectively
 * requires the real Streamable HTTP transport. This mounts the SAME three tools via the
 * official SDK (same pattern as services/mcpPersonalServer.js). The legacy endpoint stays
 * untouched as a fallback for older clients.
 *
 * URL: POST /mcp2/:token   where :token = MCP_CONNECTOR_TOKEN (URL-safe) or PB_WEBHOOK_SECRET.
 *
 * ⚠ NAMING: "recall" = the source-agnostic transcript STORE, not the Recall.ai service.
 */

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const express = require('express');

const clientService = require('./clientService');
const { findLeadByEmail } = require('./inboundEmailService');
const { getMeetingsForLead, getParticipantsForMeeting } = require('./recallWebhookDb');
const { normalizeFathomApiTranscript } = require('./fathomIngestService');
const { registerWingguyRulesTools } = require('./wingguyRulesMcp');
const { registerWingguyBookingTools } = require('./wingguyBookingMcp');
const { registerWingguyMailTools } = require('./wingguyMailMcp');
const { registerWingguyGetStartedTools } = require('./wingguyGetStartedMcp');

const BASE = '/mcp2';
const DEFAULT_COACH_CLIENT_ID = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

function validTokens() {
  return [process.env.PB_WEBHOOK_SECRET, process.env.MCP_CONNECTOR_TOKEN]
    .map((t) => (t || '').trim())
    .filter(Boolean);
}

// Multi-tenant connector auth (roadmap step 3). OFF by default: until this flag is on, ONLY the
// shared connector secrets authenticate and everything maps to Guy — byte-identical to before.
// Flip WINGGUY_CONNECTOR_MULTITENANT=1 (staging first) to also accept per-client Portal Tokens.
const CONNECTOR_MULTITENANT = String(process.env.WINGGUY_CONNECTOR_MULTITENANT || '').trim() === '1';

/**
 * Resolve the URL :token to the coach/tenant clientId whose data this call operates on.
 *   - a shared connector secret (PB_WEBHOOK_SECRET / MCP_CONNECTOR_TOKEN) => Guy (DEFAULT), unchanged.
 *   - else, when multi-tenant is ON, an ACTIVE client's Portal Token => that client's clientId.
 *   - otherwise null => 401 (fail closed; a lookup error is also treated as unauthorized).
 * The same Portal Token the Chrome extension already sends (x-portal-token) identifies the client here.
 */
async function resolveCoachClientId(token) {
  const t = String(token || '');
  if (!t) return null;
  if (validTokens().includes(t)) return DEFAULT_COACH_CLIENT_ID;
  if (!CONNECTOR_MULTITENANT) return null;
  try {
    const client = await clientService.getClientByPortalToken(t);
    if (client && client.status === 'Active' && client.clientId) return client.clientId;
  } catch (_e) {
    // fail closed — an Airtable hiccup must not widen access
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool executors (ported from the legacy /mcp/:token endpoint — same behaviour)
// ---------------------------------------------------------------------------

async function replaceParticipantLabels(text, meetingId) {
  if (!text || !meetingId) return text;
  let rows;
  try {
    rows = await getParticipantsForMeeting(meetingId);
  } catch {
    return text;
  }
  let result = text;
  for (const p of rows || []) {
    if (p.verified_name && p.speaker_label && String(p.speaker_label).startsWith('Participant ')) {
      const escaped = String(p.speaker_label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), p.verified_name);
    }
  }
  return result;
}

async function runRecallLatestTranscript({ email, after }, coachClientId = DEFAULT_COACH_CLIENT_ID) {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) return { text: 'Error: a valid email address is required.', isError: true };

  const coachClient = await clientService.getClientById(coachClientId);
  if (!coachClient?.airtableBaseId) return { text: 'Server config error: coach base not set.', isError: true };
  const lead = await findLeadByEmail(coachClient, clean);
  if (!lead?.id) return { text: `No lead found for email: ${clean}`, isError: true };

  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || clean;
  let rows = await getMeetingsForLead(lead.id, 100);
  if (after) {
    const afterMs = new Date(after).getTime();
    if (!isNaN(afterMs)) {
      rows = rows.filter((r) => {
        const t = r.meeting_start || r.created_at;
        return t && new Date(t).getTime() >= afterMs;
      });
    }
  }
  if (!rows || rows.length === 0) return { text: `No meetings found for ${leadName} (${clean}).` };

  // Prefer the newest meeting that actually HAS a transcript. A header-only row (capture failed,
  // or an auto-split child built from a calendar event with no utterances) otherwise wins on
  // recency and gets served as "the meeting" — a confident header with nothing in it, which reads
  // as coverage. If every row is empty, say so plainly rather than returning a hollow header.
  const hasBody = (r) => r && r.transcript_text && String(r.transcript_text).trim();
  const latest = rows.find(hasBody);
  if (!latest) {
    const newest = rows[0];
    const when = newest.meeting_start || newest.created_at;
    return {
      text:
        `A meeting record exists for ${leadName} (${clean}) — "${newest.title || 'Meeting'}" (#${newest.meeting_id})` +
        `${when ? ` on ${when}` : ''} — but it has NO transcript body${rows.length > 1 ? ` (nor do the other ${rows.length - 1} record(s) for them)` : ''}.\n\n` +
        `The meeting was booked and filed, but the recording never landed. Do NOT treat this as "nothing was discussed" — the transcript is missing, not empty. Check Fathom for the recording; if it's within retention it can be re-ingested.`,
      isError: true,
    };
  }
  const skipped = rows.indexOf(latest);
  const transcript = await replaceParticipantLabels(latest.transcript_text || '', latest.meeting_id);
  const durMin = latest.duration_seconds ? Math.round(latest.duration_seconds / 60) : null;
  const header = [
    `Meeting: ${latest.title || 'Meeting'} (#${latest.meeting_id})`,
    `Lead: ${leadName} (${clean})`,
    latest.meeting_start || latest.created_at ? `Date: ${latest.meeting_start || latest.created_at}` : '',
    durMin ? `Duration: ${durMin} min` : '',
    skipped ? `⚠ NB: ${skipped} more recent record(s) for this lead have no transcript body — this is the newest one that does.` : '',
    '---',
    '',
  ].filter(Boolean).join('\n');
  return { text: header + transcript };
}

async function fathomFetchMeetings(apiKey, { includeTranscript = false, createdAfter } = {}) {
  const u = new URL(`${FATHOM_API_BASE}/meetings`);
  u.searchParams.set('limit', '25');
  if (includeTranscript) u.searchParams.set('include_transcript', 'true');
  if (createdAfter) u.searchParams.set('created_after', createdAfter);
  const r = await fetch(u.toString(), { headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`Fathom API ${r.status} ${r.statusText}`);
  const data = await r.json();
  return data.items || data.meetings || data.data || [];
}

function fathomMeetingSummary(m) {
  const start = m.recording_start_time || m.scheduled_start_time || m.created_at || '';
  const end = m.recording_end_time || m.scheduled_end_time || '';
  let durMin = null;
  if (start && end) {
    const d = (Date.parse(end) - Date.parse(start)) / 60000;
    if (Number.isFinite(d) && d > 0) durMin = Math.round(d);
  }
  const invitees = (m.calendar_invitees || m.invitees || [])
    .filter((p) => p && p.is_external)
    .map((p) => `${p.name || '?'} <${p.email || '?'}>`);
  return {
    recordingId: String(m.recording_id ?? m.id ?? '?'),
    title: m.title || m.meeting_title || '(untitled)',
    start,
    durMin,
    invitees,
  };
}

function fathomMeetingMatches(m, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const s = fathomMeetingSummary(m);
  return s.title.toLowerCase().includes(q) || s.invitees.some((i) => i.toLowerCase().includes(q));
}

async function coachFathomKey(coachClientId = DEFAULT_COACH_CLIENT_ID) {
  const coachClient = await clientService.getClientById(coachClientId);
  if (!coachClient?.fathomApiKey) throw new Error('Server config error: no Fathom API key for the coach client.');
  return coachClient.fathomApiKey;
}

async function runFathomListMeetings({ query, after }, coachClientId = DEFAULT_COACH_CLIENT_ID) {
  const key = await coachFathomKey(coachClientId);
  let items = await fathomFetchMeetings(key, { createdAfter: after });
  items = items.filter((m) => fathomMeetingMatches(m, query));
  if (!items.length) return { text: 'No Fathom recordings matched.' };
  const lines = items.map((m) => {
    const s = fathomMeetingSummary(m);
    return `- recording_id=${s.recordingId} | "${s.title}" | start=${s.start}${s.durMin ? ` | ${s.durMin} min` : ''}${s.invitees.length ? ` | invitees: ${s.invitees.join(', ')}` : ''}`;
  });
  return { text: `Fathom recordings (newest window, ${items.length} shown):\n${lines.join('\n')}` };
}

async function runFathomTranscript({ recording_id, query, after }, coachClientId = DEFAULT_COACH_CLIENT_ID) {
  if (!recording_id && !(query || '').trim()) {
    return { text: 'Provide recording_id (from fathom_list_meetings) or a query (title / invitee name / email).', isError: true };
  }
  const key = await coachFathomKey(coachClientId);
  const items = await fathomFetchMeetings(key, { includeTranscript: true, createdAfter: after });
  let meeting = null;
  if (recording_id) {
    meeting = items.find((m) => String(m.recording_id ?? m.id) === String(recording_id));
  } else {
    const matches = items.filter((m) => fathomMeetingMatches(m, query));
    matches.sort((a, b) => Date.parse(fathomMeetingSummary(b).start || 0) - Date.parse(fathomMeetingSummary(a).start || 0));
    meeting = matches[0] || null;
  }
  if (!meeting) return { text: 'No matching Fathom recording found in the recent window. Try fathom_list_meetings to see what is available.', isError: true };

  const transcript = normalizeFathomApiTranscript(meeting);
  if (!transcript) return { text: 'Recording found but its transcript is empty (Fathom may still be processing it).', isError: true };
  const s = fathomMeetingSummary(meeting);
  const header = [
    `Fathom recording: "${s.title}" (recording_id=${s.recordingId})`,
    `Start: ${s.start}${s.durMin ? ` | Duration: ${s.durMin} min` : ''}`,
    s.invitees.length ? `External invitees: ${s.invitees.join(', ')}` : '',
    'Source: Fathom API direct (raw recording — may span back-to-back calls; check timestamps/speakers)',
    '---',
    '',
  ].filter(Boolean).join('\n');
  return { text: header + transcript };
}

function asMcpResult(out) {
  return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
}

// ---------------------------------------------------------------------------
// SDK server + Streamable HTTP mount
// ---------------------------------------------------------------------------

function createRecallMcpServer(coachClientId = DEFAULT_COACH_CLIENT_ID) {
  const server = new McpServer({ name: 'recall-transcript', version: '2.0.0' });

  server.registerTool(
    'recall_latest_transcript',
    {
      title: 'Latest transcript for a lead (reviewed store)',
      description:
        'Fetches the latest meeting transcript for a lead from the reviewed transcript STORE (meetings already filed and split per person). Use when asked for a transcript for a specific person (by email). If the result looks wrong (missing, empty, or contains a different person\'s call), fall back to fathom_transcript to pull the raw recording straight from Fathom.',
      inputSchema: {
        email: z.string().describe('The lead\'s email address (must match their Airtable record)'),
        after: z.string().optional().describe('Optional ISO 8601 date — only return meetings on or after this date/time'),
      },
    },
    async (args) => {
      try { return asMcpResult(await runRecallLatestTranscript(args, coachClientId)); }
      catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }; }
    },
  );

  server.registerTool(
    'fathom_list_meetings',
    {
      title: 'List recent Fathom recordings',
      description:
        'Lists the most recent Fathom recordings (title, start time, duration, external invitees, recording_id) straight from the Fathom API, bypassing the transcript store. Use to see what Fathom captured — e.g. to find the right recording before calling fathom_transcript.',
      inputSchema: {
        query: z.string().optional().describe('Optional filter — matches meeting title or invitee name/email (case-insensitive)'),
        after: z.string().optional().describe('Optional ISO 8601 date — only recordings created on or after this date/time'),
      },
    },
    async (args) => {
      try { return asMcpResult(await runFathomListMeetings(args, coachClientId)); }
      catch (e) { return { content: [{ type: 'text', text: `Fathom API error: ${e.message}` }], isError: true }; }
    },
  );

  server.registerTool(
    'fathom_transcript',
    {
      title: 'Verbatim transcript direct from Fathom',
      description:
        'Fetches a verbatim meeting transcript DIRECTLY from Fathom, bypassing the transcript store. Use when the user says to get it "from Fathom", or when recall_latest_transcript returns nothing/wrong content. NOTE: Fathom returns whole recordings — a back-to-back session comes back as ONE transcript covering all its calls (use timestamps + speaker names to find the right portion).',
      inputSchema: {
        recording_id: z.string().optional().describe('Fathom recording_id (from fathom_list_meetings) — most precise'),
        query: z.string().optional().describe('Title or invitee name/email to match (most recent matching recording is returned)'),
        after: z.string().optional().describe('Optional ISO 8601 date — only consider recordings created on or after this date/time'),
      },
    },
    async (args) => {
      try { return asMcpResult(await runFathomTranscript(args, coachClientId)); }
      catch (e) { return { content: [{ type: 'text', text: `Fathom API error: ${e.message}` }], isError: true }; }
    },
  );

  // Wingguy rules-store tools (the write-door from chat — "update my rules").
  // ⚠ First NON-transcript tools on this connector → the roadmap's rename-to-"Wingguy" trigger.
  registerWingguyGetStartedTools(server, coachClientId);
  registerWingguyRulesTools(server, coachClientId);
  registerWingguyBookingTools(server, coachClientId);
  registerWingguyMailTools(server, coachClientId);

  return server;
}

function mountRecallMcp(app, log = console) {
  const tokens = validTokens();
  if (!tokens.length) {
    log.info && log.info('mcpRecallServer: skipping mount (no PB_WEBHOOK_SECRET / MCP_CONNECTOR_TOKEN)');
    return;
  }

  const hit = (req, note) => {
    const ua = String(req.headers['user-agent'] || '').slice(0, 60);
    console.log(`MCP2-CONNECTOR ${req.method} rpc=${req.body?.method || 'n/a'} ${note || ''} ua="${ua}"`);
  };

  app.post(`${BASE}/:token`, express.json({ limit: '2mb' }), async (req, res) => {
    const coachClientId = await resolveCoachClientId(req.params.token);
    hit(req, coachClientId ? `auth=ok tenant=${coachClientId}` : 'auth=BAD');
    if (!coachClientId) {
      return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32001, message: 'unauthorized' } });
    }
    const server = createRecallMcpServer(coachClientId);
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => { transport.close(); server.close(); });
    } catch (err) {
      log.error && log.error('mcpRecallServer streamable error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  // Legacy HTTP+SSE transport: some client surfaces open a GET stream on the endpoint URL
  // rather than POSTing streamable HTTP. Serve both (same dual-transport pattern as
  // mcpPersonalServer): GET opens the SSE stream, POST :token/messages carries the session.
  const sseTransports = {};
  app.get(`${BASE}/:token`, async (req, res) => {
    const coachClientId = await resolveCoachClientId(req.params.token);
    hit(req, coachClientId ? `GET-sse auth=ok tenant=${coachClientId}` : 'GET auth=BAD');
    if (!coachClientId) {
      return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } });
    }
    try {
      const transport = new SSEServerTransport(`${BASE}/${encodeURIComponent(req.params.token)}/messages`, res);
      sseTransports[transport.sessionId] = transport;
      res.on('close', () => { delete sseTransports[transport.sessionId]; });
      const server = createRecallMcpServer(coachClientId);
      await server.connect(transport);
    } catch (err) {
      log.error && log.error('mcpRecallServer SSE error:', err.message);
      if (!res.headersSent) res.status(500).end('MCP SSE error');
    }
  });
  app.post(`${BASE}/:token/messages`, express.json({ limit: '2mb' }), async (req, res) => {
    const coachClientId = await resolveCoachClientId(req.params.token);
    hit(req, coachClientId ? 'sse-message' : 'sse-message auth=BAD');
    if (!coachClientId) {
      return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } });
    }
    try {
      const transport = sseTransports[req.query.sessionId];
      if (!transport) {
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No valid SSE session' } });
      }
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      log.error && log.error('mcpRecallServer sse-message error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } });
      }
    }
  });
  app.delete(`${BASE}/:token`, (req, res) => {
    hit(req, 'DELETE');
    res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed.' } });
  });

  log.info && log.info(`mcpRecallServer: mounted ${BASE}/:token (streamable POST, SDK) — recall_latest_transcript + fathom tools`);
}

module.exports = { mountRecallMcp, BASE };
