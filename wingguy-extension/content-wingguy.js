// content-wingguy.js — Wingguy on LinkedIn (the AI-Blaze-style full-screen shell).
//
// Surface: a LinkedIn PROFILE page (/in/...) — works whether the messaging overlay is open or not.
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

  const LAUNCHER_ID = 'wingguy-launcher-btn';
  const OVERLAY_ID = 'wingguy-overlay';
  const PANEL_ID = 'wingguy-panel'; // the modal inside the overlay; kept as the id the insert code excludes

  // Typed triggers (slash-prefixed only, so they never fire inside normal prose). Longest first so
  // "/wingguy" wins over "/wg" when both would match the tail.
  const TRIGGERS = ['/wingguy', '\\wingguy', '/wingman', '\\wingman', '/wg', '\\wg'];

  let currentUrl = location.href;
  let templates = null; // cached [{ id, label, useWhen, detectionKeywords, isDefault }]

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
    return 'WINGGUY DIAGNOSTIC\n' + JSON.stringify({ path: location.pathname, ...collectEditables() }, null, 2);
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
  function onComposerKeyup() {
    if (document.getElementById(OVERLAY_ID)) return;          // already open
    const target = deepActiveElement();
    if (!isEditableEl(target) || insideWingguy(target)) return;
    if (!isMessageEditableSafe(target)) return;               // only inside the message box
    const text = (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
      ? (target.value || '') : (target.textContent || '');
    const tr = matchedTrigger(text);
    if (!tr) return;
    console.log('[Wingguy] trigger typed:', tr);
    stripTrigger(target, tr.length);
    lastFocusedEditable = target;                              // remember the box for the insert
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

  // ---- UI: launcher + full-screen overlay -----------------------------------
  function injectLauncher() {
    if (!isProfilePage()) return;
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
    // Click the dim backdrop (outside the modal) to close; Esc to close.
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePanel(); });
    return overlay;
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

    // Read the open thread (if any) and auto-route: ongoing conversation → reply; else → first hello.
    const thread = scrapeOpenThread();
    renderRoute(profile, thread, classifyMode(thread));
  }

  function templateLabel(id) {
    const t = (templates || []).find((x) => x.id === id);
    return t ? t.label : id;
  }

  // The CONTEXT header: who we're drafting for + a mode switch (auto-detected, human-overridable).
  function renderContext(profile, thread, mode) {
    const who = `${escapeHtml(profile.name || '(name not found)')}${profile.headline ? ` <span class="wingguy-muted">· ${escapeHtml(profile.headline)}</span>` : ''}`;
    const tab = (m, label) =>
      `<button class="wingguy-mode ${m === mode ? 'wingguy-mode-on' : ''}" data-mode="${m}">${label}</button>`;
    setContextSub(`
      <span class="wingguy-context-who">${who}</span>
      <span class="wingguy-modes">
        ${tab('thanks', 'Thanks for connecting')}
        ${tab('reply', `Reply${thread.length ? ` (${thread.length})` : ''}`)}
      </span>
    `);
    document.querySelectorAll('#wingguy-context-sub .wingguy-mode').forEach((b) => {
      b.addEventListener('click', () => renderRoute(profile, thread, b.getAttribute('data-mode')));
    });
  }

  // Top-level: set the header, then auto-draft for the chosen mode (AI-Blaze "it just shows you the
  // message"). Thanks mode auto-detects the campaign template; reply mode runs the reply engine.
  function renderRoute(profile, thread, mode) {
    renderContext(profile, thread, mode);
    const pageLen = (profile.pageText || '').length;
    if (profile.nameSource && profile.nameSource !== 'page') {
      console.log(`[Wingguy] name from ${profile.nameSource} (DOM h1 not matched); page content chars=${pageLen}`);
    }
    if (mode === 'reply') {
      if (!thread.length) {
        setBody(`<div class="wingguy-warn">No open conversation found. Open the message thread (click "Message"), then reopen Wingguy — or switch to "Thanks for connecting" above.</div>`);
        return;
      }
      draftReply(profile, thread);
    } else {
      autoDraftThanks(profile, thread, null); // null → let the backend auto-detect the template
    }
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

  async function draftReply(profile, thread) {
    setBody(`<div class="wingguy-muted">Reading the conversation and drafting your reply…</div>`);
    try {
      const data = await bg({ type: 'WINGGUY_DRAFT_REPLY', profile, conversation: thread });
      renderDraftStep(data.draft || '', data.model || '', {
        onRegenerate: () => draftReply(profile, thread),
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

  // The draft view (full-screen): the editable message + Insert/Copy/Regenerate. In thanks mode it
  // also shows the auto-detected template as a pill with a one-tap override to the other templates.
  function renderDraftStep(draft, model, opts = {}) {
    const { onRegenerate, templateId, autoDetected, onPickTemplate } = opts;

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

  function onKeydown(e) {
    if (e.key === 'Escape' && document.getElementById(OVERLAY_ID)) closePanel();
  }

  function init() {
    refresh();
    watchSpaNavigation();
    // Remember the last editable the user focused (so Insert can target the message box even though
    // they then click the Wingguy panel). focusin is composed, so it fires for open shadow roots too.
    document.addEventListener('focusin', trackFocus, true);
    // Typed trigger (/wg etc.) inside the composer — composed keyup crosses open shadow boundaries.
    document.addEventListener('keyup', onComposerKeyup, true);
    document.addEventListener('keydown', onKeydown, true);
    console.log('[Wingguy] content script ready (type /wg in the message box, or click the launcher)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
