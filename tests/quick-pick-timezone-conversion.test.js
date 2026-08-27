/**
 * Test: Quick Pick timezone conversion
 * Verifies that slot times (user's timezone) are correctly converted to lead's timezone.
 *
 * Run: node tests/quick-pick-timezone-conversion.test.js
 */

const { getTimezoneFromLocation } = require('../linkedin-messaging-followup-next/lib/timezoneFromLocation.js');
const { parseSlotTimeAsUTC } = require('../utils/slotTimeParser.js');

function formatTimeInTimezone(date, tz) {
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
}

function runTests() {
  let passed = 0;
  let failed = 0;

  // Test 1: UTC ISO string - 3:30pm Brisbane (05:30 UTC) -> 4:30pm Melbourne
  {
    const slotTime = '2025-03-27T05:30:00.000Z';
    const yourTimezone = 'Australia/Brisbane';
    const leadTimezone = 'Australia/Melbourne';
    const date = parseSlotTimeAsUTC(slotTime, yourTimezone);
    const melbTime = formatTimeInTimezone(date, leadTimezone);
    const bneTime = formatTimeInTimezone(date, yourTimezone);
    const expected = '4:30 pm';
    if (melbTime === expected) {
      console.log(`✓ Test 1: ${bneTime} Brisbane -> ${melbTime} Melbourne`);
      passed++;
    } else {
      console.log(`✗ Test 1: Expected "${expected}", got "${melbTime}" (Brisbane: ${bneTime})`);
      failed++;
    }
  }

  // Test 2: No-Z format - "2025-03-27T15:30:00" as Brisbane local -> 4:30pm Melbourne
  {
    const slotTime = '2025-03-27T15:30:00';
    const yourTimezone = 'Australia/Brisbane';
    const leadTimezone = 'Australia/Melbourne';
    const date = parseSlotTimeAsUTC(slotTime, yourTimezone);
    const melbTime = formatTimeInTimezone(date, leadTimezone);
    const bneTime = formatTimeInTimezone(date, yourTimezone);
    const expected = '4:30 pm';
    if (melbTime === expected && bneTime === '3:30 pm') {
      console.log(`✓ Test 2: ${slotTime} (Brisbane local) -> ${melbTime} Melbourne`);
      passed++;
    } else {
      console.log(`✗ Test 2: Expected Melbourne "${expected}", Brisbane "3:30 pm". Got Melbourne "${melbTime}", Brisbane "${bneTime}"`);
      failed++;
    }
  }

  // Test 3: Perth (UTC+8) 10am -> Melbourne (UTC+11) 1pm
  {
    const slotTime = '2025-03-27T02:00:00.000Z';
    const yourTimezone = 'Australia/Perth';
    const leadTimezone = 'Australia/Melbourne';
    const date = parseSlotTimeAsUTC(slotTime, yourTimezone);
    const melbTime = formatTimeInTimezone(date, leadTimezone);
    const perthTime = formatTimeInTimezone(date, yourTimezone);
    const expectedMelb = '1:00 pm';
    const expectedPerth = '10:00 am';
    if (melbTime === expectedMelb && perthTime === expectedPerth) {
      console.log(`✓ Test 3: ${perthTime} Perth -> ${melbTime} Melbourne`);
      passed++;
    } else {
      console.log(`✗ Test 3: Expected Perth "${expectedPerth}", Melbourne "${expectedMelb}". Got Perth "${perthTime}", Melbourne "${melbTime}"`);
      failed++;
    }
  }

  // Test 4: getTimezoneFromLocation
  {
    const loc = 'Dandenong South, Victoria, Australia';
    const tz = getTimezoneFromLocation(loc);
    if (tz === 'Australia/Melbourne') {
      console.log(`✓ Test 4: "${loc}" -> ${tz}`);
      passed++;
    } else {
      console.log(`✗ Test 4: Expected Australia/Melbourne, got ${tz}`);
      failed++;
    }
  }

  // Test 5: Full format (matches quick-pick-message output)
  {
    const slotTime = '2025-03-27T15:30:00';
    const yourTimezone = 'Australia/Brisbane';
    const leadTimezone = 'Australia/Melbourne';
    const date = parseSlotTimeAsUTC(slotTime, yourTimezone);
    const weekday = date.toLocaleDateString('en-AU', { weekday: 'short', timeZone: leadTimezone });
    const day = date.toLocaleDateString('en-AU', { day: 'numeric', timeZone: leadTimezone });
    const month = date.toLocaleDateString('en-AU', { month: 'short', timeZone: leadTimezone });
    const time = date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: leadTimezone });
    const formatted = `${weekday}, ${day} ${month}, ${time}`;
    if (time === '4:30 pm' && formatted.includes('4:30 pm')) {
      console.log(`✓ Test 5: Full format "${formatted}" (Melbourne)`);
      passed++;
    } else {
      console.log(`✗ Test 5: Expected "4:30 pm" in output, got time="${time}", formatted="${formatted}"`);
      failed++;
    }
  }

  // ---- DST-OFF MIRRORS (2026-08-27) ----
  // Every test above is pinned to 27 March — inside Australian daylight saving. The other half of
  // the year, when Brisbane and Melbourne share a clock, had NO coverage — and that identical-clocks
  // window is exactly what hid the Wayne Merry location bug for a week. Same conversions, July date.

  // Test 6: DST off - 3:30pm Brisbane (05:30 UTC) -> 3:30pm Melbourne (SAME clock)
  {
    const slotTime = '2025-07-24T05:30:00.000Z';
    const date = parseSlotTimeAsUTC(slotTime, 'Australia/Brisbane');
    const melbTime = formatTimeInTimezone(date, 'Australia/Melbourne');
    const bneTime = formatTimeInTimezone(date, 'Australia/Brisbane');
    if (melbTime === '3:30 pm' && bneTime === '3:30 pm') {
      console.log(`✓ Test 6: DST off — ${bneTime} Brisbane -> ${melbTime} Melbourne (same clock)`);
      passed++;
    } else {
      console.log(`✗ Test 6: Expected 3:30 pm in both, got Melbourne "${melbTime}", Brisbane "${bneTime}"`);
      failed++;
    }
  }

  // Test 7: DST off - no-Z Brisbane local stays 3:30pm in Melbourne too
  {
    const slotTime = '2025-07-24T15:30:00';
    const date = parseSlotTimeAsUTC(slotTime, 'Australia/Brisbane');
    const melbTime = formatTimeInTimezone(date, 'Australia/Melbourne');
    const bneTime = formatTimeInTimezone(date, 'Australia/Brisbane');
    if (melbTime === '3:30 pm' && bneTime === '3:30 pm') {
      console.log(`✓ Test 7: DST off — ${slotTime} (Brisbane local) -> ${melbTime} Melbourne`);
      passed++;
    } else {
      console.log(`✗ Test 7: Expected 3:30 pm in both, got Melbourne "${melbTime}", Brisbane "${bneTime}"`);
      failed++;
    }
  }

  // Test 8: DST off - Perth (UTC+8) 10am -> Melbourne (UTC+10) 12pm, not 1pm
  {
    const slotTime = '2025-07-24T02:00:00.000Z';
    const date = parseSlotTimeAsUTC(slotTime, 'Australia/Perth');
    const melbTime = formatTimeInTimezone(date, 'Australia/Melbourne');
    const perthTime = formatTimeInTimezone(date, 'Australia/Perth');
    if (melbTime === '12:00 pm' && perthTime === '10:00 am') {
      console.log(`✓ Test 8: DST off — ${perthTime} Perth -> ${melbTime} Melbourne`);
      passed++;
    } else {
      console.log(`✗ Test 8: Expected Perth "10:00 am", Melbourne "12:00 pm". Got Perth "${perthTime}", Melbourne "${melbTime}"`);
      failed++;
    }
  }

  // Test 9: a bare country maps to NOTHING — deliberately. There is no "australia" rule because
  // guessing a state from a country is wrong five ways; callers must fall back HONESTLY (coach's
  // zone + a said-out-loud assumption), never guess. This locks the gap in so nobody "fixes" it.
  {
    const tz = getTimezoneFromLocation('Australia');
    if (tz === null) {
      console.log(`✓ Test 9: "Australia" -> null (bare country must NOT resolve)`);
      passed++;
    } else {
      console.log(`✗ Test 9: Expected null for bare "Australia", got ${tz}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0;
}

if (require.main === module) {
  const ok = runTests();
  process.exit(ok ? 0 : 1);
}

module.exports = { parseSlotTimeAsUTC, runTests };
