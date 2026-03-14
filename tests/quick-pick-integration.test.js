/**
 * End-to-end integration test for Quick Pick timezone conversion.
 *
 * This test does what the real UI does:
 * 1. Calls the availability API (same as frontend) to get real slot data
 * 2. Picks a slot from the response
 * 3. Sends it to quick-pick-message (same as frontend)
 * 4. Verifies the message shows the correct time in the lead's timezone
 *
 * Run: BASE_URL=https://pb-webhook-server.onrender.com CLIENT_ID=Guy-Wilson node tests/quick-pick-integration.test.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CLIENT_ID = process.env.CLIENT_ID || 'Guy-Wilson';
const LEAD_LOCATION = 'Dandenong South, Victoria, Australia';

let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function runTests() {
  // ── Step 1: Call availability API with Melbourne lead ──
  console.log('\n1. Fetching availability (leadLocation = Melbourne suburb)...');
  const availRes = await fetch(
    `${BASE_URL}/api/calendar/availability?leadLocation=${encodeURIComponent(LEAD_LOCATION)}`,
    { headers: { 'x-client-id': CLIENT_ID } }
  );
  const avail = await availRes.json();
  if (avail.error) {
    console.error('Availability API error:', avail.error);
    process.exit(1);
  }

  assert(avail.yourTimezone === 'Australia/Brisbane', 'yourTimezone is Brisbane', `got: ${avail.yourTimezone}`);
  assert(avail.leadTimezone === 'Australia/Melbourne', 'leadTimezone is Melbourne', `got: ${avail.leadTimezone}`);

  // ── Step 2: Pick a real slot from the response ──
  console.log('\n2. Inspecting slots from availability API...');
  const dayWithSlots = avail.days?.find(d => d.freeSlots?.length > 0);
  if (!dayWithSlots) {
    console.error('No days with free slots found');
    process.exit(1);
  }

  const slot = dayWithSlots.freeSlots[0];
  assert(slot.time.endsWith('Z'), 'slot.time has Z suffix (UTC)', `got: ${slot.time}`);
  assert(typeof slot.display === 'string' && slot.display.length > 0, 'slot.display exists', `got: ${slot.display}`);
  assert(typeof slot.leadDisplay === 'string' && slot.leadDisplay.length > 0, 'slot.leadDisplay exists', `got: ${slot.leadDisplay}`);

  // Verify slot.display is YOUR time (Brisbane) and slot.leadDisplay is LEAD time (Melbourne)
  const date = new Date(slot.time);
  const brisbaneTime = date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Brisbane' });
  const melbourneTime = date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Australia/Melbourne' });
  assert(slot.display.includes(brisbaneTime), `slot.display shows Brisbane time (${brisbaneTime})`, `got: ${slot.display}`);
  assert(slot.leadDisplay.includes(melbourneTime), `slot.leadDisplay shows Melbourne time (${melbourneTime})`, `got: ${slot.leadDisplay}`);

  // ── Step 3: Send slot to quick-pick-message (same as frontend) ──
  console.log('\n3. Calling quick-pick-message with real slot...');
  const qpRes = await fetch(`${BASE_URL}/api/calendar/quick-pick-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': CLIENT_ID },
    body: JSON.stringify({
      selectedSlots: [slot],
      context: {
        yourName: 'Guy Wilson',
        yourTimezone: avail.yourTimezone,
        leadName: 'Ray Keefe',
        leadLocation: LEAD_LOCATION,
        leadTimezone: avail.leadTimezone,
        yourZoom: 'https://zoom.us/j/123',
      },
    }),
  });
  const qp = await qpRes.json();
  assert(qpRes.ok, 'quick-pick-message returns 200', `got: ${qpRes.status}`);

  const msg = qp.message || '';

  // The message must show Melbourne time, not Brisbane time
  assert(msg.includes(melbourneTime), `message contains Melbourne time (${melbourneTime})`, `message: ${msg.substring(0, 300)}`);
  assert(!msg.includes(brisbaneTime + ' (Melbourne)'), `message does NOT show Brisbane time labeled as Melbourne`, `message: ${msg.substring(0, 300)}`);

  // The message should include (Melbourne) label since timezones differ during AEDT
  const brisOffset = getOffsetMinutes('Australia/Brisbane');
  const melbOffset = getOffsetMinutes('Australia/Melbourne');
  if (brisOffset !== melbOffset) {
    assert(msg.includes('(Melbourne)'), 'message includes (Melbourne) label when offsets differ');
  } else {
    assert(!msg.includes('(Melbourne)'), 'message omits timezone label when offsets are same (winter)');
  }

  // ── Summary ──
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0;
}

function getOffsetMinutes(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
  const m = (parts.find(p => p.type === 'timeZoneName')?.value || '').match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  return (m[1] === '+' ? 1 : -1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
}

runTests()
  .then(ok => process.exit(ok ? 0 : 1))
  .catch(err => {
    console.error('Test error:', err.message);
    process.exit(1);
  });
