/**
 * Share links - turning the link a person copies out of OneDrive, Google Drive or Dropbox into
 * the address the file itself can be fetched from.
 *
 * WHY: a client moving onto their Linked Helper machine has an export of their old copy sitting
 * on their own laptop, and the machine is a screen in a browser tab - nothing can be dragged into
 * it. Until 30 Sep 2026 the file went laptop -> email to Guy -> Claude copies it on, which put
 * Guy in the middle of every move. Claude cannot be handed a file by a chat, only text, so the
 * client hands over a LINK and the machine fetches the file itself
 * (services/machineFileStore.js, scripts/linked-helper/lh-clipboard.py).
 *
 * A share link opens a PAGE about the file, not the file. Each service has its own way of asking
 * for the file instead, and that is all this module knows. Pure - no network, no database.
 *
 * ONLY THESE THREE, ON PURPOSE. The machine is signed in to somebody's LinkedIn account. "Fetch
 * whatever address the chat was given" is how a machine ends up holding something it should not.
 * A short list of services people already keep their files in is enough, and anything else is
 * refused in words a person can act on.
 */

const ACCEPTED = 'OneDrive, Google Drive or Dropbox';

/** What a machine will keep. An export to import, or a list to load - never anything that runs. */
const ALLOWED_EXTENSIONS = ['.lhd2', '.csv'];

function refuse(why) {
  const e = new Error(why);
  e.refused = true;
  return e;
}

function parse(raw) {
  const text = String(raw || '').trim().replace(/^<|>$/g, '');
  if (!text) throw refuse('There is no link there. Paste the share link for the file.');
  let u;
  try {
    u = new URL(text);
  } catch (_e) {
    throw refuse(`That does not look like a link: "${text.slice(0, 80)}". Copy the share link from ${ACCEPTED} and paste the whole thing.`);
  }
  if (u.protocol !== 'https:') throw refuse('The link has to start with https://.');
  if (u.username || u.password) throw refuse('That link has a sign-in built into it. Use an ordinary share link.');
  return u;
}

const isHost = (host, ...names) => names.some((n) => host === n || host.endsWith(`.${n}`));

/** base64url of the whole share link, the form OneDrive's own sharing address takes. */
function oneDriveShareToken(url) {
  return `u!${Buffer.from(url).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
}

function googleFileId(u) {
  const inPath = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (inPath) return inPath[1];
  const id = u.searchParams.get('id');
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
}

/**
 * Returns { service, shareUrl, downloadUrl } or throws an Error with `.refused = true` whose
 * message is written for the person who pasted the link.
 */
function resolveShareLink(raw) {
  const u = parse(raw);
  const host = u.hostname.toLowerCase();
  const shareUrl = u.toString();

  if (isHost(host, 'dropbox.com')) {
    const d = new URL(shareUrl);
    d.searchParams.set('dl', '1');
    return { service: 'Dropbox', shareUrl, downloadUrl: d.toString() };
  }

  if (isHost(host, 'drive.google.com', 'drive.usercontent.google.com')) {
    if (u.pathname.includes('/folders/')) {
      throw refuse('That is a link to a Google Drive FOLDER. Open the folder, right-click the file itself, and copy the link to that.');
    }
    const id = googleFileId(u);
    if (!id) throw refuse('That Google Drive link does not point at one file. Right-click the file, choose Share, then Copy link.');
    // confirm=t skips Google's "too large to scan for viruses" page, which a big export gets.
    return { service: 'Google Drive', shareUrl, downloadUrl: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t` };
  }
  if (isHost(host, 'docs.google.com')) {
    throw refuse('That is a Google Docs or Sheets link, not a file. The file needs to be the export itself, uploaded to Google Drive.');
  }

  if (isHost(host, '1drv.ms', 'onedrive.live.com')) {
    return { service: 'OneDrive', shareUrl, downloadUrl: `https://api.onedrive.com/v1.0/shares/${oneDriveShareToken(shareUrl)}/root/content` };
  }
  if (isHost(host, 'sharepoint.com')) {
    // OneDrive on a work or school account lives on SharePoint.
    const d = new URL(shareUrl);
    d.searchParams.set('download', '1');
    return { service: 'OneDrive (work)', shareUrl, downloadUrl: d.toString() };
  }

  throw refuse(`I can only fetch a file from ${ACCEPTED}, and that link is from ${host}. Put the file in one of those, share it so anyone with the link can view it, and paste that link.`);
}

/** Is this host one a machine may be sent to? The machine's agent asks the same question. */
function isAcceptedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return isHost(host, 'dropbox.com', 'drive.google.com', 'drive.usercontent.google.com',
    '1drv.ms', 'onedrive.live.com', 'api.onedrive.com', 'sharepoint.com');
}

module.exports = { resolveShareLink, isAcceptedHost, oneDriveShareToken, ACCEPTED, ALLOWED_EXTENSIONS };
