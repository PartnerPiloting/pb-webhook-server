/**
 * READ-ONLY blast-radius scan for the LinkedIn substring-dedup bug (Bognar/Byrne, 2026-07-28).
 *
 * The old dedup used Airtable SEARCH() (containment), so any lead whose canonical slug is a
 * substring of another lead's slug could have been mis-deduped: a create refused, fields written
 * onto the wrong record, or outreach logged against the wrong person. This scan lists, per client
 * base, every pair of leads where one canonical slug is contained in another (prefix pairs are the
 * ones the create path could actually hit), plus groups of records whose slugs are IDENTICAL
 * (variant-spelling duplicates the exact-match paths missed).
 *
 * It changes NOTHING. Output is a human-readable report on stdout for Guy to review.
 *
 * Run (Render one-off job): node scripts/scan-linkedin-slug-collisions.js
 * Optionally limit to one base: node scripts/scan-linkedin-slug-collisions.js appXySOLo6V9PfMfa
 */
const clientService = require('../services/clientService');
const { canonicalLinkedinSlug } = require('../utils/linkedinCanonical');

// Above this many distinct slugs the O(n²) containment pass gets slow, so we fall back to the
// sorted-prefix pass only — and SAY SO, since a silent cap would read as full coverage.
const SUBSTRING_PASS_LIMIT = 15000;

async function fetchLeads(base) {
  const rows = [];
  await base('Leads').select({
    fields: ['LinkedIn Profile URL', 'First Name', 'Last Name', 'Date Created', 'Date Connected'],
    pageSize: 100,
  }).eachPage((records, next) => {
    for (const r of records) {
      const f = r.fields || {};
      rows.push({
        id: r.id,
        name: `${f['First Name'] || ''} ${f['Last Name'] || ''}`.trim() || '(no name)',
        url: f['LinkedIn Profile URL'] || '',
        slug: canonicalLinkedinSlug(f['LinkedIn Profile URL']),
      });
    }
    next();
  });
  return rows;
}

function scanBase(rows) {
  const bySlug = new Map();
  for (const row of rows) {
    if (!row.slug) continue; // blank URLs can't collide with anything
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, []);
    bySlug.get(row.slug).push(row);
  }
  const slugs = [...bySlug.keys()].sort();

  // Same canonical slug on 2+ records = variant-spelling duplicates of one person.
  const sameSlugGroups = [...bySlug.values()].filter((g) => g.length > 1);

  // One slug contained in another = the pairs SEARCH() could confuse. Sorted-prefix pass first
  // (a prefix sorts immediately before its extensions), then a full containment pass when small.
  const pairs = new Map(); // "a|b" -> {shorter, longer, kind}
  const addPair = (a, b, kind) => {
    const key = `${a}|${b}`;
    if (!pairs.has(key)) pairs.set(key, { shorter: a, longer: b, kind });
  };
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length && slugs[j].startsWith(slugs[i]); j++) {
      addPair(slugs[i], slugs[j], 'prefix');
    }
  }
  let substringPassRan = false;
  if (slugs.length <= SUBSTRING_PASS_LIMIT) {
    substringPassRan = true;
    for (let i = 0; i < slugs.length; i++) {
      const a = slugs[i];
      for (let j = 0; j < slugs.length; j++) {
        if (i === j) continue;
        const b = slugs[j];
        if (b.length > a.length && b.includes(a)) addPair(a, b, b.startsWith(a) ? 'prefix' : 'substring');
      }
    }
  }
  return { bySlug, sameSlugGroups, pairs: [...pairs.values()], substringPassRan, slugCount: slugs.length, blankCount: rows.length - rows.filter((r) => r.slug).length };
}

(async () => {
  const onlyBase = process.argv[2] || '';
  const clients = await clientService.getAllClients();
  const targets = clients.filter((c) => c.airtableBaseId && (!onlyBase || c.airtableBaseId === onlyBase));
  console.log(`\n=== LinkedIn slug collision scan — ${targets.length} client base(s), read-only ===`);

  let totalPairs = 0;
  let totalDupGroups = 0;
  for (const client of targets) {
    const label = `${client.clientName || client.clientId} (${client.airtableBaseId})`;
    let rows;
    try {
      const base = clientService.getClientBase(client.airtableBaseId);
      if (!base) { console.log(`\n--- ${label}: base unavailable, skipped`); continue; }
      rows = await fetchLeads(base);
    } catch (e) {
      console.log(`\n--- ${label}: FAILED to read (${e.message}) — not scanned`);
      continue;
    }
    const { bySlug, sameSlugGroups, pairs, substringPassRan, slugCount, blankCount } = scanBase(rows);
    console.log(`\n--- ${label}: ${rows.length} leads, ${slugCount} distinct slugs, ${blankCount} blank URLs`);
    if (!substringPassRan) console.log(`    NOTE: >${SUBSTRING_PASS_LIMIT} slugs — only the PREFIX pass ran; mid-string containment not checked here.`);

    if (!pairs.length && !sameSlugGroups.length) { console.log('    clean — no collision candidates'); continue; }

    for (const p of pairs) {
      totalPairs++;
      console.log(`    COLLISION-CANDIDATE (${p.kind}): "${p.shorter}" ⊂ "${p.longer}"`);
      for (const side of [p.shorter, p.longer]) {
        for (const rec of bySlug.get(side)) console.log(`        ${rec.id}  ${rec.name}  ${rec.url}`);
      }
    }
    for (const g of sameSlugGroups) {
      totalDupGroups++;
      console.log(`    SAME-SLUG DUPLICATES ("${g[0].slug}"):`);
      for (const rec of g) console.log(`        ${rec.id}  ${rec.name}  ${rec.url}`);
    }
  }
  console.log(`\n=== Done: ${totalPairs} containment pair(s), ${totalDupGroups} same-slug duplicate group(s) across ${targets.length} base(s). Nothing was modified. ===`);
  process.exit(0);
})().catch((e) => { console.error('SCAN FAILED:', e); process.exit(1); });
