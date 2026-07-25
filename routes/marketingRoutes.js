// routes/marketingRoutes.js
//
// The public "I Know A Guy" marketing site.
//   GET /home   -> the homepage (preview path while we build)
//
// Sits alongside the one-pager library (routes/onePagerRoutes.js, /series):
// the homepage owns the WHY and earns the conversation; /series is the depth
// behind the link. Same server, same domain, one home for the writing — which
// is what settles the old "WordPress vs pb-webhook-server" library question.
//
// The page body lives in content/site/homepage.html (plain HTML, authored as
// the design mockup) so copy edits never touch this file. Read once at boot,
// with a re-read when NODE_ENV !== 'production' so local edits show up on
// refresh.
//
// NOTE: this mounts at /home, NOT /. The root route is still the old dev
// index; flipping / over to this page is a deliberate later step, once Guy
// has signed off on the live rendering.

const fs = require('fs');
const path = require('path');
const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const enquiries = require('../services/siteEnquiryStore');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'marketing_site' });

// Where "someone got in touch" lands. Falls back to the Gmail sending identity
// so a missing env var can never silently swallow a warm enquiry.
function notifyAddress() {
  return (process.env.SITE_ENQUIRY_TO || process.env.GMAIL_FROM_EMAIL || 'guyralphwilson@gmail.com').trim();
}

// A checkbox arrives as true from JSON but as the string "on" from a plain
// form post, so both have to count.
function isTruthy(v) {
  return v === true || v === 'true' || v === 'on' || v === '1';
}

// Fire-and-forget: the visitor's response never waits on Gmail, and a mail
// failure never fails the request — the row is already safely stored.
function notifyGuy({ id, kind, name, email, referrer, note, alsoSubscribe }) {
  const isEnquiry = kind === 'enquiry';
  const who = name ? `${name} <${email}>` : email;
  const subject = isEnquiry
    ? `I Know A Guy - enquiry from ${name || email}`
    : `I Know A Guy - new series subscriber: ${email}`;
  const lines = isEnquiry
    ? [
      `${who} would like a chat.`,
      '',
      `Referred by: ${referrer || '(not said)'}`,
      '',
      note ? `They said:\n${note}` : 'They left no note.',
      '',
      alsoSubscribe ? 'They also asked for the series.' : 'They did not ask for the series.',
      '',
      'Hit Reply to answer them directly - a few times that might suit.',
    ]
    : [`${who} asked for the series by email.`];

  let gmail;
  try {
    gmail = require('../services/gmailApiService');
  } catch (err) {
    logger.error(`[site] gmail service unavailable: ${err && err.message}`);
    return;
  }

  gmail.sendTextEmail({
    to: notifyAddress(),
    subject,
    text: lines.join('\n'),
    fromName: 'I Know A Guy',
    // Hitting Reply goes straight to the person who got in touch.
    replyTo: email || undefined,
  })
    .then(() => enquiries.markNotified(id))
    .catch((err) => logger.error(`[site] notification email failed (row ${id} is safe): ${err && err.message}`));
}

const PAGE_PATH = path.join(__dirname, '..', 'content', 'site', 'homepage.html');
const TITLE = 'I Know A Guy - Network building, rethought';
const DESCRIPTION =
  'Network building, rethought. Choose who belongs in your network, reach out like a human, '
  + 'and let the grind be handled - so the part that actually matters fits inside a normal week.';

let cached = null;

function loadBody() {
  if (cached && process.env.NODE_ENV === 'production') return cached;
  try {
    cached = fs.readFileSync(PAGE_PATH, 'utf8');
  } catch (err) {
    logger.error(`[site] could not read homepage.html: ${err && err.message}`);
    cached = '<p>The page is temporarily unavailable.</p>';
  }
  return cached;
}

function fullPage(body, host) {
  // Index the real domain; never the onrender.com hostname. Doing it by host
  // rather than a flag means pointing the domain is the ONLY step — there's no
  // "remember to turn indexing on" left lying around, and no risk of the
  // preview hostname competing with the real site in search results.
  const isPreview = !host || /onrender\.com$/i.test(String(host).split(':')[0]);
  const robots = isPreview
    ? '<meta name="robots" content="noindex, nofollow">'
    : '';
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${robots}
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:type" content="website">
<style>
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

module.exports = function mountMarketingSite(app) {
  const router = express.Router();

  // "/" is the public homepage. /home stays as an alias so any link already
  // shared keeps working.
  const serveHomepage = (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.end(fullPage(loadBody(), req.get('host')));
  };

  router.get('/', serveHomepage);
  router.get('/home', serveHomepage);

  // Both public forms post here. Accepts JSON (the page's fetch) or a plain
  // form POST, so the form still works if JavaScript never runs.
  const parseJson = express.json({ limit: '32kb' });
  const parseForm = express.urlencoded({ extended: false, limit: '32kb' });

  router.post('/site/enquiry', parseJson, parseForm, async (req, res) => {
    const body = req.body || {};
    const kind = body.kind === 'subscribe' ? 'subscribe' : 'enquiry';

    const result = await enquiries.record({
      kind,
      name: body.name,
      email: body.email,
      referrer: body.referrer,
      note: body.note,
      sourcePage: body.sourcePage || req.get('referer') || null,
      userAgent: req.get('user-agent') || null,
    });

    if (!result.ok) {
      logger.warn(`[site] ${kind} rejected: ${result.error}`);
      return res.status(400).json({ ok: false, error: result.error });
    }

    logger.info(`[site] ${kind} received${result.duplicate ? ' (already subscribed)' : ` (row ${result.id})`}`);
    if (!result.duplicate) {
      notifyGuy({
        id: result.id, kind, name: body.name, email: body.email,
        referrer: body.referrer, note: body.note,
        alsoSubscribe: kind === 'enquiry' && isTruthy(body.alsoSubscribe),
      });
    }

    // They ticked "send me the series too". Recorded as its own subscription
    // row so the drip has one consistent place to read from, and so an
    // unsubscribe later doesn't have to reason about which door they came in.
    // Deliberately after the response is prepared: a failure here must never
    // cost us the enquiry itself.
    if (kind === 'enquiry' && isTruthy(body.alsoSubscribe)) {
      const sub = await enquiries.record({
        kind: 'subscribe',
        name: body.name,
        email: body.email,
        referrer: body.referrer,
        sourcePage: 'enquiry-form opt-in',
        userAgent: req.get('user-agent') || null,
      });
      if (!sub.ok) logger.warn(`[site] opt-in subscribe failed for enquiry ${result.id}: ${sub.error}`);
    }

    return res.json({ ok: true });
  });

  app.use(router);
  logger.info('[site] marketing routes mounted at /home (+ POST /site/enquiry)');
};
