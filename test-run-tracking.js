/**
 * Run Tracking System Test
 * 
 * This script tests the run tracking system on the staging environment
 * by triggering a small lead scoring job and monitoring the results.
 */

import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Initialize dotenv
dotenv.config();

// Configuration
const STAGING_URL = process.env.STAGING_URL || 'https://pb-webhook-server-staging.onrender.com';
const AUTH_TOKEN = process.env.PB_WEBHOOK_SECRET || 'Diamond9753!!@@pb';
const TEST_CLIENT_ID = process.env.TEST_CLIENT_ID; // Optional: specify a client ID to test
const TEST_LIMIT = 5; // Process only 5 leads per client for testing

async function testRunTracking() {
  console.log('Starting run tracking test on staging...');
  console.log(`Server URL: ${STAGING_URL}`);
  console.log(`Test client: ${TEST_CLIENT_ID || 'All clients'}`);
  console.log(`Lead limit: ${TEST_LIMIT}`);
  
  try {
    // 1. Trigger a small lead scoring job
    console.log('\n== STEP 1: Triggering lead scoring job ==');
    const response = await fetch(`${STAGING_URL}/api/run-batch-score-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({
        stream: 1,
        limit: TEST_LIMIT,
        clientId: TEST_CLIENT_ID // Optional: will be undefined if not set
      })
    });
    
    const result = await response.json();
    console.log('API Response:', result);
    
    if (!result.jobId) {
      throw new Error('No job ID returned. API request failed.');
    }
    
    const jobId = result.jobId;
    console.log(`Job ID: ${jobId}`);
    
    // 2. Monitor job status until completion
    console.log('\n== STEP 2: Monitoring job status ==');
    console.log('Waiting for job to initialize...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    let jobComplete = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // Maximum polling attempts (5 minutes total)
    
    while (!jobComplete && attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(`Check #${attempts}...`);
      
      const statusResponse = await fetch(`${STAGING_URL}/api/debug-job-status?jobId=${jobId}`, {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      });
      
      const statusResult = await statusResponse.json();
      console.log(`Job Status: ${statusResult.status || 'Unknown'}`);
      
      if (statusResult.status === 'COMPLETED' || statusResult.status === 'FAILED') {
        jobComplete = true;
        console.log(`Job finished with status: ${statusResult.status}`);
      } else {
        console.log('Job still running. Checking again in 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds between checks
      }
    }
    
    if (!jobComplete) {
      console.log(`Job did not complete after ${MAX_ATTEMPTS} checks. Check Airtable manually.`);
    }
    
    // 3. Final instructions
    console.log('\n== STEP 3: Verification ==');
    console.log('Test completed. Please check Airtable for:');
    console.log('1. Job Tracking table - A record with the latest run');
    console.log('2. Client Run Results table - Client-specific records for this run');
    console.log('3. Verify that metrics are recorded accurately');
    
    console.log('\nLook for Run IDs that start with "SR-" followed by today\'s date.');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Execute the test
testRunTracking().catch(console.error);