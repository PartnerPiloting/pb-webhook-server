// Test the new batch error patterns
const testCases = [
  // Should MATCH (real errors):
  { text: "batchScorer: Multi-Tenant Batch Run Failed Critically", shouldMatch: true },
  { text: "Batch failed to process client", shouldMatch: true },
  { text: "batch run failed", shouldMatch: true },
  { text: "Error: batch operation failed", shouldMatch: true },
  { text: "Failed batch processing", shouldMatch: true },
  
  // Should NOT MATCH (false positives):
  { text: "📊 Summary: 1 successful, 0 failed, 8 posts scored", shouldMatch: false },
  { text: "Batch completed: 5 successful, 0 failed", shouldMatch: false },
  { text: "Results: 10 succeeded, 0 failed in batch", shouldMatch: false },
];

// Test patterns
const pattern1 = /batch\s+(?:run\s+)?failed/i;
const pattern2 = /\b(?:failed|error):\s*.*batch/i;
const pattern3 = /\bfailed\s+batch/i;

console.log('Testing new batch error patterns:\n');
console.log('='.repeat(80));

testCases.forEach((testCase, idx) => {
  const match1 = pattern1.test(testCase.text);
  const match2 = pattern2.test(testCase.text);
  const match3 = pattern3.test(testCase.text);
  const matches = match1 || match2 || match3;
  
  const result = matches === testCase.shouldMatch ? '✅ PASS' : '❌ FAIL';
  const expected = testCase.shouldMatch ? 'MATCH' : 'NO MATCH';
  const actual = matches ? 'MATCHED' : 'NO MATCH';
  
  console.log(`\n[${idx + 1}] ${result}`);
  console.log(`Text: "${testCase.text}"`);
  console.log(`Expected: ${expected}, Actual: ${actual}`);
  
  if (result === '❌ FAIL') {
    console.log(`  Pattern1 (batch run failed): ${match1}`);
    console.log(`  Pattern2 (failed/error batch): ${match2}`);
  }
});

console.log('\n' + '='.repeat(80));
