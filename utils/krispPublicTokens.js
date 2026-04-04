/**
 * Signed, time-limited tokens for public Krisp URLs (fix form, transcript view).
 * Uses KRISP_PUBLIC_LINK_SECRET if set, else PB_WEBHOOK_SECRET.
 */

const crypto = require('crypto');

function linkSecret() {
  return (process.env.KRISP_PUBLIC_LINK_SECRET || process.env.PB_WEBHOOK_SECRET || '').trim();
}

function timingSafeEqualB64u(a, b) {
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/**
 * @param {{ typ: 'fix'|'tr', pid: number, pem?: string, exp: number }} payload exp = unix seconds
 */
function signKrispPublicToken(payload) {
  const secret = linkSecret();
  if (!secret) return null;
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(json).digest('base64url');
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  return `${b64}.${sig}`;
}

/** @returns {null | { typ: string, pid: number, pem?: string, exp: number }} */
function verifyKrispPublicToken(tokenStr) {
  const secret = linkSecret();
  if (!secret || !tokenStr || typeof tokenStr !== 'string') return null;
  const dot = tokenStr.lastIndexOf('.');
  if (dot <= 0) return null;
  const jsonPart = tokenStr.slice(0, dot);
  const sigPart = tokenStr.slice(dot + 1);
  let json;
  try {
    json = Buffer.from(jsonPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expectedSig = crypto.createHmac('sha256', secret).update(json).digest('base64url');
  if (!timingSafeEqualB64u(sigPart, expectedSig)) return null;
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  if (payload.typ !== 'fix' && payload.typ !== 'tr') return null;
  const pid = Number(payload.pid);
  if (!Number.isFinite(pid) || pid < 1) return null;
  return payload;
}

function signFixUnmatchedToken(postgresId, participantEmailNormalized, expDays = 7) {
  const exp = Math.floor(Date.now() / 1000) + expDays * 86400;
  const pem = String(participantEmailNormalized || '').toLowerCase().trim();
  return signKrispPublicToken({ typ: 'fix', pid: Number(postgresId), pem, exp });
}

function signTranscriptViewToken(postgresId, expDays = 30) {
  const exp = Math.floor(Date.now() / 1000) + expDays * 86400;
  return signKrispPublicToken({ typ: 'tr', pid: Number(postgresId), exp });
}

module.exports = {
  signKrispPublicToken,
  verifyKrispPublicToken,
  signFixUnmatchedToken,
  signTranscriptViewToken,
  linkSecret,
};
