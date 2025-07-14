#!/usr/bin/env node

/**
 * Remote Environment Tester
 * 
 * Tests if your deployed environments are working correctly by making actual API calls.
 * This helps verify that environment variables are set correctly on Render and Vercel.
 */

const https = require('https');
const http = require('http');

const RENDER_BACKEND_URL = 'https://pb-webhook-server.onrender.com';
const VERCEL_FRONTEND_URL = process.env.VERCEL_URL || 'your-vercel-app.vercel.app';

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    const req = protocol.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

async function testBackendHealth() {
  console.log('🔍 Testing Backend (Render)...');
  console.log('------------------------------');
  
  try {
    const response = await makeRequest(RENDER_BACKEND_URL);
    
    if (response.statusCode === 200) {
      console.log('✅ Backend is responding');
      console.log(`📋 Response preview: ${response.body.substring(0, 100)}...`);
      
      // Check if it mentions environment variables
      if (response.body.includes('environment') || response.body.includes('config')) {
        console.log('🔧 Backend appears to be loading configuration');
      }
    } else {
      console.log(`⚠️  Backend responded with status: ${response.statusCode}`);
    }
  } catch (error) {
    console.log(`❌ Backend test failed: ${error.message}`);
    console.log('💡 This could indicate environment variable issues');
  }
}

async function testBackendAPI() {
  console.log('\n🔍 Testing Backend API Endpoints...');
  console.log('-----------------------------------');
  
  const endpoints = [
    '/api/linkedin/leads',
    '/api/linkedin/health',
    '/status'
  ];
  
  for (const endpoint of endpoints) {
    try {
      const url = RENDER_BACKEND_URL + endpoint;
      console.log(`Testing: ${endpoint}`);
      
      const response = await makeRequest(url);
      
      if (response.statusCode === 200) {
        console.log(`✅ ${endpoint} - OK`);
      } else if (response.statusCode === 401) {
        console.log(`🔒 ${endpoint} - Authentication required (normal)`);
      } else if (response.statusCode === 404) {
        console.log(`⚠️  ${endpoint} - Not found`);
      } else {
        console.log(`⚠️  ${endpoint} - Status: ${response.statusCode}`);
      }
    } catch (error) {
      console.log(`❌ ${endpoint} - Error: ${error.message}`);
    }
  }
}

async function testEnvironmentVariables() {
  console.log('\n🔍 Testing Environment Variable Dependencies...');
  console.log('-----------------------------------------------');
  
  // Test if Airtable connection works by trying to access a protected endpoint
  try {
    const response = await makeRequest(RENDER_BACKEND_URL + '/api/linkedin/leads', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.statusCode === 500 && response.body.includes('Airtable')) {
      console.log('❌ Airtable configuration issue detected');
    } else if (response.statusCode === 401) {
      console.log('✅ Airtable connection appears configured (authentication working)');
    } else {
      console.log(`🔧 Endpoint responded with status: ${response.statusCode}`);
    }
  } catch (error) {
    console.log(`⚠️  Could not test Airtable connection: ${error.message}`);
  }
}

function showManualChecks() {
  console.log('\n📋 MANUAL VERIFICATION STEPS');
  console.log('============================');
  
  console.log('\n🎯 Render Dashboard Checks:');
  console.log('1. Go to https://dashboard.render.com');
  console.log('2. Select your pb-webhook-server service');
  console.log('3. Check "Environment" tab for:');
  console.log('   • AIRTABLE_API_KEY (starts with pat_)');
  console.log('   • AIRTABLE_BASE_ID (starts with app)');
  console.log('   • OPENAI_API_KEY (starts with sk-)');
  console.log('   • GCP credentials and project info');
  
  console.log('\n🎯 Vercel Dashboard Checks:');
  console.log('1. Go to https://vercel.com/dashboard');
  console.log('2. Select your frontend project');
  console.log('3. Go to Settings → Environment Variables');
  console.log('4. Verify NEXT_PUBLIC_API_BASE_URL is set correctly');
  
  console.log('\n🎯 Live Testing:');
  console.log('1. Visit your Vercel deployment');
  console.log('2. Try updating a lead in the Lead Search & Update tab');
  console.log('3. Check browser developer tools for any API errors');
  console.log('4. Verify environment validation shows green checkmarks');
}

// Main execution
const command = process.argv[2];

async function runTests() {
  console.log('🚀 Remote Environment Validation');
  console.log('================================\n');
  
  await testBackendHealth();
  await testBackendAPI();
  await testEnvironmentVariables();
  showManualChecks();
  
  console.log('\n💡 Next Steps:');
  console.log('- If tests fail, check environment variables in respective dashboards');
  console.log('- Use ENVIRONMENT-AUDIT.md for detailed verification checklist');
  console.log('- Run "node env-sync.js platforms" for platform-specific guidance');
}

if (command === 'test' || !command) {
  runTests().catch(console.error);
} else {
  console.log('Remote Environment Tester');
  console.log('========================');
  console.log('');
  console.log('Usage:');
  console.log('  node remote-env-test.js test   - Run all remote environment tests');
  console.log('  node remote-env-test.js        - Same as test');
}
