// routes/unipileNotifyRoutes.js
// Unipile calls this the moment a client approves a hosted-auth link minted by
// services/unipileHostedAuth.js. The path token IS the auth (signed + expiring + bound to one
// client), so there is no portal-token middleware here - Unipile has no idea what that is.
//
//   POST /api/unipile/notify/:token     body { status, account_id, name }
//
// Always answers 200 once the token verifies: a payload we choose to ignore (wrong status, name
// mismatch) must not make Unipile retry it. A bad token gets 403 so a probe learns nothing useful.
// Mounted from index.js at /api/unipile.

const express = require('express');
const hosted = require('../services/unipileHostedAuth');
const { createLogger } = require('../utils/contextLogger');

const router = express.Router();

router.post('/notify/:token', async (req, res) => {
  const clientId = hosted.verifyNotifyToken(req.params.token);
  if (!clientId) return res.status(403).json({ success: false, error: 'bad or expired token' });
  const logger = createLogger({ runId: 'UNIPILE', clientId, operation: 'unipile_notify' });
  try {
    const result = await hosted.handleNotify(req.params.token, req.body || {}, { logger });
    if (!result.ok) logger.warn(`unipile notify ignored for ${clientId}: ${result.reason}`);
    return res.json({ success: true, applied: result.ok, reason: result.ok ? undefined : result.reason });
  } catch (e) {
    logger.error(`unipile notify failed for ${clientId}: ${e.message}`, e.stack);
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
