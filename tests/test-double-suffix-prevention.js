// test-double-suffix-prevention.js
// Test script to verify our fix for double client suffixes in run IDs

const runIdUtils = require('./utils/runIdUtils');

// Test cases
const testCases = [
  {
    name: "Standard run ID with no suffix",
    runId: "SR-250924-001-T1234-S1",
    clientId: "Guy-Wilson",
    expectedResult: "SR-250924-001-T1234-S1-CGuy-Wilson"
  },
  {
    name: "Run ID already has suffix",
    runId: "SR-250924-001-T1234-S1-CGuy-Wilson",
    clientId: "Guy-Wilson",
    expectedResult: "SR-250924-001-T1234-S1-CGuy-Wilson" // Should not add a second suffix
  },
  {
    name: "Apify-style run ID with no suffix",
    runId: "8MSTBAfqMzuXPvgB3",
    clientId: "Guy-Wilson",
    expectedResult: "8MSTBAfqMzuXPvgB3-CGuy-Wilson"
  },
  {
    name: "Apify-style run ID with existing suffix",
    runId: "8MSTBAfqMzuXPvgB3-CGuy-Wilson",
    clientId: "Guy-Wilson",
    expectedResult: "8MSTBAfqMzuXPvgB3-CGuy-Wilson" // Should not add a second suffix
  },
  {
    name: "Run ID with wrong suffix",
    runId: "SR-250924-001-T1234-S1-CDean-Hobin",
    clientId: "Guy-Wilson",
    expectedResult: "SR-250924-001-T1234-S1-CGuy-Wilson" // Should replace with correct suffix
  },
  {
    name: "Run ID with double suffix (invalid)",
    runId: "SR-250924-001-T1234-S1-CGuy-Wilson-CGuy-Wilson",
    clientId: "Guy-Wilson",
    expectedResult: "SR-250924-001-T1234-S1-CGuy-Wilson" // Should strip to single suffix
  }
];

// Run tests
console.log("🧪 Testing runIdUtils.addClientSuffix to prevent double suffixes\n");

let allPassed = true;

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.name}`);
  console.log(`  Input: runId="${testCase.runId}", clientId="${testCase.clientId}"`);
  
  const result = runIdUtils.addClientSuffix(testCase.runId, testCase.clientId);
  console.log(`  Result: "${result}"`);
  console.log(`  Expected: "${testCase.expectedResult}"`);
  
  if (result === testCase.expectedResult) {
    console.log("  ✅ PASS\n");
  } else {
    console.log("  ❌ FAIL\n");
    allPassed = false;
  }
});

// Summary
if (allPassed) {
  console.log("✅ All tests passed - our fix for double client suffixes is working correctly!");
} else {
  console.log("❌ Some tests failed - we need to improve our implementation.");
}

// Test real-world example from the screenshot
const problematicRunId = "DWKxqfjR2334qYlWA-CGuy-Wilson-CGuy-Wilson";
console.log("\nChecking real-world problematic run ID:");
console.log(`  Input: "${problematicRunId}"`);
console.log(`  Base ID: "${runIdUtils.getBaseRunId(problematicRunId)}"`);
console.log(`  After addClientSuffix: "${runIdUtils.addClientSuffix(problematicRunId, "Guy-Wilson")}"`);