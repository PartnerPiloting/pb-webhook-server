/**
 * Tests for one-home client facts (services/clientFactSync.js): a setup-page save writes the
 * matching record field; timezone words only reach the record when they pin down one zone; a
 * record write goes back to the store; and the mismatch compare ignores cosmetic differences but
 * catches the Joshua case (two different Meet links). No network. ⚠ Synthetic content only.
 *
 * Run: node tests/client-fact-sync.test.js
 */
const assert = require('assert');
const sync = require('../services/clientFactSync');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};

const fakeClientService = () => {
  const writes = [];
  return { writes, updateClientRecordFields: async (id, fields) => { writes.push({ id, fields }); } };
};

(async () => {
  console.log('store -> record');
  await check('meeting room link save writes Meeting Link', async () => {
    const cs = fakeClientService();
    const r = await sync.syncStoreToRecord({ tenantId: 'Pat-Example', scope: 'asset', key: 'zoom_room', value: ' https://meet.google.com/abc-defg-hij ' }, { clientService: cs });
    assert.strictEqual(r.synced, true);
    assert.deepStrictEqual(cs.writes, [{ id: 'Pat-Example', fields: { 'Meeting Link': 'https://meet.google.com/abc-defg-hij' } }]);
  });
  await check('phone and LinkedIn map to Phone and LinkedIn URL; clearing clears', async () => {
    const cs = fakeClientService();
    await sync.syncStoreToRecord({ tenantId: 'P', scope: 'variable', key: 'owner_phone', value: '0400 000 000' }, { clientService: cs });
    await sync.syncStoreToRecord({ tenantId: 'P', scope: 'asset', key: 'owner_linkedin_profile', value: '' }, { clientService: cs });
    assert.deepStrictEqual(cs.writes.map((w) => w.fields), [{ Phone: '0400 000 000' }, { 'LinkedIn URL': null }]);
  });
  await check('timezone words become a zone on the record', async () => {
    const cs = fakeClientService();
    const r = await sync.syncStoreToRecord({ tenantId: 'P', scope: 'variable', key: 'timezone', value: 'Brisbane (AEST, no daylight saving)' }, { clientService: cs });
    assert.strictEqual(r.value, 'Australia/Brisbane');
    assert.deepStrictEqual(cs.writes[0].fields, { Timezone: 'Australia/Brisbane' });
  });
  await check('timezone that does not pin one zone leaves the record alone', async () => {
    const cs = fakeClientService();
    const r = await sync.syncStoreToRecord({ tenantId: 'P', scope: 'variable', key: 'timezone', value: 'AEST' }, { clientService: cs });
    assert.strictEqual(r.synced, false);
    assert.strictEqual(cs.writes.length, 0);
    const blank = await sync.syncStoreToRecord({ tenantId: 'P', scope: 'variable', key: 'timezone', value: '' }, { clientService: cs });
    assert.strictEqual(blank.synced, false);
    assert.strictEqual(cs.writes.length, 0);
  });
  await check('other setup keys touch nothing', async () => {
    const cs = fakeClientService();
    const r = await sync.syncStoreToRecord({ tenantId: 'P', scope: 'variable', key: 'signoff', value: 'Cheers' }, { clientService: cs });
    assert.strictEqual(r.synced, false);
    assert.strictEqual(cs.writes.length, 0);
  });
  await check('a failed record write is reported, never thrown', async () => {
    const r = await sync.syncStoreToRecord({ tenantId: 'P', scope: 'variable', key: 'owner_phone', value: '1' }, { clientService: { updateClientRecordFields: async () => { throw new Error('boom'); } } });
    assert.strictEqual(r.synced, false);
    assert.ok(/boom/.test(r.reason));
  });

  console.log('record -> store');
  await check('admin record write lands on the page keys', async () => {
    const calls = [];
    const store = { setVariable: async (a) => calls.push(['v', a.varKey, a.value]), setAsset: async (a) => calls.push(['a', a.assetKey, a.url, a.status]) };
    await sync.syncRecordToStore({ tenantId: 'P', fields: { Phone: '0400', 'LinkedIn URL': '', 'Client Name': 'x' }, actor: 't' }, { store });
    assert.deepStrictEqual(calls, [['v', 'owner_phone', '0400'], ['a', 'owner_linkedin_profile', '', 'retired']]);
  });

  console.log('compare');
  await check('the Joshua case: two different Meet links is a mismatch', async () => {
    const out = sync.compareClient({
      client: { bookingZoom: 'https://meet.google.com/aaa-bbbb-ccc', coachPhone: '0400 000 000', coachLinkedInUrl: 'https://www.linkedin.com/in/pat/', timezone: 'Australia/Sydney' },
      storeVars: [{ var_key: 'owner_phone', value: '+61 400 000 000' }, { var_key: 'timezone', value: 'Sydney' }],
      storeAssets: [{ asset_key: 'zoom_room', url: 'https://meet.google.com/ddd-eeee-fff', status: 'active' }, { asset_key: 'owner_linkedin_profile', url: 'linkedin.com/in/pat', status: 'active' }],
    });
    assert.deepStrictEqual(out.map((d) => [d.fact, d.problem]), [['Meeting Link', 'different']]);
  });
  await check('+61 0412..., +61 412... and 0412... are one number', async () => {
    assert.ok(sync.sameFact('phone', '+61 0412120548', '+61 412 120 548'));
    assert.ok(sync.sameFact('phone', '0412 120 548', '+61412120548'));
    assert.ok(!sync.sameFact('phone', '0412 120 548', '0412 120 549'));
  });
  await check('one side blank is listed; both blank is not', async () => {
    const out = sync.compareClient({
      client: { bookingZoom: 'https://zoom.us/j/1', coachPhone: '', coachLinkedInUrl: '', timezone: '' },
      storeVars: [{ var_key: 'owner_phone', value: '0400' }],
      storeAssets: [{ asset_key: 'zoom_room', url: 'https://zoom.us/j/1', status: 'retired' }],
    });
    assert.deepStrictEqual(out.map((d) => [d.fact, d.problem]), [['Meeting Link', 'blank on the setup page'], ['Phone', 'blank on the record']]);
  });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
  process.exit(failures ? 1 : 0);
})();
