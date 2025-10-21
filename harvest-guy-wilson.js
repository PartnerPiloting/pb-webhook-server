#!/usr/bin/env node

/**
 * Direct Guy Wilson Post Harvesting Script
 * 
 * This script directly calls the post harvesting endpoint for Guy Wilson
 * without going through the smart-resume process.
 * 
 * Usage:
 * node harvest-guy-wilson.js
 */

// Import required modules
const fetch = require('node-fetch');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function harvestGuyWilsonPosts() {
  console.log('🚀 Starting direct post harvesting for Guy Wilson...');
  
  try {
    // Prepare the request
    const baseUrl = process.env.RENDER_EXTERNAL_URL || 'https://pb-webhook-server-staging.onrender.com';
    const endpointUrl = `${baseUrl}/api/apify/process-level2-v2`;
    const secret = process.env.PB_WEBHOOK_SECRET;
    
    if (!secret) {
      console.error('❌ ERROR: Missing PB_WEBHOOK_SECRET environment variable');
      process.exit(1);
    }
    
    console.log(`🔍 Calling endpoint: ${endpointUrl}`);
    
    // Make the request
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': 'Guy-Wilson',
        'Authorization': `Bearer ${secret}`
      },
      body: JSON.stringify({
        clientId: 'Guy-Wilson',
        stream: 1,
        debug: true,
        force: true
      })
    });
    
    // Parse the response
    const data = await response.json();
    
    // Show the result
    console.log(`✅ Response status: ${response.status}`);
    console.log(`✅ Response data: ${JSON.stringify(data, null, 2)}`);
    console.log('🎉 Post harvesting completed for Guy Wilson!');
    
  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`);
    if (error.stack) {
      console.error(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Run the function
harvestGuyWilsonPosts();