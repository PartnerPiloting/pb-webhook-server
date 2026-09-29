// services/wingguyIdentity.js
// "Is the person signed in to LinkedIn the person Wingguy is signed in as?" (Guy, 2026-09-30.)
//
// Why it exists: the extension took its sign-in from whichever Portal page loaded last, so opening a
// client's Portal link in a normal window silently turned Guy's extension into that client. The next
// /wg on Guy's own LinkedIn drafted as them (their sign-off, their meeting link, their diary, their
// Claude key) and wrote Guy's conversation into THEIR leads base - Max Dagenais into Dean Hobin's
// (9 Sep) and Shiva Farabi into Steve Nelson's (30 Sep). The extension now keeps its owner; this is
// the safety net behind that, and the ONE place the comparison lives - the extension asks
// /api/wingguy/identity rather than carrying its own copy of the rule.
//
// The rule is deliberately lenient. A false "no" locks a paying client out of drafting, so it says
// no only when it is sure, and "can't tell" (null) whenever a name is missing:
//   - the LinkedIn name carries any part of the client's surname            -> yes
//   - or a longer part of it appears in the client's LinkedIn URL slug      -> yes
//     (a client whose LinkedIn name differs from the name on their record)
//   - the client has a one-word name and the first names agree              -> yes
//   - otherwise                                                             -> no
// A shared FIRST name alone is never enough - Guy Wilson is not Guy McPhee.
//
// Pure: no I/O, no Airtable. Tests: node tests/wingguy-identity.test.js

// "Julian Davis (FILP)" -> ['julian','davis','filp']; "Szymon Żurek" -> ['szymon','zurek'].
function nameTokens(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[łŁ]/g, 'l').replace(/[øØ]/g, 'o')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

// The /in/ slug with everything but letters dropped: ".../in/guy-wilson-safeur/" -> "guywilsonsafeur".
function slugLetters(url) {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(String(url || ''));
  if (!m) return '';
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch (_) { /* keep the raw slug */ }
  return nameTokens(slug).join('');
}

// -> { matches: true | false | null, reason }
function viewerMatchesClient({ viewerName, clientName, linkedinUrl } = {}) {
  const viewer = nameTokens(viewerName);
  const client = nameTokens(clientName);
  if (!viewer.length) return { matches: null, reason: 'no LinkedIn name was read' };
  if (!client.length) return { matches: null, reason: 'the client record has no name' };

  const first = client[0];
  const surname = client.slice(1);
  if (!surname.length) {
    return viewer.includes(first)
      ? { matches: true, reason: 'first name agrees (one-word client name)' }
      : { matches: false, reason: 'names differ' };
  }
  if (viewer.some((t) => surname.includes(t))) return { matches: true, reason: 'surname agrees' };

  const slug = slugLetters(linkedinUrl);
  if (slug && viewer.some((t) => t.length >= 4 && t !== first && slug.includes(t))) {
    return { matches: true, reason: 'name appears in the LinkedIn URL on the record' };
  }
  return { matches: false, reason: 'names differ' };
}

// The sentence the panel shows, and the /chat refusal. Plain English, names both people, says what
// to do. No dash characters other than the plain spaced one (house style).
function mismatchMessage({ viewerName, clientName }) {
  const v = String(viewerName || '').trim() || 'someone else';
  const c = String(clientName || '').trim() || 'another account';
  return `This LinkedIn is signed in as ${v}, but Wingguy here is signed in as ${c}. `
    + 'Nothing has been drafted or saved. Click the Wingguy icon, choose Disconnect, '
    + 'then open your own Portal link and type /wg again.';
}

module.exports = { nameTokens, slugLetters, viewerMatchesClient, mismatchMessage };
