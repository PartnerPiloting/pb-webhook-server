/**
 * extensionPolicy - what the server tells a client's browser extension about its own version.
 *
 * Why this exists (Guy, 5 Nov 2026): extension 0.3.38 re-dated old messages as "today" and the
 * only client who could not be fixed from here was the one who updates by hand (Ashley Knowles).
 * Some clients are on the hourly updater, some download from the portal, and Guy does not want to
 * email anyone "update urgently". So:
 *
 *   1. The extension (0.3.41+) sends its version with every request (header x-wingguy-version).
 *   2. It asks GET /api/wingguy/extension-status when the panel opens and shows whatever notice
 *      comes back - the wording lives in content/extension-policy.json, not in the extension.
 *   3. A version listed in pausedVersions stops SAVING conversations (the quick-update route
 *      refuses, and the extension skips the save) while drafting carries on. A faulty version can
 *      then do no harm while its owner gets round to the 30-second update.
 *
 * Versions before 0.3.41 send no header: they are never shown a notice and can never be paused by
 * version. They are covered by the portal hub's status card and, for the 0.3.38 fault, by
 * utils/captureDateGuard.dropForgedToday.
 *
 * Pure apart from reading the two files. Tested by tests/extension-policy.test.js.
 */
const fs = require('fs');
const path = require('path');

const POLICY_FILE = path.join(__dirname, '..', 'content', 'extension-policy.json');
const MANIFEST_FILE = path.join(__dirname, '..', 'wingguy-extension', 'manifest.json');
const VERSION_HEADER = 'x-wingguy-version';

let policyCache = null;
let currentCache = null;

function loadPolicy() {
  if (policyCache) return policyCache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')); } catch (_) { raw = {}; }
  policyCache = {
    pausedVersions: Array.isArray(raw.pausedVersions) ? raw.pausedVersions.map((v) => cleanVersion(v)).filter(Boolean) : [],
    notices: raw.notices && typeof raw.notices === 'object' ? raw.notices : {},
  };
  return policyCache;
}

/** The version the server is handing out right now (the manifest in this deploy). */
function currentVersion() {
  if (currentCache !== null) return currentCache;
  try { currentCache = cleanVersion(JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')).version); } catch (_) { currentCache = ''; }
  return currentCache;
}

/** A version string we are prepared to compare and store: digits and dots only. '' otherwise. */
function cleanVersion(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{1,4}(\.\d{1,4}){1,3}$/.test(s) ? s : '';
}

/** -1 / 0 / 1, comparing part by part as numbers (0.3.9 is older than 0.3.10). */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function isPaused(version, policy = loadPolicy()) {
  const v = cleanVersion(version);
  return !!v && policy.pausedVersions.includes(v);
}

/**
 * The answer to "how is my version?".
 * @param {Object} args
 * @param {string} args.version  what the extension says it is ('' = it did not say)
 * @param {string} args.current  the version the server hands out
 * @param {'portal'|'updater'} [args.lane]  how this client gets updates
 * @returns {{yours:string, current:string, behind:boolean, paused:boolean, notice:null|{tone:string,text:string,button?:string,action?:string}, toast?:string}}
 */
function extensionStatus({ version, current, lane = 'portal', policy = loadPolicy() } = {}) {
  const yours = cleanVersion(version);
  const cur = cleanVersion(current);
  const n = policy.notices || {};
  const paused = isPaused(yours, policy);
  const behind = !!yours && !!cur && compareVersions(yours, cur) < 0;
  let notice = null;
  if (paused) {
    notice = { tone: 'pause', text: n.paused || 'This version of Wingguy needs updating before it can save conversations again.', button: n.button || 'Get the new version', action: 'open-install' };
  } else if (behind && lane === 'updater') {
    notice = { tone: 'info', text: n.updaterBehind || 'A new version of Wingguy is on its way to this computer.' };
  } else if (behind) {
    notice = { tone: 'info', text: n.portalBehind || 'A new version of Wingguy is ready.', button: n.button || 'Get the new version', action: 'open-install' };
  }
  const out = { yours, current: cur, behind, paused, notice };
  if (paused) out.toast = pausedToast(policy);
  return out;
}

function pausedToast(policy = loadPolicy()) {
  return (policy.notices && policy.notices.pausedToast) || 'Not saved - Wingguy needs updating first.';
}

/** What the save route answers for a paused version: a 200 the extension reads, not an error. */
function pausedSaveResponse(policy = loadPolicy()) {
  return { paused: true, saved: false, message: pausedToast(policy) };
}

function _resetCachesForTests() { policyCache = null; currentCache = null; }

module.exports = {
  VERSION_HEADER, loadPolicy, currentVersion, cleanVersion, compareVersions, isPaused,
  extensionStatus, pausedSaveResponse, pausedToast, _resetCachesForTests,
};
