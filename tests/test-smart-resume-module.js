/**
 * Test script for the smart-resume-client-by-client module implementation
 * 
 * This script tests the direct module import approach to ensure it works correctly
 * without requiring child_process.execSync.
 */

require('dotenv').config();

// Set required environment variables for testing
process.env.BATCH_PROCESSING_STREAM = '1';
process.env.SMART_RESUME_RUN_ID = `test_module_${Date.now()}`;
process.env.LEAD_SCORING_LIMIT = '5'; // Limit to 5 leads for testing
process.env.POST_SCORING_LIMIT = '5'; // Limit to 5 posts for testing

console.log('🧪 Starting module test...');
console.log(`🔍 TESTING WITH: SMART_RESUME_RUN_ID = ${process.env.SMART_RESUME_RUN_ID}`);

// Import the module directly
const path = require('path');
const scriptPath = path.join(__dirname, 'scripts/smart-resume-client-by-client.js');
const smartResumeModule = require(scriptPath);

console.log('📝 Smart resume module imported successfully');
console.log('🔍 Module exports:', Object.keys(smartResumeModule));

// Check if the module exports the expected function
if (typeof smartResumeModule.runSmartResume !== 'function') {
  console.error('❌ TEST FAILED: Module does not export runSmartResume function');
  process.exit(1);
}

console.log('✅ Module exports runSmartResume function');
console.log('🚀 Calling runSmartResume function...');

// Execute the module function and handle result
smartResumeModule.runSmartResume()
  .then(() => {
    console.log('✅ TEST PASSED: Module executed successfully');
  })
  .catch(error => {
    console.error('❌ TEST FAILED: Module execution error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  });