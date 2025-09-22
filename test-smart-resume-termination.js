/**
 * Test script for the enhanced Smart Resume termination functionality
 * 
 * This script simulates the following:
 * 1. Getting the current status of Smart Resume
 * 2. Forcing a termination if a process is running
 * 3. Checking the status again after termination
 * 
 * Usage:
 * node test-smart-resume-termination.js [--force]
 */

const fetch = require('node-fetch');

// Configuration
const DEFAULT_LOCAL_URL = 'http://localhost:3001';
const DEFAULT_STAGING_URL = 'https://pb-webhook-server-staging.onrender.com';
const DEFAULT_PRODUCTION_URL = 'https://pb-webhook-server-prod.onrender.com';

// Parse command line arguments
const args = process.argv.slice(2);
const forceTerminate = args.includes('--force');
const useStaging = args.includes('--staging');
const useProduction = args.includes('--production');
const useLocal = args.includes('--local') || (!useStaging && !useProduction);

// Determine API base URL
let API_BASE_URL;
if (useProduction) {
  API_BASE_URL = DEFAULT_PRODUCTION_URL;
  console.log('🚀 Using PRODUCTION environment');
} else if (useStaging) {
  API_BASE_URL = DEFAULT_STAGING_URL;
  console.log('🚀 Using STAGING environment');
} else {
  API_BASE_URL = DEFAULT_LOCAL_URL;
  console.log('🚀 Using LOCAL environment');
}

const WEBHOOK_SECRET = process.env.PB_WEBHOOK_SECRET;

// Check if we have the required environment variables
if (!WEBHOOK_SECRET) {
  console.error('ERROR: PB_WEBHOOK_SECRET environment variable is required.');
  console.error('Please set it before running this script.');
  process.exit(1);
}

// Headers with authentication
const headers = {
  'Content-Type': 'application/json',
  'x-webhook-secret': WEBHOOK_SECRET
};

/**
 * Get the current status of Smart Resume
 */
async function getStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/debug-smart-resume-status`, {
      method: 'GET',
      headers
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to get status:', error);
    return null;
  }
}

/**
 * Force reset the Smart Resume lock and optionally terminate the process
 */
async function resetLock(forceTerminate) {
  try {
    const response = await fetch(`${API_BASE_URL}/reset-smart-resume-lock`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        forceTerminate
      })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to reset lock:', error);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== Smart Resume Termination Test ===');
  
  // 1. Get current status
  console.log('\n1. Getting current status...');
  const initialStatus = await getStatus();
  
  if (!initialStatus) {
    console.error('Failed to get status. Exiting.');
    return;
  }
  
  console.log(JSON.stringify(initialStatus, null, 2));
  
  // 2. Check if a process is running
  const isProcessRunning = 
    initialStatus.lockStatus?.locked && 
    initialStatus.activeProcess?.status === 'running';
  
  if (!isProcessRunning) {
    console.log('\nNo active Smart Resume process running.');
    
    if (!forceTerminate) {
      console.log('Exiting. Use --force flag to reset the lock anyway.');
      return;
    }
  }
  
  // 3. Reset lock and optionally terminate
  console.log(`\n2. ${forceTerminate ? 'Terminating' : 'Resetting lock for'} Smart Resume process...`);
  const resetResult = await resetLock(forceTerminate);
  
  if (!resetResult) {
    console.error('Failed to reset lock. Exiting.');
    return;
  }
  
  console.log('Reset result:');
  console.log(JSON.stringify(resetResult, null, 2));
  
  // 4. Get status again after reset
  console.log('\n3. Getting updated status after reset...');
  
  // Wait a moment for the termination signal to be processed
  if (forceTerminate) {
    console.log('Waiting 3 seconds for termination to be processed...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  const finalStatus = await getStatus();
  
  if (!finalStatus) {
    console.error('Failed to get updated status.');
    return;
  }
  
  console.log(JSON.stringify(finalStatus, null, 2));
  
  console.log('\n=== Test completed ===');
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});