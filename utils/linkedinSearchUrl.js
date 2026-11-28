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
    codes = codesFrom(raw.match(/relationship:List\(([^)]*)\)/), /\b([A-Z])\b/g);
    if (!codes.length) {
      // (type:RELATIONSHIP,values:List((id:F,...,selectionType:INCLUDED),(id:S,...,selectionType:EXCLUDED)))
      // An EXCLUDED value is the opposite of asking for it - only included ones count (review 28 Nov 2026).
      const block = raw.match(/type:RELATIONSHIP,values:List\((.*?)\)\)\)/) || raw.match(/type:RELATIONSHIP,values:List\((.*?)\)\)/);
      if (block) {
        for (const v of block[1].split(/\),\s*\(/)) {
          const id = (v.match(/id:([A-Z])\b/) || [])[1];
          if (id && !/selectionType:EXCLUDED/.test(v)) codes.push(id);
        }
      }
    }
  }
  d.first = codes.includes('F');
  d.second = codes.includes('S');
  d.third = codes.includes('O');
  d.other = codes.some((c) => !['F', 'S', 'O'].includes(c));   // e.g. Sales Navigator group members (A)
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

/**
 * Is this a search of the client's OWN connections, ready to bring into Wingguy?
 * (docs/CONNECTIONS-SEARCH-BUILD-PLAN.md, Guy 27-28 Nov 2026.)
 *
 * A campaign top-up wants 2nd/3rd degree (it invites). Bringing connections in wants the opposite:
 * 1st degree ONLY - nobody to invite, Linked Helper only visits them. And it must be NARROWED: a
 * bare "all my 1st-degree connections" is the Connections.csv problem again (Guy: "everyone I know"
 * is never the list), so the link must carry at least one real filter besides the degree.
 *
 * Returns { own, problem } - own=true means use it; otherwise `problem` says why, in words for the
 * person who pasted it, or null when the link is simply not a 1st-degree search (a normal top-up).
 */
const SEARCH_NARROWING_PARAMS = [
  'keywords', 'geoUrn', 'currentCompany', 'pastCompany', 'industry', 'title', 'titleFreeText',
  'schoolFilter', 'schoolFreetext', 'school', 'company', 'firstName', 'lastName', 'profileLanguage',
  'serviceCategory', 'connectionOf', 'followerOf',
];

function searchIsNarrowed(url, kind) {
  if (kind === 'search-page') {
    // Split the query BEFORE decoding, so a %3F or %26 inside one value can't cut it short.
    const at = url.indexOf('?');
    const q = at >= 0 ? url.slice(at + 1).split('#')[0] : '';
    return q.split('&').some((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return false;
      const k = part.slice(0, eq);
      let val = part.slice(eq + 1).replace(/\+/g, ' ');
      try { val = decodeURIComponent(val); } catch (_e) { /* keep as is */ }
      val = val.trim();
      return SEARCH_NARROWING_PARAMS.includes(k) && val && val !== '[]' && val !== '""';
    });
  }
  if (kind === 'sn-search-page') {
    let raw = url;
    try { raw = decodeURIComponent(url); } catch (_e) { /* leave as pasted */ }
    if (/keywords:[^,)]+/i.test(raw)) return true;
    // Any filter besides the connection degree counts. A saved search whose link shows no filters
    // does NOT count - its filters live on Sales Navigator's side and can't be seen from here.
    const types = [...raw.matchAll(/type:([A-Z_]+)/g)].map((m) => m[1]).filter((t) => t !== 'RELATIONSHIP');
    return types.length > 0;
  }
  return false;
}

function ownConnectionsCheck(check) {
  const out = { own: false, problem: null };
  if (!check || !check.ok || !check.degrees) return out;
  const d = check.degrees;
  if (check.kind === 'sn-search-page' && !d.known && /savedSearchId=/i.test(check.url)) {
    out.problem = 'That is a saved Sales Navigator search, and its link does not show its filters, so I cannot tell who is in it. '
      + 'Open the saved search, wait for the results to load, then copy the link from the address bar again - it then carries the filters.';
    return out;
  }
  if (!d.first) return out;                                     // not about their own connections
  if (d.second || d.third || d.other) {
    out.problem = 'That search mixes your own connections (1st) with people you are not connected to (2nd/3rd). '
      + 'Split it into two: 1st only to bring your connections into Wingguy, and 2nd and 3rd only to top up your campaign.';
    return out;
  }
  if (!searchIsNarrowed(check.url, check.kind)) {
    out.problem = 'That search is all of your 1st-degree connections with nothing else picked. Narrow it down to the people '
      + 'you actually want to talk to - a job title, a location, an industry or a company size - then copy the link again.';
    return out;
  }
  out.own = true;
  return out;
}

module.exports = { checkSearchUrl, degreeObjection, degreeNote, ownConnectionsCheck, searchIsNarrowed, KINDS };
