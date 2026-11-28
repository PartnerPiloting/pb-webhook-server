// Bring your connections in from a search - step 1, the server end (docs/CONNECTIONS-SEARCH-BUILD-PLAN.md).
// Run: node tests/connection-searches.test.js
process.env.CONNECTION_SEARCH_CLIENTS = 'Guy-Wilson';

const assert = require('assert');
const { checkSearchUrl, ownConnectionsCheck, degreeObjection } = require('../utils/linkedinSearchUrl');
const cs = require('../services/connectionSearches');

let failed = 0;
const results = [];
const check = async (label, fn) => {
  try { await fn(); results.push(`  ✓ ${label}`); }
  catch (e) { failed++; results.push(`  ✗ ${label}: ${e.message}`); }
};

const LI = 'https://www.linkedin.com/search/results/people/';
const li = (q) => `${LI}?${q}&origin=FACETED_SEARCH`;
const F = 'network=%5B%22F%22%5D';
const FS = 'network=%5B%22F%22%2C%22S%22%5D';
const SN = (filters) => `https://www.linkedin.com/sales/search/people?query=(filters%3AList(${filters}))&sessionId=abc`;
const SN_REL_1 = '(type%3ARELATIONSHIP%2Cvalues%3AList((id%3AF%2Ctext%3A1st%2520Degree%2520Connections%2CselectionType%3AINCLUDED)))';
const SN_REL_12 = '(type%3ARELATIONSHIP%2Cvalues%3AList((id%3AF%2CselectionType%3AINCLUDED)%2C(id%3AS%2CselectionType%3AINCLUDED)))';
const SN_REGION = '(type%3AREGION%2Cvalues%3AList((id%3A105606446%2Ctext%3AMelbourne%2CselectionType%3AINCLUDED)))';

// A fake Postgres: remembers inserts, answers the reads the code makes.
function fakePool() {
  const searches = [];
  const people = [];
  return {
    searches, people,
    async query(sql, params = []) {
      if (/UPDATE connection_searches SET reason/.test(sql)) {
        const hit = searches.find((x) => x.client_id === params[0] && x.url === params[1] && x.status === 'waiting');
        if (!hit) return { rowCount: 0, rows: [] };
        hit.reason = params[2]; hit.share_link = params[3];
        return { rowCount: 1, rows: [{ search_id: hit.search_id }] };
      }
      if (/INSERT INTO connection_searches/.test(sql)) {
        const [search_id, client_id, url, url_kind, reason, share_link, requested_by] = params;
        searches.push({ search_id, client_id, url, url_kind, reason, share_link, requested_by, status: 'waiting', created_at: new Date() });
        return { rowCount: 1, rows: [] };
      }
      if (/INSERT INTO connection_search_people/.test(sql)) {
        const [client_id, search_id, slugs] = params; let n = 0;
        if (!searches.some((x) => x.search_id === search_id && x.client_id === client_id)) return { rowCount: 0, rows: [] };
        for (const slug of slugs) if (!people.some((p) => p.client_id === client_id && p.slug === slug)) { people.push({ client_id, slug, search_id }); n++; }
        return { rowCount: n, rows: [] };
      }
      if (/FROM connection_search_people p/.test(sql)) {
        const p = people.find((x) => x.client_id === params[0] && x.slug === params[1]);
        const s = p && searches.find((x) => x.search_id === p.search_id && x.client_id === p.client_id);
        return { rows: s ? [{ search_id: s.search_id, reason: s.reason, share_link: s.share_link }] : [] };
      }
      if (/SELECT \* FROM connection_searches/.test(sql)) {
        return { rows: searches.filter((s) => s.client_id === params[0]).reverse() };
      }
      if (/DELETE FROM connection_search_people/.test(sql)) { const n = people.length; people.length = 0; return { rowCount: n }; }
      if (/DELETE FROM connection_searches/.test(sql)) { const n = searches.length; searches.length = 0; return { rowCount: n }; }
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    },
  };
}
const noAssets = { getAssets: async () => [], findRetiredUrls: () => [] };
const GUY = { clientId: 'Guy-Wilson', clientName: 'Guy Wilson' };
const STEVE = { clientId: 'Steve-Nelson', clientName: 'Steve Nelson' };

