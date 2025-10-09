#!/usr/bin/env node
/**
 * Script to trigger System 1 (pattern-based log analysis)
 * Analyzes recent Render logs and saves errors to Production Issues table
 */

const https = require('https');

// Get minutes from command line (default: 60)
const minutes = parseInt(process.argv[2]) || 60;

// Configuration
const STAGING_URL = 'pb-webhook-server-staging.onrender.com';
const PROD_URL = 'pb-webhook-server.onrender.com';
const SECRET = process.env.PB_WEBHOOK_SECRET;

// Use staging by default, unless --prod flag is passed
const isProd = process.argv.includes('--prod');
const hostname = isProd ? PROD_URL : STAGING_URL;

if (!SECRET) {
  console.error('❌ ERROR: PB_WEBHOOK_SECRET environment variable not set');
  console.error('   Set it in your .env file or run: export PB_WEBHOOK_SECRET=your_secret');
  process.exit(1);
}

console.log(`\n🔍 Analyzing last ${minutes} minutes of Render logs...`);
console.log(`📍 Target: ${isProd ? 'PRODUCTION' : 'STAGING'} (${hostname})`);
console.log(`⏰ Started at: ${new Date().toISOString()}\n`);

const postData = JSON.stringify({ minutes });

const options = {
  hostname,
  port: 443,
  path: '/api/analyze-logs/recent',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': `Bearer ${SECRET}`
  }
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`📡 Response status: ${res.statusCode}\n`);
    
    try {
      const result = JSON.parse(data);
      
      if (result.ok) {
        console.log('✅ LOG ANALYSIS COMPLETE\n');
        console.log(`📊 Results:`);
        console.log(`   - Total issues found: ${result.issues}`);
        console.log(`   - Critical: ${result.summary.critical}`);
        console.log(`   - Errors: ${result.summary.error}`);
        console.log(`   - Warnings: ${result.summary.warning}`);
        console.log(`   - Saved to Airtable: ${result.saved}`);
        console.log(`   - Duplicates skipped: ${result.duplicates}`);
        
        if (result.issues > 0) {
          console.log(`\n📋 Errors saved to Production Issues table in Airtable`);
          console.log(`   Open your Master Clients base to view details`);
        } else {
          console.log(`\n🎉 No errors found - clean run!`);
        }
        
        console.log(`\n${result.message}\n`);
      } else {
        console.error('❌ ANALYSIS FAILED');
        console.error(`   Error: ${result.error}\n`);
        process.exit(1);
      }
    } catch (parseError) {
      console.error('❌ Failed to parse response:', parseError.message);
      console.error('Raw response:', data);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
  process.exit(1);
});

req.write(postData);
req.end();
