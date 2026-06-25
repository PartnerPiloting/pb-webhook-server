// content-wingguy.js — Wingguy Slice 1 (personalised thanks-for-connecting on LinkedIn profiles).
//
// Surface: a LinkedIn PROFILE page (/in/...). Flow:
//   read profile (name, headline, About auto-expanded, light recent activity)
//   -> campaign quick-pick buttons (General / Fractional, served by the backend)
//   -> backend drafts in Guy's voice (Sonnet) -> shown in an editable panel
//   -> formatting-preserving INSERT into the LinkedIn message composer (+ Copy fallback)
//   -> human clicks send.
//
// FORK HYGIENE: every DOM id/class is namespaced `wingguy-*` and the UI is visually distinct
// (teal) so it never collides with the legacy "Network Accelerator" extension running side-by-side.
// This script deliberately does NOT carry the legacy messaging "Save to Portal" surface — that's a
// different feature and keeping it would double-inject with the old extension.

(function () {
  'use strict';

  const LAUNCHER_ID = 'wingguy-launcher-btn';
  const PANEL_ID = 'wingguy-panel';

  let currentUrl = location.href;
  let templates = null; // cached [{ id, label, useWhen }]

  // ---- page detection -------------------------------------------------------
  function isProfilePage() {
    return /^\/in\//.test(location.pathname);
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
  // version these move to remote extension-config; for Slice 1 sensible defaults + Copy fallback.
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
    const spans = Array.from(section.querySelectorAll('span[aria-hidden="true"]'))
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
    const items = Array.from(section.querySelectorAll('span[aria-hidden="true"]'))
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
    const m = location.pathname.match(/^\/in\/([^/]+)/);
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

  async function scrapeProfile() {
    await autoScrollToLoad();   // force lazy sections (About/Experience) into the DOM
    await expandAboutSeeMore();
    const nameEl = qsFirst([
      'main h1',
      'h1.text-heading-xlarge',
      '.pv-top-card h1',
      'section.artdeco-card h1',
      'main section h1',
      'h1',
    ]);
    let name = cleanText(nameEl && nameEl.textContent);
    let nameSource = name ? 'page' : '';
    if (!name) { name = nameFromTitle(); if (name) nameSource = 'title'; }
    if (!name) { name = nameFromSlug(); if (name) nameSource = 'url'; }

    // Headline + location: search the top card (anchored on the name element when found, else the
    // top-card container). Junk risk is bounded because pageText below is the real grounding net.
    const topCard = (nameEl && nameEl.closest('section')) ||
      document.querySelector('.pv-top-card, .ph5.pb5, main section') || document;
    const headlineEl = qsFirst(
      ['div.text-body-medium.break-words', '.pv-text-details__left-panel .text-body-medium', 'div.text-body-medium'],
      topCard
    );
    let headline = cleanText(headlineEl && headlineEl.textContent);
    const locationEl = qsFirst(
      ['span.text-body-small.inline.t-black--light.break-words', '.pv-text-details__left-panel .text-body-small'],
      topCard
    );
    let location = cleanText(locationEl && locationEl.textContent);

    // RAW FALLBACK: the whole profile's visible text. Robust to LinkedIn's class churn — when the
    // structured selectors miss, the model still gets real content to hook on (like AI Blaze does).
    const mainEl = document.querySelector('main') || document.body;
    const pageText = (mainEl.innerText || '')
      .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, 6000);

    return {
      name,
      headline,
      location,
      profileUrl: location_origin_path(),
      about: readAbout(),
      recentPosts: readRecentActivity(),
      pageText,
      nameSource,
    };
  }

  function location_origin_path() {
    return location.origin + location.pathname.replace(/\/$/, '');
  }

  // Read the OPEN LinkedIn message thread (the overlay you pop, or the /messaging pane), labelling
  // who said what. Messages are grouped: one .msg-s-message-group__name per run of bubbles from the
  // same sender, so we carry the last seen name forward across grouped continuations.
  function scrapeOpenThread() {
    const items = document.querySelectorAll('.msg-s-event-listitem');
    if (!items.length) return [];
    const out = [];
    let lastSender = '';
    items.forEach((item) => {
      const group = item.closest('.msg-s-message-group');
      const nameEl = group && group.querySelector('.msg-s-message-group__name');
      if (nameEl) {
        const n = cleanText(nameEl.textContent);
        if (n) lastSender = n;
      }
      const bodyEl = item.querySelector('.msg-s-event-listitem__body');
      const text = cleanText(bodyEl && bodyEl.textContent);
      if (text) out.push({ sender: lastSender || 'Unknown', text });
    });
    return out;
  }

  // Code-side routing (deterministic, no AI): an open thread with real messages = a follow-on reply;
  // otherwise a first-touch thanks-for-connecting. The human can override in the panel.
  function classifyMode(thread) {
    return thread.length >= 1 ? 'reply' : 'thanks';
  }

  // ---- the LinkedIn message composer (insert target) ------------------------
  function isVisible(el) {
    return !!(el && (el.offsetParent !== null || el.getClientRects().length));
  }

  // Find the open message box. LinkedIn's markup varies (profile overlay vs /messaging pane vs new
  // layouts), so try several selectors, accept only VISIBLE matches, and prefer the LAST one (the
  // most recently opened thread). Final fallback = any visible contenteditable.
  function findComposer() {
    const selectors = [
      '.msg-form__contenteditable[contenteditable="true"]',
      'div.msg-form__contenteditable',
      '.msg-form [contenteditable="true"]',
      '[aria-label*="message" i][contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      if (els.length) return els[els.length - 1];
    }
    return null;
  }

  // Insert preserving line breaks. LinkedIn's composer is a React/Draft-style editor that IGNORES a
  // direct innerHTML write (React re-renders over it and Send stays disabled), so we go through the
  // browser's native input pipeline: focus → select-all → execCommand('insertText'), which React DOES
  // observe and which keeps newlines as soft breaks. innerHTML+<p> is kept only as a last-ditch fallback.
  function insertIntoComposer(text) {
    const composer = findComposer();
    if (!composer) return { ok: false, reason: 'no-composer' };

    const normalized = String(text).replace(/\r\n/g, '\n').trim();
    composer.focus();
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(composer);
      sel.addRange(range);
      const ok = document.execCommand('insertText', false, normalized);
      if (!ok) throw new Error('execCommand insertText returned false');
    } catch (_) {
      const html = normalized.split('\n').map((l) => `<p>${l ? escapeHtml(l) : '<br>'}</p>`).join('');
      composer.innerHTML = html;
    }
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: normalized }));
    return { ok: true };
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

  // ---- UI: launcher + panel -------------------------------------------------
  function injectLauncher() {
    if (!isProfilePage()) return;
    if (document.getElementById(LAUNCHER_ID)) return;

    const btn = document.createElement('button');
    btn.id = LAUNCHER_ID;
    btn.className = 'wingguy-launcher-btn';
    btn.title = 'Wingguy — draft a thanks-for-connecting';
    btn.innerHTML = `<span class="wingguy-launcher-mark">✦</span><span class="wingguy-launcher-text">Wingguy</span>`;
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
  }

  function removeLauncher() {
    document.getElementById(LAUNCHER_ID)?.remove();
    closePanel();
  }

  function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  async function togglePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }
    await openPanel();
  }

  function panelShell() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'wingguy-panel';
    panel.innerHTML = `
      <div class="wingguy-panel-head">
        <span class="wingguy-panel-title">✦ Wingguy — thanks for connecting</span>
        <button class="wingguy-x" title="Close" id="wingguy-close">×</button>
      </div>
      <div class="wingguy-panel-body" id="wingguy-body"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#wingguy-close').addEventListener('click', closePanel);
    return panel;
  }

  function setBody(html) {
    const body = document.getElementById('wingguy-body');
    if (body) body.innerHTML = html;
    return body;
  }

  async function openPanel() {
    const panel = panelShell();
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

    // Load the template buttons (cached after first fetch).
    if (!templates) {
      try {
        const data = await bg({ type: 'WINGGUY_GET_TEMPLATES' });
        templates = (data && data.templates) || [];
      } catch (e) {
        setBody(`<div class="wingguy-warn">Couldn't load templates: ${escapeHtml(e.message)}</div>`);
        return;
      }
    }

    // Read the open thread (if any) and auto-route: ongoing conversation → reply; else → first hello.
    const thread = scrapeOpenThread();
    renderRoute(profile, thread, classifyMode(thread));
  }

  // The top-level view: a mode switch (auto-detected, human-overridable) + the body for that mode.
  function renderRoute(profile, thread, mode) {
    // Warn ONLY when the page genuinely came through thin (little/no content to ground on) — NOT just
    // because the name fell back to the tab title, which is harmless (the title name is correct, and
    // the raw page text carries the substance). The old warning fired on name-source and cried wolf.
    const pageLen = (profile.pageText || '').length;
    const thin = !profile.about && pageLen < 400;
    if (profile.nameSource && profile.nameSource !== 'page') {
      console.log(`[Wingguy] name from ${profile.nameSource} (DOM h1 not matched); page content chars=${pageLen}`);
    }
    const degradedNote = thin
      ? `<div class="wingguy-notice">Heads up — Wingguy couldn't pull much detail from this page, so the draft will be more generic. Make sure you're on the person's profile and it's finished loading, then try again.</div>`
      : '';

    const tab = (m, label) =>
      `<button class="wingguy-mode ${m === mode ? 'wingguy-mode-on' : ''}" data-mode="${m}">${label}</button>`;

    setBody(`
      <div class="wingguy-who">${escapeHtml(profile.name || '(name not found)')}${profile.headline ? ` — <span class="wingguy-muted">${escapeHtml(profile.headline)}</span>` : ''}</div>
      ${degradedNote}
      <div class="wingguy-modes">
        ${tab('thanks', 'Thanks for connecting')}
        ${tab('reply', `Reply to conversation${thread.length ? ` (${thread.length})` : ''}`)}
      </div>
      <div id="wingguy-mode-body"></div>
    `);

    document.querySelectorAll('.wingguy-mode').forEach((b) => {
      b.addEventListener('click', () => renderRoute(profile, thread, b.getAttribute('data-mode')));
    });

    const body = document.getElementById('wingguy-mode-body');
    if (mode === 'reply') renderReplyBody(body, profile, thread);
    else renderThanksBody(body, profile, thread);
  }

  function renderThanksBody(body, profile, thread) {
    let hookHint;
    if (profile.about) {
      hookHint = `<div class="wingguy-muted">Read About (${profile.about.length} chars)${profile.recentPosts.length ? ` + ${profile.recentPosts.length} activity snippet(s)` : ''}.</div>`;
    } else if (profile.pageText) {
      hookHint = `<div class="wingguy-muted">Read the profile page (${profile.pageText.length} chars of content) — will hook on what's there.</div>`;
    } else {
      hookHint = `<div class="wingguy-muted">No profile text found — Wingguy will keep it warm and generic.</div>`;
    }

    const buttons = templates.map((t) =>
      `<button class="wingguy-tpl" data-tpl="${escapeHtml(t.id)}">
         <span class="wingguy-tpl-label">${escapeHtml(t.label)}</span>
         <span class="wingguy-tpl-when">${escapeHtml(t.useWhen || '')}</span>
       </button>`
    ).join('');

    body.innerHTML = `
      ${hookHint}
      <div class="wingguy-section-label">Pick a campaign:</div>
      <div class="wingguy-tpl-list">${buttons}</div>
    `;
    body.querySelectorAll('.wingguy-tpl').forEach((b) => {
      b.addEventListener('click', () => draftThanks(profile, thread, b.getAttribute('data-tpl')));
    });
  }

  function renderReplyBody(body, profile, thread) {
    if (!thread.length) {
      body.innerHTML = `<div class="wingguy-warn">No open conversation found. Open the message thread on this profile (click "Message"), then reopen Wingguy — or use "Thanks for connecting" above.</div>`;
      return;
    }
    const last = thread[thread.length - 1];
    body.innerHTML = `
      <div class="wingguy-muted">Ongoing conversation — ${thread.length} message${thread.length > 1 ? 's' : ''} read. Last from <strong>${escapeHtml(last.sender || 'Unknown')}</strong>.</div>
      <div class="wingguy-section-label">Wingguy will read the whole thread and draft your next message.</div>
      <button class="wingguy-primary wingguy-block" id="wingguy-draft-reply">Draft reply</button>
    `;
    body.querySelector('#wingguy-draft-reply').addEventListener('click', () => draftReply(profile, thread));
  }

  async function draftThanks(profile, thread, templateId) {
    setBody(`<div class="wingguy-muted">Drafting in your voice…</div>`);
    try {
      const data = await bg({ type: 'WINGGUY_DRAFT_THANKS', templateId, profile });
      renderDraftStep(data.draft || '', data.model || '', {
        onRegenerate: () => draftThanks(profile, thread, templateId),
        onBack: () => renderRoute(profile, thread, 'thanks'),
      });
    } catch (e) {
      renderError(e, () => renderRoute(profile, thread, 'thanks'));
    }
  }

  async function draftReply(profile, thread) {
    setBody(`<div class="wingguy-muted">Reading the conversation and drafting your reply…</div>`);
    try {
      const data = await bg({ type: 'WINGGUY_DRAFT_REPLY', profile, conversation: thread });
      renderDraftStep(data.draft || '', data.model || '', {
        onRegenerate: () => draftReply(profile, thread),
        onBack: () => renderRoute(profile, thread, 'reply'),
      });
    } catch (e) {
      renderError(e, () => renderRoute(profile, thread, 'reply'));
    }
  }

  function renderError(e, onBack) {
    setBody(`<div class="wingguy-warn">Draft failed: ${escapeHtml(e.message)}</div>
      <button class="wingguy-secondary" id="wingguy-back">← Back</button>`);
    document.getElementById('wingguy-back')?.addEventListener('click', onBack);
  }

  function renderDraftStep(draft, model, { onRegenerate, onBack }) {
    setBody(`
      <textarea class="wingguy-draft" id="wingguy-draft" rows="9">${escapeHtml(draft)}</textarea>
      <div class="wingguy-row">
        <button class="wingguy-primary" id="wingguy-insert">Insert into LinkedIn</button>
        <button class="wingguy-secondary" id="wingguy-copy">Copy</button>
        <button class="wingguy-secondary" id="wingguy-regen">Regenerate</button>
      </div>
      <div class="wingguy-foot">
        <button class="wingguy-link" id="wingguy-back">← Back</button>
        <span class="wingguy-muted">${escapeHtml(model)} · you click send</span>
      </div>
      <div class="wingguy-status" id="wingguy-status"></div>
    `);

    const statusEl = document.getElementById('wingguy-status');
    const getText = () => document.getElementById('wingguy-draft').value;

    document.getElementById('wingguy-insert').addEventListener('click', () => {
      const res = insertIntoComposer(getText());
      if (res.ok) {
        statusEl.textContent = '✓ Inserted — review and click send.';
        statusEl.className = 'wingguy-status wingguy-ok';
      } else {
        statusEl.textContent = 'Open the LinkedIn message box first (click "Message"), then Insert. Use Copy as a fallback.';
        statusEl.className = 'wingguy-status wingguy-warn-inline';
      }
    });

    document.getElementById('wingguy-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getText());
        statusEl.textContent = '✓ Copied.';
        statusEl.className = 'wingguy-status wingguy-ok';
      } catch (_) {
        statusEl.textContent = 'Copy blocked by the browser — select the text and copy manually.';
        statusEl.className = 'wingguy-status wingguy-warn-inline';
      }
    });

    document.getElementById('wingguy-regen').addEventListener('click', onRegenerate);
    document.getElementById('wingguy-back').addEventListener('click', onBack);
  }

  // ---- lifecycle / SPA navigation ------------------------------------------
  function refresh() {
    if (isProfilePage()) injectLauncher();
    else removeLauncher();
  }

  function watchSpaNavigation() {
    setInterval(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        closePanel();
        // small delay so the new profile DOM settles
        setTimeout(refresh, 600);
      }
    }, 1000);
    window.addEventListener('popstate', () => setTimeout(refresh, 600));
  }

  function init() {
    refresh();
    watchSpaNavigation();
    console.log('[Wingguy] content script ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
