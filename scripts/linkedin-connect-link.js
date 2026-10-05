/**
 * Mint the "connect your LinkedIn" link for a client (services/unipileHostedAuth.js - Reconnect).
 * The client opens it, signs in to LinkedIn on Unipile's page, and their record gets its LinkedIn
 * account id and connected date by itself. Their mail and calendar connection is not touched.
 * Run as a Render one-off job (it needs the server's Unipile key).
 *
 * Usage:
 *   node scripts/linkedin-connect-link.js --tenant=Client-Id
 *
 * The link lasts 24 hours. Send it a few days BEFORE the Reconnect session: Unipile starts
 * pulling the inbox history the moment they connect, and that takes hours to days.
 */

require('dotenv').config();

const arg = process.argv.slice(2).find((a) => a.startsWith('--tenant='));
const tenant = arg ? arg.slice('--tenant='.length) : '';
if (!tenant) { console.error('[linkedin-connect-link] --tenant=Client-Id is required'); process.exit(1); }

(async () => {
  const clientService = require('../services/clientService');
  const client = await clientService.getClientById(tenant);
  if (!client) { console.error(`[linkedin-connect-link] no client ${tenant}`); process.exit(1); }
  if (client.unipileLinkedinAccountId) console.log(`[linkedin-connect-link] NOTE: ${tenant} already has a LinkedIn connection on file (${client.unipileLinkedinAccountId}). A new approval replaces it.`);
  const link = await require('../services/unipileHostedAuth').mintHostedLink(tenant, { linkedin: true });
  console.log(`[linkedin-connect-link] ${tenant} - expires ${link.expiresAt}`);
  console.log(`LINK ${link.url}`);
  process.exit(0);
})().catch((e) => { console.error(`[linkedin-connect-link] FAILED - ${e.message}`); process.exit(1); });
