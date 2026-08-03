// content-wingguy.js — Wingguy on LinkedIn (the AI-Blaze-style full-screen shell).
//
// Surfaces: a LinkedIn PROFILE page (/in/...) AND the MESSAGING surface (the full /messaging/ page or a
//   floating conversation bubble on any page) — where there's no profile page, Wingguy reads the open
//   thread's header (name + headline + /in/ link) and looks the person up in the Portal to enrich.
// Flow (matches Guy's AI Blaze muscle memory):
//   type a trigger (/wg, /wingguy, /wingman) INSIDE LinkedIn's "Write a message…" box  (or click the
//     teal launcher as a fallback)
//   -> a FULL-SCREEN overlay takes over (roomy, not cramped)
//   -> Wingguy reads the profile + the open thread and auto-routes:
//        no live reply yet -> THANKS-FOR-CONNECTING, auto-detecting the campaign template by keyword
//          (connection-request note / profile contains "fractional" -> \frac, else \tks; human override)
//        they've replied      -> REPLY (read the whole thread, draft the next move)
//   -> backend drafts in Guy's voice (Sonnet) -> shown editable in the overlay
//   -> "Insert into LinkedIn" drops it at the cursor in the message box and CLOSES the overlay
//   -> human edits + clicks send.
//
// FORK HYGIENE: every DOM id/class is namespaced `wingguy-*` and the UI is visually distinct (teal)
// so it never collides with the legacy "Network Accelerator" extension running side-by-side. This
// script deliberately does NOT carry the legacy messaging "Save to Portal" surface.

