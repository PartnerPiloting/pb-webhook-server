#!/usr/bin/env node

/**
 * Development Workflow Manager
 * 
 * Helps manage your development workflow - whether local or cloud-only
 */

const fs = require('fs');
const { execSync } = require('child_process');

function showCurrentWorkflow() {
  console.log('🔄 Your Current Development Workflow');
  console.log('====================================\n');
  
  console.log('📋 CURRENT (Cloud-Only) WORKFLOW:');
  console.log('1. Edit code in VS Code');
  console.log('2. git add . && git commit -m "description"');
  console.log('3. git push origin main');
  console.log('4. Render auto-deploys backend (1-3 minutes)');
  console.log('5. Vercel auto-deploys frontend (1-3 minutes)');
  console.log('6. Test on live sites');
  console.log('');
  
  console.log('⏱️  TIMING:');
  console.log('• Code change to live: 3-5 minutes');
  console.log('• Good for: Small changes, bug fixes');
  console.log('• Best when: You want to avoid environment setup');
}

function showLocalWorkflow() {
  console.log('🏠 LOCAL DEVELOPMENT WORKFLOW:');
  console.log('1. Run: node dev-workflow.js setup-local');
  console.log('2. Start backend: npm start (in one terminal)');
  console.log('3. Start frontend: cd linkedin-messaging-followup-next && npm run dev');
  console.log('4. Develop and test at http://localhost:3000');
  console.log('5. When ready: git add . && git commit && git push');
  console.log('6. Auto-deploy to production');
  console.log('7. Final test on live sites');
  console.log('');
  
  console.log('⏱️  TIMING:');
  console.log('• Code change to see result: Instant');
  console.log('• Code change to production: 3-5 minutes (when you push)');
  console.log('• Good for: Major features, debugging, experimentation');
  console.log('• Setup time: 5-10 minutes (one time)');
}

function setupLocalEnvironment() {
  console.log('🚀 Setting Up Local Development Environment');
  console.log('==========================================\n');
  
  console.log('📋 STEP-BY-STEP SETUP:');
  console.log('');
  
  console.log('1️⃣  BACKEND ENVIRONMENT (.env in root):');
  console.log('   Copy these from your Render dashboard:');
  console.log('   • AIRTABLE_API_KEY');
  console.log('   • AIRTABLE_BASE_ID');
  console.log('   • OPENAI_API_KEY');
  console.log('   • GCP_PROJECT_ID');
  console.log('   • GCP_LOCATION');
  console.log('   • GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON');
  console.log('');
  
  console.log('2️⃣  FRONTEND ENVIRONMENT (.env.local in linkedin-messaging-followup-next/):');
  console.log('   NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/linkedin');
  console.log('');
  
  console.log('3️⃣  START DEVELOPMENT:');
  console.log('   Terminal 1: npm start (backend)');
  console.log('   Terminal 2: cd linkedin-messaging-followup-next && npm run dev');
  console.log('');
  
  console.log('4️⃣  ACCESS YOUR APP:');
  console.log('   Frontend: http://localhost:3000');
  console.log('   Backend API: http://localhost:3000/api/linkedin');
  console.log('');
  
  // Create template files
  createLocalEnvTemplates();
}

function createLocalEnvTemplates() {
  const backendEnv = `# Backend Local Development Environment
# Copy values from your Render dashboard

# Required Variables
AIRTABLE_API_KEY=your_airtable_key_here
AIRTABLE_BASE_ID=your_base_id_here
OPENAI_API_KEY=your_openai_key_here
GCP_PROJECT_ID=your_project_id_here
GCP_LOCATION=us-central1
GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON={"type":"service_account","your":"credentials"}

# Optional Variables
GEMINI_MODEL_ID=gemini-2.5-pro-preview-05-06
PB_WEBHOOK_SECRET=your_webhook_secret
PORT=3000
`;

  const frontendEnv = `# Frontend Local Development Environment

# Point to local backend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/linkedin

# Optional
# NEXT_PUBLIC_WP_BASE_URL=https://yoursite.com/wp-json/wp/v2
`;

  fs.writeFileSync('.env.template', backendEnv);
  fs.writeFileSync('linkedin-messaging-followup-next/.env.local.template', frontendEnv);
  
  console.log('✅ Created template files:');
  console.log('   • .env.template (copy to .env and fill in values)');
  console.log('   • linkedin-messaging-followup-next/.env.local.template');
}

function checkDeploymentStatus() {
  console.log('🔍 Checking Deployment Status');
  console.log('=============================\n');
  
  try {
    // Check git status
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
    
    if (gitStatus.trim()) {
      console.log('⚠️  UNCOMMITTED CHANGES:');
      console.log(gitStatus);
      console.log('Run: git add . && git commit -m "description" && git push');
    } else {
      console.log('✅ All changes committed and pushed');
    }
    
    // Check last commit
    const lastCommit = execSync('git log -1 --oneline', { encoding: 'utf8' });
    console.log(`📝 Last commit: ${lastCommit.trim()}`);
    
  } catch (error) {
    console.log('❌ Could not check git status');
  }
  
  console.log('\n🌐 Check deployment status:');
  console.log('• Render: https://dashboard.render.com');
  console.log('• Vercel: https://vercel.com/dashboard');
  console.log('• Test live: https://pb-webhook-server.onrender.com');
}

function showRecommendation() {
  console.log('\n💡 RECOMMENDATION FOR YOUR USE CASE:');
  console.log('====================================');
  console.log('');
  console.log('🎯 STICK WITH CLOUD-ONLY for:');
  console.log('• Bug fixes');
  console.log('• Small feature additions');
  console.log('• Configuration changes');
  console.log('• Quick experiments');
  console.log('');
  console.log('🏠 USE LOCAL DEVELOPMENT for:');
  console.log('• AI attribute editor (major feature)');
  console.log('• Complex debugging sessions');
  console.log('• Testing multiple changes rapidly');
  console.log('• Learning/exploring the codebase');
  console.log('');
  console.log('⚖️  HYBRID APPROACH:');
  console.log('• Use cloud-only 80% of the time');
  console.log('• Set up local environment for big projects');
  console.log('• Clean up local environment when done');
}

// Main execution
const command = process.argv[2];

switch (command) {
  case 'current':
    showCurrentWorkflow();
    break;
  case 'local':
    showLocalWorkflow();
    break;
  case 'setup-local':
    setupLocalEnvironment();
    break;
  case 'status':
    checkDeploymentStatus();
    break;
  case 'recommend':
    showRecommendation();
    break;
  default:
    console.log('Development Workflow Manager');
    console.log('===========================');
    console.log('');
    console.log('Usage:');
    console.log('  node dev-workflow.js current      - Show your current workflow');
    console.log('  node dev-workflow.js local        - Show local development workflow');
    console.log('  node dev-workflow.js setup-local  - Set up local development');
    console.log('  node dev-workflow.js status       - Check deployment status');
    console.log('  node dev-workflow.js recommend    - Get workflow recommendations');
    console.log('');
    console.log('Examples:');
    console.log('  node dev-workflow.js current');
    console.log('  node dev-workflow.js setup-local');
    showRecommendation();
}
