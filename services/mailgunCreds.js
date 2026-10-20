// services/mailgunCreds.js
//
// The one place every server-sent email gets its Mailgun key, its sending domain and its
// From address. Change the sender identity here (or in the env vars this reads) and every
// alert, client notification, invoice, digest and inbound-pipe reply moves together.
//
// Why one place: on 16 Oct 2026 Australian Side Hustles was retired, but eleven files each
// read MAILGUN_API_KEY / MAILGUN_DOMAIN / FROM_EMAIL for themselves and kept sending as ASH.
// The series mailer (services/seriesMailer.js) moved first and proved the knowaguy domain;
// this helper moves everything else the same way.
//
// Mailgun keys can be scoped to one domain. The old shared key only sends for the ASH
// domain (401 on mg.knowaguy.com.au), so the key and the domain must always change as a
// pair. The order of precedence below guarantees they do:
//
//   1. MAILGUN_DOMAIN is mg.knowaguy.com.au (or any non-retired domain) -> use MAILGUN_API_KEY
//      with it. This is the steady state once the Render env group has been updated.
//   2. MAILGUN_DOMAIN is unset or still a retired ASH domain, and a knowaguy key exists
//      (KNOWAGUY_MAILGUN_API_KEY, or SERIES_MAILGUN_API_KEY which is the same domain key)
//      -> send as knowaguy with that key. This is the bridge: the code can deploy before
//      the env vars change and nothing goes out as ASH in between.
//   3. Otherwise -> whatever MAILGUN_API_KEY / MAILGUN_DOMAIN say (legacy).
//
// From address: at the ROOT domain (guy@knowaguy.com.au), while the message is signed by
// the mg. subdomain. DMARC on knowaguy.com.au uses relaxed alignment (aspf=r; adkim=r), so
// a subdomain signature aligns with the parent and the reader sees a clean address. A
// FROM_EMAIL that still points at a retired domain is ignored, for the same reason: an ASH
// From on a knowaguy signature would fail alignment.

const https = require('https');
const querystring = require('querystring');

const KNOWAGUY_SENDING_DOMAIN = 'mg.knowaguy.com.au';
const DEFAULT_FROM_EMAIL = 'guy@knowaguy.com.au';
const RETIRED_DOMAINS = ['australiansidehustles.com.au', 'mail.australiansidehustles.com.au'];

function isRetiredDomain(domain) {
    const d = String(domain || '').trim().toLowerCase();
    return RETIRED_DOMAINS.some((r) => d === r || d.endsWith(`.${r}`));
}

/**
 * The key + domain pair to send with. Always a matched pair - never mix the ASH key with the
 * knowaguy domain or vice versa.
 * @returns {{ apiKey: string, domain: string, source: 'env'|'knowaguy-key'|'legacy' }}
 */
function mailgunCreds() {
    const envDomain = String(process.env.MAILGUN_DOMAIN || '').trim();
    const envKey = String(process.env.MAILGUN_API_KEY || '').trim();
    const knowaguyKey = String(process.env.KNOWAGUY_MAILGUN_API_KEY || process.env.SERIES_MAILGUN_API_KEY || '').trim();

    if (envDomain && !isRetiredDomain(envDomain)) {
        return { apiKey: envKey, domain: envDomain, source: 'env' };
    }
    if (knowaguyKey) {
        return { apiKey: knowaguyKey, domain: KNOWAGUY_SENDING_DOMAIN, source: 'knowaguy-key' };
    }
    return { apiKey: envKey, domain: envDomain, source: 'legacy' };
}

function isConfigured() {
    const { apiKey, domain } = mailgunCreds();
    return Boolean(apiKey && domain);
}

/** The bare From address (no display name). */
function fromEmail() {
    const env = String(process.env.FROM_EMAIL || '').trim();
    if (!env) return DEFAULT_FROM_EMAIL;
    const bare = env.includes('<') ? env.slice(env.indexOf('<') + 1, env.indexOf('>')).trim() : env;
    const domain = bare.split('@')[1];
    return isRetiredDomain(domain) ? DEFAULT_FROM_EMAIL : env;
}

/**
 * A From header with a display name: fromAddress('Wingguy') -> 'Wingguy <guy@knowaguy.com.au>'.
 * If FROM_EMAIL already carries a display name it is used as-is.
 */
function fromAddress(displayName) {
    const addr = fromEmail();
    if (!displayName || addr.includes('<')) return addr;
    return `${displayName} <${addr}>`;
}

/**
 * Send one message through Mailgun (url-encoded; for attachments see
 * emailNotificationService.sendMailgunEmailWithAttachments). Resolves with Mailgun's parsed
 * reply ({ id, message }) and rejects on any non-2xx so callers can log the real reason.
 */
function sendMailgunMessage(fields) {
    const { apiKey, domain } = mailgunCreds();
    if (!apiKey || !domain) {
        return Promise.reject(new Error('Mailgun not configured - missing MAILGUN_API_KEY / MAILGUN_DOMAIN'));
    }
    return new Promise((resolve, reject) => {
        const data = querystring.stringify(fields);
        const auth = Buffer.from(`api:${apiKey}`).toString('base64');
        const req = https.request({
            hostname: 'api.mailgun.net',
            port: 443,
            path: `/v3/${domain}/messages`,
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(body)); } catch (_) { resolve({ id: 'unknown', message: body }); }
                } else {
                    reject(new Error(`Mailgun API error: ${res.statusCode} - ${String(body).slice(0, 300)}`));
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

module.exports = {
    mailgunCreds,
    isConfigured,
    fromEmail,
    fromAddress,
    sendMailgunMessage,
    isRetiredDomain,
    KNOWAGUY_SENDING_DOMAIN,
    DEFAULT_FROM_EMAIL,
};
