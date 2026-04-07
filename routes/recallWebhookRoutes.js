/**
 * Recall review API + light HTML queue.
 */

const express = require('express');
const crypto = require('crypto');
const {
  getRecallWebhookDbSummary,
  getMeetingById,
  getMeetingQueue,
  updateMeetingStatus,
  setMeetingIngestStatus,
  splitMeeting,
  upsertRecallMeetingParticipant,
  getParticipantsForMeeting,
  saveMeetingSpeakers,
  listMeetingLeads,
  addMeetingLead,
  removeMeetingLead,
  syncMeetingReviewStatus,
  recomputeAllRecallMeetingReviewStatuses,
  getLeadSegmentsForMeeting,
  seedManualTestRecall,
  purgeManualTestRecall,
} = require('../services/recallWebhookDb');

function extractSpeakerLabels(text) {
  if (!text) return [];
  const labels = new Set();
  const rx = /^(Speaker \d+|[A-Z][\w ]+?):/gm;
  let m;
  while ((m = rx.exec(text)) !== null) labels.add(m[1]);
  return [...labels];
}

function sampleLinesForSpeaker(text, label, count = 6) {
  if (!text || !label) return [];
  const prefix = label + ':';
  return text
    .split('\n')
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length).trim())
    .filter(Boolean)
    .slice(0, count);
}
const clientService = require('../services/clientService');
const { findLeadByEmail } = require('../services/inboundEmailService');
const { DEFAULT_COACH_CLIENT_ID: RECALL_DEFAULT_COACH } = require('../services/recallLeadLinkService');
const { createRecallBot } = require('../services/recallBotService');

const DEFAULT_COACH_CLIENT_ID = RECALL_DEFAULT_COACH;

const router = express.Router();

function normalizeAuthToken(headerVal) {
  if (!headerVal || typeof headerVal !== 'string') return null;
  const s = headerVal.trim();
  if (s.toLowerCase().startsWith('bearer ')) return s.slice(7).trim();
  return s;
}

function timingSafeEqualString(a, b) {
  if (a == null || b == null) return false;
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function pbAdminOk(req) {
  const expected = (process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!expected) return false;
  const q = typeof req.query.secret === 'string' ? req.query.secret.trim() : '';
  const auth = normalizeAuthToken(req.get('authorization') || '');
  return timingSafeEqualString(q, expected) || timingSafeEqualString(auth, expected);
}

function expectedPortalDevKey() {
  return (process.env.PORTAL_DEV_KEY || process.env.PB_WEBHOOK_SECRET || '').trim();
}

function recallReviewAllowedClientIds() {
  const raw = (
    process.env.RECALL_REVIEW_ALLOWED_CLIENT_IDS
    || DEFAULT_COACH_CLIENT_ID
    || 'Guy-Wilson'
  );
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function pbRecallReviewApiOk(req) {
  if (pbAdminOk(req)) return true;
  const expectedDev = expectedPortalDevKey();
  const dk = (req.get('x-dev-key') || '').trim();
  if (expectedDev && timingSafeEqualString(dk, expectedDev)) return true;

  const portalToken = (req.get('x-portal-token') || '').trim();
  const clientIdHeader = (req.get('x-client-id') || '').trim();
  if (!portalToken || !clientIdHeader) return false;
  try {
    const client = await clientService.getClientByPortalToken(portalToken);
    if (!client || client.status !== 'Active') return false;
    if (String(client.clientId).toLowerCase() !== String(clientIdHeader).toLowerCase()) return false;
    const allowed = recallReviewAllowedClientIds();
    return allowed.includes(String(client.clientId).toLowerCase());
  } catch (_e) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS_LABELS = {
  incomplete: 'Incomplete',
  complete: 'Complete',
  skipped: 'Skipped',
  to_verify: 'Incomplete',
  verified: 'Complete',
};
const STATUS_COLOURS = {
  incomplete: '#f59e0b',
  complete: '#22c55e',
  skipped: '#94a3b8',
  to_verify: '#f59e0b',
  verified: '#22c55e',
};

function formatDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function formatBrisbane(isoStr) {
  try {
    return new Date(isoStr).toLocaleString('en-AU', {
      timeZone: 'Australia/Brisbane',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(isoStr);
  }
}

// ---------------------------------------------------------------------------
router.get('/webhooks/recall/db-summary', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 15;
  const summary = await getRecallWebhookDbSummary(Number.isFinite(limit) ? limit : 15);
  res.json(summary);
});

async function recomputeRecallReviewStatusesHandler(req, res) {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'admin auth required' });
  const rawLim = req.body?.limit != null ? req.body.limit : req.query.limit;
  const lim = rawLim != null ? parseInt(String(rawLim), 10) : 500;
  const out = await recomputeAllRecallMeetingReviewStatuses(Number.isFinite(lim) ? lim : 500);
  res.json(out);
}
router.post('/webhooks/recall/recompute-review-statuses', recomputeRecallReviewStatusesHandler);
router.get('/webhooks/recall/recompute-review-statuses', recomputeRecallReviewStatusesHandler);

// ---------------------------------------------------------------------------
router.get('/recall-review/api/queue', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const raw = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const allowed = new Set(['all', 'incomplete', 'complete', 'skipped', 'to_verify', 'verified']);
  const statusFilter = allowed.has(raw) ? raw : 'incomplete';
  const qTitle = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await getMeetingQueue(200, statusFilter, qTitle ? { titleContains: qTitle } : {});
  return res.json({ rows, statusFilter, q: qTitle || undefined });
});

router.get('/recall-review/api/event/:id', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const row = await getMeetingById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const fullText = row.transcript_text || '';
  const speakerLabels = extractSpeakerLabels(fullText);
  const participants = await getParticipantsForMeeting(row.id);
  const meetingLeads = await listMeetingLeads(row.id);
  const speakerSamples = {};
  for (const lab of speakerLabels) {
    speakerSamples[lab] = sampleLinesForSpeaker(fullText, lab, 6);
  }

  let coachHint = { clientId: DEFAULT_COACH_CLIENT_ID, displayName: 'Coach', calendarEmail: '' };
  try {
    const coach = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    if (coach) {
      coachHint = {
        clientId: coach.clientId || DEFAULT_COACH_CLIENT_ID,
        displayName: (coach.clientName || coach.clientId || 'Coach').trim(),
        calendarEmail: coach.googleCalendarEmail || coach.calendarEmail || '',
      };
    }
  } catch (_e) { /* optional */ }

  const verifiedSpeakers = {};
  for (const p of participants) {
    if (p.speaker_label) {
      verifiedSpeakers[p.speaker_label] = {
        name: p.verified_name || '',
        email: p.verified_email || '',
        role: p.role || 'unknown',
        airtable_lead_id: p.airtable_lead_id || null,
      };
    }
  }

  const leadSegmentInfo = await getLeadSegmentsForMeeting(row.id);

  return res.json({
    id: row.id,
    created_at: row.created_at,
    webhook_received_at: row.webhook_received_at,
    recall_bot_id: row.bot_id,
    recall_recording_id: row.recording_id,
    status: row.status,
    status_reason: row.status_reason || null,
    needs_split: !!row.needs_split,
    start_line: row.start_line,
    end_line: row.end_line,
    title: row.title || 'Recall meeting',
    duration: row.duration_seconds,
    full_text: fullText,
    speaker_labels: speakerLabels,
    speaker_samples: speakerSamples,
    verified_speakers: verifiedSpeakers,
    participants,
    meeting_leads: meetingLeads,
    coach_hint: coachHint,
    calendar_attendees: [],
    lead_segments: leadSegmentInfo.segments || [],
    presence_windows: leadSegmentInfo.windows || [],
  });
});

