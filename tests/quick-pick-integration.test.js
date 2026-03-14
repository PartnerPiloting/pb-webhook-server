/**
 * Integration test: Quick Pick timezone conversion
 * Calls the quick-pick-message endpoint and verifies timezone conversion.
 *
 * Run: BASE_URL=https://pb-webhook-server.onrender.com CLIENT_ID=Guy-Wilson node tests/quick-pick-integration.test.js
 * Or:  BASE_URL=http://localhost:3001 CLIENT_ID=Guy-Wilson node tests/quick-pick-integration.test.js
 *
 * Test 1: Slot with Z (UTC) - real flow from availability API. 3:30pm Brisbane = 05:30 UTC.
 * Test 2: Slot without Z - backend uses yourTimezone from Airtable to interpret as local time.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CLIENT_ID = process.env.CLIENT_ID || 'Guy-Wilson';

async function runIntegrationTest() {
  const url = `${BASE_URL}/api/calendar/quick-pick-message`;
  const context = {
    yourName: 'Guy Wilson',
    yourTimezone: 'Australia/Brisbane',
    leadName: 'Test Lead',
    leadLocation: 'Dandenong South, Victoria, Australia',
    yourZoom: 'https://zoom.us/j/123',
  };

  // Test 1: Slot with Z (UTC) - 3:30pm Brisbane = 05:30 UTC. Should show 4:30pm Melbourne.
  const res1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': CLIENT_ID },
    body: JSON.stringify({
      selectedSlots: [{ time: '2025-03-27T05:30:00.000Z', display: '3:30 pm', leadDisplay: 'Fri, 27 Mar, 4:30 pm' }],
      context,
    }),
  });
  const data1 = await res1.json();
  if (!res1.ok) {
    console.error('FAIL Test 1: Request failed', res1.status, data1);
    return false;
  }
  const msg1 = data1.message || '';
  const has430pm1 = msg1.includes('4:30 pm') || msg1.includes('4:30pm');
  const has330pm1 = /3:30\s*pm\s*\(Melbourne\)/i.test(msg1);
  if (!has430pm1 || has330pm1) {
    console.error('FAIL Test 1 (slot with Z): Expected 4:30 pm (Melbourne), got:', msg1.substring(0, 300));
    return false;
  }
  console.log('PASS Test 1: Slot with Z (UTC) -> 4:30 pm (Melbourne)');

  // Test 2: Slot without Z - backend looks up yourTimezone from Airtable. If Brisbane, 15:30 local -> 4:30pm Melbourne.
  const res2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': CLIENT_ID },
    body: JSON.stringify({
      selectedSlots: [{ time: '2025-03-27T15:30:00', display: '3:30 pm', leadDisplay: 'Fri, 27 Mar, 4:30 pm' }],
      context,
    }),
  });
  const data2 = await res2.json();
  if (!res2.ok) {
    console.error('FAIL Test 2: Request failed', res2.status, data2);
    return false;
  }
  const msg2 = data2.message || '';
  const has430pm2 = msg2.includes('4:30 pm') || msg2.includes('4:30pm');
  const has330pm2 = /3:30\s*pm\s*\(Melbourne\)/i.test(msg2);
  if (!has430pm2 || has330pm2) {
    console.error('FAIL Test 2 (slot without Z): Expected 4:30 pm (Melbourne). Your Airtable Timezone must be Australia/Brisbane. Got:', msg2.substring(0, 300));
    return false;
  }
  console.log('PASS Test 2: Slot without Z (Airtable Brisbane) -> 4:30 pm (Melbourne)');

  console.log('All integration tests passed.');
  return true;
}

runIntegrationTest()
  .then(ok => process.exit(ok ? 0 : 1))
  .catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
  });
