/**
 * Verify Recall.ai HTTP webhooks (HMAC) per
 * https://docs.recall.ai/docs/authenticating-requests-from-recallai
 */

const crypto = require('crypto');

/**
 * @param {{ secret: string, headers: Record<string, string>, payload: string | null }} args
 */
function verifyRequestFromRecall(args) {
  const { secret, headers, payload } = args;
  const h = headers || {};
  const msgId = h['webhook-id'] ?? h['svix-id'];
  const msgTimestamp = h['webhook-timestamp'] ?? h['svix-timestamp'];
  const msgSignature = h['webhook-signature'] ?? h['svix-signature'];

  if (!secret || !String(secret).startsWith('whsec_')) {
    throw new Error('Verification secret is missing or invalid (expected whsec_…)');
  }
  if (!msgId || !msgTimestamp || !msgSignature) {
    throw new Error('Missing webhook-id, webhook-timestamp, or webhook-signature');
  }

  const base64Part = String(secret).slice('whsec_'.length);
  const key = Buffer.from(base64Part, 'base64');

  let payloadStr = '';
  if (payload != null && payload !== '') {
    payloadStr = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
  }

  const toSign = `${msgId}.${msgTimestamp}.${payloadStr}`;
  const expectedSig = crypto.createHmac('sha256', key).update(toSign).digest('base64');

  const passedSigs = String(msgSignature).split(' ');
  for (const versionedSig of passedSigs) {
    const [version, signature] = versionedSig.split(',');
    if (version !== 'v1' || !signature) continue;
    const sigBytes = Buffer.from(signature, 'base64');
    const expectedSigBytes = Buffer.from(expectedSig, 'base64');
    if (
      expectedSigBytes.length === sigBytes.length
      && crypto.timingSafeEqual(new Uint8Array(expectedSigBytes), new Uint8Array(sigBytes))
    ) {
      return true;
    }
  }
  throw new Error('No matching webhook signature');
}

module.exports = { verifyRequestFromRecall };
