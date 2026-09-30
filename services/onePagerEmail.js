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
//   client:   #1 = the orientation ("What you've actually joined" - carries the
//             welcome), #2..#23 = the 22 manifest pieces. #2 (the map) goes out
//             in a short one-line-per-step form, each step linking to its piece.
//             Content index = sentCount - 1. (Settled with Guy 2026-09-28.)

const content = require('./onePagerContent');
const shell = require('./onePagerShell');
const MANIFEST = require('../config/onePagerSeriesManifest');

const DEFAULT_BASE_URL = 'https://pb-webhook-server.onrender.com';
const PORTAL_BASE_URL = 'https://pb-webhook-server.vercel.app';

// Both audiences get a standalone email #1 before the arc: prospects a
// permission intro, clients the orientation.
function hasIntro(audience) {
  return audience === 'prospect' || audience === 'client';
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

// The client orientation (email #1, carries the welcome). Timed for the END of
// onboarding (the series starts at the client's Email Series Start Date, set at
// the Linked Helper launch session - decided 2026-08-23), so it opens on the
// engine switching on. Before any how-to it says what they've joined - a
// circle, not a solo sport - and gives every call its question. Approved by Guy
// 2026-09-28. Says "email", not "time", so #2 can open "The last email...".
function clientOrientationBody() {
  return `
    <p>Your engine is switched on. The setup we built together is behind you, and the system is out there quietly filling your database. Before any of the how-to, I want you to be clear on what we're actually doing - because it isn't what most people mean by networking.</p>
    <p>Most people treat networking as a solo sport. Your network is whoever you've happened to meet, and it's only ever as good as your own memory and your own diary.</p>
    <p>This works differently. You're now one of a circle of people who all build their networks the same way - chosen for attitude, not job title, and every one of them in the habit of giving introductions away freely. When you meet one of them, the point isn't to sell anything. It's to find out what they do, well enough to think of someone you already know who they should meet - someone from your wider network, the clients, colleagues and old friends who already trust you. And when the right person crosses your path later, you'll think of them then too. They do the same for you.</p>
    <p>That sits on top of everything you'd normally do. You'll still be reaching out to good people on LinkedIn and building your own network the way we set it up. The circle is the extra layer - people listening out for you, each with a wider network of their own that trusts their judgement.</p>
    <p>So on every call from here, the question underneath is simple: what does this person do, and who could I introduce them to?</p>
    <p>Next email, the whole process on one page.</p>`;
}

// The client map (email #2) in short form: one line per step, each linked to
// its full piece, then the whole map one click away (the full map stays the
// library page). Approved by Guy 2026-09-28. The "What Wingguy can do" pointer
// links into the client's own portal when their token is known.
const MAP_STEPS = [
  ['choose-the-room', "Choose who you'll actively engage with", 'decide on purpose who belongs in your network, before you meet a soul.'],
  ['who-do-i-reach-out-to', 'Find them on LinkedIn', 'narrow the professional world by role, industry and experience. The easy half.'],
  ['score-on-attitude', 'Score them on attitude', 'LinkedIn tells you what someone is. The score tells you how they think.'],
  ['twenty-second-thank-you', 'A thanks-for-connecting that delights', 'a line about their work that makes them feel seen, not just greeted by name.'],
  ['never-send-calendly', 'Offer times - the right way', `a couple of times that suit, never "here's my link, grab a slot".`],
  ['first-discovery-call', 'Have the discovery call', "you're there to ask questions, not to perform."],
  ['reason-to-follow-up', 'Give yourself a reason to follow up', `something real to come back about, not "let's stay in touch".`],
  ['nodes', 'Building nodes', 'where it all compounds, and work starts arriving on a recommendation.'],
  ['i-know-a-guy-principle', 'Practise the "I know a guy" principle', 'hear a need, make the introduction, expect nothing back.'],
  ['increase-your-intelligence', 'Increase your intelligence with Wingguy', "you're already using it. This is where you learn to lean on it."],
];
function clientMapShortBody({ portalToken } = {}) {
  const steps = MAP_STEPS.map(([slug, title, line]) =>
    `<li><strong><a href="/series/${slug}?audience=client">${title}</a></strong> - ${line}</li>`).join('\n      ');
  const tab = portalToken
    ? `<a href="${PORTAL_BASE_URL}/start-here?token=${encodeURIComponent(portalToken)}">"What Wingguy can do" tab</a>`
    : '"What Wingguy can do" tab';
  return `
    <p>The last email was the why. This is the how - the whole journey on one page. Don't try to master it; it's just so you always know where you are. Each step links to its own short piece if you want to go deeper now. If not, they'll arrive one at a time.</p>
    <ol>
      ${steps}
    </ol>
    <p><strong><a href="/series/the-process?audience=client">Read the whole map</a></strong></p>
    <p>To see what Wingguy does for you at each step, open the ${tab} in your portal.</p>`;
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
// opts: { audience, recipientName, sentCount, unsubscribeUrl, baseUrl, portalToken }
// Returns { audience, kind, slug, position, total, subject, html } or null when
// the recipient has completed their run (nothing left to send).
async function buildEmail({ audience = 'prospect', recipientName = '', sentCount = 0, unsubscribeUrl, baseUrl, portalToken } = {}) {
  const item = resolveItem(audience, sentCount);
  if (!item) return null; // run complete
  const base = baseUrl || process.env.SERIES_PUBLIC_BASE_URL || DEFAULT_BASE_URL;

  // Standalone email #1: the prospect permission intro, or the client orientation
  if (item.kind === 'intro') {
    const isClient = audience === 'client';
    const title = isClient ? "What you've actually joined" : 'A short series on network building';
    const inner = shell.articleCard({
      greeting: greetingFor(recipientName),
      bodyHtml: isClient ? clientOrientationBody() : prospectIntroBody(),
      footerHtml: isClient ? emailFooter({ audience, unsubscribeUrl }) : introFooter({ unsubscribeUrl }),
      qs: isClient ? '?audience=client' : '',
    });
    const html = absolutizeLinks(shell.fullPage({ title, inner }), base);
    return { audience, kind: 'intro', slug: isClient ? '(orientation)' : '(intro)', position: item.position, total: item.total, subject: title, html };
  }

  // Client #2: the map, short form
  if (audience === 'client' && item.slug === 'the-process') {
    const title = 'The whole process on one page';
    const inner = shell.articleCard({
      greeting: greetingFor(recipientName),
      bodyHtml: clientMapShortBody({ portalToken }),
      footerHtml: emailFooter({ audience, unsubscribeUrl }),
      qs: '?audience=client',
    });
    const html = absolutizeLinks(shell.fullPage({ title, inner }), base);
    return { audience, kind: 'piece', slug: item.slug, position: item.position, total: item.total, subject: title, html };
  }

  // A normal content piece
  const slug = item.slug;
  const piece = await content.renderPiece(slug, { audience });
  if (!piece) throw new Error(`onePagerEmail: piece "${slug}" (${audience} #${item.position}) not found`);

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
    bodyHtml: piece.bodyHtml,
    footerHtml: emailFooter({ audience, unsubscribeUrl }),
  });
  const html = absolutizeLinks(shell.fullPage({ title: piece.title, inner }), base);

  // Subjects TBD (masthead carries the series identity); use the piece title.
  const subject = piece.title;

  return { audience, kind: 'piece', slug, position: item.position, total: item.total, subject, html };
}

module.exports = { buildEmail, resolveItem, totalEmails, greetingFor, MANIFEST };
