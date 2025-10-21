/**
 * Quick Test for Smart Resume Module Integration
 * 
 * This test runs a minimal version of the Smart Resume process
 * with very limited scope for quick testing.
 */

require('dotenv').config();
const path = require('path');

console.log('🧪 Starting minimal test of Smart Resume module...');

// Set extremely limited scope for quick test
process.env.BATCH_PROCESSING_STREAM = '1';
process.env.SMART_RESUME_RUN_ID = `test_minimal_${Date.now()}`;
process.env.LEAD_SCORING_LIMIT = '1';  // Just 1 lead
process.env.POST_SCORING_LIMIT = '1';  // Just 1 post
process.env.MINIMAL_TEST_MODE = 'true'; // Signal test mode to the module

// Import the module directly
const scriptPath = path.join(__dirname, 'scripts/smart-resume-client-by-client.js');

// Clear module from cache to ensure fresh instance
delete require.cache[require.resolve(scriptPath)];

try {
  console.log('🔍 Loading Smart Resume module...');
  const smartResumeModule = require(scriptPath);
  
  console.log('✅ Module loaded successfully');
  console.log('🔍 Module exports:', Object.keys(smartResumeModule));
  
  if (typeof smartResumeModule.runSmartResume !== 'function') {
    console.error('❌ TEST FAILED: Module does not export runSmartResume function');
    process.exit(1);
  }
  
  console.log('🚀 Executing minimal test with tight limits...');
  
  // Execute the module
  smartResumeModule.runSmartResume()
    .then(() => {
      console.log('✅ TEST PASSED: Module executed successfully');
    })
    .catch(error => {
      console.error('❌ TEST FAILED: Module execution error:', error.message);
      console.error('Stack trace:', error.stack);
      process.exit(1);
    });
    
} catch (error) {
  console.error('❌ TEST FAILED: Module loading error:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}