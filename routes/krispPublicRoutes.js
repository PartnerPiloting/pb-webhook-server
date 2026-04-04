/**
 * Public (token-signed) Krisp pages: unmatched fix form + read-only transcript.
 * No admin secret in URL — uses HMAC tokens from utils/krispPublicTokens.js
 */

const express = require('express');
const { getClientBase } = require('../config/airtableClient');
const { getKrispWebhookEventById } = require('../services/krispWebhookDb');
const { linkKrispEventToLeadsByEmail, DEFAULT_COACH_CLIENT_ID } = require('../services/krispLeadLinkService');
const { extractKrispDisplayText } = require('../services/krispPayloadText');
const { verifyKrispPublicToken } = require('../utils/krispPublicTokens');
const { sendAlertEmail } = require('../services/emailNotificationService');
const { createSafeLogger } = require('../utils/loggerHelper');

const router = express.Router();
const parseForm = express.urlencoded({ extended: true });

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isLikelyAirtableRecordId(id) {
  return typeof id === 'string' && /^rec[a-zA-Z0-9]{10,}$/.test(id.trim());
}

/** GET /krisp/fix-unmatched?t=… */
router.get('/krisp/fix-unmatched', (req, res) => {
  const token = typeof req.query.t === 'string' ? req.query.t.trim() : '';
  const payload = verifyKrispPublicToken(token);
  if (!payload || payload.typ !== 'fix' || !payload.pem) {
    return res.status(400).type('html')
      .send('<!DOCTYPE html><html><body><p>Invalid or expired link.</p></body></html>');
  }

  const pem = escapeHtml(payload.pem);
  const tEsc = escapeHtml(token);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Krisp — fix CRM match</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:2rem auto;padding:0 1rem}label{display:block;margin-top:12px;font-weight:600}input{width:100%;max-width:100%;padding:8px;box-sizing:border-box}button{margin-top:16px;padding:10px 16px;font-size:15px;cursor:pointer}.hint{color:#555;font-size:14px}</style></head><body>
<h1>Fix Krisp → CRM match</h1>
<p class="hint">Krisp participant email (from webhook): <strong>${pem}</strong></p>
<p class="hint">Enter the <strong>Airtable Leads</strong> record id (<code>rec…</code>) for the person this should attach to, and the email/name that should be on that row. Submitting updates Airtable and re-runs linking for this Krisp event.</p>
<form method="post" action="/krisp/fix-unmatched">
<input type="hidden" name="t" value="${tEsc}"/>
<label for="airtable_record_id">Airtable record id</label>
<input id="airtable_record_id" name="airtable_record_id" required placeholder="recXXXXXXXXXXXXXX" autocomplete="off"/>
<label for="corrected_email">Email (on lead)</label>
<input id="corrected_email" name="corrected_email" type="email" required placeholder="${pem}"/>
<label for="first_name">First name</label>
<input id="first_name" name="first_name" placeholder="First"/>
<label for="last_name">Last name</label>
<input id="last_name" name="last_name" placeholder="Last"/>
<button type="submit">Update lead &amp; relink</button>
</form></body></html>`;
  res.type('html').send(html);
});

/** POST /krisp/fix-unmatched */
router.post('/krisp/fix-unmatched', parseForm, async (req, res) => {
  const log = createSafeLogger('SYSTEM', null, 'krisp_fix_unmatched');
  const token = typeof req.body.t === 'string' ? req.body.t.trim() : '';
  const payload = verifyKrispPublicToken(token);
  if (!payload || payload.typ !== 'fix' || !payload.pem) {
    return res.status(400).type('html')
      .send('<!DOCTYPE html><html><body><p>Invalid or expired link.</p></body></html>');
  }

  const recId = String(req.body.airtable_record_id || '').trim();
  const email = String(req.body.corrected_email || '').trim();
  const firstName = String(req.body.first_name || '').trim();
  const lastName = String(req.body.last_name || '').trim();

  if (!isLikelyAirtableRecordId(recId)) {
    return res.status(400).type('html')
      .send('<!DOCTYPE html><html><body><p>Invalid Airtable record id.</p><p><a href="javascript:history.back()">Back</a></p></body></html>');
  }
  if (!email || !email.includes('@')) {
    return res.status(400).type('html')
      .send('<!DOCTYPE html><html><body><p>Valid email required.</p><p><a href="javascript:history.back()">Back</a></p></body></html>');
  }

  const coachId = (process.env.KRISP_COACH_CLIENT_ID || DEFAULT_COACH_CLIENT_ID).trim();
  const adminEmail = process.env.ALERT_EMAIL || '';

  try {
    const clientBase = await getClientBase(coachId);
    const fields = { Email: email };
    if (firstName) fields['First Name'] = firstName;
    if (lastName) fields['Last Name'] = lastName;
    await clientBase('Leads').update(recId, fields);

    const row = await getKrispWebhookEventById(payload.pid);
    if (!row?.payload) {
      return res.status(404).type('html')
        .send('<!DOCTYPE html><html><body><p>Krisp event not found in database.</p></body></html>');
    }

    const lr = await linkKrispEventToLeadsByEmail(payload.pid, row.payload, { coachClientId: coachId });

    const summaryHtml = `<p><strong>Krisp fix applied</strong></p>
<ul>
<li>Airtable lead <code>${escapeHtml(recId)}</code> updated (Email + name).</li>
<li>Postgres Krisp row <code>${escapeHtml(String(payload.pid))}</code> — new links created: <strong>${lr.linked}</strong> (checked ${lr.checked} participant emails).</li>
<li>Krisp participant token: ${escapeHtml(payload.pem)}</li>
</ul>`;

    if (adminEmail) {
      try {
        await sendAlertEmail(
          `[Krisp fix done] ${recId} — linked ${lr.linked}`,
          `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif">${summaryHtml}</body></html>`,
          adminEmail,
        );
      } catch (e) {
        log.warn(`confirmation email failed: ${e.message}`);
      }
    }

    return res.status(200).type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Done</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:2rem auto;padding:0 1rem">
