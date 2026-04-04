/**
 * One ping per stored Krisp webhook: saved + link to review in the portal.
 * No full transcript in the email. Deduped per postgres row.
 */

const { sendAlertEmail } = require('./emailNotificationService');
const { createSafeLogger } = require('../utils/loggerHelper');
const { listKrispParticipants } = require('./krispLeadLinkService');
const {
  getKrispConversationAlertAlreadySent,
  markKrispConversationAlertSent,
} = require('./krispWebhookDb');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function portalBaseUrl() {
  return (process.env.PORTAL_BASE_URL || 'https://pb-webhook-server.vercel.app').replace(/\/$/, '');
}

function reviewPageUrl(postgresId) {
  const base = portalBaseUrl();
  const clientId = (process.env.KRISP_COACH_CLIENT_ID || 'Guy-Wilson').trim();
  const devKey = (process.env.PORTAL_DEV_KEY || process.env.PB_WEBHOOK_SECRET || '').trim();
  if (!devKey) return null;
  return `${base}/krisp-review?clientId=${encodeURIComponent(clientId)}&devKey=${encodeURIComponent(devKey)}&reviewId=${encodeURIComponent(String(postgresId))}`;
}

/**
 * @param {{ postgresId: string, meetingId?: string, payload: object, krispId: string|null, event: string|null, leadsLinked: number }} params
 */
async function maybeSendKrispConversationAlert(params) {
  const log = createSafeLogger('SYSTEM', null, 'krisp_conversation_email');
  const { postgresId, meetingId, payload, krispId, event, leadsLinked } = params;

  try {
    const already = await getKrispConversationAlertAlreadySent(postgresId);
    if (already) return { sent: false, reason: 'already_sent' };
  } catch (e) {
    log.warn(`KRISP-CONV dedupe check failed: ${e.message}`);
  }

  const participants = listKrispParticipants(payload);
  const reviewUrl = reviewPageUrl(meetingId || postgresId);

  const participantSummary =
    participants.length > 0
      ? participants.map((p) => `${p.email} (${[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'})`).join('; ')
      : 'None listed in Krisp payload.';

  const plainText = [
    'Krisp meeting saved — open the link to review the transcript and verify speakers.',
    '',
    `Reference id: ${postgresId}`,
    `Krisp meeting id: ${krispId != null ? String(krispId) : '—'}`,
    `Event: ${event || '—'}`,
    `CRM links created: ${Number(leadsLinked) || 0}`,
    `Participants (from Krisp if any): ${participantSummary}`,
    '',
    reviewUrl ? `Review transcript: ${reviewUrl}` : 'No review link available (set PB_WEBHOOK_SECRET on server).',
  ].join('\n');

  const buttonHtml = reviewUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#111;color:#fff;padding:14px 22px;text-decoration:none;border-radius:8px;font-weight:600">Review transcript</a></p>
<p style="color:#444;font-size:14px;line-height:1.5">Verify speakers and mark ready in the review queue.</p>`
    : '<p><em>Set PB_WEBHOOK_SECRET so review links work.</em></p>';

  const partRows =
    participants.length > 0
      ? participants
          .map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
            return `<tr><td>${escapeHtml(p.email)}</td><td>${escapeHtml(name)}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="2">None in Krisp payload — check the review page for speaker details.</td></tr>';

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.45;color:#111">
<p><strong>Krisp meeting saved</strong> — one email per meeting. Use the button to review the transcript and verify speakers.</p>
<p style="color:#555;font-size:14px">Krisp id: ${escapeHtml(krispId != null ? String(krispId) : '—')} · Event: ${escapeHtml(event || '—')} · CRM links: ${Number(leadsLinked) || 0}</p>
${buttonHtml}
<p><strong>Participants</strong> <span style="color:#666;font-weight:normal">(from Krisp when available)</span></p>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><thead><tr><th>Email</th><th>Name</th></tr></thead><tbody>${partRows}</tbody></table>
<p style="color:#666;font-size:13px;margin-top:24px">Reference id: <code>${escapeHtml(String(postgresId))}</code></p>
</body></html>`;

  const subject = `[Krisp] Meeting saved — ${postgresId}`;

  try {
    const result = await sendAlertEmail(subject, html, null, { text: plainText });
    if (result.success) {
      await markKrispConversationAlertSent(postgresId);
      log.info(`KRISP-CONV email sent postgres_id=${postgresId}`);
      return { sent: true };
    }
    return { sent: false, reason: result.error };
  } catch (e) {
    log.warn(`KRISP-CONV error: ${e.message}`);
    return { sent: false, reason: e.message };
  }
}

module.exports = { maybeSendKrispConversationAlert };
