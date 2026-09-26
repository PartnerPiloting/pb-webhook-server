/**
 * Make a client's desktop icon for their Linked Helper machine.
 *
 *   node scripts/make-client-rdp.js Sam-Noble
 *   node scripts/make-client-rdp.js Sam-Noble --size=2560x1440
 *
 * Writes "Linked Helper machine.rdp" into ./client-icons/<Client-ID>/ (git-ignored) using the
 * 100.x address the machine itself reported to the client's Machine Tailscale field - so there is
 * nothing to look up or mistype. --size must match the machine's screen (setup-ubuntu-vps.sh sets
 * it; 1920x1080 unless it was changed to the client's monitor).
 *
 * Getting it to the client: send it in the Zoom chat during the session and have them save it to
 * their desktop. Do NOT email it - Outlook blocks .rdp attachments outright.
 *
 * The full step (Tailscale on their laptop, share the machine, prove the double-click) is
 * checklist step 14: docs/wingguy-onboarding-checklist.md. Afterwards set "Machine Icon Proven"
 * on their Clients row.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const clientService = require('../services/clientService');
const { tailscaleAddress, parseSize, buildRdpFile } = require('../services/clientMachineRdp');

(async () => {
  const args = process.argv.slice(2);
  const wanted = (args.find((a) => !a.startsWith('--')) || '').trim();
  const sizeArg = (args.find((a) => a.startsWith('--size=')) || '').slice('--size='.length);
  if (!wanted) {
    console.error('Usage: node scripts/make-client-rdp.js <Client-ID> [--size=1920x1080]');
    process.exit(2);
  }
  const size = sizeArg ? parseSize(sizeArg) : { width: 1920, height: 1080 };
  if (!size) {
    console.error(`--size must look like 1920x1080, got "${sizeArg}".`);
    process.exit(2);
  }

  const client = await clientService.getClientById(wanted);
  if (!client) {
    console.error(`No client found with id "${wanted}".`);
    process.exit(1);
  }
  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
  const tailscale = raw['Machine Tailscale'] || '';
  const address = tailscaleAddress(tailscale);
  if (!address) {
    console.error(`${client.clientId} has no 100.x address in Machine Tailscale ("${tailscale}").`
      + ' The machine fills that in itself once it is built and reporting - check its REPORT_URL/REPORT_SECRET.');
    process.exit(1);
  }

  const dir = path.join(process.cwd(), 'client-icons', client.clientId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Linked Helper machine.rdp');
  fs.writeFileSync(file, buildRdpFile({ address, ...size }));

  console.log(`
Icon for ${client.clientId}: ${file}
  points at ${address} (${tailscale.trim()}), screen ${size.width}x${size.height}

Before it works on their laptop:
  1. They install Tailscale and sign in with their OWN Gmail.
  2. You share ${tailscale.trim().split(/\s+/)[0] || 'the machine'} to that address (Tailscale admin -> Machines -> ... -> Share), they accept.
  3. Send this file in the Zoom chat (never email - Outlook blocks .rdp), they save it to their desktop.
  4. They double-click it and see the Linked Helper screen. Then set "Machine Icon Proven" on their row.
`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
