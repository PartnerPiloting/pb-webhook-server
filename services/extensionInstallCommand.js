// services/extensionInstallCommand.js
// The ONE place that builds the "paste this on their machine" line for the extension updater.
// Used by scripts/extension-install-command.js (the terminal) and by the concierge sheet on the
// portal (services/clientBoardService.js), so the two can never drift apart.
//
// Everything about the SHAPE of these lines was learned on real machines - read the history in
// scripts/extension-install-command.js before changing a character:
//   - PowerShell-native, no `powershell -Command "..."` wrapper (the token vanishes otherwise)
//   - the token travels as a HEADER, never in the URL, so it stays out of request logs
//   - `-ExecutionPolicy Bypass -File` on the CHILD, never Set-ExecutionPolicy on the pasted line
//   - the Mac line is UNPROVEN on a real Mac (2026-09-16) - walk it, do not send it

const DEFAULT_SERVER = 'https://pb-webhook-server.onrender.com';

function serverBase(override) {
  return String(override || process.env.EXTENSION_DIST_SERVER || DEFAULT_SERVER).replace(/\/+$/, '');
}

/**
 * @param {string} token   the client's Portal Token (their existing per-client secret)
 * @param {object} [opts]  { server } to override the dist server (staging etc)
 * @returns {{ windows: string, mac: string, server: string }}
 */
function buildInstallCommands(token, opts = {}) {
  const t = String(token || '').trim();
  if (!t) throw new Error('no portal token - mint one before building the install line');
  if (/['"\s]/.test(t)) throw new Error('portal token contains a quote or whitespace - refusing to build a line that would break');
  const server = serverBase(opts.server);

  const windows =
    `$t='${t}'; $p=Join-Path $env:TEMP 'wg.ps1'; ` +
    `Invoke-WebRequest -Uri '${server}/extension/dist/installer' -Headers @{'x-portal-token'=$t} -OutFile $p -UseBasicParsing; ` +
    `& powershell.exe -ExecutionPolicy Bypass -File $p -Install -Server '${server}' -Token $t`;

  const mac =
    `T='${t}'; curl -sS -H "x-portal-token: $T" '${server}/extension/dist/installer.sh' -o /tmp/wg.sh && ` +
    `bash /tmp/wg.sh --install --server '${server}' --token "$T"`;

  return { windows, mac, server };
}

module.exports = { buildInstallCommands, DEFAULT_SERVER };
