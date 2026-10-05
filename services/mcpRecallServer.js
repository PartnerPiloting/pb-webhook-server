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
const { getMeetingsForLead, getParticipantsForMeeting, findMeetingsByFathomRecordingId, findMeetingsForCoach, getMeetingById } = require('./recallWebhookDb');
const { normalizeFathomApiTranscript } = require('./fathomIngestService');
const { registerWingguyRulesTools } = require('./wingguyRulesMcp');
const { registerWingguyBookingTools } = require('./wingguyBookingMcp');
const { registerWingguyMailTools } = require('./wingguyMailMcp');
const { registerWingguyLeadsTools } = require('./wingguyLeadsMcp');
const { registerWingguyScoringTools } = require('./wingguyScoringMcp');
const { registerWingguyGetStartedTools } = require('./wingguyGetStartedMcp');
const { registerRecallImportTools } = require('./recallImportMcp');
const { registerCaptureControlTools } = require('./captureControlMcp');
const { registerWingguyContactsTools } = require('./wingguyContactsMcp');
const { registerMachineClipboardTools } = require('./machineClipboardMcp');

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
  // A miss is never silent (Rick Wong / Cynthia Lau, 2026-09-04): before saying "no lead" or
  // "no meetings", check the parked list and, if the person is there, say so and name the door.
  const { waitingHintForEmail, waitingHintForLead } = require('./pendingPeopleLookup');
  if (!lead?.id) {
    const hint = await waitingHintForEmail(coachClient, clean);
    return { text: `No lead found for email: ${clean}${hint}`, isError: !hint };
  }

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
  if (!rows || rows.length === 0) {
    const hint = await waitingHintForLead(coachClient, { name: leadName, email: lead.email || clean });
    return { text: `No meetings found for ${leadName} (${clean}).${hint}` };
  }

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

/**
 * "Get me the transcript of my last call with Guy" - find a stored call by name, title word or date,
 * across EVERY call this client has, not only calls filed under a lead. Serves the newest match in
 * full and lists the other matches so the model can ask for a different one by meeting_id.
 */
