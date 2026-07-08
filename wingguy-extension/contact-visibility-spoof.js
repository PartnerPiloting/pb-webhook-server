// Wingguy — visibility spoof for the contact-info background tab.
//
// Runs at document_start in the MAIN (page) world — see manifest.json — ONLY on
// .../in/<slug>/overlay/contact-info/ pages. Wingguy opens that page in a HIDDEN background tab to read a
// lead's LinkedIn Contact Info (email + phone) after a create or a manual "grab their details". The problem
// (diagnosed live 2026-07-08, confirmed as a known issue): a hidden tab reports document.visibilityState
// = "hidden", and LinkedIn's single-page app PAUSES rendering while hidden — so the contact card never
// draws and the read comes back empty.
//
// This makes the tab report "visible" (and swallows the browser's real visibilitychange) so LinkedIn builds
// the card exactly as it would for a focused tab. We read the DOM the app renders; painting doesn't matter.
// It's the same technique the "always active tab" extensions use. Harmless if a human ever lands on this
// page directly — the tab is genuinely visible then, so the override changes nothing they'd notice.
(function () {
  try {
    if (window.__wgVisSpoof) return;
    window.__wgVisSpoof = true;

    const asVisible = { configurable: true, get: function () { return 'visible'; } };
    const asNotHidden = { configurable: true, get: function () { return false; } };
    Object.defineProperty(document, 'visibilityState', asVisible);
    Object.defineProperty(document, 'hidden', asNotHidden);
    try { Object.defineProperty(document, 'webkitVisibilityState', asVisible); } catch (_) { /* older alias */ }
    try { Object.defineProperty(document, 'webkitHidden', asNotHidden); } catch (_) { /* older alias */ }

    // Stop the browser's real "you went hidden" event from reaching the app (capture phase, first in line).
    const swallow = function (e) { e.stopImmediatePropagation(); };
    document.addEventListener('visibilitychange', swallow, true);
    document.addEventListener('webkitvisibilitychange', swallow, true);
  } catch (_) { /* non-fatal — worst case we're back to the empty read */ }
})();