(async () => {
  console.log('which searches count as "your own connections"');
  await check('LinkedIn: 1st only + a keyword = own', () => assert.ok(ownConnectionsCheck(checkSearchUrl(li(`${F}&keywords=CEO`))).own));
  await check('LinkedIn: 1st only + a location = own', () => assert.ok(ownConnectionsCheck(checkSearchUrl(li(`${F}&geoUrn=%5B%22100992797%22%5D`))).own));
  await check('LinkedIn: 1st only and nothing else = too broad', () => {
    const r = ownConnectionsCheck(checkSearchUrl(li(F)));
    assert.ok(!r.own && /all of your 1st-degree/.test(r.problem), JSON.stringify(r));
  });
  await check('LinkedIn: an empty keywords box does not count as narrowing', () => assert.ok(!ownConnectionsCheck(checkSearchUrl(li(`${F}&keywords=`))).own));
  await check('LinkedIn: 1st + 2nd mixed = split it', () => {
    const r = ownConnectionsCheck(checkSearchUrl(li(`${FS}&keywords=CEO`)));
    assert.ok(!r.own && /Split it into two/.test(r.problem), JSON.stringify(r));
  });
  await check('LinkedIn: 2nd only = not about own connections, no complaint (a normal top-up)', () => {
    const r = ownConnectionsCheck(checkSearchUrl(li('network=%5B%22S%22%5D&keywords=CEO')));
    assert.deepStrictEqual(r, { own: false, problem: null });
  });
  await check('Sales Navigator: 1st + a region = own', () => assert.ok(ownConnectionsCheck(checkSearchUrl(SN(`${SN_REL_1}%2C${SN_REGION}`))).own));
  await check('Sales Navigator: 1st and nothing else = too broad', () => assert.ok(/all of your 1st-degree/.test(ownConnectionsCheck(checkSearchUrl(SN(SN_REL_1))).problem || '')));
  await check('Sales Navigator: 1st + 2nd = split it', () => assert.ok(/Split it/.test(ownConnectionsCheck(checkSearchUrl(SN(`${SN_REL_12}%2C${SN_REGION}`))).problem || '')));
  await check('the old top-up objection still stands for anyone without the feature', () => assert.ok(degreeObjection(checkSearchUrl(li(`${F}&keywords=CEO`)))));

  const SN_REL_F_EXCL = '(type%3ARELATIONSHIP%2Cvalues%3AList((id%3AF%2CselectionType%3AEXCLUDED)))';
  const SN_REL_F_IN_S_EX = '(type%3ARELATIONSHIP%2Cvalues%3AList((id%3AF%2CselectionType%3AINCLUDED)%2C(id%3AS%2CselectionType%3AEXCLUDED)))';
  const SN_REL_F_A = '(type%3ARELATIONSHIP%2Cvalues%3AList((id%3AF%2CselectionType%3AINCLUDED)%2C(id%3AA%2CselectionType%3AINCLUDED)))';
  await check('Sales Navigator: 1st EXCLUDED is not "own connections"', () => assert.ok(!ownConnectionsCheck(checkSearchUrl(SN(`${SN_REL_F_EXCL}%2C${SN_REGION}`))).own));
  await check('Sales Navigator: 1st included, 2nd excluded = own (not "mixed")', () => assert.ok(ownConnectionsCheck(checkSearchUrl(SN(`${SN_REL_F_IN_S_EX}%2C${SN_REGION}`))).own));
  await check('Sales Navigator: 1st + group members = mixed, not own', () => assert.ok(/Split it/.test(ownConnectionsCheck(checkSearchUrl(SN(`${SN_REL_F_A}%2C${SN_REGION}`))).problem || '')));
  await check('Sales Navigator: a saved search with no visible filters = told how to copy it properly', () => {
    const r = ownConnectionsCheck(checkSearchUrl('https://www.linkedin.com/sales/search/people?savedSearchId=123&sessionId=x'));
    assert.ok(!r.own && /saved Sales Navigator search/.test(r.problem || ''), JSON.stringify(r));
  });
  await check('LinkedIn: "connections of" someone counts as narrowed', () => assert.ok(ownConnectionsCheck(checkSearchUrl(li(`${F}&connectionOf=%5B%22ACoAAA%22%5D`))).own));
  await check('LinkedIn: a free-text school counts as narrowed', () => assert.ok(ownConnectionsCheck(checkSearchUrl(li(`${F}&schoolFreetext=Monash`))).own));
  await check('LinkedIn: a %3F inside an earlier value does not cut the query short', () => assert.ok(ownConnectionsCheck(checkSearchUrl(`${LI}?origin=x%3Fy&${F}&keywords=ceo`)).own));
  await check('top-up degrees: Sales Navigator 1st EXCLUDED + 2nd is a valid top-up (no 1st-degree objection)', () => assert.strictEqual(degreeObjection(checkSearchUrl(SN('(type%3ARELATIONSHIP%2Cvalues%3AList((id%3AF%2CselectionType%3AEXCLUDED)%2C(id%3AS%2CselectionType%3AINCLUDED)))'))), null));

  console.log('the reason and the share link');
  await check('no reason = asked for one, with an example', () => assert.ok(/Why are you reaching out/.test(cs.cleanReason('').problem)));
  await check('a two-word reason = say more', () => assert.ok(cs.cleanReason('ceos').problem));
  await check('a real reason is kept, tidied', () => assert.strictEqual(cs.cleanReason('  CEOs I\'d like to tell   about our programme ').reason, 'CEOs I\'d like to tell about our programme'));
  await check('no share link is fine', async () => assert.deepStrictEqual(await cs.cleanShareLink('', 'Guy-Wilson', noAssets), { link: null }));
  await check('a bare address gets https', async () => assert.strictEqual((await cs.cleanShareLink('24hbp.com.au/leaders', 'Guy-Wilson', noAssets)).link, 'https://24hbp.com.au/leaders'));
  await check('a LinkedIn search pasted as the share link is refused', async () => assert.ok((await cs.cleanShareLink(li(`${F}&keywords=CEO`), 'Guy-Wilson', noAssets)).problem));
  await check('a retired asset address is refused', async () => {
    const r = await cs.cleanShareLink('https://old.example.com/page', 'Guy-Wilson', { getAssets: async () => [], findRetiredUrls: () => [{ assetKey: 'retired_old_page', url: 'https://old.example.com/page' }] });
    assert.ok(/retired/.test(r.problem || ''), JSON.stringify(r));
  });
  await check('an asset library that cannot be reached never blocks the search', async () => {
    const r = await cs.cleanShareLink('https://ok.example.com', 'Guy-Wilson', { getAssets: async () => { throw new Error('db down'); } });
    assert.strictEqual(r.link, 'https://ok.example.com');
  });

  console.log('saving a search (requestSearch)');
  const pool = fakePool();
  const deps = { pool, ...noAssets };
  const good = li(`${F}&keywords=CEO&geoUrn=%5B%22100992797%22%5D`);
  await check('switched off for a client not on the list - nothing saved', async () => {
    const r = await cs.requestSearch({ client: STEVE, url: good, reason: 'CEOs for the programme' }, { deps });
    assert.ok(!r.ok && /not switched on/.test(r.text) && pool.searches.length === 0, r.text);
  });
  await check('no reason = a question back, nothing saved', async () => {
    const r = await cs.requestSearch({ client: GUY, url: good, reason: '' }, { deps });
    assert.ok(!r.ok && r.needsReason && pool.searches.length === 0);
  });
  await check('a top-up search (2nd/3rd) pointed back to the campaign', async () => {
    const r = await cs.requestSearch({ client: GUY, url: li('network=%5B%22S%22%5D&keywords=CEO'), reason: 'CEOs for the programme' }, { deps });
    assert.ok(!r.ok && /top up my campaign/.test(r.text), r.text);
  });
  await check('a lead list is refused with the reason why', async () => {
    const r = await cs.requestSearch({ client: GUY, url: 'https://www.linkedin.com/sales/lists/people/123', reason: 'CEOs for the programme' }, { deps });
    assert.ok(!r.ok && /lead list/.test(r.text), r.text);
  });
  let firstId;
  await check('a good search is saved with its reason and link, and the words promise no message', async () => {
    const r = await cs.requestSearch({ client: GUY, url: good, reason: 'CEOs I\'d like to tell about the programme', shareLink: 'https://example.com/p', requestedBy: 'test' }, { deps });
    assert.ok(r.ok && r.searchId, r.text);
    firstId = r.searchId;
    assert.strictEqual(pool.searches.length, 1);
    assert.strictEqual(pool.searches[0].share_link, 'https://example.com/p');
    assert.ok(/never invites or messages/.test(r.text) && /never in the first message/.test(r.text) && /start with those/.test(r.text), r.text);
  });
  await check('a second, different search is KEPT beside the first - searches never replace each other', async () => {
    const r = await cs.requestSearch({ client: GUY, url: li(`${F}&keywords=accountant`), reason: 'Accountants who could refer clients to me' }, { deps });
    assert.ok(r.ok && /^Saved\./.test(r.text), r.text);
    assert.strictEqual(pool.searches.filter((x) => x.status === 'waiting').length, 2);
    assert.strictEqual((await cs.listFor('Guy-Wilson', { deps })).length, 2);
  });
  await check('the same search sent again while waiting updates it - no second copy', async () => {
    const r = await cs.requestSearch({ client: GUY, url: good, reason: 'Melbourne CEOs for the programme', shareLink: 'https://example.com/new' }, { deps });
    assert.ok(r.ok && /^Updated/.test(r.text) && r.searchId === firstId, r.text);
    assert.strictEqual(pool.searches.length, 2);
    assert.strictEqual(pool.searches.find((x) => x.search_id === firstId).share_link, 'https://example.com/new');
  });

  console.log('one person, one row');
  await check('people recorded against a search; the same person in a later search keeps the FIRST reason', async () => {
    const [a, b] = pool.searches;
    await cs.recordPeople('Guy-Wilson', a.search_id, ['https://www.linkedin.com/in/priya-p/', 'sam-k'], { deps });
    const r = await cs.recordPeople('Guy-Wilson', b.search_id, ['priya-p', 'new-person'], { deps });
    assert.strictEqual(r.added, 1);
    const why = await cs.reasonFor('Guy-Wilson', 'linkedin.com/in/priya-p', { deps });
    assert.strictEqual(why.reason, a.reason);
  });
  await check('a search id from another client adds nobody (tenant guard)', async () => {
    const r = await cs.recordPeople('Steve-Nelson', pool.searches[0].search_id, ['someone'], { deps });
    assert.strictEqual(r.added, 0);
    assert.strictEqual(await cs.reasonFor('Steve-Nelson', 'someone', { deps }), null);
  });
  await check('nobody from a search = no reason (never a throw)', async () => assert.strictEqual(await cs.reasonFor('Guy-Wilson', 'stranger', { deps }), null));
  await check('offboarding removes the searches and the people', async () => {
    const r = await cs.forgetClient('Guy-Wilson', { deps });
    assert.ok(r.ok && r.count > 0 && !pool.searches.length && !pool.people.length);
  });

  console.log('the top-up door points own-connection searches here');
  await check('a gated client pasting a 1st-only narrowed search into a top-up is told where it goes', async () => {
    const r = await require('../services/lhTopUp').requestTopUp({ client: GUY, url: good });
    assert.ok(!r.ok && r.ownConnections && /bring these connections into Wingguy/.test(r.text), r.text);
  });
  await check('a client without it still gets the old objection', async () => {
    const r = await require('../services/lhTopUp').requestTopUp({ client: STEVE, url: good });
    assert.ok(!r.ok && !r.ownConnections && /Untick 1st/.test(r.text), r.text);
  });

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
