// The coach's OWN email addresses - the set every door treats as "self".
//
// Moved here from wingguyMailMcp (28 Sep 2026) so the lead-writing doors can share it without pulling in
// the whole mail module. Those doors use it as a guard: a coach's own address must never be written onto
// a LEAD's record. Matthew Bulat, 28 Sep 2026: /wg on Guy's profile scanned the thread for an email Guy
// had "proffered", found Matthew's own address inside one of Guy's messages, and saved it as Guy's email -
// so Wingguy treated Guy as Matthew. Any lead who ever types the coach's address back to them would do
// the same.
function coachOwnEmails(coach) {
  const set = new Set();
  if (!coach) return set;
  const add = (v) => { const e = String(v || '').trim().toLowerCase(); if (e) set.add(e); };
  add(coach.clientEmailAddress);
  add(coach.googleCalendarEmail);   // the {Calendar Email} column - the mailbox Wingguy reads
  add(coach.calendarEmail);
  // Same source the inbound path filters on, so every door treats the same addresses as "self".
  try {
    String(coach.rawRecord?.get('Alternative Email Addresses') || '').split(';').forEach(add);
  } catch (_) { /* rawRecord absent (cached/stubbed client) - the primary addresses still apply */ }
  return set;
}

function isCoachOwnEmail(coach, email) {
  const e = String(email || '').trim().toLowerCase();
  return !!e && coachOwnEmails(coach).has(e);
}

module.exports = { coachOwnEmails, isCoachOwnEmail };