async function runRecallFindTranscript({ query, after, before, meeting_id }, coachClientId = DEFAULT_COACH_CLIENT_ID) {
  const includeUnowned = coachClientId === DEFAULT_COACH_CLIENT_ID;
  let pick = null;
  let others = [];
  if (meeting_id != null && String(meeting_id).trim()) {
    pick = await getMeetingById(meeting_id, coachClientId);
    const owned = pick && (pick.coach_client_id ? pick.coach_client_id === coachClientId : includeUnowned);
    if (!owned) {
      return { text: `No stored call #${meeting_id} for this client.`, isError: true };
    }
  } else {
    const words = String(query || '').split(/\s+/).filter((w) => w.length > 1);
    const rows = await findMeetingsForCoach(coachClientId, { words, after, before, limit: 10, includeUnowned });
    if (!rows.length) {
      return {
        text: `No stored call matched${words.length ? ` "${words.join(' ')}"` : ''}${after || before ? ' in that date range' : ''}. `
          + 'Try fewer words (just a first name), a wider date range, or no query at all to see the most recent calls.',
      };
    }
    pick = await getMeetingById(rows[0].id, coachClientId);
    others = rows.slice(1);
  }
  const when = pick.meeting_start || pick.created_at;
  const durMin = pick.duration_seconds ? Math.round(pick.duration_seconds / 60) : null;
  const transcript = await replaceParticipantLabels(pick.transcript_text || '', pick.id);
  const header = [
    `Meeting: ${pick.title || 'Meeting'} (#${pick.id})`,
    when ? `Date: ${new Date(when).toISOString()}` : '',
    durMin ? `Duration: ${durMin} min` : '',
    pick.source ? `Recorded by: ${pick.source}` : '',
    others.length
      ? `Other matching calls (ask again with meeting_id for one of these):\n${others.map((r) => `  - #${r.id} "${r.title || 'Meeting'}" ${new Date(r.meeting_start || r.created_at).toISOString()}`).join('\n')}`
      : '',
    '---',
    '',
  ].filter(Boolean).join('\n');
  return { text: header + (transcript || '(empty transcript)') };
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

/**
 * What the STORE did with a raw Fathom recording, said in the raw tool's own output.
 * A back-to-back session is ONE lump in the Fathom API even after the splitter has filed it as
 * separate per-person meetings — on 2026-07-28 that lump was misread as "Rick is filed under
 * April" and a "repair" was offered against data that was already correct. The guard is
 * structural: every raw-feed response carries the filing verdict, so the wrong conclusion cannot
 * be drawn from the raw view alone. Distinguishes "not ingested" from "could not check".
 */
async function storeFilingStatus(fathomRecordingId) {
  let rows;
  try {
    rows = await findMeetingsByFathomRecordingId(fathomRecordingId);
  } catch {
    rows = null;
  }
  if (rows === null) {
    return 'Store cross-check UNAVAILABLE — could not reach the transcript store; do not draw filing conclusions either way.';
  }
  if (!rows.length) {
    return 'Store status: NOT in the transcript store yet (not ingested, or ingest failed) — the poller may still be coming.';
  }
  const parts = rows.map((m) => {
    const mins = m.duration_seconds ? `${Math.round(m.duration_seconds / 60)} min` : '?';
    return `#${m.id} "${m.title}" (${mins}${m.has_transcript ? '' : ', EMPTY'})`;
  });
  return `Store status: ALREADY FILED as ${rows.length} meeting(s): ${parts.join(' + ')}. `
    + 'The splitter has done its job — do NOT diagnose mis-filing from this raw lump. '
    + 'For a per-person transcript use recall_latest_transcript.';
}

async function runFathomListMeetings({ query, after }, coachClientId = DEFAULT_COACH_CLIENT_ID) {
  const key = await coachFathomKey(coachClientId);
  let items = await fathomFetchMeetings(key, { createdAfter: after });
  items = items.filter((m) => fathomMeetingMatches(m, query));
  if (!items.length) return { text: 'No Fathom recordings matched.' };
  const lines = await Promise.all(items.map(async (m) => {
    const s = fathomMeetingSummary(m);
    // Per-recording store verdict: a back-to-back lump lists under ONE title here even when the
    // store has already split it into several meetings — say what the store holds, per line.
    let filed = '';
    try {
      const rows = await findMeetingsByFathomRecordingId(s.recordingId);
      if (rows === null) filed = ' | store: could not check';
      else if (!rows.length) filed = ' | store: not ingested';
      else filed = ` | store: filed as ${rows.length} meeting(s) — ${rows.map((r) => `#${r.id} "${r.title}"`).join(' + ')}`;
    } catch { filed = ' | store: could not check'; }
    return `- recording_id=${s.recordingId} | "${s.title}" | start=${s.start}${s.durMin ? ` | ${s.durMin} min` : ''}${s.invitees.length ? ` | invitees: ${s.invitees.join(', ')}` : ''}${filed}`;
  }));
  return { text: `Fathom recordings (newest window, ${items.length} shown). NOTE: a raw recording can span back-to-back calls — the "store:" field on each line is the filing truth.\n${lines.join('\n')}` };
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
    await storeFilingStatus(s.recordingId),
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

/**
 * Does this tenant record on Fathom? The two fathom_* tools only work with a Fathom key; offered to a
 * Fireflies or Wispr client they are a wrong turn that ends in "no Fathom API key" (Rick Wong,
 * 29 Sep 2026). A lookup failure keeps them on - hiding a working tool is the worse miss.
 */
async function tenantHasFathom(coachClientId) {
  try {
    const c = await clientService.getClientById(coachClientId);
    return !!(c && c.fathomApiKey);
  } catch {
    return true;
  }
}

function createRecallMcpServer(coachClientId = DEFAULT_COACH_CLIENT_ID, { hasFathom = true } = {}) {
  // Server-level instructions sit ABOVE every tool description - the one steer the model reads
  // before it has looked at a single tool. Added 19 Sep 2026 after "help me set up my Linked
  // Helper machine" (the sentence a client's email told them to type) was answered from the
  // model's own memory: wingguy_learn's description did not claim machine setup, and nothing
  // higher up said "this system has its own answers - ask it first". Now something does.
  const server = new McpServer(
    { name: 'recall-transcript', version: '2.0.0' },
    {
      instructions:
        "This is Wingguy - Guy Wilson's I Know A Guy system, plugged into this chat for one client. "
        + "For ANY question about how the method works, or about setting up, buying or fixing any part of the kit it "
        + "runs on (the Linked Helper machine and where to buy it, Linked Helper itself, the Chrome extension, the Claude "
        + "connection, the Anthropic key, scoring, campaigns, the portal), call wingguy_learn FIRST and present its answer "
        + "as Guy's own words. Never answer those from memory, from past chats, or from general knowledge about computers "
        + "or LinkedIn - Guy runs a specific setup with specific suppliers, and an answer that is right in general is wrong "
        + "for this client, and they cannot tell the difference. If wingguy_learn does not cover it, say so and point them to Guy. "
        + "One exception: when they want to OPEN, see or get into their Linked Helper machine (they may call it their VPS or "
        + "server), call wingguy_open_machine - it returns their own link, which is what they are asking for.",
    },
  );

  server.registerTool(
    'recall_latest_transcript',
    {
      title: 'Latest transcript for a lead (reviewed store)',
      description:
        'Fetches the latest meeting transcript for a LEAD (by email) from the reviewed transcript STORE (meetings already filed and split per person). For "my last call", a call with someone who is not a lead (Guy, a colleague, a client), or a call you can only describe by name, title or date, use recall_find_transcript instead - it searches every stored call. If the result looks wrong (missing, empty, or contains a different person\'s call), try recall_find_transcript' + (hasFathom ? ', then fathom_transcript to pull the raw recording straight from Fathom' : '') + '. If it answers "no lead" or "no meetings" but adds a BUT line about a PARKED meeting, relay that to the human and offer the door it names (wingguy_create_lead or wingguy_update_lead with that email) - the meeting exists; only the address is missing. Never conclude the call was not recorded.',
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
    'recall_find_transcript',
    {
      title: 'Find a stored call transcript (by name, title or date)',
      description:
        'Finds a call in this client\'s transcript STORE - every recorded call, whichever recorder captured it (Fathom, Fireflies, Wispr, imports), including calls with people who are not leads. Use for "the transcript of my last call", "my call with Guy on Friday", "what did we discuss yesterday". Returns the newest matching call in full, plus a list of other matches (ask again with meeting_id for one of those). query = a name or a word from the title (every word must match); leave it out to get the most recent call. Convert relative dates ("last Friday") to ISO dates for after/before.',
      inputSchema: {
        query: z.string().optional().describe('A person\'s name or a word from the call title, e.g. "Guy" or "Andrew McCallum". Omit for the most recent call.'),
        after: z.string().optional().describe('Optional ISO 8601 date - only calls on or after this'),
        before: z.string().optional().describe('Optional ISO 8601 date - only calls before this'),
        meeting_id: z.union([z.number(), z.string()]).optional().describe('A meeting number (#1234) from an earlier result, to fetch that exact call'),
      },
    },
    async (args) => {
      try { return asMcpResult(await runRecallFindTranscript(args, coachClientId)); }
      catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }; }
    },
  );

  if (hasFathom) {
  server.registerTool(
    'fathom_list_meetings',
    {
      title: 'List recent Fathom recordings',
      description:
        'Lists the most recent Fathom recordings (title, start time, duration, external invitees, recording_id) straight from the Fathom API — this is the RAW feed, NOT the filing truth. A back-to-back session appears as ONE recording under one title here even when the store has already split it into separate per-person meetings (each line carries a "store:" field with the actual filing state — trust that field). NEVER conclude a meeting is missing or mis-filed because its person does not appear in this list; check recall_latest_transcript first.',
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
        'Fetches a verbatim meeting transcript DIRECTLY from Fathom — the RAW recording, NOT the filing truth. A back-to-back session comes back as ONE lump covering all its calls even when the store has already split it correctly (the header\'s "Store status" line reports what the splitter actually filed — trust that line). NEVER diagnose a filing/attribution problem from this output, and never propose repairing data based on it. Use when the user says to get it "from Fathom", or when recall_latest_transcript returns nothing/wrong content; use timestamps + speaker names to find the right portion.',
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
  }

  // Wingguy rules-store tools (the write-door from chat — "update my rules").
  // ⚠ First NON-transcript tools on this connector → the roadmap's rename-to-"Wingguy" trigger.
  registerWingguyGetStartedTools(server, coachClientId);
  registerWingguyRulesTools(server, coachClientId);
  registerWingguyBookingTools(server, coachClientId);
  registerWingguyMailTools(server, coachClientId);
  registerWingguyLeadsTools(server, coachClientId);
  // Scoring attributes ("rebuild my scoring" - read, propose, commit with backup, revert, test).
  registerWingguyScoringTools(server, coachClientId);
  // Contacts warehouse ("who is Bob, what's their email?" - one lookup across every feed).
  registerWingguyContactsTools(server, coachClientId);
  // Transcript-store import (the write-door for missed captures — Zoom AI Companion etc.).
  registerRecallImportTools(server, coachClientId);
  // Capture control (the client's hands on their own store — held queue, veto, real delete).
  registerCaptureControlTools(server, coachClientId);
  // Machine clipboard (paste into the Linked Helper machine - the connection cannot carry it).
  registerMachineClipboardTools(server, coachClientId);

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
    const server = createRecallMcpServer(coachClientId, { hasFathom: await tenantHasFathom(coachClientId) });
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
      const server = createRecallMcpServer(coachClientId, { hasFathom: await tenantHasFathom(coachClientId) });
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

  log.info && log.info(`mcpRecallServer: mounted ${BASE}/:token (streamable POST, SDK) — recall_latest_transcript + recall_find_transcript + fathom tools (Fathom tenants only)`);
}

module.exports = { mountRecallMcp, BASE };
