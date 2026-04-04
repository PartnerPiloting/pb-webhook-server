/**
 * One summary email per stored Krisp webhook: all participants + transcript (plain text for copy) + link to web Copy button.
 * No feature flag — sends when ALERT_EMAIL is set and Mailgun is configured. Deduped per postgres row.
 */

const { sendAlertEmail } = require('./emailNotificationService');
const { createSafeLogger } = require('../utils/loggerHelper');
const { listKrispParticipants } = require('./krispLeadLinkService');
const { extractKrispDisplayText } = require('./krispPayloadText');
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
  const transcriptBody = extractKrispDisplayText(payload);
  const token = signTranscriptViewToken(postgresId, 30);
  const base = publicBaseUrl();
  const transcriptUrl = token ? `${base}/krisp/transcript?t=${encodeURIComponent(token)}` : null;

  const partRows =
    participants.length > 0
      ? participants
          .map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
            return `<tr><td>${escapeHtml(p.email)}</td><td>${escapeHtml(name)}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="2">No structured participants in payload</td></tr>';

  const participantLines =
    participants.length > 0
      ? participants
          .map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
            return `${p.email}\t${name}`;
          })
          .join('\n')
      : '(no structured participants in payload)';

  const plainText = [
    'Krisp meeting — one email per meeting',
    '',
    `Internal id: ${postgresId}`,
    `Krisp meeting id: ${krispId != null ? String(krispId) : '—'}`,
    `Event: ${event || '—'}`,
    `CRM links created: ${Number(leadsLinked) || 0}`,
    '',
    'PARTICIPANTS (email / name)',
    participantLines,
    '',
    '--- TRANSCRIPT (select all below to copy) ---',
    '',
    transcriptBody || '(no transcript text in payload)',
    '',
    transcriptUrl ? `Open in browser (Copy button): ${transcriptUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const copyButtonHtml = transcriptUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(transcriptUrl)}" style="display:inline-block;background:#111;color:#fff;padding:14px 22px;text-decoration:none;border-radius:8px;font-weight:600">Open transcript &amp; tap Copy</a></p>
<p style="color:#444;font-size:14px;line-height:1.5">This opens a simple page with a <strong>Copy</strong> button. You can also copy from this email: use <strong>“Show original”</strong> or your app’s plain-text view and select everything under the transcript section.</p>`
    : linkSecret()
      ? '<p><em>Transcript link unavailable.</em></p>'
      : '<p><em>Set PB_WEBHOOK_SECRET (or KRISP_PUBLIC_LINK_SECRET) so transcript links work.</em></p>';

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.45;color:#111">
<p><strong>Krisp meeting summary</strong> — everyone on this call is listed below. You only get this once per meeting.</p>
<p style="color:#555;font-size:14px">Krisp id: ${escapeHtml(krispId != null ? String(krispId) : '—')} · Event: ${escapeHtml(event || '—')} · CRM links: ${Number(leadsLinked) || 0}</p>
${copyButtonHtml}
<p><strong>Participants</strong></p>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><thead><tr><th>Email</th><th>Name</th></tr></thead><tbody>${partRows}</tbody></table>
<p style="color:#666;font-size:13px;margin-top:24px">Reference id: <code>${escapeHtml(String(postgresId))}</code></p>
</body></html>`;

  const subject = `[Krisp] Meeting — ${postgresId}`;

  try {
    const result = await sendAlertEmail(subject, html, adminEmail, { text: plainText });
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
