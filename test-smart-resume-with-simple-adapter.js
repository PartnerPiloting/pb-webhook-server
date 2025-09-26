#!/usr/bin/env node

/**
 * Test script for the simplified run record system
 * This script tests the smart-resume-client-by-client.js with our new adapter
 */

// Force the test mode and limit to a single client for testing
process.env.TESTING_MODE = 'true';
process.env.MAX_CLIENTS = '1'; // Process just 1 client for testing

// Import and run the main script
const smartResumeScript = require('./scripts/smart-resume-client-by-client');

console.log('🧪 Test run complete. Check the logs for any errors.');