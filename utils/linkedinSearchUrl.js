/**
 * What kind of LinkedIn link is this, and which connection degrees does it ask for?
 *
 * WHY (Guy, 5 Nov 2026): a client pastes a search link to top up their campaign. Before the
 * machine touches anything we read the link: is it a people search at all, and does it include
 * 1st-degree connections (people they already know - the campaign invites, and you cannot invite
 * someone you are already connected to, so those would sit in the queue forever looking like a
 * top-up that never goes anywhere). This is the honest limit of what a link can tell us: nothing
 * about whether the people look right, how many there are, or who is already in the list.
 *
 * The shapes are Linked Helper's own (canCollectFromUrlAsType in its bundle, read 5 Nov 2026) -
 * a people search on LinkedIn, a people search in Sales Navigator, a Sales Navigator lead list.
 * The Python twin on the machine is scripts/linked-helper/lh-topup.py check_url(); keep them in step.
 */

const KINDS = [
  ['sn-search-page', /linkedin\.com\/sales\/search\/people/i, 'a Sales Navigator people search'],
  ['sn-list-people-page', /linkedin\.com\/sales\/lists\/people\/[^/&#?]+/i, 'a Sales Navigator lead list'],
  ['search-page', /linkedin\.com\/search\/results\/people/i, 'a LinkedIn people search'],
];

function degreesIn(url, kind) {
  const d = { first: false, second: false, third: false, known: false };
  let raw = url;
  try { raw = decodeURIComponent(url); } catch (_e) { /* leave as pasted */ }
  const codesFrom = (m, rx) => (m ? [...m[1].matchAll(rx)].map((x) => x[1]) : []);
  let codes = [];
  if (kind === 'search-page') {
    codes = codesFrom(raw.match(/[?&]network=(\[[^\]&#]*\])/), /"([FSO])"/g);
  } else if (kind === 'sn-search-page') {
    codes = codesFrom(raw.match(/relationship:List\(([^)]*)\)/), /\b([FSO])\b/g);
    if (!codes.length) codes = codesFrom(raw.match(/type:RELATIONSHIP,values:List\((.*?)\)\)/), /id:([FSO])\b/g);
  }
  d.first = codes.includes('F');
  d.second = codes.includes('S');
  d.third = codes.includes('O');
  d.known = codes.length > 0;
  return d;
}

/**
 * Classify a pasted link. Never throws.
 * Returns { ok, url, kind, kindWords, degrees, problem }.
 */
function checkSearchUrl(input) {
  let url = String(input || '').trim();
  const out = { ok: false, url, kind: null, kindWords: null, degrees: null, problem: null };
  if (!url) { out.problem = 'no link was given'; return out; }
  if (!/^https?:\/\//i.test(url)) { url = `https://${url}`; out.url = url; }
  if (/\s/.test(url)) { out.problem = 'that does not look like one link - copy the whole address from the address bar, nothing else'; return out; }
  if (/linkedin\.com\/search\/results\/people\/.*?[&?]eventAttending=/i.test(url)) {
    out.problem = "that is an event's attendee list, not a people search";
    return out;
  }
  for (const [kind, rx, words] of KINDS) {
    if (rx.test(url)) { out.kind = kind; out.kindWords = words; break; }
  }
  if (!out.kind) {
    if (/linkedin\.com\/in\//i.test(url)) out.problem = "that is one person's profile, not a search";
    else if (/linkedin\.com\/search\/results\/(companies|all|content|groups|events|schools|services)/i.test(url)) out.problem = 'that search is not a PEOPLE search - switch the filter at the top to People and copy the link again';
    else if (/linkedin\.com\/sales\//i.test(url)) out.problem = 'that Sales Navigator page is not a people search or a lead list';
    else if (/linkedin\.com/i.test(url)) out.problem = 'that LinkedIn page is not a people search';
    else out.problem = 'that is not a LinkedIn link';
    return out;
  }
  if (out.kind === 'sn-search-page') { url = stripViewMarkers(url); out.url = url; }
  out.degrees = degreesIn(url, out.kind);
  out.ok = true;
  return out;
}

/**
 * A Sales Navigator link copied from a saved search carries lastViewedAt, and with it Sales
 * Navigator lists only the people NEW since that moment - the header still says the full count.
 * Guy's BDM search, 5 Nov 2026: header 795, "Page 3 of 3", 68 people listed; the same saved
 * search without lastViewedAt walked every page. sessionId and page are the copier's own
 * browsing state and go too. The saved search id and the query stay untouched.
 */
function stripViewMarkers(url) {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = base.indexOf('?');
  if (qAt < 0) return url;
  const kept = base.slice(qAt + 1).split('&').filter((part) => part && !/^(lastViewedAt|sessionId|page)=/i.test(part));
  return base.slice(0, qAt) + (kept.length ? `?${kept.join('&')}` : '') + hash;
}

/**
 * The one objection worth stopping for, in words for the person who pasted the link.
 * null = nothing to object to from the link alone.
 */
function degreeObjection(check) {
  if (!check || !check.ok || !check.degrees) return null;
  const d = check.degrees;
  if (d.first) {
    return 'That search includes your 1st-degree connections - people you are already connected to. The campaign sends '
      + 'connection requests, and you cannot invite someone you already know, so they would sit in the queue and never go anywhere. '
      + 'Untick 1st in the Connections filter so it is 2nd and 3rd only, then copy the link again.';
  }
  return null;
}

/** A soft note when the link carries no degree filter we can read (a saved search, a lead list). */
function degreeNote(check) {
  if (!check || !check.ok || !check.degrees) return null;
  if (check.degrees.known) return null;
  if (check.kind === 'sn-list-people-page') {
    return 'A lead list has no connection filter in its address, so I cannot see from the link whether everyone on it is 2nd or 3rd degree - check that in Sales Navigator.';
  }
  return 'That link has no connection-degree filter I can read, so I cannot tell from it whether it is 2nd and 3rd degree only - check the Connections filter before relying on it.';
}

module.exports = { checkSearchUrl, degreeObjection, degreeNote, KINDS };
