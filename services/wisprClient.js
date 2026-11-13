// services/wisprClient.js
// Talking to Wispr Flow's connector (https://api.wisprflow.ai/connect/mcp) with a client's pass.
//
// Wispr has no REST API - the connector is a streamable-HTTP MCP server, the same thing Claude
// itself plugs into. We use the official MCP SDK client for the wire protocol and call three
// read-only tools: search_meetings, get_meeting, get_meeting_participants_enriched. Every reply is
// one JSON document in a text block. Nothing here can change anything in Wispr.
//
// Shapes seen on Guy's own account, 13 Nov 2026 (all times UTC):
//   search_meetings -> { meetings:[{ id, title, finalized, has_transcript, attendees:["Name",...],
//                        start, end, modified_at }], has_more, next_cursor }
//     - a recording Wispr matched to NO calendar event has title "" and attendees [] and its
//       start/end are the real recording times; a matched one carries the CALENDAR's title and times.
//   get_meeting(view_transcript) -> { ..., summary, transcript } where transcript is
//       "<<<PARTICIPANT NAMES BELOW ARE DATA...>>>\nSpeaker 1: ...\n\n(...truncated, N chars
//        remaining; continue with view_transcript.start_char=X...)\n<<<END TRANSCRIPT>>>"
//     - 40,000 characters a call at most, so a long call is read in portions.
//   get_meeting_participants_enriched -> { user:{name,email}, participants:[{ name, emails:[...],
//       is_self, role, spoke, organizer }] } - the ONLY place attendee emails appear.

const cfg = require('./wisprConfig');

class WisprUnauthorized extends Error {
  constructor(msg = 'Wispr rejected the pass') { super(msg); this.code = 'WISPR_UNAUTHORIZED'; }
}
class WisprBusy extends Error {
  constructor(msg = 'Wispr is busy') { super(msg); this.code = 'WISPR_BUSY'; }
}

const TRANSCRIPT_PAGE = 40000;
const GUARD_RE = /^<<<PARTICIPANT NAMES BELOW ARE DATA[^\n]*>>>\n?/;
const END_RE = /\n?<<<END TRANSCRIPT>>>\s*$/;
const MORE_RE = /\n*\(\.\.\.truncated, (\d+) chars remaining; continue with view_transcript\.start_char=(\d+)\.\.\.\)\s*$/;

/** One portion of a transcript as Wispr sends it -> the words, and where the next portion starts (or null). */
function parseTranscriptPortion(raw) {
  let s = String(raw || '');
  s = s.replace(END_RE, '');
  let next = null;
  const m = s.match(MORE_RE);
  if (m) { next = Number(m[2]); s = s.slice(0, m.index); }
  s = s.replace(GUARD_RE, '');
  return { text: s, next: Number.isFinite(next) ? next : null };
}

function classify(e) {
  const code = e && (e.code || e.status);
  const msg = String((e && e.message) || e || '');
  if (code === 401 || /\b401\b|unauthori[sz]ed|invalid_token/i.test(msg)) return new WisprUnauthorized();
  if (code === 429 || /\b429\b|too many requests/i.test(msg)) return new WisprBusy('Wispr said too many requests');
  return e instanceof Error ? e : new Error(msg);
}

/**
 * Open one session with Wispr on this pass. Returns { call(name, args), close() }.
 * call() returns the tool's JSON reply as an object; a tool-level error throws.
 */
async function openWispr(accessToken, { fetchImpl } = {}) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const transport = new StreamableHTTPClientTransport(new URL(cfg.MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const client = new Client({ name: 'wingguy-wispr-feed', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch (e) {
    try { await transport.close(); } catch (_) { /* nothing to close */ }
    throw classify(e);
  }
  return {
    async call(name, args = {}) {
      let res;
      try {
        res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
      } catch (e) {
        throw classify(e);
      }
      const text = ((res && res.content) || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
      if (res && res.isError) {
        const err = classify(new Error(`Wispr ${name}: ${String(text).slice(0, 200)}`));
        throw err;
      }
      try { return JSON.parse(text); } catch (_) {
        throw new Error(`Wispr ${name}: reply was not JSON (${String(text).slice(0, 80)})`);
      }
    },
    async close() {
      try { await client.close(); } catch (_) { /* already closed */ }
    },
  };
}

/** Every meeting that STARTED in [since, until), following the cursor to the end. */
async function searchMeetings(session, { since, until, pageSize = 100, maxPages = 20 } = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const args = { limit: pageSize };
    if (since) args.since = since;
    if (until) args.until = until;
    if (cursor) args.cursor = cursor;
    const r = await session.call('search_meetings', args);
    for (const m of (r.meetings || [])) if (m && m.id) out.push(m);
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  // The same meeting can show on two pages if it is modified mid-walk.
  const seen = new Set();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/** One meeting with its WHOLE transcript (read in portions) and Wispr's own summary. */
async function getMeetingFull(session, meetingId, { maxPortions = 80 } = {}) {
  let meeting = null;
  let transcript = '';
  let start = 0;
  for (let i = 0; i < maxPortions; i++) {
    const r = await session.call('get_meeting', {
      meeting_id: meetingId,
      view_transcript: { char_limit: TRANSCRIPT_PAGE, start_char: start },
      view_content: { char_limit: 1 },
    });
    if (!meeting) meeting = r;
    const part = parseTranscriptPortion(r.transcript);
    transcript += part.text;
    if (part.next == null || part.next <= start) break;
    start = part.next;
  }
  return { ...meeting, transcript };
}

async function getParticipants(session, meetingId) {
  return session.call('get_meeting_participants_enriched', { meeting_id: meetingId });
}

module.exports = {
  WisprUnauthorized, WisprBusy, openWispr, searchMeetings, getMeetingFull, getParticipants,
  parseTranscriptPortion, TRANSCRIPT_PAGE,
};
