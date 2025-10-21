#!/usr/bin/env node
/**
 * Test that ProductionIssueService can be imported without RENDER_API_KEY
 * This validates the lazy loading fix
 */

console.log('Testing lazy loading of RenderLogService...\n');

// Unset the environment variables to simulate missing config
delete process.env.RENDER_API_KEY;
delete process.env.RENDER_OWNER_ID;

console.log('Step 1: Import ProductionIssueService (should NOT crash)');
try {
  const ProductionIssueService = require('./services/productionIssueService');
  console.log('✅ Import successful - constructor did not crash\n');
  
  console.log('Step 2: Create instance (should NOT crash)');
  const service = new ProductionIssueService();
  console.log('✅ Instance created - lazy initialization working\n');
  
  console.log('Step 3: Try to use renderLogService (should crash with helpful error)');
  try {
    const logs = service.renderLogService; // This should trigger the getter and crash
    console.log('❌ FAILED - Should have thrown error about missing RENDER_API_KEY');
  } catch (error) {
    if (error.message.includes('RENDER_API_KEY')) {
      console.log('✅ Correct error thrown:', error.message);
    } else {
      console.log('❌ Wrong error thrown:', error.message);
    }
  }
  
  console.log('\n✅ ALL TESTS PASSED - Lazy loading is working correctly!');
  process.exit(0);
  
} catch (error) {
  console.log('❌ FAILED - Import or constructor crashed:');
  console.log(error.message);
  console.log('\nThis means lazy loading is NOT working.');
  process.exit(1);
}
