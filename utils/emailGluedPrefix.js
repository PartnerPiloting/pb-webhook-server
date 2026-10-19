/**
 * Has a word been glued onto the FRONT of this lead's email address?
 *
 * The mirror of utils/runOnEmail.js (which trims a sentence glued onto the END). LinkedIn capture
 * once lost the line break between "My email is" and "Craig.carolan@infocus.com.au", so the address
 * finder took "iscraig.carolan@infocus.com.au" - a valid-looking address for a mailbox that does not
 * exist. It was saved as the primary email and the invite bounced (Craig Carolan, 2026-10-19).
 *
 * The evidence is the lead's NAME: the part before the @ almost always reads as the person's name,
 * and here it did - just with "is" stuck in front. So: if the local part does not read as the name
 * but it does once a short run of leading letters is removed, that run is glued text.
 *
 * Deliberately a FLAG, never a silent fix. "drcraig.carolan@" or "jpcraig@" would trip the same
 * check and be real addresses, so every caller shows the human both forms and asks. A wrong
 * "correction" would create the exact problem this exists to stop.
 */
const { localPartMatchesName } = require('../services/pendingLeadFilter');

const MAX_PREFIX = 10; // longer than any glued word we have seen ("emailis" is 7)

/**
 * @param {string} email     the address to check
 * @param {string} fullName  the lead's name ("Craig Carolan"); first + last joined is fine
 * @returns {{suspect:boolean, prefix?:string, suggested?:string}}
 *   suspect=true means: `email` does NOT read as the name, but `suggested` (the same address with
 *   `prefix` cut off the front) DOES.
 */
function gluedPrefix(email, fullName) {
  const e = String(email || '').trim();
  const name = String(fullName || '').trim();
  const at = e.indexOf('@');
  if (at < 2 || !name) return { suspect: false };
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (localPartMatchesName(e, name)) return { suspect: false };
  const lower = local.toLowerCase();
  const nameTokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (!nameTokens.length) return { suspect: false };
  const first = nameTokens[0];
  const last = nameTokens[nameTokens.length - 1];
  // Only a run of LETTERS can be a glued word; digits or dots in front are part of real addresses.
  const letters = (lower.match(/^[a-z]+/) || [''])[0];
  const limit = Math.min(letters.length, MAX_PREFIX, lower.length - 2);
  for (let i = 1; i <= limit; i++) {
    const rest = local.slice(i);
    const rl = rest.toLowerCase();
    // The remainder must START with the name EXACTLY (first name, surname, or initial+surname).
    // localPartMatchesName alone tolerates a one-letter typo, which would cut "i" off "iscraig" and
    // suggest "scraig" - the typo tolerance is right for matching, wrong for deciding where to cut.
    const startsRight = rl.startsWith(first) || (nameTokens.length >= 2 && (rl.startsWith(last) || rl.startsWith(first[0] + last)));
    if (startsRight && localPartMatchesName(`${rest}@${domain}`, name)) {
      return { suspect: true, prefix: local.slice(0, i), suggested: `${rest}@${domain}` };
    }
  }
  return { suspect: false };
}

/** The sentence every door says when the flag trips - one wording, so the human learns it once. */
function describeGluedPrefix(email, g) {
  return `"${email}" looks like text got stuck to the front of the address - "${g.prefix}" before the name. ` +
    `It is probably "${g.suggested}". Show the human both and ask which is right; nothing was saved or sent.`;
}

module.exports = { gluedPrefix, describeGluedPrefix };