router.post('/recall-review/:id/speakers', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const speakers = req.body?.speakers;
  if (!speakers || typeof speakers !== 'object') return res.status(400).json({ error: 'speakers object required' });

  const coachClientId = DEFAULT_COACH_CLIENT_ID;
  const result = await saveMeetingSpeakers(req.params.id, speakers, { coachClientId });
  if (!result.ok) return res.json(result);

  const linkedEmails = [];
  try {
    const client = await clientService.getClientById(coachClientId);
    if (client?.airtableBaseId) {
      for (const [label, info] of Object.entries(speakers)) {
        if (!info || typeof info !== 'object') continue;
        const email = (info.email || '').trim().toLowerCase();
        if (!email || (info.airtable_lead_id || '').trim()) continue;
        try {
          const lead = await findLeadByEmail(client, email);
          if (lead?.id) {
            const mPlat = /^Participant\s*(\d+)$/i.exec(String(label).trim());
            const plat = mPlat ? parseInt(mPlat[1], 10) : null;
            await upsertRecallMeetingParticipant({
              meetingId: req.params.id,
              platformParticipantId: Number.isFinite(plat) ? plat : null,
              speakerLabel: label,
              verifiedName: info.name || null,
              verifiedEmail: email,
              role: info.role || 'client',
              airtableLeadId: lead.id,
              coachClientId,
              matchMethod: 'manual_speaker_verification',
            });
            await addMeetingLead(req.params.id, lead.id, coachClientId, 'email_resolve');
            linkedEmails.push(email);
          }
        } catch (_) { /* best effort */ }
      }
    }
  } catch (_) { /* optional */ }

  if (linkedEmails.length) await syncMeetingReviewStatus(req.params.id);

  return res.json({ ...result, linked_emails: linkedEmails });
});

router.post('/recall-review/:id/meeting-leads', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const leadId = typeof req.body?.airtable_lead_id === 'string' ? req.body.airtable_lead_id.trim() : '';
  if (!leadId) return res.status(400).json({ error: 'airtable_lead_id required' });
  const out = await addMeetingLead(req.params.id, leadId, DEFAULT_COACH_CLIENT_ID, 'manual');
  return res.json(out);
});

