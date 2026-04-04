/**
 * Email coach/admin when Krisp participants could not be matched to Airtable Leads.
 * Uses Mailgun via sendAlertEmail. Deduped per postgres row (see krispWebhookDb).
 *
 * Enable with KRISP_UNMATCHED_EMAIL_ALERT=1 (default off to avoid surprise volume).
 */

const { sendAlertEmail } = require('./emailNotificationService');
const { createSafeLogger } = require('../utils/loggerHelper');
const {
  getKrispUnmatchedAlertAlreadySent,
  markKrispUnmatchedAlertSent,
} = require('./krispWebhookDb');
const { signFixUnmatchedToken, signTranscriptViewToken, linkSecret } = require('../utils/krispPublicTokens');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function alertsEnabled() {
  const v = (process.env.KRISP_UNMATCHED_EMAIL_ALERT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function publicBaseUrl() {
  const raw =
    (process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '') ||
    'https://pb-webhook-server.onrender.com';
  return raw;
}

/**
 * @param {{ postgresId: string, krispId: string|null, event: string|null, unmatchedParticipants: { email: string, first_name?: string, last_name?: string }[] }} params
 */
async function maybeSendKrispUnmatchedAlert(params) {
  const log = createSafeLogger('SYSTEM', null, 'krisp_unmatched_alert');
  const { postgresId, krispId, event, unmatchedParticipants } = params;

  if (!alertsEnabled()) {
    return { sent: false, reason: 'disabled' };
  }
  if (!unmatchedParticipants?.length) {
    return { sent: false, reason: 'none' };
  }

  try {
    const already = await getKrispUnmatchedAlertAlreadySent(postgresId);
    if (already) {
      return { sent: false, reason: 'already_sent' };
    }
  } catch (e) {
    log.warn(`KRISP-ALERT dedupe check failed: ${e.message}`);
  }

  const adminEmail = process.env.ALERT_EMAIL || process.env.KRISP_UNMATCHED_ALERT_TO || '';
  if (!adminEmail) {
    log.warn('KRISP-ALERT skip: no ALERT_EMAIL');
    return { sent: false, reason: 'no_recipient' };
  }

  const base = publicBaseUrl();
  const relinkUrl = `${base}/krisp-test/relink-event`;

  const trTok = signTranscriptViewToken(postgresId, 30);
  const transcriptHref = trTok
    ? `${base}/krisp/transcript?t=${encodeURIComponent(trTok)}`
    : null;

  const participantBlocks = unmatchedParticipants.map((p) => {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || '—';
    const email = p.email || '—';
    const fixTok = signFixUnmatchedToken(postgresId, email, 7);
    const fixHref = fixTok
      ? `${base}/krisp/fix-unmatched?t=${encodeURIComponent(fixTok)}`
      : null;
    const fixLine = fixHref
      ? `<br/><a href="${escapeHtml(fixHref)}">Open secure fix form</a> (choose Airtable lead + corrected email/name)`
      : linkSecret()
        ? ''
        : '<br/><em>Fix link needs PB_WEBHOOK_SECRET or KRISP_PUBLIC_LINK_SECRET on server.</em>';
    return `<li style="margin:8px 0"><strong>${escapeHtml(email)}</strong> — ${escapeHtml(name)}${fixLine}</li>`;
  });

  const mailtoSubject = `Krisp CRM fix — postgres id=${postgresId}`;
  const mailtoBody = `Postgres Krisp row id: ${postgresId}

Corrected participant email (if wrong in Krisp):
Corrected name (First Last):

Notes:
`;
  const mailtoHref = `mailto:${encodeURIComponent(adminEmail)}?subject=${encodeURIComponent(mailtoSubject)}&body=${encodeURIComponent(mailtoBody)}`;

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.45;color:#111">
<p><strong>Krisp webhook — no matching lead in CRM</strong></p>
<p>None of the participant emails/names below matched a row in the coach Leads base (after email + name lookup).</p>
<p><strong>Postgres event id:</strong> <code>${escapeHtml(String(postgresId))}</code> — use this in the relink API or when asking support.</p>
<p><strong>Krisp meeting id:</strong> ${escapeHtml(krispId != null ? String(krispId) : '—')}<br/>
<strong>Event:</strong> ${escapeHtml(event || '—')}</p>
${transcriptHref ? `<p><a href="${escapeHtml(transcriptHref)}">View transcript</a> (signed link)</p>` : ''}
<p><strong>Participants (unmatched):</strong></p>
<ul style="margin:0;padding-left:1.25rem">${participantBlocks.join('')}</ul>
<p><strong>Fix (recommended):</strong> use <strong>Open secure fix form</strong> per participant — updates the Airtable lead you specify and re-runs linking. You will get a confirmation email.</p>
<p><strong>Or manually:</strong></p>
<ol>
<li>Add or fix the lead in Airtable so <strong>Email</strong> matches Krisp (or first+last name matches for name fallback).</li>
<li>Re-run linking: <code>POST ${escapeHtml(relinkUrl)}</code> with header <code>Authorization: Bearer …</code> (same as other Krisp admin routes) and JSON body: <code>{"postgresId":"${escapeHtml(String(postgresId))}"}</code></li>
</ol>
<p><a href="${escapeHtml(mailtoHref)}">Compose email with correction details</a> (mailto template — add the right email/name, then send).</p>
</body></html>`;

  const subject = `[Krisp] No CRM match — postgres id=${postgresId}`;

  try {
    const result = await sendAlertEmail(subject, html, adminEmail);
    if (result.success) {
      await markKrispUnmatchedAlertSent(postgresId);
      log.info(`KRISP-ALERT sent for postgres_id=${postgresId}`);
      return { sent: true };
    }
    log.warn(`KRISP-ALERT send failed: ${result.error || 'unknown'}`);
    return { sent: false, reason: result.error };
  } catch (e) {
    log.warn(`KRISP-ALERT error: ${e.message}`);
    return { sent: false, reason: e.message };
  }
}

module.exports = { maybeSendKrispUnmatchedAlert, alertsEnabled };
