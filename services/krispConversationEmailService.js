/**
 * Optional summary email for every stored Krisp webhook (participants + signed transcript link).
 * Enable: KRISP_CONVERSATION_EMAIL_ALERT=1. Deduped per postgres row.
 */

const { sendAlertEmail } = require('./emailNotificationService');
const { createSafeLogger } = require('../utils/loggerHelper');
const { listKrispParticipants } = require('./krispLeadLinkService');
const {
  getKrispConversationAlertAlreadySent,
  markKrispConversationAlertSent,
} = require('./krispWebhookDb');
const { signTranscriptViewToken, linkSecret } = require('../utils/krispPublicTokens');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function enabled() {
  const v = (process.env.KRISP_CONVERSATION_EMAIL_ALERT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function publicBaseUrl() {
  const raw =
    (process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '') ||
    'https://pb-webhook-server.onrender.com';
  return raw;
}

/**
 * @param {{ postgresId: string, payload: object, krispId: string|null, event: string|null, leadsLinked: number }} params
 */
async function maybeSendKrispConversationAlert(params) {
  const log = createSafeLogger('SYSTEM', null, 'krisp_conversation_email');
  const { postgresId, payload, krispId, event, leadsLinked } = params;

  if (!enabled()) return { sent: false, reason: 'disabled' };

  try {
    const already = await getKrispConversationAlertAlreadySent(postgresId);
    if (already) return { sent: false, reason: 'already_sent' };
  } catch (e) {
    log.warn(`KRISP-CONV dedupe check failed: ${e.message}`);
  }

  const adminEmail = process.env.ALERT_EMAIL || '';
  if (!adminEmail) {
    log.warn('KRISP-CONV skip: no ALERT_EMAIL');
    return { sent: false, reason: 'no_recipient' };
  }

  const participants = listKrispParticipants(payload);
  const token = signTranscriptViewToken(postgresId, 30);
  const base = publicBaseUrl();
  const transcriptUrl = token
    ? `${base}/krisp/transcript?t=${encodeURIComponent(token)}`
    : null;

  const partRows =
    participants.length > 0
      ? participants
          .map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
            return `<tr><td>${escapeHtml(p.email)}</td><td>${escapeHtml(name)}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="2">No structured participants in payload</td></tr>';

  const linkBlock = transcriptUrl
    ? `<p><a href="${escapeHtml(transcriptUrl)}">Open transcript (signed link, ~30 days)</a></p>`
    : linkSecret()
      ? '<p><em>Transcript link unavailable.</em></p>'
      : '<p><em>Set PB_WEBHOOK_SECRET or KRISP_PUBLIC_LINK_SECRET to generate transcript links.</em></p>';

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.45;color:#111">
<p><strong>Krisp conversation saved</strong></p>
<p><strong>Postgres id:</strong> <code>${escapeHtml(String(postgresId))}</code><br/>
<strong>Krisp meeting id:</strong> ${escapeHtml(krispId != null ? String(krispId) : '—')}<br/>
<strong>Event:</strong> ${escapeHtml(event || '—')}<br/>
<strong>CRM links created:</strong> ${Number(leadsLinked) || 0}</p>
${linkBlock}
<p><strong>Participants</strong></p>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><thead><tr><th>Email</th><th>Name</th></tr></thead><tbody>${partRows}</tbody></table>
</body></html>`;

  const subject = `[Krisp] Conversation saved — id ${postgresId}`;

  try {
    const result = await sendAlertEmail(subject, html, adminEmail);
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

module.exports = { maybeSendKrispConversationAlert, enabled };
