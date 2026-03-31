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
  classifyOutreachBodyVariant,
  inferOutreachBodyVariant,
  pickBodyTemplate,
  applyOutreachBodyTemplate,
} = require("../services/corporateCaptivesOutreachService.js");

function mockRecord(id, fields, opts = {}) {
  const createdTime = opts.createdTime ?? "2018-01-01T00:00:00.000Z";
  return {
    id,
    _rawJson: { createdTime },
    get: (k) => fields[k],
  };
}

async function runUnitTests() {
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

  const noExtraGates = {
    minOutboundScoreFloor: null,
    minDaysSinceCreated: null,
  };

  const goodFields = {
    [F.scoringStatus]: "Scored",
    [F.notes]: "",
    [F.email]: "x@example.com",
    [F.firstName]: "Sam",
    [F.score]: 10,
    [F.dateScored]: "2024-01-01",
  };
  const good = leadPassesFilters(mockRecord("recGOOD", goodFields), noExtraGates);
  assert.strictEqual(good.ok, true, good.reason);

  const badScore0 = leadPassesFilters(
    mockRecord("rec1", { ...goodFields, [F.score]: 0 }),
    noExtraGates
  );
  assert.strictEqual(badScore0.ok, false);

  const badNotes = leadPassesFilters(
    mockRecord("rec2", { ...goodFields, [F.notes]: "talked" }),
    noExtraGates
  );
  assert.strictEqual(badNotes.ok, false);

  const badStatus = leadPassesFilters(
    mockRecord("rec3", { ...goodFields, [F.scoringStatus]: "To Be Scored" }),
    noExtraGates
  );
  assert.strictEqual(badStatus.ok, false);

  const tooRecentCreated = leadPassesFilters(
    mockRecord(
      "rec4",
      goodFields,
      { createdTime: DateTime.now().toUTC().toISO() }
    ),
    { minOutboundScoreFloor: null, minDaysSinceCreated: 60 }
  );
  assert.strictEqual(tooRecentCreated.ok, false);

  const belowMinScore = leadPassesFilters(mockRecord("rec5", { ...goodFields, [F.score]: 7 }), {
    minOutboundScoreFloor: 7,
    minDaysSinceCreated: null,
  });
  assert.strictEqual(belowMinScore.ok, false);

  const atMinScorePlus = leadPassesFilters(mockRecord("rec6", { ...goodFields, [F.score]: 8 }), {
    minOutboundScoreFloor: 7,
    minDaysSinceCreated: null,
  });
  assert.strictEqual(atMinScorePlus.ok, true, atMinScorePlus.reason);

  const r1 = mockRecord("a", { ...goodFields, [F.score]: 10 });
  const r2 = mockRecord("b", { ...goodFields, [F.score]: 99 });
  const r3 = mockRecord("c", { ...goodFields, [F.score]: 50 });
  const { eligible } = buildSortedEligible([r1, r2, r3], noExtraGates);
  assert.deepStrictEqual(
    eligible.map((r) => r.id),
    ["b", "c", "a"]
  );

  assert.strictEqual(applyTemplate("Hi {{FirstName}}!", "Pat"), "Hi Pat!");

  assert.ok(
    applyOutreachBodyTemplate(
      '<a href="{{GuestBookingLink}}">book</a>',
      "Pat",
      "https://x.example/guest-book?t=abc"
    ).includes("https://x.example/guest-book?t=abc")
  );
  assert.ok(
    applyOutreachBodyTemplate("Hi {{FirstName}} link {{GuestBookingLink}}", "Pat", null).includes(
      "Pat"
    )
  );
  assert.ok(
    applyOutreachBodyTemplate("x {{GuestBookingLink}}", "A", null).includes(
      "Guest booking link not generated"
    )
  );

  assert.strictEqual(
    applyOutreachBodyTemplate('"\n\nHi {{FirstName}}\n\n"', "Pat", null, null),
    "\nHi Pat\n"
  );
  assert.strictEqual(
    applyOutreachBodyTemplate('"\r\n\r\nHi {{FirstName}}\r\n\r\n"', "Pat", null, null),
    "\nHi Pat\n"
  );

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

  const prev = await buildPreviewRows(
    [mockRecord("recX", goodFields)],
    { fields: { ...settingsFields, [F.body]: "<p>Hi {{FirstName}}</p>" } },
    1
  );
  assert.strictEqual(prev.length, 1);
  assert.ok(prev[0].html.includes("Hi Sam"));

  assert.strictEqual(classifyOutreachBodyVariant(""), "default");
  assert.strictEqual(inferOutreachBodyVariant(""), "employee");
  assert.strictEqual(
    classifyOutreachBodyVariant(JSON.stringify({ headline: "Founder at Acme" })),
    "owner"
  );
  assert.strictEqual(
    inferOutreachBodyVariant(JSON.stringify({ headline: "Founder at Acme" })),
    "owner"
  );
  assert.strictEqual(
    classifyOutreachBodyVariant(
      JSON.stringify({ headline: "VP Sales at BigCorp Inc" })
    ),
    "employee"
  );

  assert.strictEqual(
    pickBodyTemplate(
      { [F.body]: "DEFAULT", [F.bodyOwner]: "OWNER", [F.bodyEmployee]: "EMP" },
      "default"
    ),
    "DEFAULT"
  );

  const dual = pickBodyTemplate(
    {
      [F.body]: "DEFAULT",
      [F.bodyOwner]: "OWNER",
      [F.bodyEmployee]: "EMP",
    },
    "owner"
  );
  assert.strictEqual(dual, "OWNER");
  assert.strictEqual(
    pickBodyTemplate(
      { [F.body]: "DEFAULT", [F.bodyOwner]: "", [F.bodyEmployee]: "EMP" },
      "owner"
    ),
    "DEFAULT"
  );

  const founderFields = {
    ...goodFields,
    [F.rawProfile]: JSON.stringify({ headline: "Co-founder | SaaS" }),
  };
  const prevOwner = await buildPreviewRows(
    [mockRecord("recFounder", founderFields)],
    {
      fields: {
        ...settingsFields,
        [F.body]: "<p>Default {{FirstName}}</p>",
        [F.bodyOwner]: "<p>Owner {{FirstName}}</p>",
        [F.bodyEmployee]: "<p>Emp {{FirstName}}</p>",
      },
    },
    1
  );
  assert.strictEqual(prevOwner[0].variant, "owner");
  assert.ok(prevOwner[0].html.includes("Owner Sam"));

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
  await runUnitTests();
  await runLiveSmoke();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
