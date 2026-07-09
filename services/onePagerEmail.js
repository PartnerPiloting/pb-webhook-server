// services/onePagerEmail.js
//
// Builds a ready-to-send one-pager series email for one recipient: picks their
// next piece from the send-order manifest, renders it with the correct audience
// ending, and wraps it in the shared editorial shell with a first-name greeting
// and an email footer (reply line + per-series unsubscribe). Pure — it does not
// send; the drip loop (later) calls this then hands the html to gmailApiService.

const content = require('./onePagerContent');
const shell = require('./onePagerShell');
const MANIFEST = require('../config/onePagerSeriesManifest');

// The index of the next piece for someone who has been sent `sentCount` already.
// Returns -1 when the run is complete.
function nextIndex(audience, sentCount) {
  const list = MANIFEST[audience];
  if (!list) throw new Error(`onePagerEmail: unknown audience "${audience}"`);
  const i = Math.max(0, Math.floor(Number(sentCount) || 0));
  return i < list.length ? i : -1;
}

// First-name merge with a "Hi there" fallback for missing/junky names.
function firstNameOf(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const f = n.split(/\s+/)[0];
  if (f.length > 40 || !/[A-Za-z]/.test(f)) return null; // junk guard
  return f;
}
function greetingFor(name) {
  const f = firstNameOf(name);
  return f ? `Hi ${f},` : 'Hi there,';
}

// The email footer: a warm reply line, the sign-off, and one quiet per-series
// unsubscribe line. Prospects get the open-door invitation; clients a lighter
// version (they already know Guy).
function emailFooter({ audience, unsubscribeUrl }) {
  const reply = audience === 'prospect'
    ? "Any time one of these raises a question - or you'd like to talk it through for your own situation - just hit reply. I read every one."
    : "Any question or reaction, just hit reply - I read every one.";
  const unsub = unsubscribeUrl || '#';
  const keeps = audience === 'prospect' ? " - keeps any others you're on" : '';
  return `<div class="op-foot">
    <p class="op-reply">${reply}</p>
    <p class="op-sign">Cheers,<br><strong>(I know a) Guy</strong></p>
    <p class="op-unsub">Getting one too many? <a href="${unsub}">Unsubscribe from the series</a>${keeps}. Or just reply STOP.</p>
  </div>`;
}

// The public origin used to make in-email links absolute (see below). Override
// with SERIES_PUBLIC_BASE_URL or the baseUrl option once a custom domain exists.
const DEFAULT_BASE_URL = 'https://pb-webhook-server.onrender.com';

// Root-relative links (href="/series/...") are correct on the website but break
// in email clients (no page origin -> "http:///series/..."). Prefix them with
// the public origin so every link in an email is absolute.
function absolutizeLinks(html, baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  return html.replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`);
}

// The client edition-1 welcome. Frames the map as an orientation (not a to-do
// list), sets the "these arrive one at a time" expectation, and opens on the
// mutual "building our networks together" note - congruent with the system's
// own philosophy. Client edition 1 only; never prospects, never the web page.
function clientWelcomeIntro() {
  return `
    <p>I'm genuinely thrilled we'll be building our networks together through the I Know a Guy network-building system.</p>
    <p>I care about a lot more than getting you set up. What I really want is for you to get a <em>result</em> - and that takes more than mastering the mechanics. It's the subtleties: the judgment calls, the small moves, the things you only pick up from years of networking and building businesses. Passing those on to you, a bit at a time, is what this series is for.</p>
    <p>And it starts here, with your map - the whole journey on one page. No need to read it all now, and definitely no need to do it all now. It's just so you can see the shape of where we're headed. From here, each step lands in its own email over the coming weeks - so come back to this overview whenever you like.</p>`;
}

// Build the next email for a recipient.
// opts: { audience, recipientName, sentCount, unsubscribeUrl, baseUrl }
// Returns { audience, slug, position, total, subject, html } or null when the
// recipient has completed their run (nothing left to send).
async function buildEmail({ audience = 'prospect', recipientName = '', sentCount = 0, unsubscribeUrl, baseUrl } = {}) {
  const list = MANIFEST[audience];
  if (!list) throw new Error(`onePagerEmail: unknown audience "${audience}"`);
  const idx = nextIndex(audience, sentCount);
  if (idx < 0) return null; // run complete

  const base = baseUrl || process.env.SERIES_PUBLIC_BASE_URL || DEFAULT_BASE_URL;
  const slug = list[idx];
  const piece = await content.renderPiece(slug, { audience });
  if (!piece) throw new Error(`onePagerEmail: piece "${slug}" (${audience} #${idx + 1}) not found`);

  const introHtml = (audience === 'client' && idx === 0) ? clientWelcomeIntro() : '';
  const inner = shell.articleCard({
    title: piece.title,
    dek: piece.dek,
    greeting: greetingFor(recipientName),
    introHtml,
    bodyHtml: piece.bodyHtml,
    footerHtml: emailFooter({ audience, unsubscribeUrl }),
  });
  const html = absolutizeLinks(shell.fullPage({ title: piece.title, inner }), base);

  // Subjects are still TBD (masthead carries the series identity); use the
  // piece title for now.
  const subject = piece.title;

  return { audience, slug, position: idx + 1, total: list.length, subject, html };
}

module.exports = { buildEmail, nextIndex, greetingFor, MANIFEST };
