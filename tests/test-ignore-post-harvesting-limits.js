// test-ignore-post-harvesting-limits.js
// Simple test to verify IGNORE_POST_HARVESTING_LIMITS environment variable works
// Usage: IGNORE_POST_HARVESTING_LIMITS=true node test-ignore-post-harvesting-limits.js

// Mock process.env for testing
const ORIGINAL_ENV = process.env;
process.env = { 
  ...ORIGINAL_ENV,
  IGNORE_POST_HARVESTING_LIMITS: process.env.IGNORE_POST_HARVESTING_LIMITS || 'true'
};

// Constants from apifyProcessRoutes.js
const IGNORE_POST_HARVESTING_LIMITS = process.env.IGNORE_POST_HARVESTING_LIMITS === 'true';

// Test cases for while loop condition
function testPostLimits() {
  // Test scenarios
  const scenarios = [
    { postsToday: 100, postsTarget: 50, batches: 5, maxBatches: 10, expected: true, name: "Over target but under max batches" },
    { postsToday: 100, postsTarget: 50, batches: 10, maxBatches: 10, expected: false, name: "Over target and at max batches" },
    { postsToday: 30, postsTarget: 50, batches: 5, maxBatches: 10, expected: true, name: "Under target and under max batches" },
    { postsToday: 30, postsTarget: 50, batches: 10, maxBatches: 10, expected: false, name: "Under target but at max batches" }
  ];

  console.log(`🧪 Testing IGNORE_POST_HARVESTING_LIMITS=${IGNORE_POST_HARVESTING_LIMITS}`);
  
  // For each scenario, evaluate the modified while condition
  scenarios.forEach(scenario => {
    const { postsToday, postsTarget, batches, maxBatches, expected, name } = scenario;
    
    // Original condition: postsToday < postsTarget && batches < maxBatches
    const originalResult = postsToday < postsTarget && batches < maxBatches;
    
    // Modified condition: (IGNORE_POST_HARVESTING_LIMITS || postsToday < postsTarget) && batches < maxBatches
    const modifiedResult = (IGNORE_POST_HARVESTING_LIMITS || postsToday < postsTarget) && batches < maxBatches;
    
    const testPassed = modifiedResult === expected;
    
    console.log(`${testPassed ? '✅' : '❌'} Scenario: ${name}`);
    console.log(`  postsToday: ${postsToday}, postsTarget: ${postsTarget}, batches: ${batches}, maxBatches: ${maxBatches}`);
    console.log(`  Original: ${originalResult ? 'Continue' : 'Stop'}, Modified: ${modifiedResult ? 'Continue' : 'Stop'}`);
    console.log(`  Expected: ${expected ? 'Continue' : 'Stop'}\n`);
  });
}

// Run tests
testPostLimits();

// Restore original environment after test
process.env = ORIGINAL_ENV;

console.log("\nTest Summary:");
console.log("============");
console.log(`The environment variable IGNORE_POST_HARVESTING_LIMITS=${process.env.IGNORE_POST_HARVESTING_LIMITS === 'true'}`);
console.log("When set to 'true', post harvesting will continue until reaching max batches");
console.log("When set to 'false', post harvesting will stop when reaching daily post target");
console.log("\nTo test with Guy-Wilson client:");
console.log("1. Set IGNORE_POST_HARVESTING_LIMITS=true in environment");
console.log("2. Run process-client API with Guy-Wilson client ID");
console.log("3. Check logs for post harvesting continuing past the daily target");