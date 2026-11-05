/**
 * threadDates - the dates on a LinkedIn thread, for the drafter.
 *
 * The extension reads LinkedIn's day label above each message ("Today", "Tuesday", "Aug 13",
 * "Aug 13, 2018") and sends it as `day` on every message. Until 5 Nov 2026 the drafter was handed
 * the thread as bare "Sender: text" lines and the labels were dropped, so it could not tell a
 * message from 2018 from one sent this morning. David Gould's reconnect drafts answered eight-year-
 * old remarks as news ("hope the assignment is going well" to a man whose assignment was January
 * 2018), and no instruction could fix it, because his instruction said "look at the date" and there
 * was no date to look at.
 *
 * Pure. Nothing here guesses: a label that cannot be read comes back null and is shown as written.
 */

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Today's calendar date in a timezone, as a local-fields Date at midnight. */
function todayIn(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
    return new Date(get('year'), get('month') - 1, get('day'));
  } catch (_) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

function validDay(year, month, day) {
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null;
}

/**
 * One LinkedIn day label -> a Date (midnight, local fields), or null when it cannot be read.
 * A label with no year is the most recent such day that is not after today: LinkedIn only drops
 * the year for the current twelve months.
 */
function resolveDayLabel(label, today) {
  const t = String(label || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!t || !(today instanceof Date) || isNaN(today.getTime())) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const lower = t.toLowerCase();

  if (lower === 'today') return base;
  if (lower === 'yesterday') return new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);

  const wd = WEEKDAYS.indexOf(lower);
  if (wd !== -1) {
    let diff = base.getDay() - wd;
    if (diff < 0) diff += 7;
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() - diff);
  }

  let monthName, dayNum, yearNum;
  const monthFirst = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  const dayFirst = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:,?\s*(\d{4}))?$/);
  if (monthFirst) { monthName = monthFirst[1]; dayNum = monthFirst[2]; yearNum = monthFirst[3]; }
  else if (dayFirst) { dayNum = dayFirst[1]; monthName = dayFirst[2]; yearNum = dayFirst[3]; }
  else return null;

  const month = MONTHS[monthName.toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  const day = parseInt(dayNum, 10);
  if (yearNum) return validDay(parseInt(yearNum, 10), month, day);

  const thisYear = validDay(base.getFullYear(), month, day);
  if (thisYear && thisYear.getTime() <= base.getTime()) return thisYear;
  return validDay(base.getFullYear() - 1, month, day);
}

/** "Thu 13 Aug 2018" */
function formatDay(d) {
  return `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** How long before today, in words a person would use. */
function agoWords(d, today) {
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  let months = (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth());
  if (today.getDate() < d.getDate()) months -= 1;
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const y = `${years} year${years === 1 ? '' : 's'}`;
  return rem ? `${y} ${rem} month${rem === 1 ? '' : 's'} ago` : `${y} ago`;
}

/**
 * The prefix for one message line: "[Thu 13 Aug 2018] ". A label that is present but unreadable is
 * shown as LinkedIn wrote it; no label at all gives no prefix.
 */
function linePrefix(message, today) {
  const label = String((message && message.day) || '').replace(/\s+/g, ' ').trim();
  if (!label) return '';
  const d = resolveDayLabel(label, today);
  return d ? `[${formatDay(d)}] ` : `[${label.slice(0, 30)}] `;
}

/**
 * The worked-out summary that sits above the thread. `messages` are the ones being shown
 * ({ sender, text, day }), oldest first. Returns '' when there is nothing to say.
 */
function threadDatesNote(messages, today) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && String(m.text || '').trim());
  if (!list.length || !(today instanceof Date) || isNaN(today.getTime())) return '';
  const todayText = formatDay(today);

  const dated = list.map((m) => ({ m, when: resolveDayLabel(m.day, today) })).filter((x) => x.when);
  if (!dated.length) {
    return `MESSAGE DATES: today is ${todayText}. LinkedIn's dates could not be read for this thread, so how old these messages are is NOT known. Do not assume any of it is recent. If the timing matters to the message, tell the coach you could not see the dates rather than guessing.`;
  }

  // Newest by date; on a tie the later line in the thread wins.
  let newest = dated[0];
  for (const x of dated) if (x.when.getTime() >= newest.when.getTime()) newest = x;
  const newestBy = new Map(); // sender -> newest dated message from them
  for (const x of dated) {
    const s = String(x.m.sender || '').trim();
    if (!s || s.toLowerCase() === 'unknown') continue;
    const prior = newestBy.get(s);
    if (!prior || x.when.getTime() >= prior.when.getTime()) newestBy.set(s, x);
  }

  const days = Math.round((today.getTime() - newest.when.getTime()) / 86400000);
  const who = String(newest.m.sender || '').trim();
  let out = `MESSAGE DATES (worked out in code from LinkedIn's own day labels - trust these over any sense of timing in the wording): today is ${todayText}. The newest message in this thread${who && who.toLowerCase() !== 'unknown' ? ` is from ${who},` : ' was'} sent ${formatDay(newest.when)} - ${agoWords(newest.when, today)}.`;

  const perSender = [...newestBy.entries()]
    .filter(([, x]) => x !== newest)
    .map(([s, x]) => `${s}'s newest: ${formatDay(x.when)} (${agoWords(x.when, today)})`);
  if (perSender.length) out += ` ${perSender.join('; ')}.`;

  out += ' Every message below carries its own date in [brackets].';
  if (days >= 365) {
    out += ' ⚠ THIS THREAD IS YEARS OLD. Nothing in it has just arrived and you are not replying to it. Whatever was said in a message - a trip, a busy patch, an illness, a plan to catch up "later in the year", an apology - belongs to the date on that message and is long finished. Never answer it as current, never wish it well as if it is still happening, and never treat it as a live plan. Refer to it only as history, with the year named.';
  } else if (days >= 30) {
    out += ' This thread has been quiet for a while. Whatever was said in a message belongs to the date on that message - do not treat it as having just arrived or as still happening.';
  }
  return out;
}

module.exports = { todayIn, resolveDayLabel, formatDay, agoWords, linePrefix, threadDatesNote };
