// services/onePagerEmail.js
//
// Builds a ready-to-send one-pager series email for one recipient: works out
// what they're due next (a piece from the send-order manifest, or - for
// prospects - a standalone intro as email 1), renders it with the correct
// audience ending, and wraps it in the shared editorial shell with a first-name
// greeting and an email footer. Pure - it does not send; the drip loop (later)
// calls this then hands the html to gmailApiService.
//
// Email numbering per audience:
//   prospect: #1 = the intro (permission/value, no teaching), #2..#19 = the 18
//             manifest pieces. So content index = sentCount - 1.
//   client:   #1..#21 = the 21 manifest pieces; #1 (the map) carries a welcome
//             opener folded in. Content index = sentCount.

const content = require('./onePagerContent');
const shell = require('./onePagerShell');
const MANIFEST = require('../config/onePagerSeriesManifest');

const DEFAULT_BASE_URL = 'https://pb-webhook-server.onrender.com';

// Prospects get a standalone intro before the arc; clients do not (their welcome
// is folded into email #1, the map).
function hasIntro(audience) {
  return audience === 'prospect';
}

// Total number of emails in a run (intro included where applicable).
function totalEmails(audience) {
  const list = MANIFEST[audience];
  if (!list) throw new Error(`onePagerEmail: unknown audience "${audience}"`);
  return list.length + (hasIntro(audience) ? 1 : 0);
}

// What is this recipient due next? Returns { kind:'intro'|'piece', position,
// total, slug? } or null when the run is complete.
function resolveItem(audience, sentCount) {
  const list = MANIFEST[audience];
  if (!list) throw new Error(`onePagerEmail: unknown audience "${audience}"`);
  const total = totalEmails(audience);
  const i = Math.max(0, Math.floor(Number(sentCount) || 0));
  if (i >= total) return null; // run complete
  if (hasIntro(audience) && i === 0) return { kind: 'intro', position: 1, total };
  const contentIdx = hasIntro(audience) ? i - 1 : i;
  return { kind: 'piece', slug: list[contentIdx], position: i + 1, total };
}

// Root-relative links (href="/series/...") are correct on the website but break
// in email clients (no page origin -> "http:///series/..."). Prefix them with
// the public origin so every link in an email is absolute.
function absolutizeLinks(html, baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  return html.replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`);
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

// The prospect intro (email #1). A cold-ish re-engagement list didn't opt in, so
// this asks permission and offers value rather than teaching. Opens on a recent,
// true connection, frames the series as a gift (no pitch), sets the weekly + easy
// -exit expectation, and signs off. Never for clients.
function prospectIntroBody() {
  return `
    <p>We recently crossed paths - a conversation, an introduction, a bit of networking - and you stuck with me as someone who genuinely values good relationships.</p>
    <p>Over the years I've picked up a fair bit about network building: what works, what doesn't, the subtleties most people never get told. I've started putting the best of it into a short series of one-pagers, and I thought you might get some value from them.</p>
    <p>No pitch, nothing to buy - just one useful idea every week or so, from someone who's spent a long time at this. If it's not for you, one click and you're off the list, no hard feelings.</p>
    <p>If that sounds alright, the first proper one lands next week. I hope it earns its place in your inbox.</p>
    <p class="op-sign" style="margin-top:1.25rem">Cheers,<br><strong>(I know a) Guy</strong></p>`;
}

// The client edition-1 welcome (folded above the map). Frames the map as
// orientation not a to-do list, sets the "one at a time" expectation, and opens
// on the mutual "building our networks together" note.
function clientWelcomeIntro() {
  return `
    <p>I'm genuinely thrilled we'll be building our networks together through the I Know a Guy network-building system.</p>
    <p>I care about a lot more than getting you set up. What I really want is for you to get a <em>result</em> - and that takes more than mastering the mechanics. It's the subtleties: the judgment calls, the small moves, the things you only pick up from years of networking and building businesses. Passing those on to you, a bit at a time, is what this series is for.</p>
    <p>And it starts here, with your map - the whole journey on one page. No need to read it all now, and definitely no need to do it all now. It's just so you can see the shape of where we're headed, and from here each step lands in its own email over the coming weeks - so come back to this overview whenever you like.</p>`;
}

// Footer for a normal content email: warm reply line, sign-off, one quiet
// per-series unsubscribe line.
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

// Minimal footer for the intro email: the body already signs off and invites a
// reply, so this is just the functional unsubscribe.
function introFooter({ unsubscribeUrl }) {
  const unsub = unsubscribeUrl || '#';
  return `<div class="op-foot">
    <p class="op-unsub">Not for you? <a href="${unsub}">Unsubscribe</a> - one click, no hard feelings.</p>
  </div>`;
}

// Build the next email for a recipient.
// opts: { audience, recipientName, sentCount, unsubscribeUrl, baseUrl }
// Returns { audience, kind, slug, position, total, subject, html } or null when
// the recipient has completed their run (nothing left to send).
async function buildEmail({ audience = 'prospect', recipientName = '', sentCount = 0, unsubscribeUrl, baseUrl } = {}) {
  const item = resolveItem(audience, sentCount);
  if (!item) return null; // run complete
  const base = baseUrl || process.env.SERIES_PUBLIC_BASE_URL || DEFAULT_BASE_URL;

  // Prospect intro (standalone email #1)
  if (item.kind === 'intro') {
    const inner = shell.articleCard({
      greeting: greetingFor(recipientName),
      bodyHtml: prospectIntroBody(),
      footerHtml: introFooter({ unsubscribeUrl }),
    });
    const html = absolutizeLinks(shell.fullPage({ title: 'A short series on network building', inner }), base);
    // Subject still TBD.
    return { audience, kind: 'intro', slug: '(intro)', position: item.position, total: item.total, subject: 'A short series on network building', html };
  }

  // A normal content piece
  const slug = item.slug;
  const piece = await content.renderPiece(slug, { audience });
  if (!piece) throw new Error(`onePagerEmail: piece "${slug}" (${audience} #${item.position}) not found`);

  const introHtml = (audience === 'client' && item.position === 1) ? clientWelcomeIntro() : '';

  // Prospect content emails carry a small italic "series" line under the greeting:
  // email #2 (their first article, right after the intro) bridges back to the
  // intro; email #3 onward gets a quiet ongoing reminder.
  let kicker = '';
  if (audience === 'prospect') {
    if (item.position === 2) kicker = "This is the series I mentioned last week - here's the first one. Hope it's useful.";
    else if (item.position >= 3) kicker = 'Continuing the network-building series.';
  }

  const inner = shell.articleCard({
    title: piece.title,
    dek: piece.dek,
    greeting: greetingFor(recipientName),
    kicker,
    introHtml,
    bodyHtml: piece.bodyHtml,
    footerHtml: emailFooter({ audience, unsubscribeUrl }),
  });
  const html = absolutizeLinks(shell.fullPage({ title: piece.title, inner }), base);

  // Subjects TBD (masthead carries the series identity); use the piece title.
  const subject = piece.title;

  return { audience, kind: 'piece', slug, position: item.position, total: item.total, subject, html };
}

module.exports = { buildEmail, resolveItem, totalEmails, greetingFor, MANIFEST };
