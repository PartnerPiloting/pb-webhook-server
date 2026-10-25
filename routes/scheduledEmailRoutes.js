// routes/scheduledEmailRoutes.js
//
// The coach's Scheduled page in the portal (Guy, 25 Oct 2026: "I need more control of Wingguy
// because I can't see, for example, Rick's email"). Everything scheduled from his own mailbox
// (services/scheduledEmails.js) - see each email as it will arrive, approve the ones Claude wrote
// for him, edit, move, cancel, send now. Coach only, same auth as the client board.
//
//   GET  /                 the queue: needs your OK, held, scheduled, sent in the last 14 days
//   GET  /:id              one email: where it stands + the HTML as it will arrive
//   POST /:id/approve      a NEEDS YOUR OK one may go at its time
//   POST /:id/edit         {subject?, html?} - Guy's own words, checked like a draft
//   POST /:id/move         {sendAt} - an ISO time
//   POST /:id/cancel       it will not go
//   POST /:id/send-now     send it now (a held one only after Guy has read why)

const express = require('express');
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');
const queue = require('../services/scheduledEmails');

const router = express.Router();
const parseJson = express.json({ limit: '2mb' });

/** Only the coach - the one tenant that schedules (RECALL_COACH_CLIENT_ID, Guy). */
function coachOnly(req, res, next) {
  const coach = (process.env.RECALL_COACH_CLIENT_ID || 'Guy-Wilson').trim();
  if (!req.client || req.assistant || req.client.clientId !== coach) return res.status(403).json({ success: false, error: 'Coach access only' });
  return next();
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
};
const idOf = (req) => Number(req.params.id);
const said = (res, r) => res.status(r.ok ? 200 : 400).json({ success: !!r.ok, message: r.text });

router.use(authenticateUserWithTestMode, coachOnly);

router.get('/', wrap(async (req, res) => {
  const tenant = req.client.clientId;
  const [emails, away] = await Promise.all([queue.forPage(tenant), queue.getAway(tenant)]);
  res.json({ success: true, emails, away: away && away.from ? away : null });
}));

router.get('/:id', wrap(async (req, res) => {
  const p = await queue.preview(req.client.clientId, idOf(req));
  if (!p) return res.status(404).json({ success: false, error: 'Not found' });
  const r = p.row;
  res.json({
    success: true,
    email: {
      id: r.id, kind: r.kind, status: r.status, subject: r.subject, to: r.to, cc: r.cc,
      sendAt: new Date(r.sendAt).toISOString(), sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
      when: queue.whenLabel(r.sentAt || r.sendAt), holdReason: r.holdReason, result: r.result,
      html: p.html, rawHtml: r.html,
    },
  });
}));

router.post('/:id/approve', wrap(async (req, res) => said(res, await queue.approve(req.client.clientId, idOf(req)))));
router.post('/:id/edit', parseJson, wrap(async (req, res) => said(res, await queue.editEmail(req.client.clientId, idOf(req), { subject: req.body && req.body.subject, html_body: req.body && req.body.html }))));
router.post('/:id/move', parseJson, wrap(async (req, res) => said(res, await queue.move(req.client.clientId, idOf(req), req.body && req.body.sendAt))));
router.post('/:id/cancel', wrap(async (req, res) => said(res, await queue.cancel(req.client.clientId, idOf(req)))));
router.post('/:id/send-now', wrap(async (req, res) => said(res, await queue.sendNow(req.client.clientId, idOf(req)))));

module.exports = router;