${summaryHtml}
<p>If you expected a link and see zero new links, check that the lead email matches a participant in the Krisp payload.</p>
</body></html>`);
  } catch (e) {
    log.error(`KRISP-FIX failed: ${e.message}`);
    return res.status(500).type('html')
      .send(`<!DOCTYPE html><html><body><p>Update failed: ${escapeHtml(e.message)}</p><p><a href="javascript:history.back()">Back</a></p></body></html>`);
  }
});

/** GET /krisp/transcript?t=… */
router.get('/krisp/transcript', async (req, res) => {
  const token = typeof req.query.t === 'string' ? req.query.t.trim() : '';
  const payload = verifyKrispPublicToken(token);
  if (!payload || payload.typ !== 'tr') {
    return res.status(400).type('html')
      .send('<!DOCTYPE html><html><body><p>Invalid or expired link.</p></body></html>');
  }

  const row = await getKrispWebhookEventById(payload.pid);
  if (!row) {
    return res.status(404).type('html').send('<!DOCTYPE html><html><body><p>Not found.</p></body></html>');
  }

  const text = extractKrispDisplayText(row.payload);
  const title = escapeHtml(`Krisp #${row.id} — ${row.event || 'event'}`);
  const safeText = escapeHtml(text);
  res.type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:1rem auto;padding:0 1rem}textarea{width:100%;min-height:280px;font-family:ui-monospace,monospace;font-size:13px}button{padding:8px 14px;font-size:15px;margin-top:8px}</style></head><body>
<p style="color:#444;font-size:14px">Received: ${escapeHtml(String(row.received_at))} · Krisp id: ${escapeHtml(String(row.krisp_id || '—'))}</p>
<label for="txt"><strong>Transcript / body</strong></label>
<textarea id="txt" readonly>${safeText}</textarea>
<p><button type="button" id="copyBtn">Copy</button></p>
<script>
document.getElementById('copyBtn').addEventListener('click', async function() {
  var t = document.getElementById('txt');
  t.select();
  try {
    await navigator.clipboard.writeText(t.value);
    alert('Copied');
  } catch (e) {
    document.execCommand('copy');
    alert('Copied (fallback)');
  }
});
</script>
</body></html>`);
});

module.exports = router;
