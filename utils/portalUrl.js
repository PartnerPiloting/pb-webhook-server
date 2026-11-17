/**
 * The one address of the client portal - every link we hand a client is built from this.
 *
 * portal.knowaguy.com.au is the branded address (live since 13 Oct 2026, switched on for all links
 * 17 Nov 2026). The old pb-webhook-server.vercel.app address keeps working for links clients
 * already hold, so never remove it from CORS or the extension's host list.
 *
 * PORTAL_BASE_URL in the environment overrides it (staging, tests).
 */
const PORTAL_BASE_URL = (process.env.PORTAL_BASE_URL || 'https://portal.knowaguy.com.au').replace(/\/$/, '');

module.exports = { PORTAL_BASE_URL };
