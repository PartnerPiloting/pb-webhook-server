/**
 * The client's desktop icon for their Linked Helper machine - a Remote Desktop (.rdp) file.
 *
 * WHY: every client ends up needing to open their own machine (topping up campaigns, looking at
 * what it is doing). Until 26 Sep 2026 the icon was a "later, optional" follow-up, so it never
 * happened - Sam Noble was told "icon on your desktop" and there was none. It is now part of the
 * machine session (checklist step 14), and this builds the file so nobody hand-edits one.
 *
 * The file points at the machine's Tailscale 100.x ADDRESS, not its name: the machine is shared
 * into the client's own tailnet, and a shared machine's name does not resolve the same way on the
 * client's side as it does on Guy's. The address is the same everywhere.
 *
 * No password goes in the file. The machine's xrdp.ini carries the screen password and autoruns
 * straight onto the Linked Helper screen (setup-ubuntu-vps.sh), so a double-click lands there.
 *
 * Settings are Guy's own proven "Sydney Linked Helper.rdp", with three changes for clients:
 * smart sizing on and dynamic resolution off (the server screen is a fixed size - let the window
 * scale it), and the client's drives NOT redirected into the machine.
 */

const TAILSCALE_ADDRESS = /\b100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/;

/** Pull the 100.x address out of the Machine Tailscale field ("lh-sam-noble 100.83.127.27"). */
function tailscaleAddress(machineTailscale) {
  const m = String(machineTailscale || '').match(TAILSCALE_ADDRESS);
  if (!m) return null;
  if ([m[1], m[2], m[3]].some((n) => Number(n) > 255)) return null;
  return m[0];
}

function parseSize(size) {
  const m = String(size || '').trim().match(/^(\d{3,4})x(\d{3,4})$/i);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Build the .rdp text. Windows' Remote Desktop reads UTF-8 fine; CRLF line endings because it is
 * a Windows file first (the Mac Windows App reads it either way).
 */
function buildRdpFile({ address, width = 1920, height = 1080 }) {
  if (!address) throw new Error('no Tailscale address');
  const lines = [
    `full address:s:${address}`,
    'username:s:lh',
    'screen mode id:i:2',
    'use multimon:i:0',
    `desktopwidth:i:${width}`,
    `desktopheight:i:${height}`,
    'smart sizing:i:1',
    'dynamic resolution:i:0',
    'session bpp:i:24',
    'compression:i:1',
    'audiomode:i:2',
    'redirectclipboard:i:1',
    'redirectprinters:i:0',
    'redirectdrives:i:0',
    'authentication level:i:0',
    'prompt for credentials:i:0',
    'negotiate security layer:i:0',
    'enablecredsspsupport:i:0',
    'autoreconnection enabled:i:1',
    'bitmapcachepersistenable:i:1',
  ];
  return lines.join('\r\n') + '\r\n';
}

module.exports = { tailscaleAddress, parseSize, buildRdpFile };
