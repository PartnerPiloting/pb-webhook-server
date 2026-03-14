/**
 * Integration test: Quick Pick timezone conversion
 * Calls the quick-pick-message endpoint and verifies timezone conversion.
 *
 * Run: BASE_URL=https://pb-webhook-server.onrender.com CLIENT_ID=Guy-Wilson node tests/quick-pick-integration.test.js
 * Or:  BASE_URL=http://localhost:3001 CLIENT_ID=Guy-Wilson node tests/quick-pick-integration.test.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CLIENT_ID = process.env.CLIENT_ID || 'Guy-Wilson';

async function runIntegrationTest() {
  const selectedSlots = [
    { time: '2025-03-27T15:30:00', display: '3:30 pm', leadDisplay: 'Fri, 27 Mar, 4:30 pm' },
  ];
  const context = {
    yourName: 'Guy Wilson',
    yourTimezone: 'Australia/Brisbane',
    leadName: 'Test Lead',
    leadLocation: 'Dandenong South, Victoria, Australia',
    yourZoom: 'https://zoom.us/j/123',
  };

  const url = `${BASE_URL}/api/calendar/quick-pick-message`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': CLIENT_ID,
    },
    body: JSON.stringify({ selectedSlots, context }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('FAIL: Request failed', res.status, data);
    return false;
  }

  const message = data.message || '';
  const has430pm = message.includes('4:30 pm') || message.includes('4:30pm');
  const has330pmMelb = /3:30\s*pm\s*\(Melbourne\)/i.test(message);

  if (has430pm && !has330pmMelb) {
    console.log('PASS: Message shows 4:30 pm (Melbourne) - correct conversion from 3:30pm Brisbane');
    return true;
  }
  if (has330pmMelb) {
    console.error('FAIL: Message shows 3:30 pm (Melbourne) - conversion failed (should be 4:30 pm)');
    console.error('Message excerpt:', message.substring(0, 500));
    return false;
  }
  console.error('FAIL: Could not verify conversion. Message:', message.substring(0, 500));
  return false;
}

runIntegrationTest()
  .then(ok => process.exit(ok ? 0 : 1))
  .catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
  });
