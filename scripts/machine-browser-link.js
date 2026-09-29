/**
 * Give a client a web link to their Linked Helper machine.
 *
 *   node scripts/machine-browser-link.js Roland-Illyes --plan       what it would do; touches nothing
 *   node scripts/machine-browser-link.js Roland-Illyes              Cloudflare side + writes Machine Link
 *   node scripts/machine-browser-link.js Roland-Illyes --install    ...and puts it on the machine over ssh
 *   node scripts/machine-browser-link.js Roland-Illyes --add=pa@example.com   allow one more person
 *   node scripts/machine-browser-link.js Roland-Illyes --remove     the client has left - take the link away
 *
 * What the client ends up with: https://<client>.<domain> -> their email -> a one-time code ->
 * their machine's desktop in a browser tab. Nothing installed on their side. The why and the
 * shape are in services/machineBrowserLink.js; the machine's half is
 * scripts/linked-helper/lh-browser-access.sh.
 *
 * Safe to re-run: every step looks before it writes. Re-run it after changing the client's email
 * or the Machine Link Emails field and only the allowed list changes.
 *
 * WHO IS ALLOWED: the client's own email (Client Email Address), their coach's, and anyone in the
 * client's "Machine Link Emails" field. --add puts an address into that field so it survives the
 * next run.
 *
 * Needs, in .env.local on the laptop (never in the repo, never on Render - the server does not
 * talk to Cloudflare, it only reads the Machine Link field):
 *   CLOUDFLARE_API_TOKEN    permissions: Account > Cloudflare Tunnel: Edit, Account > Access: Apps
 *                           and Policies: Edit, Account > Access: Organizations, Identity
 *                           Providers, and Groups: Edit, Zone > DNS: Edit and Zone > Zone: Read
 *                           (the machine domain only)
 *   CLOUDFLARE_ACCOUNT_ID
 *   MACHINE_LINK_DOMAIN     the domain bought for this, e.g. example.com
 */
require('dotenv').config();
try { require('dotenv').config({ path: '.env.local' }); } catch (_) { /* optional */ }

const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const clientService = require('../services/clientService');
const { MASTER_TABLES } = require('../constants/airtableUnifiedConstants');
const { tailscaleAddress } = require('../services/clientMachineRdp');
const {
  machineHostname, machineLink, tunnelName, allowedEmails, cloudflare, ensureMachineLink, removeMachineLink,
  seatLine, countPeople,
} = require('../services/machineBrowserLink');

const FIELD_LINK = 'Machine Link';
const FIELD_EMAILS = 'Machine Link Emails';

// HOW WE GET ONTO A MACHINE. Every client machine: root, with the shared client-machines key.
// Guy's own machine is the exception - it was built on 1 Sep 2026, before the client method
// existed, so it is user `ubuntu` (then sudo) with its own key. That key must never go onto a
// client machine, which is why the two are kept apart here rather than "tidied" into one.
// --ssh-user= and --ssh-key= (a file name in ~/.ssh) override either for a one-off.
const DEFAULT_LOGIN = { user: 'root', key: 'wg_clients_ed25519' };
const OWN_LOGINS = { 'Guy-Wilson': { user: 'ubuntu', key: 'lh_vps_ed25519' } };

