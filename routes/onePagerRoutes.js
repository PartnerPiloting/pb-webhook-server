// routes/onePagerRoutes.js
//
// Link-only web pages for the "network building, rethought" one-pager series.
//   GET /series          -> the prospect map (how-it-actually-works) + catalogue
//   GET /series/:slug     -> one article, rendered in the editorial shell
//
// Pages are deliberately noindex (see the shell's <head>) — they exist to be
// linked from the drip emails, not crawled. The drip send itself is a later
// phase; this phase is the reading surface the emails will point at.

const express = require('express');
const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'one_pager_series' });

const content = require('../services/onePagerContent');
const shell = require('../services/onePagerShell');

const MAP_SLUG = 'how-it-actually-works'; // the prospect library landing (#8)

function sendHtml(res, status, html) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(html);
}

function notFoundPage(what) {
  const inner = shell.articleCard({
    title: 'Not found',
    bodyHtml: `<p>${what}</p><p><a href="/series">Back to the library</a></p>`,
    footerHtml: shell.libraryFooter(),
  });
  return shell.fullPage({ title: 'Not found', inner });
}

module.exports = function mountOnePagers(app /*, base */) {
  const router = express.Router();

  // Library landing: the map on top, the full catalogue beneath.
  router.get('/series', async (req, res) => {
    try {
      const audience = req.query.audience === 'client' ? 'client' : 'prospect';
      const map = await content.renderPiece(MAP_SLUG, { audience });
      const pieces = content.listPieces().filter(p => p.slug !== MAP_SLUG);

      const cards = [];
      if (map) {
        cards.push(shell.articleCard({
          title: map.title,
          dek: map.dek,
          bodyHtml: map.bodyHtml,
          footerHtml: shell.libraryFooter(),
        }));
      }
      cards.push(shell.catalogueCard(pieces));

      return sendHtml(res, 200, shell.fullPage({ title: 'The library', inner: cards.join('\n') }));
    } catch (err) {
      logger.error(`[series] library render failed: ${err && err.message}`, err && err.stack);
      return sendHtml(res, 500, notFoundPage('Something went wrong loading the library.'));
    }
  });

  // A single article.
  router.get('/series/:slug', async (req, res) => {
    const slug = String(req.params.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    try {
      const audience = req.query.audience === 'client' ? 'client' : 'prospect';
      const piece = slug ? await content.renderPiece(slug, { audience }) : null;
      if (!piece) {
        return sendHtml(res, 404, notFoundPage('That piece does not exist (yet).'));
      }
      const inner = shell.articleCard({
        title: piece.title,
        dek: piece.dek,
        bodyHtml: piece.bodyHtml,
        footerHtml: shell.libraryFooter(),
      });
      return sendHtml(res, 200, shell.fullPage({ title: piece.title, inner }));
    } catch (err) {
      logger.error(`[series] article render failed for "${slug}": ${err && err.message}`, err && err.stack);
      return sendHtml(res, 500, notFoundPage('Something went wrong loading that piece.'));
    }
  });

  app.use(router);
  logger.info('[series] one-pager routes mounted at /series');
};
