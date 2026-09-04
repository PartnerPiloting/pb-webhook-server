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

// The site's pages. Each body lives in content/site/ (plain HTML, authored as
// the design mockup) so copy edits never touch this file; each page carries its
// own title/description for the head. Same read-once-in-production caching.
const PAGES = {
  homepage: {
    file: 'homepage.html',
    title: 'I Know A Guy - Network building, rethought',
    description:
      'Network building, rethought. Choose who belongs in your network, reach out like a human, '
      + 'and let the grind be handled - so the part that actually matters fits inside a normal week.',
  },
  // The working-day page: Guy's day told flat, chronologically. ONE page,
  // every entrance - the homepage's begin-with-the-end dare, the post-demo
  // follow-up send, and forwarding. (Was born as /what-you-just-saw, the
  // post-demo framing; the dare made it the shared destination, so the title
  // went neutral and the old URL 301s here.)
  day: {
    file: 'a-day-in-the-life.html',
    title: 'A day in the life - I Know A Guy',
    description:
      'A working day with the machinery running - introductions drafted from one sentence, '
      + 'mornings that brief you, bookings that book themselves. Told flat, exactly as it happens.',
  },
};

const cachedBodies = {};

function loadBody(page) {
  const key = page.file;
  if (cachedBodies[key] && process.env.NODE_ENV === 'production') return cachedBodies[key];
  try {
    cachedBodies[key] = fs.readFileSync(path.join(__dirname, '..', 'content', 'site', page.file), 'utf8');
  } catch (err) {
    logger.error(`[site] could not read ${page.file}: ${err && err.message}`);
    cachedBodies[key] = '<p>The page is temporarily unavailable.</p>';
  }
  return cachedBodies[key];
}

function fullPage(body, host, { title, description }) {
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
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
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
  const servePage = (page) => (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // The page is cheap to render and its CSS is inline, so a cached copy hides
    // every change until it expires — which reads as "the deploy didn't work".
    // Revalidate each time: the browser still gets a 304 when nothing changed.
    res.setHeader('Cache-Control', 'no-cache');
    return res.end(fullPage(loadBody(page), req.get('host'), page));
  };

  router.get('/', servePage(PAGES.homepage));
  router.get('/home', servePage(PAGES.homepage));
  router.get('/a-day-in-the-life', servePage(PAGES.day));
  // The page's original URL - keep any link already sent working forever.
  router.get('/what-you-just-saw', (req, res) => res.redirect(301, '/a-day-in-the-life'));

  // Public images for the site. Scoped to content/site/assets rather than
  // content/site, so homepage.html can never be served as a raw file.
  router.use('/assets', express.static(path.join(__dirname, '..', 'content', 'site', 'assets'), {
    maxAge: '7d',
    index: false,
    dotfiles: 'ignore',
  }));

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

  // ---- Unsubscribe -------------------------------------------------------
  // GET is the link in the footer; POST is what Gmail's own Unsubscribe button
  // calls (List-Unsubscribe-Post: One-Click). Both must work, and neither may
  // ask the person to log in or confirm — a one-click header that then demands
  // a form is worse than not offering one.
  const unsubPage = (title, body) => `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title}</title>
<style>
  body{margin:0;background:#F2EEE6;color:#22201C;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:2rem}
  .card{max-width:30rem}
  h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:600;font-size:1.8rem;margin:0 0 .8rem}
  p{color:#4C473F;margin:0 0 1rem}
  a{color:#1E5E58}
  @media (prefers-color-scheme:dark){body{background:#1A1917;color:#ECE6DA}p{color:#B6AD9E}a{color:#63B6AB}}
</style></head><body><div class="card">${body}</div></body></html>`;

  async function handleUnsubscribe(req, res) {
    const token = req.query.t || req.query.token || (req.body && req.body.t) || '';
    const result = await enquiries.unsubscribeByToken(token);

    if (req.method === 'POST') {
      // One-click clients want a bare 200, not a page.
      logger.info(`[site] one-click unsubscribe ${result.ok ? 'ok' : 'failed'}`);
      return res.status(result.ok ? 200 : 400).end();
    }

    if (!result.ok) {
      return res.status(404).send(unsubPage('Link not recognised', `
        <h1>That link didn't work</h1>
        <p>It may have already been used, or been cut short by an email client.</p>
        <p>Reply to any of my emails with the word STOP and I'll take you off the list myself.</p>`));
    }

    logger.info('[site] unsubscribed via link');
    return res.send(unsubPage('Unsubscribed', `
      <h1>Done - you're off the list.</h1>
      <p>You won't get any more of the series. No hard feelings, and thanks for giving it a go.</p>
      <p>Everything's still there to read whenever you like, at <a href="/series">the library</a>.</p>
      <p>- (I know a) Guy</p>`));
  }

  router.get('/series/unsubscribe', handleUnsubscribe);
  router.post('/series/unsubscribe', express.urlencoded({ extended: false }), handleUnsubscribe);

  // ---- Run the drip ------------------------------------------------------
  // Protected by the same shared secret the other jobs use. ?dryRun=1 builds
  // everything and reports what WOULD go out, touching nobody's inbox.
  router.post('/api/series/run-drip', parseJson, parseForm, async (req, res) => {
    const supplied = req.get('x-drip-secret') || (req.body && req.body.secret) || req.query.secret || '';
    const expected = (process.env.PB_WEBHOOK_SECRET || '').trim();
    if (!expected || supplied !== expected) {
      logger.warn('[drip] run rejected: bad or missing secret');
      return res.status(401).json({ ok: false, error: 'unauthorised' });
    }
    const dryRun = String(req.query.dryRun || (req.body && req.body.dryRun) || '') === '1';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || (req.body && req.body.limit) || '25', 10) || 25));
    try {
      const drip = require('../services/seriesDrip');
      const out = await drip.runDrip({ dryRun, limit });
      return res.json(out);
    } catch (err) {
      logger.error(`[drip] run threw: ${err && err.message}`);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.use(router);
  logger.info('[site] marketing routes mounted at /home (+ POST /site/enquiry, /series/unsubscribe, /api/series/run-drip)');
};