function machineLogin(clientId, args) {
  const arg = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
  const known = OWN_LOGINS[clientId] || DEFAULT_LOGIN;
  const user = arg('ssh-user') || known.user;
  const key = path.join(os.homedir(), '.ssh', path.basename(arg('ssh-key') || known.key));
  if (!/^[a-z_][a-z0-9_-]*$/.test(user)) throw new Error(`--ssh-user does not look like a user name: "${user}"`);
  return {
    user,
    key,
    // Where the install files land, and how to run them as root from there.
    home: user === 'root' ? '/root' : `/home/${user}`,
    sudo: user === 'root' ? '' : 'sudo ',
  };
}

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function ssh(login, address, remoteCommand) {
  return spawnSync('ssh', ['-i', login.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', `${login.user}@${address}`, remoteCommand],
    { stdio: ['ignore', 'inherit', 'inherit'] });
}

(async () => {
  const args = process.argv.slice(2);
  const wanted = (args.find((a) => !a.startsWith('--')) || '').trim();
  const flag = (name) => args.includes(`--${name}`);
  const add = (args.find((a) => a.startsWith('--add=')) || '').slice('--add='.length);
  if (!wanted) fail('Usage: node scripts/machine-browser-link.js <Client-ID> [--plan] [--install] [--add=email] [--remove]', 2);

  const domain = process.env.MACHINE_LINK_DOMAIN;
  if (!domain) fail('MACHINE_LINK_DOMAIN is not set (.env.local) - the domain bought for machine links.');

  const client = await clientService.getClientById(wanted);
  if (!client) fail(`No client found with id "${wanted}".`);
  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};

  let coachEmail = '';
  try {
    const coach = await clientService.getClientById(client.coach || 'Guy-Wilson');
    coachEmail = (coach && coach.clientEmailAddress) || '';
  } catch (_e) { /* the client's own email is enough to proceed */ }

  const extras = allowedEmails(raw[FIELD_EMAILS], add);
  const emails = allowedEmails(client.clientEmailAddress, coachEmail, extras);
  const hostname = machineHostname(client.clientId, domain);
  const address = tailscaleAddress(raw['Machine Tailscale']);
  const login = machineLogin(client.clientId, args);

  console.log(`\n${client.clientName || client.clientId}`);
  console.log(`  link      ${machineLink(client.clientId, domain)}`);
  console.log(`  tunnel    ${tunnelName(client.clientId)}`);
  console.log(`  allowed   ${emails.join(', ') || 'NOBODY'}`);
  console.log(`  machine   ${raw['Machine Tailscale'] || 'not reporting yet'} (as ${login.user})\n`);

  if (flag('plan')) {
    console.log('Plan only - nothing was changed.');
    return;
  }

  const call = cloudflare({ token: process.env.CLOUDFLARE_API_TOKEN });
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) fail('CLOUDFLARE_ACCOUNT_ID is not set (.env.local).');
  const log = (line) => console.log(`  - ${line}`);
  const base = clientService.initializeClientsBase();

  if (flag('remove')) {
    await removeMachineLink({ call, accountId, clientId: client.clientId, domain, log });
    await base(MASTER_TABLES.CLIENTS).update(client.id, { [FIELD_LINK]: '' });
    if (address) ssh(login, address, `test -f ${login.home}/lh-browser-access.sh && ${login.sudo}bash ${login.home}/lh-browser-access.sh --remove`);
    console.log(`\n${hostname} is gone. The machine itself is untouched.`);
    return;
  }

  if (!client.clientEmailAddress) fail(`${client.clientId} has no Client Email Address - they would have no way to sign in.`);

  const made = await ensureMachineLink({ call, accountId, clientId: client.clientId, domain, emails, log });

  const fields = { [FIELD_LINK]: made.link };
  if (add) fields[FIELD_EMAILS] = extras.join(', ');
  await base(MASTER_TABLES.CLIENTS).update(client.id, fields, { typecast: true });
  log(`wrote ${FIELD_LINK} on the ${client.clientId} row`);

  // Said every run, so the free limit can never arrive as a surprise.
  const people = await countPeople({ call, accountId });
  if (people !== null) {
    const seats = seatLine(people);
    console.log(seats.warn ? `\n*** ${seats.text} ***` : `  - ${seats.text}`);
  }

  if (!flag('install')) {
    console.log(`\nCloudflare side done. The machine still needs its half - re-run with --install${address ? '' : ' (once the machine is reporting its Tailscale address)'}.`);
    return;
  }

  if (!address) fail(`${client.clientId} has no 100.x address in Machine Tailscale - cannot reach the machine to install.`);
  const src = path.join(__dirname, 'linked-helper');
  const copy = spawnSync('scp', ['-i', login.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
    path.join(src, 'lh-browser-access.sh'), path.join(src, 'lh-browser-page.html'), `${login.user}@${address}:${login.home}/`],
  { stdio: ['ignore', 'inherit', 'inherit'] });
  if (copy.status !== 0) fail('Could not copy the install script to the machine (is Tailscale on, on this laptop?).');
  // The token is base64 (letters, digits, =, -, _) so single quotes are safe around it.
  if (!/^[A-Za-z0-9=_-]+$/.test(made.tunnelToken)) fail('The tunnel token has characters in it that were not expected - not sending it to a shell.');
  const run = ssh(login, address, `${login.sudo}TUNNEL_TOKEN='${made.tunnelToken}' bash ${login.home}/lh-browser-access.sh`);
  if (run.status !== 0) fail('The install on the machine did not finish - read the lines above.');

  console.log(`\nDONE. Open ${made.link} - sign in with ${coachEmail || 'your email'}, and you should see ${client.clientName || client.clientId}'s Linked Helper screen.`);
  console.log('Proven means the CLIENT has opened it on their own computer - then set Machine Icon Proven on their row.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
