/**
 * Print the ready-to-paste install line for one client's machine.
 *
 *   node scripts/extension-install-command.js Rick-Wong
 *
 * WHY: the clumsiest step of installing the updater used to be getting the script onto the
 * client's machine at all - copying a file across a remote session. The server now serves the
 * updater itself (GET /extension/dist/installer), so the whole job becomes ONE pasted line. This
 * prints that line with the client's own portal token already in it, so there is nothing to
 * look up, assemble or mistype while sitting in front of someone else's computer.
 *
 * The token is the client's existing Portal Token - the same one their extension and portal
 * already use. It is deliberately passed as a HEADER, never in the URL, so it never lands in
 * the server's request logs.
 *
 * See docs/extension-updater.md for the rest of the sequence (load unpacked, portal once,
 * then `node scripts/extension-fleet.js` to confirm the machine reported in).
 */
require('dotenv').config();

const clientService = require('../services/clientService');

const DEFAULT_SERVER = (process.env.EXTENSION_DIST_SERVER || 'https://pb-webhook-server.onrender.com').replace(/\/+$/, '');

(async () => {
  const wanted = (process.argv[2] || '').trim();
  if (!wanted) {
    console.error('Usage: node scripts/extension-install-command.js <Client-ID>');
    process.exit(2);
  }

  const client = await clientService.getClientById(wanted);
  if (!client) {
    console.error(`No client found with id "${wanted}".`);
    process.exit(1);
  }

  const raw = (client.rawRecord && client.rawRecord._rawJson && client.rawRecord._rawJson.fields) || {};
  const token = (raw['Portal Token'] || '').trim();
  if (!token) {
    console.error(`${client.clientId} has no Portal Token on their row - mint one before installing.`);
    process.exit(1);
  }
  if (client.status !== 'Active') {
    console.error(`WARNING: ${client.clientId} is "${client.status}", not Active. The updater will be refused until they are Active.\n`);
  }

  // PowerShell-NATIVE, with no `powershell -Command "..."` wrapper. The wrapper only works
  // from a Command Prompt: pasted into PowerShell, the OUTER session expands $t first and,
  // since it does not exist there, the token silently vanishes leaving @{'x-portal-token'=}.
  // Guy hit this on his own machine, 2026-09-03. Assume the person is already in PowerShell -
  // that is what anyone opens. Set-ExecutionPolicy -Scope Process replaces the -ExecutionPolicy
  // flag the wrapper used to carry, and affects only that one window.
  const win =
    `Set-ExecutionPolicy -Scope Process Bypass -Force; $t='${token}'; $p=Join-Path $env:TEMP 'wg.ps1'; ` +
    `Invoke-WebRequest -Uri '${DEFAULT_SERVER}/extension/dist/installer' -Headers @{'x-portal-token'=$t} -OutFile $p -UseBasicParsing; ` +
    `& $p -Install -Server '${DEFAULT_SERVER}' -Token $t`;

  const mac =
    `T='${token}'; curl -sS -H "x-portal-token: $T" '${DEFAULT_SERVER}/extension/dist/installer.sh' -o /tmp/wg.sh && ` +
    `bash /tmp/wg.sh --install --server '${DEFAULT_SERVER}' --token "$T"`;

  console.log(`
Install the Wingguy extension updater for ${client.clientId}
${'='.repeat(60)}

On THEIR machine, open a normal PowerShell (NOT administrator) and paste one line.
PowerShell, not Command Prompt - the line is written for PowerShell.

WINDOWS - PowerShell
--------------------
${win}

MAC - Terminal   [script UNPROVEN on a real Mac - walk it, do not send it]
--------------
${mac}

Then, still on their machine:
  1. Browser -> chrome://extensions or edge://extensions
  2. Developer mode ON  (Edge: the toggle is in the LEFT sidebar)
  3. Load unpacked -> C:\\Wingguy   (Mac: ~/Wingguy)
  4. Open their portal ONCE in that browser - storage is per browser, so it
     knows nothing until you do
  5. /wg on any LinkedIn profile. A message about a missing Anthropic key is
     correct behaviour, not a broken install.

Back on your machine, confirm it reported in:
  node scripts/extension-fleet.js
`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
