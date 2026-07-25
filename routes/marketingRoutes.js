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

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'marketing_site' });

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

function fullPage(body) {
  // Deliberately noindex for now: the site is not launched and shouldn't be
  // crawled at the onrender.com hostname. Drop this when the domain goes live.
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
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

  router.get('/home', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.end(fullPage(loadBody()));
  });

  app.use(router);
  logger.info('[site] marketing routes mounted at /home');
};
