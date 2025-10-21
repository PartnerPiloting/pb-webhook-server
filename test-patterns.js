const { ERROR_PATTERNS } = require('./config/errorPatterns.js');

const testMessages = [
  'Unknown field name: "Status (from Lead Status)"',
  'Failed to update record',
  'batch failed with 3 errors'
];

console.log('Testing error pattern matching:\n');
testMessages.forEach(msg => {
  console.log('Message:', msg);
  let matched = false;
  
  // Test ERROR patterns
  for (const pattern of ERROR_PATTERNS.ERROR) {
    if (pattern.test(msg)) {
      console.log('  ✓ Matched ERROR pattern:', pattern);
      matched = true;
      break;
    }
  }
  
  if (!matched) {
    // Test CRITICAL patterns
    for (const pattern of ERROR_PATTERNS.CRITICAL) {
      if (pattern.test(msg)) {
        console.log('  ✓ Matched CRITICAL pattern:', pattern);
        matched = true;
        break;
      }
    }
  }
  
  if (!matched) console.log('  ✗ NO MATCH');
  console.log('');
});
