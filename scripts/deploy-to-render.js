// scripts/deploy-to-render.js
/**
 * Deploy current branch to Render production
 * Requires RENDER_API_KEY in environment
 */

const https = require('https');
require('dotenv').config();

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = 'srv-cq178k5a73kc73csm7p0'; // pb-webhook-server production

if (!RENDER_API_KEY) {
  console.error('❌ RENDER_API_KEY not found in environment');
  console.log('Set it in your .env file or environment variables');
  process.exit(1);
}

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function getCurrentBranch() {
  const { execSync } = require('child_process');
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  return branch;
}

async function deployToRender() {
  try {
    console.log('🚀 Deploying to Render Production...\n');
    
    const currentBranch = await getCurrentBranch();
    console.log(`📍 Current branch: ${currentBranch}`);
    console.log(`🎯 Service ID: ${SERVICE_ID}`);
    console.log(`🔗 Service URL: https://pb-webhook-server.onrender.com\n`);
    
    // Trigger deployment
    const options = {
      hostname: 'api.render.com',
      port: 443,
      path: `/v1/services/${SERVICE_ID}/deploys`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const deployData = {
      clearCache: 'do_not_clear' // Keep cache for faster deploys
    };
    
    console.log('⏳ Triggering deployment...');
    const response = await makeRequest(options, deployData);
    
    if (response.statusCode === 201) {
      const deploy = response.body;
      console.log('\n✅ Deployment triggered successfully!\n');
      console.log(`Deploy ID: ${deploy.id}`);
      console.log(`Status: ${deploy.status}`);
      console.log(`Branch: ${deploy.commit?.branch || currentBranch}`);
      console.log(`Commit: ${deploy.commit?.id?.substring(0, 7) || 'latest'}`);
      console.log(`\n📊 Monitor deployment:`);
      console.log(`   Dashboard: https://dashboard.render.com/web/${SERVICE_ID}`);
      console.log(`   Logs: https://dashboard.render.com/web/${SERVICE_ID}/logs`);
      console.log(`\n⏱️  Deployment typically takes 2-3 minutes`);
      console.log(`\n🔍 After deployment, check:`);
      console.log(`   Health: https://pb-webhook-server.onrender.com/health`);
      console.log(`   Basic: https://pb-webhook-server.onrender.com/basic-test`);
    } else {
      console.error('\n❌ Deployment failed!');
      console.error(`Status: ${response.statusCode}`);
      console.error(`Response:`, response.body);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Error deploying to Render:', error.message);
    process.exit(1);
  }
}

deployToRender();
