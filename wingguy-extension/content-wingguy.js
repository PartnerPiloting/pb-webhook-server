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

  async function scrapeProfile() {
    await expandAboutSeeMore();
    const nameEl = qsFirst(['main h1', 'h1.text-heading-xlarge', '.pv-top-card h1', 'h1']);
    const name = cleanText(nameEl && nameEl.textContent);

    // Headline = the body-medium line right under the name (within the top card).
    const topCard = nameEl ? nameEl.closest('section') || document : document;
    const headlineEl = qsFirst(
      ['div.text-body-medium.break-words', '.pv-text-details__left-panel .text-body-medium', 'div.text-body-medium'],
      topCard
    );
    const headline = cleanText(headlineEl && headlineEl.textContent);

    const locationEl = qsFirst(
      ['span.text-body-small.inline.t-black--light.break-words', '.pv-text-details__left-panel .text-body-small'],
      topCard
    );
    const location = cleanText(locationEl && locationEl.textContent);

    const profileUrl = location_origin_path();

    return {
      name,
      headline,
      location,
      profileUrl,
      about: readAbout(),
      recentPosts: readRecentActivity(),
    };
  }

  function location_origin_path() {
    return location.origin + location.pathname.replace(/\/$/, '');
  }

  // ---- the LinkedIn message composer (insert target) ------------------------
  function findComposer() {
    return qsFirst([
      '.msg-form__contenteditable[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      'div.msg-form__contenteditable',
      '[aria-label*="Write a message" i][contenteditable="true"]',
    ]);
  }

  // Formatting-preserving insert: LinkedIn's composer is a Quill-style contenteditable that wraps
  // each line in <p>. Pasting through the clipboard flattens newlines (the bug we exist to fix), so
  // we write the DOM directly as paragraphs and fire an input event so LinkedIn enables Send.
  function insertIntoComposer(text) {
    const composer = findComposer();
    if (!composer) return { ok: false, reason: 'no-composer' };

    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const html = lines.map((l) => `<p>${l.trim() ? escapeHtml(l) : '<br>'}</p>`).join('');

    composer.focus();
    composer.innerHTML = html;
    // Nudge LinkedIn's editor state: input event (content changed) + a keyup for good measure.
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    composer.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
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
    setBody(`<div class="wingguy-muted">Reading this profile…</div>`);

    // Auth check first — gives a clear message instead of a cryptic 401.
    let auth;
    try { auth = await bg({ type: 'CHECK_AUTH' }); } catch (_) { auth = null; }
    if (!auth || !auth.authenticated) {
      setBody(`<div class="wingguy-warn">Not signed in. Open your portal once in another tab to sync, then reopen this.</div>`);
      return;
    }

    const profile = await scrapeProfile();
    if (!profile.name) {
      setBody(`<div class="wingguy-warn">Couldn't read this profile. Make sure you're on a person's /in/ page.</div>`);
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

    renderPickStep(profile);
  }

  function renderPickStep(profile) {
    const hookHint = profile.about
      ? `<div class="wingguy-muted">Read About (${profile.about.length} chars)${profile.recentPosts.length ? ` + ${profile.recentPosts.length} activity snippet(s)` : ''}.</div>`
      : `<div class="wingguy-muted">No About text found — Wingguy will keep it warm and generic.</div>`;

    const buttons = templates.map((t) =>
      `<button class="wingguy-tpl" data-tpl="${escapeHtml(t.id)}">
         <span class="wingguy-tpl-label">${escapeHtml(t.label)}</span>
         <span class="wingguy-tpl-when">${escapeHtml(t.useWhen || '')}</span>
       </button>`
    ).join('');

    setBody(`
      <div class="wingguy-who">${escapeHtml(profile.name)}${profile.headline ? ` — <span class="wingguy-muted">${escapeHtml(profile.headline)}</span>` : ''}</div>
      ${hookHint}
      <div class="wingguy-section-label">Pick a campaign:</div>
      <div class="wingguy-tpl-list">${buttons}</div>
    `);

    document.querySelectorAll('.wingguy-tpl').forEach((b) => {
      b.addEventListener('click', () => draftFor(profile, b.getAttribute('data-tpl')));
    });
  }

  async function draftFor(profile, templateId) {
    setBody(`<div class="wingguy-muted">Drafting in your voice…</div>`);
    try {
      const data = await bg({ type: 'WINGGUY_DRAFT_THANKS', templateId, profile });
      renderDraftStep(profile, templateId, data.draft || '', data.model || '');
    } catch (e) {
      setBody(`<div class="wingguy-warn">Draft failed: ${escapeHtml(e.message)}</div>
        <button class="wingguy-secondary" id="wingguy-back">← Back</button>`);
      document.getElementById('wingguy-back')?.addEventListener('click', () => renderPickStep(profile));
    }
  }

  function renderDraftStep(profile, templateId, draft, model) {
    setBody(`
      <textarea class="wingguy-draft" id="wingguy-draft" rows="9">${escapeHtml(draft)}</textarea>
      <div class="wingguy-row">
        <button class="wingguy-primary" id="wingguy-insert">Insert into LinkedIn</button>
        <button class="wingguy-secondary" id="wingguy-copy">Copy</button>
        <button class="wingguy-secondary" id="wingguy-regen">Regenerate</button>
      </div>
      <div class="wingguy-foot">
        <button class="wingguy-link" id="wingguy-back">← Pick another</button>
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

    document.getElementById('wingguy-regen').addEventListener('click', () => draftFor(profile, templateId));
    document.getElementById('wingguy-back').addEventListener('click', () => renderPickStep(profile));
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
