/**
 * Trim the next sentence off the END of an email address.
 *
 * LinkedIn capture flattens newlines, so a lead writing "my email is ayaanaihub@gmail.com\nLooking
 * forward" reaches us as "ayaanaihub@gmail.com.Looking forward" or "gmail.comLooking". Any email
 * pattern then grabs ".Looking" as the TLD, or fuses "Looking" into ".comLooking", and the result
 * bounces (Ayaan Malik, 2026-10-12; ten more leads found the same way).
 *
 * Sentence case is the evidence, so this is deliberately conservative: only a CAPITALISED word
 * after the last dot, or a capital straight after a lowercase TLD, is cut. A clean address
 * ("v@SmartTokenLabs.com", "Domenic@Digital-Alchemy.Consulting") is never touched.
 */
function trimRunOnEmail(addr) {
  const s = String(addr || '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return s;
  let domain = s.slice(at + 1);
  const dotted = domain.match(/^(.+\.[A-Za-z]{2,})\.[A-Z][a-z]+$/); // "gmail.com.Looking"
  if (dotted) domain = dotted[1];
  else domain = domain.replace(/(\.[a-z]{2,})[A-Z][A-Za-z]*$/, '$1'); // "gmail.comLooking"
  return `${s.slice(0, at)}@${domain}`;
}

module.exports = { trimRunOnEmail };
