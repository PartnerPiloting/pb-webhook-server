/**
 * Corporate Captives outreach — local test harness (no deploy).
 *
 *   npm run test:cc-outreach
 *
 * Unit tests: pure logic, mocked Airtable records, no network.
 * Optional live smoke (hits Airtable + HTML builder):
 *   CC_OUTREACH_LIVE=1 npm run test:cc-outreach
 */
require("dotenv").config();

const assert = require("assert");
const { DateTime } = require("luxon");

const {
  F,
  notesEffectivelyEmpty,
  leadPassesFilters,
  applyTemplate,
  pickRandomSubject,
  parseDateScoredBrisbane,
  emailLooksValid,
  numOrNull,
  buildSortedEligible,
  buildPreviewRows,
  buildDryRunPreviewHtml,
} = require("../services/corporateCaptivesOutreachService.js");

function mockRecord(id, fields) {
  return {
    id,
    get: (k) => fields[k],
  };
}

function brisbaneDay(isoDate) {
  return DateTime.fromISO(isoDate, { zone: "Australia/Brisbane" }).startOf("day");
}

function runUnitTests() {
  console.log("— Unit tests (offline) —\n");

  assert.strictEqual(notesEffectivelyEmpty(undefined), true);
  assert.strictEqual(notesEffectivelyEmpty(""), true);
  assert.strictEqual(notesEffectivelyEmpty("   "), true);
  assert.strictEqual(notesEffectivelyEmpty("."), true);
  assert.strictEqual(notesEffectivelyEmpty("hello"), false);

  assert.strictEqual(emailLooksValid("a@b.co"), true);
  assert.strictEqual(emailLooksValid("bad"), false);
  assert.strictEqual(emailLooksValid(""), false);

  assert.strictEqual(numOrNull(""), null);
  assert.strictEqual(numOrNull(0), 0);
  assert.strictEqual(numOrNull("12.5"), 12.5);

  const ds = parseDateScoredBrisbane("2025-01-15");
  assert.ok(ds && ds.toISODate() === "2025-01-15");

  const cutoff = brisbaneDay("2025-06-01");

  const goodFields = {
    [F.scoringStatus]: "Scored",
    [F.notes]: "",
    [F.email]: "x@example.com",
    [F.firstName]: "Sam",
    [F.score]: 10,
    [F.scoreOrder]: 100,
    [F.dateScored]: "2024-01-01",
  };
  const good = leadPassesFilters(mockRecord("recGOOD", goodFields), cutoff);
  assert.strictEqual(good.ok, true, good.reason);

  const badScore0 = leadPassesFilters(
    mockRecord("rec1", { ...goodFields, [F.score]: 0 }),
    cutoff
  );
  assert.strictEqual(badScore0.ok, false);

  const badNotes = leadPassesFilters(
    mockRecord("rec2", { ...goodFields, [F.notes]: "talked" }),
    cutoff
  );
  assert.strictEqual(badNotes.ok, false);

  const badStatus = leadPassesFilters(
    mockRecord("rec3", { ...goodFields, [F.scoringStatus]: "To Be Scored" }),
    cutoff
  );
  assert.strictEqual(badStatus.ok, false);

  const tooRecent = leadPassesFilters(
    mockRecord("rec4", {
      ...goodFields,
      [F.dateScored]: DateTime.now().setZone("Australia/Brisbane").toISODate(),
    }),
    cutoff
  );
  assert.strictEqual(tooRecent.ok, false);

  const r1 = mockRecord("a", { ...goodFields, [F.scoreOrder]: 10 });
  const r2 = mockRecord("b", { ...goodFields, [F.scoreOrder]: 99 });
  const r3 = mockRecord("c", { ...goodFields, [F.scoreOrder]: 50 });
  const { eligible } = buildSortedEligible([r1, r2, r3], cutoff);
  assert.deepStrictEqual(
    eligible.map((r) => r.id),
    ["b", "c", "a"]
  );

  assert.strictEqual(applyTemplate("Hi {{FirstName}}!", "Pat"), "Hi Pat!");

  const settingsFields = {
    [F.subject1]: "A",
    [F.subject2]: "B",
    [F.subject3]: "",
  };
  const origRandom = Math.random;
  try {
    Math.random = () => 0;
    assert.strictEqual(pickRandomSubject(settingsFields), "A");
    Math.random = () => 0.99;
    assert.ok(["A", "B"].includes(pickRandomSubject(settingsFields)));
  } finally {
    Math.random = origRandom;
  }

  const prev = buildPreviewRows(
    [mockRecord("recX", goodFields)],
    { fields: { ...settingsFields, [F.body]: "<p>Hi {{FirstName}}</p>" } },
    1
  );
  assert.strictEqual(prev.length, 1);
  assert.ok(prev[0].html.includes("Hi Sam"));

  console.log("All unit checks passed.\n");
}

async function runLiveSmoke() {
  if (process.env.CC_OUTREACH_LIVE !== "1") {
    console.log(
      "Skip live smoke (set CC_OUTREACH_LIVE=1 to call Airtable + preview HTML).\n"
    );
    return;
  }
  console.log("— Live smoke (Airtable) —\n");
  const html = await buildDryRunPreviewHtml({
    clientId: process.env.CC_OUTREACH_CLIENT_ID || "Guy-Wilson",
    limitOverride: 2,
  });
  assert.ok(typeof html === "string" && html.length > 200);
  assert.ok(html.includes("Corporate Captives"));
  console.log(`Live smoke OK (${html.length} chars HTML).\n`);
}

async function main() {
  runUnitTests();
  await runLiveSmoke();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
