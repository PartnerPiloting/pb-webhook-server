/**
 * Who wrote a LinkedIn line in a lead's Notes - the lead ('them') or the client ('you')?
 *
 * Notes lines look like "DD-MM-YY H:MM AM - Sender Name - text", where the sender is the
 * LinkedIn display name. Until 30 Oct 2026 every reader decided with
 * `sender.startsWith(leadFirstName)`, which fails whenever the client and the lead share a
 * first name, or the lead's first name is a prefix of the client's: "Guy Wilson" read as
 * Guy Newton, "Julian Davis" read as Julia Lippold, every Matt read as Matthew Bulat the
 * moment he messaged them. The lead then looked engaged, landed in "Waiting on you - they
 * wrote last", and their dossier quoted the client's own words back as theirs. (Guy Newton on
 * Guy's Today page, 30 Oct 2026; 14 Davids in David Gould's base the same day.)
 *
 * Order of decision:
 *   1. The sender IS the client (display name matches the client's name) -> 'you'. Beats
 *      everything: the client's own lines are the one thing the export always labels the same way.
 *   2. The lead's last name is known -> theirs only when the sender carries it as a whole word
 *      (suffixes like "FCPA" and middle names are fine; "Wilson" never matches "Newton").
 *   3. No last name on record -> fall back to the first name as a WHOLE token ("Matt" is not
 *      "Matthew", "Julia" is not "Julian"), never a bare prefix.
 *
 * Pure. Unit-tested in tests/linkedin-sender.test.js.
 */

const norm = (s) => String(s || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay, word) => !!word && new RegExp(`(^|\\s)${esc(word)}(\\s|$)`).test(hay);

/**
 * @param {string} sender      the name on the Notes line
 * @param {{first?: string, last?: string}} lead
 * @param {{name?: string}} [coach]  the client - `name` is their full name (clientName)
 * @returns {boolean} true = the lead wrote it
 */
function senderIsLead(sender, lead = {}, coach = {}) {
  const s = norm(sender);
  if (!s) return false;
  const coachName = norm(coach && coach.name);
  if (coachName && (s === coachName || s.startsWith(`${coachName} `))) return false;
  const first = norm(lead.first);
  const last = norm(lead.last);
  if (last) return hasWord(s, last) && (!first || hasWord(s, first) || s.startsWith(first.split(' ')[0]));
  return !!first && hasWord(s, first);
}

module.exports = { senderIsLead };