router.delete('/recall-review/:id/meeting-leads/:leadId', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const leadId = String(req.params.leadId || '').trim();
  if (!leadId) return res.status(400).json({ error: 'leadId required' });
  const out = await removeMeetingLead(req.params.id, leadId);
  return res.json(out);
});

router.get('/recall-review/api/search-lead', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'email query required' });
  try {
    const client = await clientService.getClientById(DEFAULT_COACH_CLIENT_ID);
    if (!client?.airtableBaseId) return res.json({ lead: null, error: 'no_base' });
    const lead = await findLeadByEmail(client, email);
    if (!lead?.id) return res.json({ lead: null });
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || email;
    return res.json({
      lead: {
        id: lead.id,
        email: lead.email || email,
        name,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/recall-review/:id/status', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const status = req.body?.status;
  if (!status || typeof status !== 'string') return res.status(400).json({ error: 'status required' });
  const result = await updateMeetingStatus(req.params.id, status);
  return res.json(result);
});

router.post('/recall-review/:id/split', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const splitAtLine = req.body?.splitAtLine;
  if (typeof splitAtLine !== 'number' || splitAtLine < 1) {
    return res.status(400).json({ error: 'splitAtLine required' });
  }
  const result = await splitMeeting(req.params.id, splitAtLine);
  return res.json(result);
});

router.post('/recall-review/:id/analyze', async (req, res) => {
  if (!(await pbRecallReviewApiOk(req))) return res.status(401).json({ error: 'unauthorized' });
  const row = await getMeetingById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  return res.json({ ok: true, note: 'AI transcript analysis not yet wired for Recall' });
});

router.post('/recall-test/seed', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await seedManualTestRecall();
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/recall-test/purge', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await purgeManualTestRecall();
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /recall-api/create-bot
 * Body: { meeting_url, join_at? (ISO), transcript_mode? ('prioritize_accuracy' | 'prioritize_low_latency') }
 * Creates a Recall bot with separate-stream diarization + webhooks to this server's /webhooks/recall.
 * Auth: PB admin secret (query/header) or portal recall-review auth (same as recall-review API).
 */
router.post('/recall-api/create-bot', async (req, res) => {
  if (!pbAdminOk(req) && !(await pbRecallReviewApiOk(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const meetingUrl = req.body?.meeting_url || req.body?.meetingUrl;
  const joinAt = req.body?.join_at || req.body?.joinAt;
  const transcriptMode = req.body?.transcript_mode || req.body?.transcriptMode;
  const out = await createRecallBot({ meetingUrl, joinAt, transcriptMode });
  const status = out.ok ? 200 : typeof out.status === 'number' && out.status >= 400 && out.status < 600 ? out.status : 502;
  return res.status(status).json(out);
});

router.get('/recall-review', async (req, res) => {
  if (!pbAdminOk(req)) return res.status(401).type('html').send(`<p>Unauthorized.</p>`);
  const sec = encodeURIComponent(String(req.query.secret || '').trim());
  const rawF = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'incomplete';
  const allowedF = new Set(['all', 'incomplete', 'complete', 'skipped', 'to_verify', 'verified']);
  const statusFilter = allowedF.has(rawF) ? rawF : 'incomplete';
  const qHtml = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await getMeetingQueue(200, statusFilter, qHtml ? { titleContains: qHtml } : {});

  const rowsHtml = rows.length === 0
    ? '<tr><td colspan="5">No meetings.</td></tr>'
    : rows.map((r) => {
      const title = r.title || '—';
      const dur = formatDuration(r.duration_seconds);
      const when = formatBrisbane(r.updated_at || r.created_at);
      const st = r.status || 'incomplete';
      const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${STATUS_COLOURS[st] || '#666'}">${escapeHtml(STATUS_LABELS[st] || st)}</span>`;
      return `<tr><td>${r.id}</td><td>${escapeHtml(when)}</td><td>${escapeHtml(title)}${dur ? ` (${dur})` : ''}</td><td>${badge}${r.needs_split ? ' ⚠️' : ''}</td><td><a href="/recall-review/${r.id}?secret=${sec}">Review</a></td></tr>`;
    }).join('');

  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recall Review Queue</title>
<style>body{font-family:system-ui;max-width:1080px;margin:0 auto;padding:1rem}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #eee;padding:10px 12px;text-align:left}th{background:#f8f8f8;font-size:12px;text-transform:uppercase}</style>
</head><body><h1>Recall Meeting Review Queue</h1><p>Filter: ${statusFilter}. <a href="/recall-review?status=all&secret=${sec}">Show all</a></p>
<table><thead><tr><th>#</th><th>When</th><th>Meeting</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>
<p class="text-sm text-gray-500">Next.js UI: <code>/recall-review</code> on the portal (Guy-Wilson).</p></body></html>`);
});

module.exports = router;