(function () {
  'use strict';

  // Guard against double-injection: the background worker re-injects this script into open LinkedIn
  // tabs on install/update (so a dead tab heals without a manual refresh). If a live copy is already
  // wired up here, bail so we don't double-wire the keyup/click listeners.
  if (window.__wingguyLoaded) return;
  window.__wingguyLoaded = true;

  const LAUNCHER_ID = 'wingguy-launcher-btn';
  const OVERLAY_ID = 'wingguy-overlay';
  const PANEL_ID = 'wingguy-panel'; // the modal inside the overlay; kept as the id the insert code excludes

  // Typed triggers (slash-prefixed only, so they never fire inside normal prose). Longest first so
  // "/wingguy" wins over "/wg" when both would match the tail.
  const TRIGGERS = ['/wingguy', '\\wingguy', '/wingman', '\\wingman', '/wg', '\\wg'];

  // ---- LinkedIn landmarks ---------------------------------------------------
  // Every CSS selector Wingguy uses to find something on a LinkedIn page lives here, and ONLY here.
  // LinkedIn renames these periodically; when that happens Wingguy goes looking for something that no
  // longer exists and comes back empty. Before this block that cost a release and every client
  // reinstalling — now the corrected value is a row in Postgres (wingguy_selectors) that reaches
  // everyone on their next page load.
  //
  // These built-in values are NOT a bootstrap — they are the permanent fallback. The server is only
  // ever asked "have any of these been corrected since you shipped?". No database, no network, an
  // expired token, a 500: all land on this object, and Wingguy behaves exactly as it did before any
  // of this existed. The store can make Wingguy better; it can never be why Wingguy stopped working.
  //
  // Values are comma-separated alternatives tried in order, so a correction can ADD the new markup
  // in front while leaving the old behind it — which matters because LinkedIn rolls changes out
  // gradually and two clients can be on different markup on the same day.
  const SELECTOR_DEFAULTS = {
    profile_name: 'main h1, h1.text-heading-xlarge, .pv-top-card h1, section.artdeco-card h1, main section h1, h1',
    profile_headline: 'div.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium, div.text-body-medium',
    profile_location: 'span.text-body-small.inline.t-black--light.break-words, .pv-text-details__left-panel .text-body-small',
    profile_top_card: '.pv-top-card, .ph5.pb5, main section',
    profile_about_spans: 'span[aria-hidden="true"]',
    convo_container: '.msg-overlay-conversation-bubble,.msg-convo-wrapper,.msg-thread,.msg-s-message-list-container,.scaffold-layout__detail',
    convo_header: 'header, [class*="overlay-bubble-header"], [class*="title-bar"], [class*="thread__header"], [class*="thread-header"]',
    message_group_name: '.msg-s-message-group__name, [class*="message-group__name"], [class*="event-listitem__name"]',
    message_timestamp: 'time, .msg-s-message-group__timestamp, [class*="timestamp"]',
    message_body: '.msg-s-event-listitem__body',
    message_group: '.msg-s-message-group, [class*="message-group"]',
    // Same landmark, looser: used where we're walking UP from a node and a generic list row is an
    // acceptable answer. Kept separate from message_group on purpose — widening that one to include
    // li/[role=listitem] would change which container the strict callers resolve to.
    message_group_item: '.msg-s-message-group, [class*="message-group"], li, [role="listitem"]',
    message_item: '.msg-s-event-listitem, .msg-s-message-list__time-heading, [class*="time-heading"]',
    message_item_row: '.msg-s-event-listitem',
    // NOTE: the editable-element scans elsewhere in this file ([contenteditable], textarea, input,
    // [role="textbox"]) are deliberately NOT here. They're web-platform attributes, not LinkedIn
    // class names — LinkedIn cannot rename them, so there is nothing for a correction to fix.
    composer_box: '[role="textbox"], [contenteditable="true"]',
    thread_open_marker: '.msg-overlay-conversation-bubble .msg-form, .msg-convo-wrapper, .msg-thread, .scaffold-layout__detail .msg-s-message-list-container',
  };

  // The live set, and where each value came from. SEL_SOURCE is not bookkeeping for its own sake:
  // when the store silently fails, Wingguy still works perfectly on defaults, so "it looks fine" is
  // exactly what a broken pipe looks like. This is the only way to tell the two apart.
  const SEL_VALUE = { ...SELECTOR_DEFAULTS };
  const SEL_SOURCE = {};
  Object.keys(SELECTOR_DEFAULTS).forEach((k) => { SEL_SOURCE[k] = 'default'; });
  let selectorStoreState = 'not-loaded';

  /** One landmark as a selector string (for querySelector / matches). */
  function selStr(key) {
    return SEL_VALUE[key] || SELECTOR_DEFAULTS[key] || '';
  }
  /** One landmark as an ordered list of alternatives (for qsFirst). */
  function selList(key) {
    return selStr(key).split(',').map((s) => s.trim()).filter(Boolean);
  }

  /** Ask the background worker for any corrections and merge them over the defaults. Never throws:
   *  every failure path leaves SEL_VALUE exactly as it shipped. */
  async function loadRemoteSelectors(force) {
    try {
      const data = await bg({ type: 'WG_GET_SELECTORS', force: !!force });
      selectorStoreState = (data && data.store) || 'unknown';
      const remote = (data && data.selectors) || {};
      let applied = 0;
      for (const [key, entry] of Object.entries(remote)) {
        // Ignore keys this build doesn't know about — an older extension must never be broken by a
        // landmark added for a newer one.
        if (!(key in SELECTOR_DEFAULTS)) continue;
        const value = entry && typeof entry === 'object' ? entry.value : entry;
        if (!value || typeof value !== 'string') continue;
        SEL_VALUE[key] = value.trim();
        SEL_SOURCE[key] = 'server';
        applied += 1;
      }
      if (applied) console.log(`[Wingguy] landmark corrections applied: ${applied} (store=${selectorStoreState})`);
      return applied;
    } catch (e) {
      selectorStoreState = 'unreachable';
      return 0;
    }
  }

  // ---- self-check ------------------------------------------------------------
  // Which landmarks are supposed to resolve on which surface. A landmark missing where it was never
  // expected (no message body on a profile page) is not a fault, and reporting it as one is how these
  // things become noise you learn to ignore. `soft: true` = genuinely optional even on its own
  // surface (not everyone writes an About section), so a miss is recorded but is not a symptom.
  const SELF_CHECK_PLAN = {
    profile: [
      { key: 'profile_name' },
      { key: 'profile_top_card' },
      { key: 'profile_headline', soft: true },
      { key: 'profile_location', soft: true },
      { key: 'profile_about_spans', soft: true, within: 'about' },
    ],
    messaging: [
      { key: 'thread_open_marker' },
      { key: 'convo_container' },
      { key: 'convo_header', within: 'convo' },
      { key: 'message_group_name', within: 'convo', soft: true },
      { key: 'message_body', within: 'convo', soft: true },
      { key: 'composer_box', within: 'convo' },
    ],
  };

  /** The STRUCTURE sitting where a landmark used to be — tag names, class names, nothing else.
   *  Deliberately carries no page text: it travels off the client's machine, and the shape is all
   *  that's needed to work out the new selector. Same idea as dumpHeaderDiag below, but small enough
   *  to store and safe enough to send. */
  function shapeOf(root) {
    try {
      const scope = root || document.querySelector('main') || document.body;
      if (!scope) return '';
      const bits = [];
      const nodes = scope.querySelectorAll('*');
      for (let i = 0; i < nodes.length && bits.length < 40; i += 1) {
        const el = nodes[i];
        const cls = String(el.className || '');
        if (typeof el.className !== 'string' || !cls) continue;
        // Class names only, capped — enough to recognise LinkedIn's new naming, not enough to
        // reconstruct anything about the person on screen.
        bits.push(`${el.tagName.toLowerCase()}.${cls.split(/\s+/).slice(0, 3).join('.')}`.slice(0, 90));
      }
      return Array.from(new Set(bits)).slice(0, 30).join(' | ').slice(0, 2000);
    } catch (_) {
      return '';
    }
  }

  /** Grade our own homework against the page we're actually on, and send the result home. Silent by
   *  design: nothing here ever reaches the screen. */
  async function runSelfCheck(surface, scopes) {
    const plan = SELF_CHECK_PLAN[surface];
    if (!plan) return [];
    const checks = [];
    let anyHardMiss = false;
    for (const item of plan) {
      let root = document;
      if (item.within === 'convo') root = (scopes && scopes.convo) || document;
      if (item.within === 'about') root = (scopes && scopes.about) || document;
      let found = false;
      try { found = !!(root && root.querySelector(selStr(item.key))); } catch (_) { found = false; }
      if (!found && !item.soft) anyHardMiss = true;
      checks.push({
        key: item.key,
        surface,
        found,
        source: SEL_SOURCE[item.key] || 'default',
        // Only pay for a shape sample when something actually failed.
        shape: found ? '' : shapeOf(item.within === 'convo' ? (scopes && scopes.convo) : null),
      });
    }
    try {
      await bg({
        type: 'WG_SELECTOR_HEALTH',
        checks,
        extensionVersion: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '',
      });
    } catch (_) { /* health is never worth surfacing */ }
    if (anyHardMiss) console.log('[Wingguy] self-check: one or more expected landmarks did not resolve', checks);
    return checks;
  }

  /** What to TELL the person when a gap actually changes what they're about to get. Plain words, no
   *  diagnostics, and it says someone is already on it — a known issue is a very different feeling
   *  from a product quietly going vague on you. Only gaps that visibly affect the draft belong here;
   *  everything else stays in the silent health report. */
  function draftGapNotice(profile) {
    // Only on a profile read. In a thread the profile-only fields are blanked on purpose, so
    // checking them there would cry wolf on every single messaging turn.
    if (!profile || profile._wgSurface !== 'profile') return '';
    const gaps = [];
    if (!profile.about) gaps.push('their About section');
    if (!profile.headline) gaps.push('their headline');
    if (!gaps.length) return '';
    const what = gaps.length === 1 ? gaps[0] : `${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1]}`;
    return `I couldn't read ${what}, so this draft is thinner than usual - I'm on it.`;
  }

  // LinkedIn BPR ("blended page rendering", 2026-07): after an SPA navigation the whole messaging
  // surface can render inside a full-viewport SAME-ORIGIN iframe (src /preload/?_bprMode=…) — the top
  // document holds nothing but that frame, so a top-frame-only script is blind to the composer and
  // /wg "silently does nothing until refresh". This script now runs in every linkedin.com frame
  // (manifest all_frames). Inside the frame, location is the meaningless /preload/ URL — the REAL
  // route lives on the top window, which same-origin lets us read. Cross-origin frames (ad iframes
  // never match the manifest anyway) fall back to their own location.
  function topLocation() {
    try { return window.top.location.href ? window.top.location : location; } catch (_) { return location; }
  }
  let currentUrl = topLocation().href;
  let templates = null; // cached [{ id, label, useWhen, detectionKeywords, isDefault }]
  let lastScrapeScoped = false; // did the last thread scrape isolate a single conversation container?

  // ---- page detection -------------------------------------------------------
  function isProfilePage() {
    return /^\/in\//.test(topLocation().pathname);
  }
  function isMessagingPage() {
    return /^\/messaging\//.test(topLocation().pathname);
  }
  // Normalise any LinkedIn profile href to a clean https://www.linkedin.com/in/<slug> (strip query/hash).
  function normalizeInUrl(href) {
    const m = String(href || '').match(/\/in\/([^/?#]+)/);
    return m ? `https://www.linkedin.com/in/${m[1]}` : '';
  }
  // Resolve LinkedIn's internal member-id URL (/in/ACoA…) to the real vanity /in/<slug>.
  // A message thread only ever links the ACoA form, and LinkedIn does NOT redirect it — a HEAD/GET
  // returns 200 on the ACoA URL itself, so the old "follow the redirect" resolve was a silent no-op
  // (it handed back the ACoA unchanged → lookup missed → save skipped). But the profile HTML embeds
  // the owner's "vanityName", so GET the page IN-PAGE (same-origin → the logged-in session is carried,
  // which a background-worker fetch can't guarantee) and read the slug out. Verified live 2026-07-01.
  async function resolveAcoaToVanity(acoaUrl) {
    try {
      const res = await fetch(acoaUrl, { method: 'GET', credentials: 'include' });
      if (!res.ok) return '';
      const html = await res.text();
      const m = html.match(/vanityName\\?":\\?"([a-zA-Z0-9\-]{2,100})/);
      return m ? `https://www.linkedin.com/in/${m[1]}` : '';
    } catch (_) {
      return '';
    }
  }
  // Read the lead's LinkedIn Contact Info (email + phone) for the ENRICH step. Called ONLY after a create
  // or Guy's manual "grab their details" — never on an ordinary turn (Guy's cost rule 2026-07-08).
  //
  // DURABLE approach (2026-07-08): LinkedIn no longer serves contact info in a way we can fetch — the page
  // HTML doesn't contain it, and the classic Voyager API endpoint is 410 Gone; the data only exists once the
  // SPA renders the "Contact info" card. So the actual read happens in the BACKGROUND worker, which opens
  // that card in a background tab and reads the rendered modal DOM (what a human would see — immune to the
  // API/queryId churn that killed the fetch approach). This thin wrapper just delegates and returns
  // { email, phone } (either may be '').
  async function scrapeContactInfo(profileUrl) {
    try {
      const r = await bg({ type: 'WG_SCRAPE_CONTACT', profileUrl });
      const out = { email: (r && r.email) || '', phone: (r && r.phone) || '' };
      console.log('[Wingguy] contact-info (background tab read) → email:', out.email || '(none)', '| phone:', out.phone || '(none)');
      return out;
    } catch (e) {
      console.log('[Wingguy] contact-info scrape failed:', e.message);
      return { email: '', phone: '' };
    }
  }

  // Is a LinkedIn message thread actually open right now? True on the full /messaging/ detail pane AND
  // when a floating conversation bubble is expanded on ANY page (feed, profile, search, etc.). This is
  // what lets Wingguy offer itself from the messages, where there's no /in/ profile page in play.
  function hasOpenMessageThread() {
    return !!document.querySelector(selStr('thread_open_marker'))
      || !!newUiConvoFromDocument();  // new-UI build: structural match (guarded by the interop marker)
  }
  // When a visible BPR /preload/ iframe is carrying the surface, the copy of this script INSIDE that
  // frame owns it (composer, thread, send capture all live there). The top-frame copy must stand down:
  // its launcher would sit on top of the frame's and open a panel that can't see the thread.
  function bprFrameOwnsSurface() {
    if (window !== window.top) return false;          // we ARE the frame copy
    const f = document.querySelector('iframe[src*="/preload/"]');
    if (!(f && f.offsetWidth > 200 && f.offsetHeight > 200)) return false;
    // A floating bubble with an OPEN composer is the one surface the top document still owns on a
    // BPR page. (Not hasOpenMessageThread(): its structural new-UI matcher false-positives on the
    // collapsed bubble-chips drawer, which put a second launcher next to the frame copy's. The typed
    // /wg trigger is surface-independent, so a bubble the stricter check misses still works.)
    return !document.querySelector('.msg-overlay-conversation-bubble .msg-form');
  }
  // Show the launcher / accept the /wg trigger on profiles AND on the messaging surface.
  function shouldShowLauncher() {
    // all_frames injects this script into EVERY same-origin iframe — including little widget/ad
    // iframes in the right rail — and topLocation() makes each of them think it's on the messaging
    // page, so each grew its own launcher (second Wingguy button inside a Promoted ad, 2026-07-28).
    // A sub-frame copy only ever owns the surface when it IS the BPR /preload/ carrier frame.
    if (window !== window.top && !/^\/preload\//.test(location.pathname)) return false;
    if (bprFrameOwnsSurface()) return false;
    return isProfilePage() || isMessagingPage() || hasOpenMessageThread();
  }

  // ---- small DOM helpers ----------------------------------------------------
  function qsFirst(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  function cleanText(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // LinkedIn lazy-renders profile sections (About/Experience aren't in the DOM until scrolled near).
  // Step down the page to force them to load, then restore the user's scroll position. This is the
  // "auto-expand the page you're already on" restraint — NOT driving LinkedIn across profiles.
  async function autoScrollToLoad() {
    try {
      const startY = window.scrollY;
      const step = Math.max(500, Math.floor(window.innerHeight * 0.9));
      const maxY = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      for (let y = step; y <= maxY; y += step) {
        window.scrollTo(0, y);
        await sleep(110);
      }
      window.scrollTo(0, startY);
      await sleep(150);
    } catch (_) { /* non-fatal */ }
  }

  // ---- profile scraping (best-effort, multiple fallbacks) -------------------
  // LinkedIn's DOM is volatile; selectors are intentionally redundant. In the productised
  // version these move to remote extension-config; for now sensible defaults + Copy fallback.
  async function expandAboutSeeMore() {
    // Click the About section's "see more" so the full text is in the DOM before we read it.
    try {
      const aboutAnchor = document.getElementById('about');
      const section = aboutAnchor ? aboutAnchor.closest('section') : null;
      if (!section) return;
      const btn = Array.from(section.querySelectorAll('button')).find((b) =>
        /see more/i.test(b.getAttribute('aria-label') || b.textContent || '')
      );
      if (btn) {
        btn.click();
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (_) { /* non-fatal */ }
  }

  function readAbout() {
    const aboutAnchor = document.getElementById('about');
    const section = aboutAnchor ? aboutAnchor.closest('section') : null;
    if (!section) return '';
    // The About copy is usually in spans marked aria-hidden="true" (LinkedIn duplicates text for a11y).
    const spans = Array.from(section.querySelectorAll(selStr('profile_about_spans')))
      .map((s) => cleanText(s.textContent))
      .filter(Boolean);
    // Drop the heading ("About") and dedupe.
    const text = Array.from(new Set(spans)).filter((t) => t.toLowerCase() !== 'about').join(' ');
    return text.slice(0, 4000);
  }

  function readRecentActivity() {
    // Light, optional: grab a couple of snippets from the Activity section if present on the profile.
    const anchor = document.getElementById('content_collections') || document.getElementById('recent_activity');
    const section = anchor ? anchor.closest('section') : null;
    if (!section) return [];
    const items = Array.from(section.querySelectorAll(selStr('profile_about_spans')))
      .map((s) => cleanText(s.textContent))
      .filter((t) => t && t.length > 25);
    return Array.from(new Set(items)).slice(0, 3);
  }

  // Name fallbacks for when LinkedIn's DOM selectors miss (markup shifts, or the messaging
  // overlay is open over the profile). On an /in/ page we can almost always recover a name from
  // the page title or the URL slug, so the panel proceeds rather than dead-ending.
  function nameFromTitle() {
    let t = (document.title || '').split('|')[0].trim();   // "Jane Doe" or "(3) Jane Doe"
    t = t.replace(/^\(\d+\)\s*/, '').trim();               // strip notification count
    return t && !/^linkedin$/i.test(t) ? t : '';
  }
  function nameFromSlug() {
    const m = topLocation().pathname.match(/^\/in\/([^/]+)/);
    if (!m) return '';
    let parts = decodeURIComponent(m[1]).split('-').filter(Boolean);
    // Drop trailing id-ish tokens (LinkedIn appends a hash/number to disambiguate slugs).
    while (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (/\d/.test(last) || /^[0-9a-f]{6,}$/i.test(last)) parts.pop();
      else break;
    }
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }

  // On a /messaging/ page the rich profile (About/posts) isn't loaded, but the open thread's HEADER
  // carries the participant's name, headline and a link to their /in/ profile. Read those so CONTEXT
  // shows the right person and the email lookup (by /in/ URL) works. Scoped to the conversation the
  // user is acting in (the box they typed /wg in), else the active detail pane. DOM-fragile by nature
  // — logs a diagnostic when it can't find a clean name so the selectors can be locked from real DOM.
  // Dump the header DOM once when we can't cleanly read a name — so the exact selectors can be locked
  // from the real (bubble vs full-page) markup instead of guessing.
  function dumpHeaderDiag(root) {
    try {
      const bits = [];
      (root || document).querySelectorAll('h1,h2,h3,[class*="title"],[class*="entity-title"],[class*="lockup"],a[href*="/in/"]').forEach((e) => {
        const t = cleanText((e.getAttribute && e.getAttribute('aria-label')) || e.textContent).slice(0, 40);
        const href = e.getAttribute && e.getAttribute('href');
        bits.push(`${e.tagName}[${String(e.className || '').slice(0, 44)}]${href ? ' href=' + String(href).slice(0, 46) : ''}: ${t}`);
      });
      console.log('[Wingguy] HEADER DIAG (paste this to fix the name):', bits.slice(0, 20));
    } catch (e) { console.log('[Wingguy] header diag failed:', e.message); }
  }

  // NEW-UI header: the container's single <h2> is the participant's name (it is NOT a link there).
  // The /in/ URL comes from the message rows' profile links — but rows link BOTH sides of the
  // conversation (the coach's own "View Guy's profile" links too), so the pick is name-matched against
  // the header: only links whose text/aria carries the participant's first name qualify. Those links
  // are the internal /in/ACoA… form — the existing resolveAcoaToVanity step downstream un-scrambles
  // them (verified working against the new build, 2026-07-06).
  function scrapeNewUiHeader(convo) {
    const h2 = convo.querySelector('h2');
    const name = cleanText(h2 && h2.textContent);
    if (!looksLikeName(name)) return null;
    const first = name.split(/\s+/)[0].toLowerCase();
    const urls = [...convo.querySelectorAll('a[href*="/in/"]')].filter((a) => {
      const t = cleanText(a.getAttribute('aria-label') || a.textContent).toLowerCase();
      return first && t.includes(first);
    }).map((a) => normalizeInUrl(a.getAttribute('href'))).filter(Boolean);
    const profileUrl = urls.find((u) => !/\/in\/ACoA/i.test(u)) || urls[0] || '';
    return { name, headline: '', profileUrl };
  }

  // "New message" COMPOSE pane: the recipient exists ONLY as a typeahead chip — there is no /in/ link
  // to them anywhere in the pane (their thread rows, if any, are the coach's own sends). The chip is
  // the identity there; selectors are a wide net because the pill markup varies across builds.
  function composeRecipientNames(scope) {
    const names = [];
    const sels = [
      '.msg-connections-typeahead__added-recipients li',
      '[class*="typeahead"] [class*="pill"]',
      '[class*="added-recipient"]',
      // Bare .artdeco-pill is used all over LinkedIn (skills, banners) — a false hit in a normal
      // thread would wrongly flip us into compose-pane mode, so only take pills in a recipient row.
      '[class*="compose"] .artdeco-pill',
      '[class*="recipient"] .artdeco-pill',
    ];
    for (const sel of sels) {
      let nodes = [];
      try { nodes = scope.querySelectorAll(sel); } catch (_) { continue; }
      for (const n of nodes) {
        if (insideWingguy(n)) continue;
        // The pill's remove glyph can ride along in textContent ("Adrian Rampoldi ×") — strip it.
        const t = cleanText(n.textContent).replace(/[×✕]+$/, '').trim();
        if (looksLikeName(t) && !names.some((x) => x.toLowerCase() === t.toLowerCase())) names.push(t);
      }
      if (names.length) break; // most-specific selector that produced chips wins
    }
    return names;
  }

  // The signed-in user's own name, from the global-nav "Me" avatar alt. Used ONLY to refuse
  // obviously-self /in/ links in the URL pick below — never to choose one.
  function selfNavName() {
    for (const sel of ['img.global-nav__me-photo', '.global-nav__me img[alt]', '[class*="global-nav__me"] img[alt]']) {
      const img = document.querySelector(sel);
      const t = cleanText(img && img.getAttribute('alt'));
      if (looksLikeName(t)) return t;
    }
    return '';
  }

  function scrapeMessagingHeader(containerOpt) {
    // NOTE: .isConnected (not document.contains) — the messaging composer lives in an open shadow root,
    // and document.contains() can't see into shadow DOM, so it wrongly reported the box as "gone" and we
    // fell back to the profile behind the bubble. isConnected traverses shadow boundaries.
    const anchor = (lastFocusedEditable && lastFocusedEditable.isConnected) ? lastFocusedEditable : null;
    const convo = containerOpt || (anchor && closestConversationContainer(anchor)) ||
      document.querySelector(CONVO_SELECTORS()) || newUiConvoFromDocument();
    if (convo && isNewUiConvoContainer(convo)) {
      const h = scrapeNewUiHeader(convo);
      if (h) { console.log('[Wingguy] messaging-header (new-UI) →', h.name, '|', h.profileUrl || '(no /in/ url)'); return h; }
      console.log('[Wingguy] messaging-header (new-UI) — could not read a name from the container; falling through.');
    }
    const pane = (convo && (convo.closest('.scaffold-layout__detail, .msg-overlay-conversation-bubble') || convo)) || document;
    // Scope to the header region so we don't pull a name/link out of a message bubble body.
    const header = pane.querySelector(selStr('convo_header')) || pane;

    // NAME and URL are read SEPARATELY — in an overlay bubble the name is a heading (text, not a link) and
    // the /in/ link is usually the avatar (no text). Requiring both on one element (the old bug) missed it.
    // Name: a compose pane's recipient chip first (the ONLY place the recipient exists there), then
    // header title/heading text (validated to look like a name), then a named /in/ link as fallback.
    let name = '';
    const recipients = composeRecipientNames(pane);
    const isComposePane = recipients.length > 0;
    if (recipients.length === 1) {
      name = recipients[0];
      console.log('[Wingguy] compose-pane recipient chip →', name);
    } else if (recipients.length > 1) {
      console.log('[Wingguy] compose pane has MULTIPLE recipient chips (group message) — no single identity:', recipients.join(', '));
    }
    const nameSelectors = [
      '.msg-thread__link-to-profile',
      '.msg-overlay-bubble-header__title',
      '.msg-entity-lockup__entity-title',
      '[class*="overlay-bubble-header"] [class*="title"]',
      '[class*="title-bar"] [class*="title"]',
      '[class*="entity-lockup__entity-title"]',
      '[class*="entity-title"]',
      'h2', 'h3',
    ];
    if (!name && !isComposePane) {
      for (const sel of nameSelectors) {
        for (const el of header.querySelectorAll(sel)) {
          const t = cleanText(el.getAttribute('aria-label') || el.textContent);
          if (looksLikeName(t)) { name = t; break; }
        }
        if (name) break;
      }
    }
    const self = selfNavName();
    if (!name && !isComposePane) {
      for (const a of pane.querySelectorAll('a[href*="/in/"]')) {
        const t = cleanText(a.getAttribute('aria-label') || a.textContent);
        // Never adopt the coach's own name off their message rows' links.
        if (looksLikeName(t) && (!self || t.toLowerCase() !== self.toLowerCase())) { name = t; break; }
      }
    }
    // URL: prefer a VANITY slug. LinkedIn message headers often link to the internal member-id form
    // (/in/ACoAAB...), which won't match the vanity URL stored in the Portal → the lookup misses. Only fall
    // back to an internal one if that's all there is (the capture path resolves it to the vanity URL before
    // looking the lead up). The pick is guarded (Adrian Rampoldi, 2026-08-01 — "first /in/ link in the pane"
    // grabbed the coach's own "View Guy's profile" row link, attributing the thread to the coach):
    //   1. a link that name-matches the person this thread is with wins;
    //   2. failing that, any link EXCEPT one carrying the signed-in user's own name;
    //   3. in a compose pane, NO fallback at all — the recipient has no /in/ link there (chip only), so
    //      every link in the pane is someone else. No URL → the rescue card, prefilled with the chip name.
    let profileUrl = '';
    const inLinks = [...header.querySelectorAll('a[href*="/in/"]'), ...pane.querySelectorAll('a[href*="/in/"]')];
    const accText = (a) => {
      const img = a.querySelector ? a.querySelector('img[alt]') : null;
      return (cleanText(a.getAttribute('aria-label') || a.textContent) || cleanText(img && img.getAttribute('alt'))).toLowerCase();
    };
    const firstNameOf = (n) => String(n || '').trim().split(/\s+/)[0].toLowerCase();
    const wantFirst = firstNameOf(name);
    const selfFirst = firstNameOf(self);
    const candidates = inLinks.map((a) => ({ u: normalizeInUrl(a.getAttribute('href')), t: accText(a) })).filter((c) => c.u);
    const pickVanityFirst = (list) => { const hit = list.find((c) => !/\/in\/ACoA/i.test(c.u)) || list[0]; return hit ? hit.u : ''; };
    if (wantFirst) profileUrl = pickVanityFirst(candidates.filter((c) => c.t.includes(wantFirst)));
    if (!profileUrl && !isComposePane) {
      const excludeSelf = selfFirst && selfFirst !== wantFirst;
      profileUrl = pickVanityFirst(excludeSelf ? candidates.filter((c) => !c.t.includes(selfFirst)) : candidates);
    }

    // Headline (best-effort) from the header subtitle / lockup near the name.
    let headline = '';
    for (const sel of ['[class*="title-bar__subtitle"]', '[class*="entity-lockup__entity-info"]', '[class*="entity-lockup__subtitle"]', '[class*="__occupation"]']) {
      const t = cleanText((header.querySelector(sel) || pane.querySelector(sel) || {}).textContent);
      if (t && t.length < 200 && !/active now|online|reachable|· $/i.test(t)) { headline = t; break; }
    }

    if (!name || /^messaging$/i.test(name)) {
      console.log('[Wingguy] messaging-header scrape WEAK — name:', JSON.stringify(name), 'url:', profileUrl || '(none)', '— paste the HEADER DIAG below.');
      dumpHeaderDiag(header);
    } else {
      console.log('[Wingguy] messaging-header →', name, '|', headline || '(no headline)', '|', profileUrl || '(no /in/ url)');
    }
    return { name, headline, profileUrl };
  }

  // The conversation the user is acting in, if any — the thread that contains the box they typed /wg in
  // (or last focused). Crucially this is non-null even on a /in/ PROFILE page when a message bubble is
  // floating over it: that's how we tell "Deepti's bubble open on Todd's profile" (act on Deepti) from
  // "just Todd's profile" (act on Todd). document.contains guards a stale, since-closed bubble.
  function activeThreadContainer() {
    // NOTE: .isConnected (not document.contains) — the messaging composer lives in an open shadow root,
    // and document.contains() can't see into shadow DOM, so it wrongly reported the box as "gone" and we
    // fell back to the profile behind the bubble. isConnected traverses shadow boundaries.
    const anchor = (lastFocusedEditable && lastFocusedEditable.isConnected) ? lastFocusedEditable : null;
    return anchor ? closestConversationContainer(anchor) : null;
  }

  async function scrapeProfile() {
    // If the user is acting inside a message thread — including a floating conversation bubble open OVER
    // someone else's /in/ profile — the person meant is the one in the THREAD, not the profile behind it.
    const inThread = isMessagingPage() || !!activeThreadContainer();
    console.log('[Wingguy] scrapeProfile: inThread=', inThread, '(msgPage=', isMessagingPage(), 'bubble/thread=', !!activeThreadContainer(), ')');
    if (!inThread) {
      await autoScrollToLoad();   // force lazy sections (About/Experience) into the DOM (profile pages only)
      await expandAboutSeeMore();
    }
    const nameEl = qsFirst(selList('profile_name'));
    let name = cleanText(nameEl && nameEl.textContent);
    let nameSource = name ? 'page' : '';
    if (!name) { name = nameFromTitle(); if (name) nameSource = 'title'; }
    if (!name) { name = nameFromSlug(); if (name) nameSource = 'url'; }

    // Headline + location: search the top card (anchored on the name element when found, else the
    // top-card container). Junk risk is bounded because pageText below is the real grounding net.
    const topCard = (nameEl && nameEl.closest('section')) ||
      document.querySelector(selStr('profile_top_card')) || document;
    const headlineEl = qsFirst(selList('profile_headline'), topCard);
    let headline = cleanText(headlineEl && headlineEl.textContent);
    const locationEl = qsFirst(selList('profile_location'), topCard);
    let location = cleanText(locationEl && locationEl.textContent);

    // RAW FALLBACK: the whole profile's visible text. Robust to LinkedIn's class churn — when the
    // structured selectors miss, the model still gets real content to hook on (like AI Blaze does).
    const mainEl = document.querySelector('main') || document.body;
    const pageText = (mainEl.innerText || '')
      .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, 6000);

    const base = {
      name,
      headline,
      location,
      profileUrl: location_origin_path(),
      about: readAbout(),
      recentPosts: readRecentActivity(),
      pageText,
      nameSource,
      // Which surface this was read from. The gap notice needs it: in a thread the profile-only
      // fields are deliberately blanked below (they belong to the person behind the bubble, not the
      // one you're writing to), so without this every messaging turn would claim it couldn't read an
      // About section that was never meant to be there.
      _wgSurface: inThread ? 'messaging' : 'profile',
    };

    // Grade our own homework on the page we just read. Not awaited and never surfaced — this is the
    // silent half. The half the person sees is draftGapNotice(), rendered with the context header.
    try {
      const aboutAnchor = document.getElementById('about');
      runSelfCheck(inThread ? 'messaging' : 'profile', {
        convo: document.querySelector(CONVO_SELECTORS()) || null,
        about: (aboutAnchor && aboutAnchor.closest('section')) || null,
      }).catch(() => {});
    } catch (_) { /* a self-check must never break a scrape */ }

    // When acting in a thread, the page values are the WRONG person: on /messaging/ the h1 is the
    // messaging UI ("Messaging"); on a bubble-over-profile the h1 is the profile BEHIND the bubble
    // (Todd, not Deepti). Either way, override name/headline/URL from the open thread's header and
    // suppress the profile-only fields (about/posts/pageText belong to the wrong person here).
    if (inThread) {
      const h = scrapeMessagingHeader();
      if (h.name) { base.name = h.name; base.nameSource = 'messaging-header'; }
      if (h.headline) base.headline = h.headline;
      if (h.profileUrl) base.profileUrl = h.profileUrl;
      base.about = '';
      base.recentPosts = [];
      base.pageText = '';
    }
    // Un-scramble the internal /in/ACoA… member-id URL to the vanity slug ONCE, here at the source, so
    // EVERY downstream consumer (context display, lead + email lookups, booking, the invite link) works on
    // the messaging surface — where the header only ever exposes the ACoA form. Doing it here means no
    // individual call site can forget to resolve. See journal 2026-07-01 (the Deepti booking miss).
    if (base.profileUrl && /\/in\/ACoA/i.test(base.profileUrl)) {
      const real = await resolveAcoaToVanity(base.profileUrl);
      if (real && !/\/in\/ACoA/i.test(real)) { console.log('[Wingguy] scrapeProfile resolved internal URL →', real); base.profileUrl = real; }
    }
    return base;
  }

  function location_origin_path() {
    const l = topLocation(); // in a BPR frame, own location is the meaningless /preload/ URL
    return l.origin + l.pathname.replace(/\/$/, '');
  }

  // Read the OPEN LinkedIn message thread (the overlay you pop, or the /messaging pane), labelling
  // who said what. Messages are grouped: one .msg-s-message-group__name per run of bubbles from the
  // same sender, so we carry the last seen name forward across grouped continuations.
  // Which conversation container to read. LinkedIn can have SEVERAL message bubbles open at once, so a
  // page-wide query mixes threads together (Vera + Doug bug, 2026-06-26). Scope to the ONE conversation
  // anchored on the box the user is acting in (the composer they typed /wg in or sent from).
  // A function, not a const: the landmark corrections land AFTER this file is evaluated, so a
  // captured string here would freeze the shipped default and quietly ignore every fix.
  function CONVO_SELECTORS() { return selStr('convo_container'); }

  // Walk one step up the tree, crossing OPEN shadow boundaries (a shadow root's parent is the root;
  // hop to its .host to continue in the outer tree). Plain .closest() can't cross shadow boundaries.
  function ascendNode(node) {
    if (!node) return null;
    const p = node.parentNode;
    if (p) return (p.nodeType === 11 && p.host) ? p.host : p; // 11 = ShadowRoot/DocumentFragment
    return node.host || null;
  }
  // ---- NEW-UI (2026-07 rollout) structural matchers --------------------------
  // LinkedIn's rebuilt messaging renders inside a shadow root under [data-testid="interop-shadowdom"]
  // with MACHINE-GENERATED class names (e.g. _3bc34f41) — every .msg-* selector is dead there, and the
  // names churn per deploy so they can never be relied on. What IS stable is structure + semantics:
  // the composer is [role="textbox"] (aria-label "Write a message…"), the thread header is an <h2>
  // with the participant's name, message rows carry a name link + <time> + <p> content, and day
  // separators are <time> elements too. So the new-UI adapter matches STRUCTURE, not classes:
  // a conversation container = the SMALLEST element holding both the header <h2> and a composer.
  // (Exactly ONE h2 — the multi-thread drawer and the page body hold several, so they never match.)
  function isNewUiConvoContainer(node) {
    if (!node || node.nodeType !== 1 || !node.querySelectorAll) return false;
    try {
      if (node.matches && node.matches(CONVO_SELECTORS())) return false;      // classic path owns these
      if (node === document.body || node === document.documentElement) return false;
      if (node.querySelectorAll('h2').length !== 1) return false;
      return !!node.querySelector(selStr('composer_box'));
    } catch (_) { return false; }
  }
  // Any open new-UI conversation on the page, anchored on a visible composer (a send/typed trigger can
  // only happen where a composer exists). Guarded by the cheap interop marker so classic pages skip the
  // deep walk entirely.
  function newUiConvoFromDocument() {
    if (!document.querySelector('[data-testid="interop-shadowdom"]')) return null;
    const boxes = deepQueryAll(selStr('composer_box'))
      .filter((el) => isVisible(el) && !insideWingguy(el) && isMessageEditableSafe(el));
    const box = boxes[boxes.length - 1];                                    // most-recently-opened thread
    return box ? closestConversationContainer(box) : null;
  }
  function closestConversationContainer(el) {
    let node = el, steps = 0;
    while (node && steps++ < 300) {
      if (node.nodeType === 1 && node.matches) {
        try { if (node.matches(CONVO_SELECTORS())) return node; } catch (_) {}
        if (isNewUiConvoContainer(node)) return node;                       // new-UI: smallest h2+composer wrapper
      }
      node = ascendNode(node);
    }
    return null;
  }

  // Best-effort sender for a message item. The sender name lives in the message GROUP header (avatar
  // alt-text / name node / profile link) that wraps a run of items. Class names vary across LinkedIn
  // builds and the overlay bubble, so cast a wide net and validate the text actually looks like a name.
  function looksLikeName(t) {
    // "profile" blocks LinkedIn's row-link text ("View Guy's profile") — that once leaked through as a
    // person's "name" and prefilled the rescue card with junk (Adrian Rampoldi capture, 2026-08-01).
    return !!t && t.length >= 2 && t.length < 60 && /[A-Za-z]/.test(t) &&
      !/(message|reaction|status|sent the following|edited|open the options|see more|today|yesterday|active now|profile|· )/i.test(t);
  }
  function senderForItem(item) {
    const group = item.closest(selStr('message_group_item')) || item;
    const cands = [];
    group.querySelectorAll('img[alt]').forEach((im) => cands.push(im.getAttribute('alt')));            // avatar alt = name
    group.querySelectorAll(selStr('message_group_name'))
      .forEach((e) => cands.push(e.textContent));
    group.querySelectorAll('a[href*="/in/"]').forEach((a) => cands.push(a.getAttribute('aria-label') || a.textContent));
    for (const c of cands) {
      const t = cleanText(c);
      if (looksLikeName(t)) return t;
    }
    return '';
  }

  // Best-effort message time ("5:41 PM"). LinkedIn shows it in the group header / a <time> element;
  // grouped consecutive messages share the header time, so the caller carries the last seen time
  // forward. Falls back to scanning the item text for an H:MM AM/PM token.
  function timeForItem(item) {
    const group = item.closest(selStr('message_group')) || item;
    const tnode = group.querySelector(selStr('message_timestamp')) ||
      item.querySelector('time, [class*="timestamp"]');
    let raw = cleanText(tnode && ((tnode.getAttribute && tnode.getAttribute('aria-label')) || tnode.textContent));
    let m = raw.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/i);
    if (m) return m[0].replace(/\s+/g, ' ');
    m = cleanText(item.textContent).match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i);
    return m ? m[0].replace(/\s+/g, ' ') : '';
  }

  // When every sender came back Unknown, dump the structure once so we can lock the right selector
  // from the real DOM (paste the console line). Shadow-aware ancestor walk + nearby name candidates.
  function dumpSenderDiag(items) {
    try {
      const first = items[0];
      if (!first) return;
      const ancestors = [];
      let n = first, steps = 0;
      while (n && steps++ < 10) {
        if (n.nodeType === 1) ancestors.push((n.tagName || '') + '.' + String(n.className || '').trim().replace(/\s+/g, '.').slice(0, 70));
        n = ascendNode(n);
      }
      let scope = first;
      for (let i = 0; i < 4 && ascendNode(scope); i++) scope = ascendNode(scope);
      const names = [];
      if (scope && scope.querySelectorAll) {
        scope.querySelectorAll('img[alt], a[href*="/in/"], [class*="name"]').forEach((e) => {
          const t = cleanText((e.getAttribute && e.getAttribute('alt')) || e.textContent);
          if (t) names.push(`${e.tagName}[${String(e.className || '').slice(0, 36)}]: ${t.slice(0, 40)}`);
        });
      }
      console.log('[Wingguy] SENDER DIAG (paste this to fix names):\n ancestors:', ancestors, '\n name-candidates:', names.slice(0, 14));
    } catch (e) { console.log('[Wingguy] sender diag failed:', e.message); }
  }

  // Read the OPEN LinkedIn thread for the conversation the user is acting in. Shadow-aware (the newer
  // messaging build renders inside open shadow roots) AND scoped to a single conversation container so
  // multiple open bubbles don't bleed into one another.
  // NEW-UI thread reader: walk the container's <time> / profile-link / <p> nodes in document order.
  // <time> with an H:MM is a message time; <time> without one is a DAY separator ("Saturday", "Today").
  // A name-ish profile link sets the sender (rows link the sender; "View X's profile" strips to X;
  // grouped continuations carry the last sender forward). <p> elements are the message text — multiple
  // <p>s sharing a parent are ONE multi-paragraph message. Composer content is excluded.
  function scrapeNewUiThread(convo) {
    const out = [];
    let lastSender = '', curDay = '', lastTime = '';
    let buf = null; // { sender, day, time, parent, parts[] } — merges sibling <p>s into one message
    const flush = () => {
      if (buf && buf.parts.length) out.push({ sender: buf.sender || 'Unknown', text: buf.parts.join('\n'), day: buf.day, time: buf.time });
      buf = null;
    };
    for (const node of convo.querySelectorAll('time, a[href*="/in/"], p')) {
      if (insideWingguy(node) || node.closest(selStr('composer_box'))) continue;
      if (node.tagName === 'TIME') {
        const t = cleanText(node.textContent);
        const m = t.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?/i);
        if (m) lastTime = m[0].replace(/\s+/g, ' ');
        else if (t && t.length < 30) curDay = t;
        flush();
        continue;
      }
      if (node.tagName === 'A') {
        let t = cleanText(node.getAttribute('aria-label') || node.textContent);
        const vm = t.match(/^view\s+(.+?)[’']s\s+profile$/i);
        if (vm) t = vm[1];
        if (looksLikeName(t) && !/profile/i.test(t)) { if (buf && buf.sender !== t) flush(); lastSender = t; }
        continue;
      }
      const text = cleanText(node.textContent);
      if (!text) continue;
      if (buf && buf.parent === node.parentElement) buf.parts.push(text);
      else { flush(); buf = { sender: lastSender, day: curDay, time: lastTime, parent: node.parentElement, parts: [text] }; }
    }
    flush();
    return out;
  }

  function scrapeOpenThread(anchorEl) {
    // A remembered box LinkedIn has since detached (composers are re-rendered after a send) must not
    // anchor the scrape — closestConversationContainer would walk the DETACHED old tree and read a
    // stale copy of the thread. Only a still-connected box counts.
    const anchor = anchorEl || ((lastFocusedEditable && lastFocusedEditable.isConnected) ? lastFocusedEditable : null) || deepActiveElement();
    const container = anchor ? closestConversationContainer(anchor) : null;
    if (container && isNewUiConvoContainer(container)) {
      lastScrapeScoped = true;
      const out = scrapeNewUiThread(container);
      console.log('[Wingguy] thread scrape (new-UI):', { items: out.length, firstSender: out[0] && out[0].sender, firstTime: out[0] && out[0].time });
      return out;
    }
    lastScrapeScoped = !!container;
    const root = container || document;
    // Walk message items AND the day-heading separators in order, so each message can carry the day it
    // fell under (real dates on the record) plus its time. Sender/time carry forward across a group's
    // continuation bubbles (only the first bubble shows the name/time).
    const nodes = deepQueryAll(selStr('message_item'), root);
    const out = [];
    const msgItems = [];
    let lastSender = '', curDay = '', lastTime = '';
    nodes.forEach((node) => {
      if (!node.matches) return;
      const isItem = node.matches(selStr('message_item_row'));
      if (!isItem) {
        if (node.matches('.msg-s-message-list__time-heading, [class*="time-heading"]')) {
          const d = cleanText(node.textContent);
          if (d && d.length < 30) curDay = d;   // e.g. "JUN 17" / "Today"
        }
        return;
      }
      msgItems.push(node);
      const name = senderForItem(node); if (name) lastSender = name;
      const time = timeForItem(node); if (time) lastTime = time;
      const bodyEl = node.querySelector(selStr('message_body'));
      const text = cleanText(bodyEl && bodyEl.textContent);
      if (text) out.push({ sender: lastSender || 'Unknown', text, day: curDay, time: lastTime });
    });
    console.log('[Wingguy] thread scrape:', {
      scopedTo: container ? (String(container.className || '').split(' ')[0] || 'container') : 'NONE→document',
      items: msgItems.length, firstSender: out[0] && out[0].sender, firstTime: out[0] && out[0].time,
    });
    if (out.length && out.every((m) => m.sender === 'Unknown')) dumpSenderDiag(msgItems);
    return out;
  }

  // Code-side routing (deterministic, no AI): it's a REPLY only when the PROSPECT has actually said
  // something. A thread that contains only Guy's own outbound (e.g. just the connection-request note)
  // is still a first-touch THANKS — otherwise we'd misread Guy's own note as "a conversation". The
  // human can override with the mode switch.
  function classifyMode(thread, prospectName) {
    if (!thread.length) return 'thanks';
    const pn = String(prospectName || '').toLowerCase().trim();
    const first = pn.split(/\s+/)[0];
    if (!first) return 'reply'; // can't identify the prospect → assume a conversation
    const prospectSpoke = thread.some((m) => {
      const s = String(m.sender || '').toLowerCase();
      return s.includes(first) || (pn && s.includes(pn));
    });
    return prospectSpoke ? 'reply' : 'thanks';
  }

  // ---- the LinkedIn message composer (insert target) ------------------------
  function isVisible(el) {
    return !!(el && (el.offsetParent !== null || el.getClientRects().length));
  }

  // AI-Blaze-style insert: don't hunt for the box — insert wherever the user's CURSOR is. We track the
  // last editable they focused (works across open shadow roots), and the Insert button is set not to
  // steal focus, so the message box stays focused when they click it.
  let lastFocusedEditable = null;
  function insideWingguy(el) { return !!(el && el.closest && el.closest('#wingguy-overlay')); }
  function isEditableEl(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable === true ||
      (el.getAttribute && el.getAttribute('role') === 'textbox');
  }
  // The real focused element, descending into open shadow roots (activeElement only gives the host).
  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  function trackFocus() {
    const el = deepActiveElement();
    if (isEditableEl(el) && !insideWingguy(el)) lastFocusedEditable = el;
  }
  function resolveInsertTarget() {
    const active = deepActiveElement();
    if (isEditableEl(active) && !insideWingguy(active)) return active;
    if (lastFocusedEditable && isEditableEl(lastFocusedEditable) && !insideWingguy(lastFocusedEditable)) {
      return lastFocusedEditable;
    }
    return findComposer(); // last resort (older surfaces where we can still locate it)
  }

  // Deep query that pierces OPEN shadow roots (LinkedIn's newer messaging build hides the composer in
  // a shadow root, where a plain document.querySelectorAll can't see it). Closed shadow roots remain
  // unreachable by any extension — those fall back to Copy.
  function deepQueryAll(selector, root = document) {
    const out = [];
    const visit = (node) => {
      let matches = [];
      try { matches = node.querySelectorAll ? Array.from(node.querySelectorAll(selector)) : []; } catch (_) {}
      for (const m of matches) out.push(m);
      let all = [];
      try { all = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : []; } catch (_) {}
      for (const el of all) { if (el.shadowRoot) visit(el.shadowRoot); }
    };
    visit(root);
    return out;
  }

  // All editable candidates (light DOM + open shadow roots), visible, excluding our own overlay.
  function editableCandidates() {
    return deepQueryAll('[contenteditable]:not([contenteditable="false"]), textarea, [role="textbox"]')
      .filter((el) => isVisible(el) && !el.closest('#wingguy-overlay'));
  }
  function describeEl(el) {
    return {
      tag: el.tagName, contenteditable: el.getAttribute('contenteditable'),
      role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'), cls: String(el.className || '').slice(0, 100),
    };
  }
  // Only ever target the MESSAGE area — matching a stray page field caused a silent wrong insert.
  function isMessageEditable(el) {
    const al = (el.getAttribute('aria-label') || '').toLowerCase();
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    return !!el.closest('.msg-form, .msg-overlay-conversation-bubble, .msg-overlay-bubble, .msg-convo-wrapper, .msgs-thread, .msg-overlay, .scaffold-layout__detail')
      || /message/.test(al) || /message/.test(ph);
  }
  function isMessageEditableSafe(el) {
    try { return isMessageEditable(el); } catch (_) { return false; }
  }
  function findComposer() {
    const all = editableCandidates();
    const scoped = all.filter(isMessageEditable);
    const chosen = scoped[scoped.length - 1] || null;  // most-recently-opened thread
    console.log('[Wingguy] composer search:', { totalEditable: all.length, inMessageArea: scoped.length, chosen: chosen ? describeEl(chosen) : null });
    return chosen;
  }

  // A collapsed "Write a message…" affordance (button/div) that, when clicked, mounts the real editable.
  function findComposeTrigger() {
    const cands = deepQueryAll('[aria-label], [placeholder]')
      .filter((el) => isVisible(el) && !el.closest('#wingguy-overlay'));
    for (const el of cands) {
      const t = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase();
      if (/write a message|message…|message\.\.\./.test(t)) return el;
    }
    return null;
  }

  // Human-friendly diagnostic (copied to clipboard from the panel), now shadow-DOM aware.
  function collectEditables() {
    const els = deepQueryAll('[contenteditable], textarea, input, [role="textbox"]');
    let shadowHosts = 0;
    try { shadowHosts = deepQueryAll('*').filter((e) => e.shadowRoot).length; } catch (_) {}
    return {
      shadowHosts,
      trigger: (() => { const t = findComposeTrigger(); return t ? describeEl(t) : null; })(),
      editables: els.slice(0, 60).map((el) => ({
        tag: el.tagName,
        contenteditable: el.getAttribute('contenteditable'),
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        cls: String(el.className || '').slice(0, 140),
        visible: isVisible(el),
        inMessageArea: isMessageEditableSafe(el),
      })),
    };
  }
  function buildDiagnosticText() {
    return 'WINGGUY DIAGNOSTIC\n' + JSON.stringify({ path: topLocation().pathname, framed: window !== window.top, ...collectEditables() }, null, 2);
  }
  function logEditableDiagnostics() {
    try { console.log('[Wingguy] composer diagnostic:', collectEditables()); } catch (_) {}
  }

  // Insert at the user's CURSOR (AI-Blaze style): target the focused editable (the box they clicked
  // into / typed the trigger in), and use the browser's native input pipeline so LinkedIn's editor
  // observes it and keeps the line breaks. The Insert button is set not to steal focus, so the message
  // box stays focused when clicked.
  async function insertIntoComposer(text) {
    const normalized = String(text).replace(/\r\n/g, '\n').trim();
    let target = resolveInsertTarget();
    if (!target) { logEditableDiagnostics(); return { ok: false, reason: 'no-focus' }; }

    target.focus();
    const tag = target.tagName;

    // <textarea>/<input>: insert at the caret via setRangeText (React observes the input event).
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      try {
        const s = target.selectionStart != null ? target.selectionStart : target.value.length;
        const e = target.selectionEnd != null ? target.selectionEnd : s;
        target.setRangeText(normalized, s, e, 'end');
      } catch (_) {
        const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, normalized);
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    }

    // contenteditable: insert at the caret (no select-all — like AI Blaze replacing its trigger).
    let inserted = false;
    try { inserted = document.execCommand('insertText', false, normalized); } catch (_) {}
    if (inserted) {
      // Native insert succeeded — trust it. A strict re-read gives false negatives in LinkedIn's
      // shadow/React editor (the text is visibly there even when innerText reads stale/elsewhere).
      target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: normalized }));
      return { ok: true };
    }
    // Fallback only if the native insert was rejected: write paragraphs, then verify THAT path.
    try {
      const html = normalized.split('\n').map((l) => `<p>${l ? escapeHtml(l) : '<br>'}</p>`).join('');
      target.innerHTML = html;
    } catch (_) {}
    target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: normalized }));
    const after = (target.value != null ? target.value : target.innerText) || '';
    if (normalized.slice(0, 15) && !after.includes(normalized.slice(0, 15))) {
      console.log('[Wingguy] insert did not take. Target was:', describeEl(target));
      logEditableDiagnostics();
      return { ok: false, reason: 'verify-failed' };
    }
    return { ok: true };
  }

  // Copy the draft to the clipboard as BOTH plain text and HTML (one <div> per line). Pasting the
  // HTML flavour into LinkedIn's composer preserves the line breaks that a plain-text paste flattens.
  async function copyDraft(text) {
    const normalized = String(text).replace(/\r\n/g, '\n').trim();
    const html = normalized.split('\n')
      .map((l) => (l.trim() ? `<div>${escapeHtml(l)}</div>` : '<div><br></div>'))
      .join('');
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([normalized], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })]);
        return true;
      }
    } catch (_) { /* fall through to plain text */ }
    try { await navigator.clipboard.writeText(normalized); return true; } catch (_) { return false; }
  }

  // ---- typed trigger (/wg etc.) from inside the composer --------------------
  // Match a trigger at the very end of the box's text (they just typed it). Longest first.
  function matchedTrigger(text) {
    const tail = String(text || '').slice(-12).toLowerCase();
    for (const tr of TRIGGERS) {
      if (tail.endsWith(tr)) return tr;
    }
    return null;
  }
  // Remove the trigger token the user typed, so it doesn't linger in the message box.
  function stripTrigger(target, n) {
    try {
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        const end = target.selectionStart != null ? target.selectionStart : (target.value || '').length;
        const start = Math.max(0, end - n);
        target.setRangeText('', start, end, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        target.focus();
        for (let i = 0; i < n; i++) document.execCommand('delete', false);
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      }
    } catch (_) { /* non-fatal — worst case the trigger text stays; user can clear it */ }
  }
  // Rolling buffer of the last printable keys typed anywhere on the page. The primary trigger path
  // reads the composer's own text — but some LinkedIn builds hide the composer where no extension can
  // read it (closed shadow root: activeElement stops at the host). Document-level keydown still
  // reports e.key regardless, so the buffer lets /wg work even when the box itself is unreadable.
  // This was one of the "typing /wg silently does nothing until I refresh" causes (2026-07-15).
  let keyBuf = '';
  function onKeydownBuffer(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') { keyBuf = keyBuf.slice(0, -1); return; }
    if (e.key === 'Enter' || e.key === 'Escape') { keyBuf = ''; return; }
    if (e.key.length === 1) keyBuf = (keyBuf + e.key).slice(-12);
  }
  function onComposerKeyup() {
    if (document.getElementById(OVERLAY_ID)) return;          // already open
    const target = deepActiveElement();
    if (insideWingguy(target)) return;
    if (isEditableEl(target)) {
      const text = (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
        ? (target.value || '') : (target.textContent || '');
      const tr = matchedTrigger(text);
      if (!tr) return;
      // The user typed the trigger DELIBERATELY — honor it in ANY editable on LinkedIn. The old
      // message-surface gate (must look like a .msg-* composer / be on /messaging/ / have a
      // detectable open thread) silently ate /wg whenever LinkedIn's A/B-served markup wasn't
      // recognised — the "sometimes it just doesn't work until I refresh" reports (2026-07-15).
      // Surface detection still governs WHERE Insert lands, just not whether the panel opens.
      console.log('[Wingguy] trigger typed:', tr);
      stripTrigger(target, tr.length);
      lastFocusedEditable = target;                            // remember the box for the insert
      keyBuf = '';
      openPanel();
      return;
    }
    // FALLBACK: something focused that we can't read (closed shadow root — the composer's keystrokes
    // still bubble out with the host as target). If the recent keystrokes end in a trigger, honor it.
    if (!target || target === document.body || target === document.documentElement) return;
    const tr = matchedTrigger(keyBuf);
    if (!tr) return;
    console.log('[Wingguy] trigger via keystroke-buffer fallback (composer unreadable — likely closed shadow root):', tr);
    keyBuf = '';
    // Best-effort strip: execCommand routes to the browser's internally-focused editable, which can
    // reach inside a closed root when our DOM access can't. Worst case the trigger text stays.
    try { for (let i = 0; i < tr.length; i++) document.execCommand('delete', false); } catch (_) {}
    openPanel();
  }

  // ---- background bridge ----------------------------------------------------
  function bg(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp) return reject(new Error('No response from background.'));
        if (resp.success === false) return reject(new Error(resp.error || 'Request failed.'));
        resolve(resp.data !== undefined ? resp.data : resp);
      });
    });
  }

  // ---- learn-from-my-edit: remember the AI's draft so a send can be paired with it ----------
  // Set by the panel's Insert/Copy buttons with the AI's ORIGINAL draft (panel edits are the
  // human's edits too, so we stash what the model produced, not the possibly-edited textarea).
  // Read + cleared by the on-Send capture, which posts {generated, sent} to /api/wingguy/edit-pair.
  // The backend drops unchanged pairs, so stashing on every insert is harmless; review happens
  // later in Claude chat ("review my edits"), never here.
  let pendingGeneratedDraft = null; // { text, profileUrl, name, at }
  const EDIT_PAIR_MAX_AGE_MS = 15 * 60 * 1000; // an insert older than this can't claim a send
  function stashGeneratedDraft(text, profile) {
    const t = String(text || '').trim();
    if (!t) return;
    pendingGeneratedDraft = {
      text: t,
      profileUrl: (profile && profile.profileUrl) || '',
      name: (profile && profile.name) || '',
      at: Date.now(),
    };
  }
  function slugOfInUrl(u) { return ((String(u || '').match(/\/in\/([^/?#]+)/) || [])[1] || '').toLowerCase(); }

  // ---- on-Send → Portal capture (the background half) -----------------------
  // When the human clicks LinkedIn's Send (iron rule: never headless), snapshot the WHOLE thread and
  // full-replace it onto the lead's Portal record. Reuses the legacy "Save to Portal" path exactly:
  //   scrape thread → format as LinkedIn-style raw text → LOOKUP_LEAD by profile URL → QUICK_UPDATE
  //   { section:'linkedin' } (the backend parseConversation() parses it and REPLACES the linkedin
  //   section of the Notes field — there's no dedicated conversation field). Kills the manual copy.

  // Mirror the legacy formatConversationForApi shape so the server-side parser handles it identically.
  // (We don't carry per-message timestamps yet, so emit a neutral time — the parser tolerates it and
  // message order is preserved from the DOM. Timestamp fidelity is a later refinement.)
  function formatThreadForApi(thread) {
    const out = [];
    let lastDay = '';
    for (const m of thread) {
      const sender = (m.sender || 'Unknown').trim();
      const time = (m.time && /\d{1,2}:\d{2}/.test(m.time)) ? m.time : '12:00 PM';
      if (m.day && m.day !== lastDay) { out.push(m.day); lastDay = m.day; } // day header → real dates on the record
      out.push(`${sender} sent the following message at ${time}`);
      out.push(`${sender}   ${time}`);
      out.push(m.text || '');
      out.push('');
    }
    return out.join('\n');
  }

  // Contact details the lead PROFFERS in the thread ("hit me up dw@... 0447 693 465") belong on the
  // record, not just buried in Notes — Deon's mobile never made it to the Portal (2026-07-28). Guy's
  // rule: a self-given detail WINS over what's stored (the server folds a displaced primary email
  // into {Alt Emails}, so nothing is lost; a mistyped mobile is the lead's to correct). Only the
  // LEAD's messages are scanned — the coach's own signature must never become the lead's contact
  // info. Thread runs oldest→newest, so a later self-correction overrides an earlier mention.
  function extractProfferedContact(thread, leadFirst, leadLast) {
    let email = '';
    let phone = '';
    for (const m of thread) {
      const sender = String(m.sender || '').toLowerCase().trim();
      const isLead = sender &&
        ((leadFirst && sender.includes(leadFirst)) || (leadLast && leadLast.length > 2 && sender.includes(leadLast)));
      if (!isLead) continue;
      // Strip URLs first — profile links carry 9-digit slugs that would read as phone numbers.
      const text = String(m.text || '').replace(/(?:https?:\/\/|www\.)\S+/gi, ' ');
      const emails = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
      if (emails && emails.length) email = emails[emails.length - 1];
      for (const c of (text.match(/[+(]?\d[\d ()-]{6,}\d/g) || [])) {
        const cand = c.trim();
        const digits = cand.replace(/\D/g, '');
        // 9–15 digits kills dates/years; the +/0/(-or-separators shape kills bare IDs and slugs.
        if (digits.length >= 9 && digits.length <= 15 && (/^[+0(]/.test(cand) || /[ ()-]/.test(cand))) phone = cand;
      }
    }
    return { email, phone };
  }
  // Which proffered details actually differ from what's stored (skip no-op churn on every capture).
  function profferedExtras(thread, leadFirst, leadLast, storedEmail, storedPhone) {
    const digitsOf = (s) => String(s || '').replace(/\D/g, '');
    const p = extractProfferedContact(thread, leadFirst, leadLast);
    const extras = {};
    if (p.email && p.email.toLowerCase() !== String(storedEmail || '').trim().toLowerCase()) extras.email = p.email;
    if (p.phone && digitsOf(p.phone) !== digitsOf(storedPhone)) extras.phone = p.phone;
    return extras;
  }
  const extrasNote = (extras) => {
    const got = [extras.email && 'email', extras.phone && 'mobile'].filter(Boolean).join(' + ');
    return got ? ` (grabbed their ${got})` : '';
  };

  let captureTimer = null;
  // The element the latest send came from (send button / composer). The capture pins to ITS conversation
  // — by capture time LinkedIn has often re-rendered the composer (detaching lastFocusedEditable), and
  // the old attached-box gate then fell back to the PAGE URL, attributing a bubble's thread to the
  // profile behind it → the wrong-person guard refused the save (Jason, 2026-07-06). Reset on every
  // schedule (null when unknown) so a stale anchor can't pin a later capture to the wrong conversation.
  let lastSendAnchor = null;
  function scheduleCapture(anchorEl) {
    lastSendAnchor = anchorEl || null;
    // TRAILING debounce: fire once ~1.8s after the LAST send in a burst. Sending a message often fires
    // several sends in a row (emoji reactions + a text message; button-click + Enter both fire) — a
    // leading debounce would snapshot after the FIRST and miss the final message. Resetting the timer on
    // each send means we snapshot once the burst has settled and the last message has rendered.
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => { captureTimer = null; captureConversationToPortal(); }, 1800);
  }

  async function captureConversationToPortal() {
    // Hoisted so the catch block can still hand whatever WAS captured to the rescue card —
    // a refusal must never throw the conversation away (Deon, 2026-07-28).
    let thread = [];
    let hdr = { profileUrl: '', name: '' };
    try {
      // We need the person's /in/ URL to look the lead up. Pin the capture to the conversation the SEND
      // came from — never trust the page URL while any thread is open. The old gate asked "is the
      // remembered composer still attached?", but LinkedIn re-renders the composer after a send, so by
      // capture time (1.8s debounce) it was often detached and the capture fell back to the page URL —
      // on a bubble over someone else's profile that attributed the thread to the profile BEHIND it and
      // the wrong-person guard below (correctly) refused the save (Jason, 2026-07-06). Resolution order:
      // the send's own element (exact) → the live focused box → ANY open conversation container (a send
      // can only come from a composer, so if one exists the send happened in a thread) → page URL only
      // when there's genuinely no thread on the page.
      const findConvo = () =>
        (lastSendAnchor && lastSendAnchor.isConnected && closestConversationContainer(lastSendAnchor)) ||
        activeThreadContainer() ||
        document.querySelector(CONVO_SELECTORS()) ||
        newUiConvoFromDocument();
      let convo = findConvo();
      hdr = convo ? scrapeMessagingHeader(convo) : { profileUrl: location_origin_path(), name: '' };
      let profileUrl = hdr.profileUrl;
      // The header can be mid-render right after a send — one quick retry before giving up.
      if ((!profileUrl || !/\/in\//.test(profileUrl)) && convo) {
        await sleep(800);
        convo = findConvo() || convo;
        hdr = scrapeMessagingHeader(convo);
        profileUrl = hdr.profileUrl;
      }
      // Read the thread from the SAME container the header came from, so identity and content can never
      // disagree (a container element is its own closestConversationContainer match). Scraped BEFORE the
      // identity gates below so a refusal can still offer the captured text through the rescue card.
      thread = convo ? scrapeOpenThread(convo) : [];
      if (!thread.length) {
        console.log('[Wingguy] capture skipped — no thread read');
        showCaptureRescue({
          reason: "Couldn't read the conversation from the page, so there's nothing to save. Reopen the conversation and resend.",
        });
        return;
      }
      // Never auto-save a thread we couldn't isolate to one conversation — that's how Vera+Doug got
      // mixed. The rescue card may still offer it, because the human reads the preview before saving.
      if (!lastScrapeScoped) {
        console.log('[Wingguy] capture skipped — could not isolate a single conversation');
        showCaptureRescue({
          reason: "Couldn't isolate this to one conversation, so nothing was saved automatically.",
          caution: 'The preview may mix messages from more than one thread — read it before saving.',
          thread,
          prefillName: hdr.name,
        });
        return;
      }
      if (!profileUrl || !/\/in\//.test(profileUrl)) {
        console.log('[Wingguy] capture needs help — no /in/ profile URL for this thread');
        showCaptureRescue({
          reason: "Couldn't read whose thread this is, so it wasn't saved automatically.",
          thread,
          prefillName: hdr.name,
        });
        return;
      }
      // LinkedIn's internal member-id URL (/in/ACoA...) won't match the vanity URL stored in Airtable —
      // resolve it in-page by reading the profile's vanityName (LinkedIn does NOT redirect the ACoA form).
      if (/\/in\/ACoA/i.test(profileUrl)) {
        const real = await resolveAcoaToVanity(profileUrl);
        if (real && !/\/in\/ACoA/i.test(real)) { console.log('[Wingguy] resolved internal URL →', real); profileUrl = real; }
        else console.log('[Wingguy] could not resolve internal URL to a vanity slug:', profileUrl);
      }
      // SELF-TEST ALARM — if the URL is STILL the internal /in/ACoA form here, the un-scramble step
      // (resolveAcoaToVanity) failed. That is the ONE miss that means the resolver itself broke — as
      // opposed to the person simply not being in the Portal. An ACoA can never match a vanity URL, so
      // stop now and shout DISTINCTLY, so this regression can never again hide as a generic "no matching
      // lead" miss (it's how the original bug went unnoticed for so long). See journal 2026-07-01.
      if (/\/in\/ACoA/i.test(profileUrl)) {
        console.error('[Wingguy] ⚠ UN-SCRAMBLE FAILED — link is still the internal /in/ACoA form:', profileUrl,
          '— resolveAcoaToVanity() may be broken (LinkedIn page shape changed?).');
        showCaptureRescue({
          reason: 'Couldn\'t un-scramble this person\'s LinkedIn link, so it wasn\'t saved automatically. Flag this: "un-scramble broke" (the resolve step may have broken, not just a missing lead).',
          thread,
          prefillName: hdr.name,
        });
        return;
      }

      const content = formatThreadForApi(thread);

      const lookup = await bg({ type: 'LOOKUP_LEAD', linkedinUrl: profileUrl });
      const leads = (lookup && lookup.leads) || [];
      if (!leads.length) {
        console.log('[Wingguy] capture: no matching lead in portal for', profileUrl);
        showCaptureRescue({
          reason: `No lead in your Portal matched ${profileUrl.replace('https://www.linkedin.com', '')}, so it wasn't saved automatically. If they ARE in your Portal, their record probably stores a different LinkedIn URL — find them below and the save fixes itself. If they're new, add them below.`,
          thread,
          prefillName: hdr.name,
          // Nothing in the Portal claims this URL — safe to stamp it on a brand-new record, which
          // is what makes the NEXT capture from this conversation save itself.
          newUrl: profileUrl,
        });
        return;
      }
      const lead = leads[0];
      const who = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'that lead';

      // SAFETY — never write one lead's conversation onto another's record (the James-chat-on-Neville's-
      // record bug). The lead we matched (by URL) MUST appear as a participant in this thread. If the
      // thread's senders are readable and the lead isn't among them, refuse and say so — a visible
      // "didn't save, mismatch" is always safer than silently corrupting a record.
      const leadFirst = String(lead.firstName || '').trim().toLowerCase();
      const leadLast = String(lead.lastName || '').trim().toLowerCase();
      const knownSenders = [...new Set(thread.map((m) => String(m.sender || '').toLowerCase().trim()))]
        .filter((s) => s && s !== 'unknown');
      const nameMatches = (hay) => !!hay && ((leadFirst && hay.includes(leadFirst)) || (leadLast.length > 2 && hay.includes(leadLast)));
      // A lead counts as a participant if they've SENT a message OR they're the person the thread is WITH
      // (the header name). A freshly-connected lead who hasn't replied yet is never a "sender", so the
      // sender-only check wrongly blocked EVERY first-contact save (Alexis/Bruce, 2026-07-01). The header
      // name is who we just matched by URL, so it confirms identity without weakening the wrong-person
      // guard — a URL that matched someone NOT named in the header or the senders is still refused.
      const headerName = String((hdr && hdr.name) || '').toLowerCase();
      const leadInThread = knownSenders.some(nameMatches) || nameMatches(headerName);
      if (knownSenders.length && !leadInThread) {
        console.log(`[Wingguy] capture BLOCKED — "${who}" (matched by URL) is not a participant in this thread. Senders: [${knownSenders.join(', ')}]`);
        showCaptureRescue({
          reason: `This conversation doesn't look like it's with ${who} (the lead the URL matched), so nothing was written — that mismatch is how one person's chat once ended up on another's record.`,
          caution: 'Check the preview, then pick the person this conversation is actually with.',
          thread,
          prefillName: hdr.name,
        });
        return;
      }

      const extras = profferedExtras(thread, leadFirst, leadLast, lead.email, lead.phone);
      if (extras.email || extras.phone) console.log('[Wingguy] lead proffered contact details →', extras);
      await bg({ type: 'QUICK_UPDATE', leadId: lead.id, content, section: 'linkedin', ...extras });
      console.log(`[Wingguy] captured ${thread.length} messages to ${who}`);
      dismissCaptureRescue(); // a stale card from an earlier miss must not outlive a clean save
      showCaptureToast(`✓ Saved ${thread.length} messages to ${who}${extrasNote(extras)}`);

      // Learn-from-my-edit: if this send follows a Wingguy insert, pair the AI's draft with the
      // message that actually went out (the newest message in the thread, if it's ours). Fire-and-
      // forget — a pairing failure never touches the capture above. The backend drops unchanged
      // pairs; the discussion happens later in Claude chat ("review my edits").
      try {
        const stash = pendingGeneratedDraft;
        if (stash && Date.now() - stash.at > EDIT_PAIR_MAX_AGE_MS) {
          pendingGeneratedDraft = null; // stale — never pair an old draft with a new send
        } else if (stash) {
          const stashSlug = slugOfInUrl(stash.profileUrl);
          const hereSlug = slugOfInUrl(profileUrl);
          const last = thread[thread.length - 1];
          const lastSender = String((last && last.sender) || '').toLowerCase();
          if (stashSlug && hereSlug && stashSlug !== hereSlug) {
            // Draft was inserted in a DIFFERENT conversation — keep the stash; its own send may
            // still be coming.
            console.log('[Wingguy] edit-pair skipped — draft belongs to another conversation');
          } else if (!last || !String(last.text || '').trim() || nameMatches(lastSender)) {
            console.log('[Wingguy] edit-pair skipped — newest thread message is not ours');
          } else {
            pendingGeneratedDraft = null; // one pair per insert
            bg({ type: 'WG_EDIT_PAIR', payload: { generated: stash.text, sent: last.text, leadName: who, leadUrl: profileUrl, surface: 'linkedin' } })
              .then((r) => console.log('[Wingguy] edit-pair:', r && r.stored ? `stored #${r.id}` : `not stored (${(r && r.reason) || 'no diff'})`))
              .catch((e) => console.log('[Wingguy] edit-pair failed (non-fatal):', e.message));
          }
        }
      } catch (e) { console.log('[Wingguy] edit-pair error (non-fatal):', e.message); }
    } catch (e) {
      console.log('[Wingguy] capture failed:', e.message);
      showCaptureRescue({
        reason: `Couldn't save to the Portal: ${e.message}`,
        thread,
        prefillName: hdr && hdr.name,
      });
    }
  }

  // A send happened if the click landed on LinkedIn's send button (shadow-aware via composedPath).
  function looksLikeSendButton(el) {
    if (!el || el.nodeType !== 1 || !el.closest) return false;
    const btn = el.closest('button');
    if (!btn) return false;
    const cls = String(btn.className || '');
    const al = (btn.getAttribute('aria-label') || '').toLowerCase();
    const txt = (btn.textContent || '').trim().toLowerCase();
    const inMsgForm = !!btn.closest('.msg-form, .msg-form__send-toggle, .msg-overlay, .msg-overlay-conversation-bubble, .msgs-thread');
    if (/msg-form__send/.test(cls) || (inMsgForm && (al === 'send' || txt === 'send'))) return true;
    // NEW-UI build: the Send button has no usable class/aria — it's a plain "Send" button inside a
    // structurally-matched conversation container (obfuscated classes rule out anything narrower).
    return (al === 'send' || txt === 'send') && !!closestConversationContainer(btn);
  }
  function onSendClick(e) {
    const path = (e.composedPath && e.composedPath()) || [e.target];
    for (const el of path) {
      if (looksLikeSendButton(el)) { console.log('[Wingguy] send button clicked'); scheduleCapture(el); return; }
    }
  }
  // LinkedIn also sends on Enter (without Shift) from the composer.
  function onSendKeydown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const target = deepActiveElement();
    if (!isEditableEl(target) || insideWingguy(target)) return;
    if (!isMessageEditableSafe(target)) return;
    scheduleCapture(target);
  }

  // Brief, unobtrusive toast for capture feedback (separate from the panel; bottom-centre).
  function showCaptureToast(text, isError) {
    try {
      const t = document.createElement('div');
      t.className = `wingguy-toast${isError ? ' wingguy-toast-err' : ''}`;
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(() => { t.classList.add('wingguy-toast-out'); }, 2800);
      setTimeout(() => { t.remove(); }, 3300);
    } catch (_) { /* non-fatal */ }
  }

  // ---- capture rescue card --------------------------------------------------
  // When a capture gate refuses to auto-save, the old error toasts vanished in ~3s and threw the
  // captured conversation away — the human couldn't even read WHY (Deon, 2026-07-28). This card
  // stays until dismissed, says why, previews what was captured, and (when there IS a captured
  // thread) lets the human pick the right lead and save to it. The identity gates exist because
  // GUESSING the person corrupted records (Vera+Doug); a human-confirmed pick removes that risk,
  // so "save it anyway" here does not weaken them.
  let rescueCard = null;
  function dismissCaptureRescue() {
    if (rescueCard) { rescueCard.remove(); rescueCard = null; }
  }
  // newUrl: the /in/ URL to put on a NEWLY created record. Only passed when we know the URL is
  // genuinely unclaimed (the "no lead matched this URL" miss). Never passed when another record
  // already holds it (the wrong-person refusal) — stamping it onto a second record is exactly how
  // duplicate-URL collisions are made — nor when the URL itself is suspect (unresolved /in/ACoA,
  // or a thread we couldn't isolate to one conversation).
  function showCaptureRescue({ reason, caution, thread = [], prefillName = '', newUrl = '' }) {
    try {
      dismissCaptureRescue();
      const canSave = thread.length > 0;
      // All scraped/served text goes in via textContent — never innerHTML — so page content
      // can't smuggle markup into the card.
      const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
      };

      const card = el('div', 'wingguy-rescue');
      const head = el('div', 'wingguy-rescue-head');
      head.appendChild(el('span', 'wingguy-rescue-title', "✦ Didn't save to the Portal"));
      const closeBtn = el('button', 'wingguy-rescue-close', '×');
      closeBtn.title = 'Dismiss (nothing will be saved)';
      closeBtn.addEventListener('click', dismissCaptureRescue);
      head.appendChild(closeBtn);
      card.appendChild(head);

      card.appendChild(el('p', 'wingguy-rescue-reason', reason));
      if (caution) card.appendChild(el('p', 'wingguy-rescue-caution', `⚠ ${caution}`));

      if (canSave) {
        const preview = el('div', 'wingguy-rescue-preview');
        for (const m of thread) {
          const line = el('div', 'wingguy-rescue-line');
          line.appendChild(el('span', 'wingguy-rescue-sender', `${(m.sender || 'Unknown').trim()}: `));
          line.appendChild(el('span', '', m.text || ''));
          preview.appendChild(line);
        }
        card.appendChild(preview);

        card.appendChild(el('div', 'wingguy-rescue-label', 'Save it anyway — whose record is this?'));
        const search = el('input', 'wingguy-rescue-search');
        search.type = 'text';
        search.placeholder = 'Type their name…';
        search.value = String(prefillName || '').trim();
        card.appendChild(search);
        const results = el('div', 'wingguy-rescue-results');
        card.appendChild(results);
        const foot = el('div', 'wingguy-rescue-foot');
        const saveBtn = el('button', 'wingguy-rescue-save', 'Save');
        saveBtn.disabled = true;
        foot.appendChild(saveBtn);
        card.appendChild(foot);

        // Typed "Justine Szalay" → first token is the first name, the rest is the surname. Crude,
        // but it's the human's own typing and they see the result on the button before saving.
        const splitTypedName = (raw) => {
          const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
          return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
        };

        let selected = null; // { mode: 'existing' | 'new', ... }
        const msgs = `${thread.length} message${thread.length === 1 ? '' : 's'}`;
        const setSelected = (pick, row) => {
          selected = pick;
          for (const r of results.children) r.classList.remove('wingguy-rescue-row-sel');
          row.classList.add('wingguy-rescue-row-sel');
          saveBtn.disabled = false;
          saveBtn.textContent = pick.mode === 'new'
            ? `Create ${pick.name} and save ${msgs}`
            : `Save ${msgs} to ${pick.name}`;
        };
        const renderResults = (leads, q) => {
          results.replaceChildren();
          selected = null;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Save';
          if (String(q || '').trim().length < 2) {
            results.appendChild(el('div', 'wingguy-rescue-empty', 'Type at least two letters of their name.'));
            return;
          }
          if (!leads.length) {
            results.appendChild(el('div', 'wingguy-rescue-empty', 'No matching lead — try just a first or last name, or add them below.'));
          }
          for (const l of leads.slice(0, 6)) {
            const name = `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(unnamed lead)';
            const row = el('div', 'wingguy-rescue-row');
            row.appendChild(el('div', 'wingguy-rescue-row-name', name));
            const slug = String(l.linkedinProfileUrl || '').replace(/^https?:\/\/(www\.)?linkedin\.com/, '');
            const sub = [l.company, slug].filter(Boolean).join(' · ');
            if (sub) row.appendChild(el('div', 'wingguy-rescue-row-sub', sub));
            row.addEventListener('click', () => setSelected({
              mode: 'existing',
              id: l.id, name,
              firstName: l.firstName || '', lastName: l.lastName || '',
              email: l.email || '', phone: l.phone || '',
            }, row));
            results.appendChild(row);
          }
          // ...and the escape hatch when they're simply not in the Portal yet. Sits LAST, under the
          // matches, so the eye lands on an existing record first — a new record for someone already
          // in there is a duplicate, which is worse than a moment's reading.
          const { firstName, lastName } = splitTypedName(q);
          if (!firstName) return;
          const newName = `${firstName} ${lastName}`.trim();
          const row = el('div', 'wingguy-rescue-row wingguy-rescue-row-new');
          row.appendChild(el('div', 'wingguy-rescue-row-name', `＋ Add ${newName} to your Portal`));
          row.appendChild(el('div', 'wingguy-rescue-row-sub', newUrl
            ? `New record, then save this conversation onto it · ${newUrl.replace(/^https?:\/\/(www\.)?linkedin\.com/, '')}`
            : 'New record, then save this conversation onto it · no LinkedIn URL - add it in the Portal'));
          row.addEventListener('click', () => setSelected({
            mode: 'new', name: newName, firstName, lastName,
            email: '', phone: '', linkedinProfileUrl: newUrl || '',
          }, row));
          results.appendChild(row);
        };
        let searchTimer = null;
        const runSearch = async () => {
          const q = search.value.trim();
          if (q.length < 2) { renderResults([], q); return; }
          results.replaceChildren(el('div', 'wingguy-rescue-empty', 'Searching…'));
          try {
            // LOOKUP_LEAD's linkedinUrl field is a generic query server-side — names work too.
            const lookup = await bg({ type: 'LOOKUP_LEAD', linkedinUrl: q });
            renderResults((lookup && lookup.leads) || [], q);
          } catch (err) {
            results.replaceChildren(el('div', 'wingguy-rescue-empty', `Search failed: ${err.message}`));
          }
        };
        search.addEventListener('input', () => {
          if (searchTimer) clearTimeout(searchTimer);
          searchTimer = setTimeout(runSearch, 350);
        });
        if (search.value.length >= 2) runSearch();

        saveBtn.addEventListener('click', async () => {
          if (!selected) return;
          const pick = selected;
          const isNew = pick.mode === 'new';
          saveBtn.disabled = true;
          saveBtn.textContent = isNew ? 'Creating…' : 'Saving…';
          try {
            let leadId = pick.id;
            if (isNew) {
              // Raw Airtable field names — POST /leads spreads them onto the record as-is.
              const fields = { 'First Name': pick.firstName };
              if (pick.lastName) fields['Last Name'] = pick.lastName;
              if (pick.linkedinProfileUrl) fields['LinkedIn Profile URL'] = pick.linkedinProfileUrl;
              const created = await bg({ type: 'CREATE_LEAD', fields });
              leadId = created && (created.id || created.recordId);
              if (!leadId) throw new Error('the new record came back without an id');
              console.log(`[Wingguy] rescue-created lead ${pick.name} (${leadId})`, fields);
              saveBtn.textContent = 'Saving…';
            }
            const extras = profferedExtras(
              thread,
              pick.firstName.toLowerCase().trim(),
              pick.lastName.toLowerCase().trim(),
              pick.email,
              pick.phone
            );
            await bg({ type: 'QUICK_UPDATE', leadId, content: formatThreadForApi(thread), section: 'linkedin', ...extras });
            console.log(`[Wingguy] rescue-saved ${thread.length} messages to ${pick.name}`, extras);
            const verb = isNew ? `✓ Added ${pick.name} and saved` : '✓ Saved';
            const to = isNew ? '' : ` to ${pick.name}`;
            card.replaceChildren(el('div', 'wingguy-rescue-done', `${verb} ${msgs}${to}${extrasNote(extras)}`));
            setTimeout(dismissCaptureRescue, 2500);
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = isNew ? `Create ${pick.name} and save ${msgs}` : `Save ${msgs} to ${pick.name}`;
            card.appendChild(el('p', 'wingguy-rescue-caution', `⚠ ${isNew ? 'Create' : 'Save'} failed: ${err.message}`));
          }
        });
      } else {
        card.appendChild(el('p', 'wingguy-rescue-hint', 'If this keeps happening, open the browser console and send the [Wingguy] lines.'));
      }

      document.body.appendChild(card);
      rescueCard = card;
    } catch (_) { /* never let the rescue card itself break a capture */ }
  }

  // ---- UI: launcher + full-screen overlay -----------------------------------
  function injectLauncher() {
    if (!shouldShowLauncher()) return;
    if (document.getElementById(LAUNCHER_ID)) return;

    const btn = document.createElement('button');
    btn.id = LAUNCHER_ID;
    btn.className = 'wingguy-launcher-btn';
    btn.title = 'Wingguy — or type /wg in the message box';
    btn.innerHTML = `<span class="wingguy-launcher-mark">✦</span><span class="wingguy-launcher-text">Wingguy</span>`;
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
  }

  function removeLauncher() {
    document.getElementById(LAUNCHER_ID)?.remove();
    closePanel();
  }

  function closePanel() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  async function togglePanel() {
    if (document.getElementById(OVERLAY_ID)) { closePanel(); return; }
    await openPanel();
  }

  // The full-screen overlay shell: a backdrop + a centred modal with a CONTEXT header.
  function overlayShell() {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'wingguy-overlay';
    overlay.innerHTML = `
      <div id="${PANEL_ID}" class="wingguy-modal" role="dialog" aria-label="Wingguy">
        <div class="wingguy-modal-head">
          <div class="wingguy-context">
            <span class="wingguy-context-label">CONTEXT</span>
            <span class="wingguy-context-sub" id="wingguy-context-sub"></span>
          </div>
          <button class="wingguy-x" title="Close (Esc)" id="wingguy-close">×</button>
        </div>
        <div class="wingguy-modal-body" id="wingguy-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#wingguy-close').addEventListener('click', closePanel);
    // No dim backdrop / click-outside-to-close: the overlay is click-through so the
    // LinkedIn page stays usable. Close via the × button or Esc. The panel floats and
    // can be dragged by its header so you can see (and use) the page underneath.
    makeDraggable(overlay.querySelector('#' + PANEL_ID));
    return overlay;
  }

  // Drag the panel by its CONTEXT header. On first grab we switch the modal from the
  // centring flex flow to fixed left/top (seeded from its current on-screen box) so it
  // stays put wherever it's dropped. Grabs that start on the × button are ignored.
  function makeDraggable(modal) {
    if (!modal) return;
    const head = modal.querySelector('.wingguy-modal-head');
    if (!head) return;
    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      // Keep at least a sliver on-screen so the panel can't be lost off an edge.
      const maxLeft = window.innerWidth - 60;
      const maxTop = window.innerHeight - 40;
      modal.style.left = Math.min(Math.max(baseLeft + dx, 60 - modal.offsetWidth), maxLeft) + 'px';
      modal.style.top = Math.min(Math.max(baseTop + dy, 0), maxTop) + 'px';
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
    };

    head.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;                       // left button only
      if (e.target.closest('#wingguy-close')) return;   // don't hijack the close button
      const rect = modal.getBoundingClientRect();
      if (!modal.classList.contains('wingguy-floating')) {
        // Freeze current position, then switch to fixed left/top for free movement.
        modal.classList.add('wingguy-floating');
        modal.style.width = rect.width + 'px';
        modal.style.left = rect.left + 'px';
        modal.style.top = rect.top + 'px';
      }
      startX = e.clientX; startY = e.clientY;
      baseLeft = rect.left; baseTop = rect.top;
      dragging = true;
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      e.preventDefault();
    });
  }

  function setContextSub(html) {
    const el = document.getElementById('wingguy-context-sub');
    if (el) el.innerHTML = html;
  }

  function setBody(html) {
    const body = document.getElementById('wingguy-body');
    if (body) body.innerHTML = html;
    return body;
  }

  async function openPanel() {
    overlayShell();
    setBody(`<div class="wingguy-muted">Reading this profile… (scanning the page)</div>`);

    // Auth check first — gives a clear message instead of a cryptic 401.
    let auth;
    try { auth = await bg({ type: 'CHECK_AUTH' }); } catch (_) { auth = null; }
    if (!auth || !auth.authenticated) {
      setBody(`<div class="wingguy-warn">Not signed in. Open your portal once in another tab to sync, then reopen this.</div>`);
      return;
    }

    const profile = await scrapeProfile();
    if (!profile.name && !profile.headline && !profile.about && !profile.pageText) {
      setBody(`<div class="wingguy-warn">Couldn't read anything from this page. Make sure you're on a person's /in/ profile, then reopen.</div>`);
      return;
    }

    // Load the templates (cached after first fetch) — used for the override list + pill labels.
    if (!templates) {
      try {
        const data = await bg({ type: 'WINGGUY_GET_TEMPLATES' });
        templates = (data && data.templates) || [];
      } catch (e) {
        setBody(`<div class="wingguy-warn">Couldn't load templates: ${escapeHtml(e.message)}</div>`);
        return;
      }
    }

    // Read the open thread (if any) and auto-route. A freshly-opened message bubble renders its
    // history async, so if the first read is empty, give it a beat and try once more before deciding.
    let thread = scrapeOpenThread();
    if (!thread.length) { await sleep(400); thread = scrapeOpenThread(); }
    console.log('[Wingguy] thread messages read:', thread.length, thread.map((m) => m.sender));
    // Snapshot the thread to the Portal on OPEN too — not just on send — so a lead's reply that you
    // READ but haven't answered still lands on their record (previously capture only fired on your
    // own send). Reuses the exact on-send path + its guards (needs a /in/ URL and the lead as a
    // participant; skips silently otherwise, never overwriting with an empty/foreign thread). The
    // 1.8s debounce coalesces with a send if you open then reply, so it still captures just once.
    if (thread.length) scheduleCapture((lastFocusedEditable && lastFocusedEditable.isConnected) ? lastFocusedEditable : null);
    renderRoute(profile, thread);
  }

  function templateLabel(id) {
    const t = (templates || []).find((x) => x.id === id);
    return t ? t.label : id;
  }

  // The CONTEXT header: just who we're working with. (The old Thanks/Reply mode tabs are gone —
  // 2026-06-28 — the unified chat agent works out the move itself; Guy steers it in chat.)
  function renderContext(profile) {
    const who = `${escapeHtml(profile.name || '(name not found)')}${profile.headline ? ` <span class="wingguy-muted">· ${escapeHtml(profile.headline)}</span>` : ''}`;
    // Say it plainly when a gap actually changes what they're about to get. No error codes, no
    // landmark names — and it says someone is already on it, because a known issue lands very
    // differently from a product that has quietly gone vague on you.
    const notice = draftGapNotice(profile);
    const noticeHtml = notice ? `<div class="wingguy-muted">${escapeHtml(notice)}</div>` : '';
    setContextSub(`<span class="wingguy-context-who">${who}</span>${noticeHtml}`);
  }

  // Top-level: set the header, then open the unified chat. The agent reads the profile + thread and
  // works out the move (thanks opener / warm-reply follow-up / reply / suggest times / book).
  function renderRoute(profile, thread) {
    renderContext(profile);
    const pageLen = (profile.pageText || '').length;
    if (profile.nameSource && profile.nameSource !== 'page') {
      console.log(`[Wingguy] name from ${profile.nameSource} (DOM h1 not matched); page content chars=${pageLen}`);
    }
    startChat(profile, thread);
  }

  async function autoDraftThanks(profile, thread, forcedTemplateId) {
    setBody(`<div class="wingguy-muted">Reading the profile and drafting in your voice…</div>`);
    try {
      const data = await bg({
        type: 'WINGGUY_DRAFT_THANKS',
        templateId: forcedTemplateId || 'auto',
        profile,
        conversation: thread,
      });
      renderDraftStep(data.draft || '', data.model || '', {
        onRegenerate: () => autoDraftThanks(profile, thread, data.templateId),
        templateId: data.templateId,
        autoDetected: !!data.autoDetected,
        onPickTemplate: (id) => autoDraftThanks(profile, thread, id),
      });
    } catch (e) {
      renderError(e, () => renderRoute(profile, thread, 'thanks'));
    }
  }

  // ── Slice 2 BIG half: the WHOLE panel is one tool-using CHAT (unified 2026-06-28) ───────────
  // A pinned editable draft (Insert/Copy → Guy sends) above a chat box wired to POST
  // /api/wingguy/chat (via WG_CHAT). The agent reads the profile + thread and works out the move
  // itself (thanks opener / warm-reply follow-up / reply / suggest times / book), drafts in Guy's
  // voice using his campaign templates, and Guy steers it conversationally. The lead's email (for
  // the invite) is looked up in the background and passed each turn. STATELESS backend: we resend
  // the running `messages` array (incl. tool blocks) each turn and store what comes back.
  let chatState = null; // { profile, thread, messages, leadEmail, draft }

  async function startChat(profile, thread) {
    chatState = { profile, thread, messages: [], leadEmail: '', draft: '' };
    renderChatShell();
    // profile.profileUrl is already un-scrambled at the source (scrapeProfile). Guard anyway: never look
    // the lead up by a scrambled /in/ACoA… URL (it's guaranteed to miss → no email → booking can't build
    // the invite and the agent reports it "can't write", Deepti 2026-07-01) — fall back to the name.
    const u = profile.profileUrl || '';
    const lookupQuery = (/\/in\/ACoA/i.test(u) ? '' : u) || profile.name || '';
    // Look up the lead's email (for the calendar invite) in the background — non-blocking.
    bg({ type: 'WG_CAL_LOOKUP', query: lookupQuery })
      .then((r) => { if (r && r.found && r.email) chatState.leadEmail = r.email; })
      .catch(() => { /* agent will ask Guy to add it if booking is attempted */ });
    // Auto-kick the first turn (hidden). The kickoff differs for a fresh connection vs an open thread.
    const kickoff = (thread && thread.length)
      ? '(Opened from the LinkedIn conversation above. Read where things stand and give me the best next message to send — and if it\'s time to offer a meeting, suggest some times.)'
      : '(Opened on this connection — no reply from them yet. Draft my thanks-for-connecting opener in my voice, using the campaign template.)';
    sendChatTurn(kickoff, { hidden: true });
  }

  function renderChatShell() {
    setBody(`
      <div class="wingguy-chat">
        <div class="wingguy-draftwrap" id="wg-draftwrap" style="display:none;">
          <div class="wingguy-draftlabel">Message to send <span class="wingguy-muted">— edit or accept, then Insert</span></div>
          <textarea class="wingguy-draft" id="wingguy-draft" rows="10"></textarea>
          <div class="wingguy-row">
            <button class="wingguy-primary" id="wingguy-insert">Insert into LinkedIn</button>
            <button class="wingguy-secondary" id="wingguy-copy">Copy</button>
          </div>
          <div class="wingguy-status" id="wingguy-status"></div>
        </div>
        <div class="wingguy-chatlog" id="wg-chatlog"></div>
        <div class="wingguy-chatinput">
          <textarea id="wg-chat-text" rows="2" placeholder="Talk to Wingguy — e.g. “suggest some times”, “book the Tuesday one”, “make it warmer”"></textarea>
          <button class="wingguy-primary" id="wg-chat-send">Send</button>
        </div>
      </div>
    `);

    const getText = () => (document.getElementById('wingguy-draft') || {}).value || '';
    const statusEl = () => document.getElementById('wingguy-status');

    const insertBtn = document.getElementById('wingguy-insert');
    insertBtn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the composer's caret
    insertBtn.addEventListener('click', async () => {
      // Stash the AI's ORIGINAL draft (learn-from-my-edit) — chatState.draft, not the textarea,
      // so panel edits count as the human's edits when the send is paired against it.
      stashGeneratedDraft((chatState && chatState.draft) || getText(), chatState && chatState.profile);
      const res = await insertIntoComposer(getText());
      if (res.ok) { closePanel(); return; }
      const s = statusEl();
      s.className = 'wingguy-status wingguy-warn-inline';
      s.textContent = 'Click inside LinkedIn\'s message box first (cursor blinking in it), then Insert — or use Copy.';
    });
    document.getElementById('wingguy-copy').addEventListener('click', async () => {
      stashGeneratedDraft((chatState && chatState.draft) || getText(), chatState && chatState.profile);
      const ok = await copyDraft(getText());
      const s = statusEl();
      s.className = ok ? 'wingguy-status wingguy-ok' : 'wingguy-status wingguy-warn-inline';
      s.textContent = ok ? '✓ Copied — click in the message box and paste (Ctrl+V).' : 'Copy blocked — select the text and copy manually.';
    });

    const textEl = document.getElementById('wg-chat-text');
    const fire = () => {
      const t = (textEl.value || '').trim();
      if (!t) return;
      textEl.value = '';
      sendChatTurn(t);
    };
    document.getElementById('wg-chat-send').addEventListener('click', fire);
    textEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fire(); } });
    textEl.focus();
  }

  function appendBubble(role, text) {
    const log = document.getElementById('wg-chatlog');
    if (!log) return null;
    const div = document.createElement('div');
    div.className = `wingguy-bubble wingguy-bubble-${role}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  // A "working…" bubble: spinner + a status line that walks the steps the agent actually runs
  // (indicative timing, not live-wired). Returns { stop() } which clears the timer and removes it.
  function showThinking(firstTurn) {
    const log = document.getElementById('wg-chatlog');
    if (!log) return { stop() {} };
    const div = document.createElement('div');
    div.className = 'wingguy-bubble wingguy-bubble-wg wingguy-thinking';
    div.innerHTML = '<span class="wingguy-spinner"></span><span class="wingguy-thinking-text"></span>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    const steps = firstTurn
      ? ['Reading the conversation…', 'Working out the best next message…', 'Writing your draft…']
      : ['Thinking…', 'Checking your calendar…', 'Writing your message…'];
    const textEl = div.querySelector('.wingguy-thinking-text');
    textEl.textContent = steps[0];
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      textEl.textContent = steps[i];
      log.scrollTop = log.scrollHeight;
    }, 2200);
    return { stop() { clearInterval(timer); div.remove(); } };
  }

  function setChatDraft(text) {
    if (chatState) chatState.draft = text;
    const ta = document.getElementById('wingguy-draft');
    const wrap = document.getElementById('wg-draftwrap');
    if (wrap) wrap.style.display = '';
    if (ta) {
      ta.value = text;
      // Auto-grow to show the whole message (no inner scrollbar), capped so it can't take the whole screen.
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight + 4, Math.round(window.innerHeight * 0.45)) + 'px';
      ta.scrollIntoView({ block: 'nearest' });
    }
  }

  async function sendChatTurn(text, opts = {}) {
    if (!chatState || chatState.busy) return;
    chatState.busy = true;
    const sendBtn = document.getElementById('wg-chat-send');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }
    if (!opts.hidden) appendBubble('me', text);
    chatState.messages.push({ role: 'user', content: text });
    const thinking = showThinking(!!opts.hidden);
    try {
      const data = await bg({
        type: 'WG_CHAT',
        payload: {
          profile: chatState.profile,
          conversation: chatState.thread,
          messages: chatState.messages,
          leadEmail: chatState.leadEmail || undefined,
        },
      });
      thinking.stop();
      // The server returns the FULL running history (incl. tool blocks) — store it for the next turn.
      if (data && Array.isArray(data.messages)) chatState.messages = data.messages;
      const reply = (data && data.reply) || '';
      if (reply) appendBubble('wg', reply);
      if (data && data.draft) setChatDraft(data.draft);
      if (data && data.booked) appendBubble('sys', `✓ Calendar invite created${data.booked.title ? ` — ${data.booked.title}` : ''}.`);
      if (!reply && !(data && data.draft)) appendBubble('wg', '(No response — try rephrasing.)');
      // Enrich contact: the server flags this when a lead was just created OR Guy asked to refresh an
      // existing lead's details (data.enrichContact.manual). Read their LinkedIn Contact Info and patch
      // any MISSING email/phone. Fire-and-forget (own status bubble) so it never holds the panel; it runs
      // ONLY when flagged — never on an ordinary turn (Guy's cost rule, 2026-07-08).
      if (data && data.enrichContact && data.enrichContact.leadRecordId) enrichLeadContact(data.enrichContact);
    } catch (e) {
      thinking.stop();
      // The backend returns friendly, complete sentences for transient Claude errors (busy /
      // rate-limited / hiccup) — show those as-is. Only frame raw or technical failures (network
      // "Failed to fetch", a bare "529 {…}", "Chat failed: 500") with our own calm fallback, so the
      // user never sees a status code or JSON blob.
      const msg = (e && e.message) || '';
      const looksFriendly = /\s/.test(msg) && msg.length > 25 && !/^\d{3}\b/.test(msg) && !/^[A-Za-z ]+failed:/i.test(msg);
      appendBubble('sys', looksFriendly ? msg : "Couldn't reach Wingguy right now - give it a moment and try again.");
    } finally {
      if (chatState) chatState.busy = false;
      const btn = document.getElementById('wg-chat-send');
      if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    }
  }

  // Read the lead's LinkedIn Contact Info and patch any MISSING email/phone onto their record — the second
  // half of both the create → enrich handshake AND Guy's manual "grab their details from LinkedIn". Non-
  // blocking + best-effort. `sig.manual` = Guy explicitly asked, so speak up even on "nothing to add"; on
  // an automatic create we stay silent when there's nothing (the record already exists either way).
  async function enrichLeadContact(sig) {
    try {
      const profileUrl = sig.profileUrl || (chatState && chatState.profile && chatState.profile.profileUrl) || '';
      const ci = await scrapeContactInfo(profileUrl);
      if (!ci.email && !ci.phone) {
        if (sig.manual) appendBubble('sys', 'No contact details were visible on their LinkedIn to add.');
        return;
      }
      const r = await bg({ type: 'WG_LEAD_CONTACT', payload: { leadRecordId: sig.leadRecordId, email: ci.email, phone: ci.phone } });
      const added = (r && r.added) || {};
      const bits = [];
      if (added.phone) bits.push(`phone ${added.phone}`);
      if (added.email) bits.push(`email ${added.email}`);
      if (bits.length) appendBubble('sys', `✓ Added from LinkedIn: ${bits.join(' · ')}.`);
      else if (sig.manual) appendBubble('sys', 'Their LinkedIn contact details are already on the record — nothing to add.');
    } catch (e) {
      console.log('[Wingguy] enrich lead contact failed:', e.message);
      if (sig.manual) appendBubble('sys', "Couldn't read their LinkedIn contact info just now — try again in a moment.");
    }
  }

  // ⚠ SUPERSEDED 2026-06-27 — the functions below (suggestTimes / bookIt / renderBookForm + the
  // FALLBACK_PREFS picker) were the form-based spike. Reply mode is now the chat agent above; these
  // are no longer called (kept temporarily for reference, safe to delete next pass).
  // Slice 2 SPIKE — "Suggest times": check Guy's real calendar and draft the "here are some times"
  // message (the one he sends when a lead asks to meet). Pure reuse of the existing booking endpoints
  // (/api/calendar/availability + /quick-pick-message); NO booking/invite yet (that's the next step).
  // Auto-picks a few slots (Guy's choice); he edits the wording before sending.
  // Mirrors config/wingguyBookingPrefs.js — used only if the backend prefs fetch fails.
  const FALLBACK_PREFS = {
    preferredStart: '10:00', earliestStart: '09:30', lastStart: '16:30',
    slotsToOffer: 3, meetingLengthMins: 30, bufferMins: 0, excludeWeekends: true,
    lunch: { start: '12:00', durationMins: 45, soft: true },
  };
  function hhmmToMin(s) { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : 0; }
  function displayToMin(s) {
    const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = (+m[1]) % 12; if (/PM/i.test(m[3])) h += 12;
    return h * 60 + (+m[2]);
  }
  function isWeekendDate(date) {
    const d = new Date(`${date}T12:00:00`);
    const g = d.getDay();
    return g === 0 || g === 6;
  }
  // Pick up to N slots, one per day, honouring the tenant's preferences (preferred start, last start,
  // soft lunch hold, weekends). Soft preference: try the preferred-start floor first, then relax to the
  // earliest-allowed floor to fill any remaining options. Times are the CLIENT's local (the `display`
  // field); timezone-correctness for the lead is already guaranteed server-side.
  function pickSlotsByPrefs(days, prefs) {
    const len = prefs.meetingLengthMins || 30;
    const last = hhmmToMin(prefs.lastStart);
    const lunchStart = hhmmToMin(prefs.lunch && prefs.lunch.start);
    const lunchEnd = lunchStart + ((prefs.lunch && prefs.lunch.durationMins) || 0);
    const eligibleDays = (days || []).filter((d) => !(prefs.excludeWeekends && isWeekendDate(d.date)));
    const ok = (mins, floor) =>
      mins != null && mins >= floor && mins <= last &&
      !(prefs.lunch && prefs.lunch.soft && mins < lunchEnd && (mins + len) > lunchStart); // skip the soft lunch hold
    const gather = (floor, taken) => {
      const out = [];
      for (const d of eligibleDays) {
        if (taken.size >= prefs.slotsToOffer) break; // taken is the shared running total (incl. earlier passes)
        const slot = (d.freeSlots || []).find((s) => ok(displayToMin(s.display), floor) && !taken.has(s.time));
        if (slot) { out.push(slot); taken.add(slot.time); }
      }
      return out;
    };
    const taken = new Set();
    const picks = gather(hhmmToMin(prefs.preferredStart), taken);
    if (picks.length < prefs.slotsToOffer) picks.push(...gather(hhmmToMin(prefs.earliestStart), taken)); // soft fallback
    return picks.slice(0, prefs.slotsToOffer).map((s) => ({ time: s.time, display: s.display, leadDisplay: s.leadDisplay }));
  }

  async function suggestTimes(profile, thread) {
    setBody(`<div class="wingguy-muted">Checking your calendar for open times…</div>`);
    try {
      let prefs = FALLBACK_PREFS;
      try { const p = await bg({ type: 'WG_BOOKING_PREFS' }); if (p && p.prefs) prefs = p.prefs; } catch (_) { /* use fallback */ }

      const leadLocation = profile.location || '';
      const avail = await bg({ type: 'WG_CAL_AVAILABILITY', leadLocation });
      const picks = pickSlotsByPrefs((avail && avail.days) || [], prefs);
      if (!picks.length) {
        setBody(`<div class="wingguy-warn">No open slots match your booking preferences in this window. Switch to "Reply" above to draft a message instead.</div>`);
        return;
      }

      const context = {
        yourName: 'Guy Wilson',
        yourTimezone: avail.yourTimezone,
        leadName: profile.name || '',
        leadLocation,
        leadTimezone: avail.leadTimezone,
      };
      const qp = await bg({ type: 'WG_CAL_QUICKPICK', selectedSlots: picks, context });
      let msg = (qp && qp.message) || '';
      msg = msg.replace(/^\s*READY TO COPY:\s*/i, '').trim(); // strip the portal's copy delimiter

      renderDraftStep(msg, `times · ${picks.length} slots`, {
        onRegenerate: () => suggestTimes(profile, thread),
        onBookIt: () => bookIt(profile, thread),
      });
    } catch (e) {
      renderError(e, () => renderRoute(profile, thread, 'reply'));
    }
  }

  // "Book it": confirm-then-create the calendar invite (the proven Nylas write path). Pre-fills the
  // guest email from the Portal lead record; the human sets/confirms the agreed time, then we create
  // the event server-side and email the guest. NO LinkedIn send is involved — this is the calendar only.
  async function bookIt(profile, thread) {
    setBody(`<div class="wingguy-muted">Looking up ${escapeHtml(profile.name || 'the lead')}…</div>`);
    let email = '';
    try {
      // Guard against the scrambled /in/ACoA… URL (already resolved at source, but never query with it —
      // it's guaranteed to miss); fall back to the name so the email pre-fill still has a chance.
      const u = profile.profileUrl || '';
      const q = (/\/in\/ACoA/i.test(u) ? '' : u) || profile.name || '';
      const r = await bg({ type: 'WG_CAL_LOOKUP', query: q });
      if (r && r.found && r.email) email = r.email;
    } catch (_) { /* manual entry below */ }
    renderBookForm(profile, thread, email);
  }

  function renderBookForm(profile, thread, email) {
    setBody(`
      <div class="wingguy-who">Book a meeting with ${escapeHtml(profile.name || 'this lead')}</div>
      <div class="wingguy-field">
        <label class="wingguy-label">Date &amp; time (your time)</label>
        <input type="datetime-local" id="wg-book-when" class="wingguy-input">
      </div>
      <div class="wingguy-field">
        <label class="wingguy-label">Guest email</label>
        <input type="email" id="wg-book-email" class="wingguy-input" value="${escapeHtml(email || '')}" placeholder="name@company.com">
        ${email ? '<span class="wingguy-muted">Pre-filled from the Portal — change if needed.</span>' : '<span class="wingguy-muted">Not on file — enter the address the invite should go to.</span>'}
      </div>
      <div class="wingguy-muted">Creates the invite on your calendar and emails the guest (30 min, your Zoom room). You're not sending anything on LinkedIn here.</div>
      <div class="wingguy-row">
        <button class="wingguy-primary" id="wg-book-create">Create invite</button>
        <button class="wingguy-secondary" id="wg-book-back">← Back</button>
      </div>
      <div class="wingguy-status" id="wg-book-status"></div>
    `);

    document.getElementById('wg-book-back').addEventListener('click', () => renderRoute(profile, thread, 'reply'));
    const statusEl = document.getElementById('wg-book-status');
    const createBtn = document.getElementById('wg-book-create');
    createBtn.addEventListener('click', async () => {
      const whenVal = document.getElementById('wg-book-when').value;
      const emailVal = (document.getElementById('wg-book-email').value || '').trim();
      if (!whenVal) { statusEl.className = 'wingguy-status wingguy-warn-inline'; statusEl.textContent = 'Pick a date and time first.'; return; }
      if (!emailVal) { statusEl.className = 'wingguy-status wingguy-warn-inline'; statusEl.textContent = 'Enter the guest email — the invite needs somewhere to go.'; return; }
      const startISO = new Date(whenVal).toISOString(); // datetime-local is local time → ISO/UTC
      createBtn.disabled = true;
      statusEl.className = 'wingguy-status';
      statusEl.textContent = 'Creating the invite…';
      try {
        const data = await bg({ type: 'WG_BOOK', payload: { startISO, leadEmail: emailVal, leadName: profile.name || '', leadLinkedIn: profile.profileUrl || '' } });
        statusEl.className = 'wingguy-status wingguy-ok';
        statusEl.innerHTML = `✓ Invite created and sent to <strong>${escapeHtml(emailVal)}</strong> — it's on your calendar.`;
      } catch (e) {
        createBtn.disabled = false;
        statusEl.className = 'wingguy-status wingguy-warn-inline';
        statusEl.textContent = `Couldn't book: ${e.message}`;
      }
    });
  }

  function renderError(e, onBack) {
    setBody(`<div class="wingguy-warn">Draft failed: ${escapeHtml(e.message)}</div>
      <button class="wingguy-secondary" id="wingguy-back">← Back</button>`);
    document.getElementById('wingguy-back')?.addEventListener('click', onBack);
  }

  // The draft view (full-screen): the editable message + Insert/Copy/Regenerate. In thanks mode it
  // also shows the auto-detected template as a pill with a one-tap override to the other templates.
  function renderDraftStep(draft, model, opts = {}) {
    const { onRegenerate, templateId, autoDetected, onPickTemplate, onSuggestTimes, onBookIt } = opts;

    // Pill + override (thanks mode only — templateId present).
    let pillHtml = '';
    if (templateId) {
      const others = (templates || []).filter((t) => t.id !== templateId);
      const overrideBtns = others.map((t) =>
        `<button class="wingguy-pill-alt" data-tpl="${escapeHtml(t.id)}" title="${escapeHtml(t.useWhen || '')}">${escapeHtml(t.label)}</button>`
      ).join('');
      pillHtml = `
        <div class="wingguy-pillbar">
          <span class="wingguy-pill">${escapeHtml(templateLabel(templateId))}${autoDetected ? ' · auto' : ''}</span>
          ${others.length ? `<span class="wingguy-pill-switch">Not right? ${overrideBtns}</span>` : ''}
        </div>`;
    }

    setBody(`
      ${pillHtml}
      <textarea class="wingguy-draft" id="wingguy-draft" rows="12">${escapeHtml(draft)}</textarea>
      <div class="wingguy-tip">Type <strong>/wg</strong> in the message box to open this · then <strong>Insert</strong> drops the message at your cursor</div>
      <div class="wingguy-row">
        <button class="wingguy-primary" id="wingguy-insert">Insert into LinkedIn</button>
        <button class="wingguy-secondary" id="wingguy-copy">Copy</button>
        <button class="wingguy-secondary" id="wingguy-regen">Regenerate</button>
        ${onSuggestTimes ? '<button class="wingguy-secondary" id="wingguy-suggest">📅 Suggest times</button>' : ''}
        ${onBookIt ? '<button class="wingguy-secondary" id="wingguy-bookit">📌 Book it</button>' : ''}
      </div>
      <div class="wingguy-foot">
        <span class="wingguy-muted">${escapeHtml(model)} · you click send</span>
      </div>
      <div class="wingguy-status" id="wingguy-status"></div>
    `);

    const statusEl = document.getElementById('wingguy-status');
    const getText = () => document.getElementById('wingguy-draft').value;

    // Template override buttons.
    document.querySelectorAll('.wingguy-pill-alt').forEach((b) => {
      b.addEventListener('click', () => onPickTemplate && onPickTemplate(b.getAttribute('data-tpl')));
    });

    const insertBtn = document.getElementById('wingguy-insert');
    // Don't let the button steal focus from the message box (so the cursor stays where it belongs).
    insertBtn.addEventListener('mousedown', (e) => e.preventDefault());
    insertBtn.addEventListener('click', async () => {
      // Learn-from-my-edit: stash the AI's original draft (no profile in scope here — the send
      // capture pairs by freshness alone).
      stashGeneratedDraft(draft, null);
      const res = await insertIntoComposer(getText());
      if (res.ok) {
        // AI-Blaze behaviour: drop it in the box and get out of the way so they can edit + send.
        closePanel();
        return;
      }
      const msg = res.reason === 'verify-failed'
        ? 'Found the box but the text didn\'t take. Click inside the message box (cursor blinking in it), then Insert — or use Copy. (Send me the diagnostic below if it persists.)'
        : 'Click inside LinkedIn\'s message box first (so the cursor is blinking in it), then click Insert — or use Copy. (Send me the diagnostic below if it persists.)';
      statusEl.className = 'wingguy-status wingguy-warn-inline';
      statusEl.innerHTML = `${escapeHtml(msg)}<br><button id="wingguy-diag" class="wingguy-secondary" style="margin-top:6px;">📋 Copy diagnostic for Wingguy</button>`;
      document.getElementById('wingguy-diag').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        try {
          await navigator.clipboard.writeText(buildDiagnosticText());
          btn.textContent = '✓ Copied — now paste it to me in the chat';
        } catch (_) {
          console.log(buildDiagnosticText());
          btn.textContent = 'Clipboard blocked — see F12 → Console instead';
        }
      });
    });

    document.getElementById('wingguy-copy').addEventListener('click', async () => {
      stashGeneratedDraft(draft, null);
      const ok = await copyDraft(getText());
      if (ok) {
        statusEl.textContent = '✓ Copied — click in the message box and paste (Ctrl+V). Line breaks preserved.';
        statusEl.className = 'wingguy-status wingguy-ok';
      } else {
        statusEl.textContent = 'Copy blocked by the browser — select the text and copy manually.';
        statusEl.className = 'wingguy-status wingguy-warn-inline';
      }
    });

    document.getElementById('wingguy-regen').addEventListener('click', onRegenerate);
    if (onSuggestTimes) document.getElementById('wingguy-suggest').addEventListener('click', onSuggestTimes);
    if (onBookIt) document.getElementById('wingguy-bookit').addEventListener('click', onBookIt);
  }

  // ---- lifecycle / SPA navigation ------------------------------------------
  function refresh() {
    if (shouldShowLauncher()) injectLauncher();
    else removeLauncher();
  }

  // Lighter sync for the polling tick: keep the launcher in step with message bubbles that open/close
  // without a URL change — but never tear it down (or close the panel) while the panel is open.
  function syncLauncher() {
    if (shouldShowLauncher()) injectLauncher();
    else if (!document.getElementById(OVERLAY_ID)) removeLauncher();
  }

  function watchSpaNavigation() {
    setInterval(() => {
      if (topLocation().href !== currentUrl) {   // top URL: a BPR frame's own /preload/ URL never changes
        currentUrl = topLocation().href;
        closePanel();
        // small delay so the new profile DOM settles
        setTimeout(refresh, 600);
      } else {
        syncLauncher(); // catch floating message bubbles opening/closing (no navigation)
      }
    }, 1000);
    window.addEventListener('popstate', () => setTimeout(refresh, 600));
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && document.getElementById(OVERLAY_ID)) closePanel();
  }

  function init() {
    // Ask for landmark corrections BEFORE anything reads the page. Not awaited: a slow or dead
    // server must never delay the launcher appearing, and every read falls back to the shipped
    // defaults until (and unless) the corrections land.
    loadRemoteSelectors().catch(() => {});
    refresh();
    watchSpaNavigation();
    // Remember the last editable the user focused (so Insert can target the message box even though
    // they then click the Wingguy panel). focusin is composed, so it fires for open shadow roots too.
    document.addEventListener('focusin', trackFocus, true);
    // Typed trigger (/wg etc.) inside the composer — composed keyup crosses open shadow boundaries.
    document.addEventListener('keyup', onComposerKeyup, true);
    // Keystroke buffer feeding the unreadable-composer fallback (closed shadow roots).
    document.addEventListener('keydown', onKeydownBuffer, true);
    document.addEventListener('keydown', onKeydown, true);
    // On-Send capture: detect the send button click (and Enter-to-send) → snapshot thread to the Portal.
    document.addEventListener('click', onSendClick, true);
    document.addEventListener('keydown', onSendKeydown, true);
    console.log('[Wingguy] content script ready (type /wg in the message box, or click the launcher)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
