// Read-only check for the new wingguy_list_events tool. Exercises the FULL tool path (executor +
// formatting) against a real tenant's real calendar, through the provider seam.
//   node scripts/wingguy-list-events-check.js [clientId]
// Defaults to Guy-Wilson (google read path). Safe: lists only, never writes.
require('dotenv').config();
const booking = require('./../services/wingguyBookingMcp');

const tenant = process.argv[2] || 'Guy-Wilson';

(async () => {
  console.log(`tenant = ${tenant}\n`);
  for (const args of [{ range: 'today' }, { range: 'tomorrow' }, { range: 'this_week' }]) {
    console.log(`=== wingguy_list_events ${JSON.stringify(args)} ===`);
    const r = await booking.legacyToolCall('wingguy_list_events', args, tenant);
    if (!r) { console.log('!! tool not found (not registered?)'); continue; }
    console.log(r.content && r.content[0] && r.content[0].text);
    console.log(`[isError: ${!!r.isError}]\n`);
  }
  console.log('=== DONE ===');
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
