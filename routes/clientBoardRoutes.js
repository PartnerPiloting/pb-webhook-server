// routes/clientBoardRoutes.js
// The coach's client board - the page behind "My Clients" in the portal (replaced My Coached
// Clients 2026-09-09). Owner/coach only: the caller is whoever the portal token resolves to,
// and they only ever see clients whose Coach is them. There is no coachClientId in the URL on
// purpose - the old /api/coached-clients/:coachClientId took the coach from the path with no
// auth at all, which is exactly the shape that leaks.
//
//   GET /api/client-board                      the whole board (fast: record + grouped stores)
//   GET /api/client-board/:clientId/detail     one card's drawer: live preflight, tasks, links
//
// Mounted from index.js at /api/client-board.

const express = require('express');
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');
const board = require('../services/clientBoardService');
const { createLogger } = require('../utils/contextLogger');

const router = express.Router();

// An assistant working inside a coach's account is NOT the coach - they never see the board.
function coachOnly(req, res, next) {
  if (!req.client || req.assistant) {
    return res.status(403).json({ success: false, error: 'Coach access only' });
  }
  return next();
}

router.get('/', authenticateUserWithTestMode, coachOnly, async (req, res) => {
  const coachClientId = req.client.clientId;
  const logger = createLogger({ runId: 'BOARD', clientId: coachClientId, operation: 'client_board' });
  try {
    const data = await board.getBoard(coachClientId);
    logger.info(`board: ${data.count} clients for ${coachClientId}`);
    res.json({ success: true, coachName: req.client.clientName, ...data });
  } catch (e) {
    logger.error(`board failed: ${e.message}`, e.stack);
    res.status(500).json({ success: false, error: `Board failed: ${e.message}` });
  }
});

router.get('/:clientId/detail', authenticateUserWithTestMode, coachOnly, async (req, res) => {
  const coachClientId = req.client.clientId;
  const { clientId } = req.params;
  const logger = createLogger({ runId: 'BOARD', clientId, operation: 'client_board_detail' });
  try {
    const data = await board.getCardDetail(coachClientId, clientId);
    res.json({ success: true, ...data });
  } catch (e) {
    if (e.code === 'FORBIDDEN') return res.status(403).json({ success: false, error: 'Not your client' });
    logger.error(`detail failed: ${e.message}`, e.stack);
    res.status(500).json({ success: false, error: `Detail failed: ${e.message}` });
  }
});

module.exports = router;
