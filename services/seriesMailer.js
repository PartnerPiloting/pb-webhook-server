// services/seriesMailer.js
//
// Sends one series email through Mailgun, from the I Know A Guy domain.
//
// Separate from emailNotificationService (which also speaks Mailgun) because
// that one sends operational alerts from whatever MAILGUN_DOMAIN is set to.
// The series has its own identity and its own sending subdomain, and mixing the
// two would mean a reputation problem with one silently affecting the other.
//
// Inbox identity (settled 2026-07-19, PROSPECT-SERIES-PLAN.md):
//   From:    Guy · I Know a Guy <guy@knowaguy.com.au>
//   Subject: #N · <piece title>          (no brand prefix - the From carries it)
//   Preheader: Network building, rethought · part N of 19
//
// The From address is at the ROOT domain while the message is signed by the
// mg. subdomain. That is deliberate: recipients see a clean personal address,
// and DMARC still passes because the domain's policy uses relaxed alignment
// (aspf=r; adkim=r), under which a subdomain aligns with its parent.

const https = require('https');
const querystring = require('querystring');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'series_mailer' });

const SENDING_DOMAIN = () => (process.env.SERIES_MAILGUN_DOMAIN || 'mg.knowaguy.com.au').trim();
const FROM_NAME = () => (process.env.SERIES_FROM_NAME || 'Guy · I Know a Guy').trim();
const FROM_EMAIL = () => (process.env.SERIES_FROM_EMAIL || 'guy@knowaguy.com.au').trim();
const REPLY_TO = () => (process.env.SERIES_REPLY_TO || FROM_EMAIL()).trim();

function isConfigured() {
  return Boolean((process.env.MAILGUN_API_KEY || '').trim());
}

// A preheader is the grey line an inbox shows after the subject. Left alone it
// scrapes whatever text comes first, which is usually the greeting - a wasted
// line. Hidden span, so it shows in the list view and not in the opened email.
function withPreheader(html, text) {
  const hidden = `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${text}</span>`;
  return html.replace(/(<body[^>]*>)/i, `$1${hidden}`);
}

/**
 * Send one series email.
 * Returns { ok, id } or { ok:false, error }. Never throws — a single bad
 * recipient must not abort the rest of the run.
 */
async function sendSeriesEmail({ to, subject, html, unsubscribeUrl, preheader, tag }) {
  if (!isConfigured()) return { ok: false, error: 'MAILGUN_API_KEY not set' };
  if (!to || !subject || !html) return { ok: false, error: 'to, subject and html are required' };

  const body = preheader ? withPreheader(html, preheader) : html;

  const fields = {
    from: `${FROM_NAME()} <${FROM_EMAIL()}>`,
    to,
    subject,
    html: body,
    'h:Reply-To': REPLY_TO(),
    // Gmail and friends surface a native Unsubscribe control from these, which
    // is far better for reputation than someone reaching for "report spam"
    // because they could not find the link in the footer.
    ...(unsubscribeUrl ? {
      'h:List-Unsubscribe': `<${unsubscribeUrl}>`,
      'h:List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    } : {}),
    'o:tracking-clicks': 'no',   // link rewriting reads as bulk in a personal letter
    'o:tracking-opens': 'yes',   // the early-warning signal that mail is landing
    ...(tag ? { 'o:tag': tag } : {}),
  };

  const data = querystring.stringify(fields);
  const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64');

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.mailgun.net',
      port: 443,
      path: `/v3/${SENDING_DOMAIN()}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let id;
          try { id = JSON.parse(out).id; } catch { id = undefined; }
          return resolve({ ok: true, id });
        }
        logger.error(`[series] Mailgun ${res.statusCode} for ${to}: ${out.slice(0, 200)}`);
        resolve({ ok: false, error: `Mailgun ${res.statusCode}` });
      });
    });
    req.on('error', (err) => {
      logger.error(`[series] send failed for ${to}: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });
    req.write(data);
    req.end();
  });
}

module.exports = { sendSeriesEmail, isConfigured, SENDING_DOMAIN, FROM_EMAIL };
