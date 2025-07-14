#!/usr/bin/env node

/**
 * Environment Variable Sync Utility
 * 
 * Helps synchronize environment variables across different deployment platforms.
 * This script helps you verify what variables are set where and identify mismatches.
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if it exists
if (fs.existsSync('.env')) {
  require('dotenv').config();
}

const BACKEND_VARIABLES = [
  'AIRTABLE_API_KEY',
  'AIRTABLE_BASE_ID', 
  'OPENAI_API_KEY',
  'GCP_PROJECT_ID',
  'GCP_LOCATION',
  'GCP_SERVICE_ACCOUNT_CREDENTIALS_JSON',
  'GEMINI_MODEL_ID',
  'PB_WEBHOOK_SECRET',
  'PORT',
  'BATCH_CHUNK_SIZE',
  'GEMINI_TIMEOUT_MS',
  'DEBUG_RAW_GEMINI',
  'ATTR_TABLE_NAME'
];

const FRONTEND_VARIABLES = [
  'NEXT_PUBLIC_API_BASE_URL',
  'NEXT_PUBLIC_WP_BASE_URL'
];

function checkEnvironmentVariables() {
  console.log('🔍 Environment Variable Status Check');
  console.log('=====================================\n');

  console.log('📋 BACKEND VARIABLES:');
  console.log('---------------------');
  
  BACKEND_VARIABLES.forEach(varName => {
    const value = process.env[varName];
    const status = value ? '✅ SET' : '❌ MISSING';
    const preview = value ? (varName.includes('SECRET') || varName.includes('KEY') || varName.includes('CREDENTIALS') 
      ? '[HIDDEN]' 
      : value.length > 50 ? value.substring(0, 47) + '...' : value) : '';
    
    console.log(`${status} ${varName} ${preview}`);
  });

  console.log('\n📋 FRONTEND VARIABLES:');
  console.log('----------------------');
  
  FRONTEND_VARIABLES.forEach(varName => {
    const value = process.env[varName];
    const status = value ? '✅ SET' : '❌ MISSING';
    const preview = value || '';
    
    console.log(`${status} ${varName} ${preview}`);
  });

  console.log('\n🔧 DEPLOYMENT CHECKLIST:');
  console.log('------------------------');
  console.log('□ Backend variables set in Render dashboard');
  console.log('□ Frontend variables set in Vercel dashboard'); 
  console.log('□ Local .env file configured for development');
  console.log('□ All sensitive variables are secure');
  console.log('□ API URLs point to correct environments');
}

function generateEnvTemplate(type = 'backend') {
  const variables = type === 'backend' ? BACKEND_VARIABLES : FRONTEND_VARIABLES;
  const filename = type === 'backend' ? '.env.example' : '.env.local.example';
  
  console.log(`\n📝 Generate ${filename}:`);
  console.log('='.repeat(filename.length + 11));
  
  variables.forEach(varName => {
    const placeholder = varName.includes('KEY') || varName.includes('SECRET') ? 'your-secret-key-here' :
                       varName.includes('ID') ? 'your-id-here' :
                       varName.includes('URL') ? 'https://your-url-here' :
                       'your-value-here';
    console.log(`${varName}=${placeholder}`);
  });
}

function validateCriticalVariables() {
  console.log('\n🚨 CRITICAL VALIDATION:');
  console.log('-----------------------');
  
  const critical = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'OPENAI_API_KEY'];
  let allCriticalSet = true;
  
  critical.forEach(varName => {
    const isSet = !!process.env[varName];
    console.log(`${isSet ? '✅' : '❌'} ${varName}`);
    if (!isSet) allCriticalSet = false;
  });
  
  if (allCriticalSet) {
    console.log('\n🎉 All critical variables are configured!');
  } else {
    console.log('\n⚠️  Some critical variables are missing. Check your environment configuration.');
  }
}

function showPlatformGuide() {
  console.log('🌐 PLATFORM ENVIRONMENT GUIDE');
  console.log('==============================\n');
  
  console.log('📍 RENDER (Backend Environment)');
  console.log('-------------------------------');
  console.log('1. Go to: https://dashboard.render.com');
  console.log('2. Select your pb-webhook-server service');
  console.log('3. Go to "Environment" tab');
  console.log('4. Verify these variables are set:');
  BACKEND_VARIABLES.forEach(varName => {
    console.log(`   • ${varName}`);
  });
  console.log('');
  
  console.log('📍 VERCEL (Frontend Environment)');
  console.log('--------------------------------');
  console.log('1. Go to: https://vercel.com/dashboard');
  console.log('2. Select your frontend project');
  console.log('3. Go to Settings → Environment Variables');
  console.log('4. Verify these variables are set:');
  FRONTEND_VARIABLES.forEach(varName => {
    console.log(`   • ${varName}`);
  });
  console.log('');
  
  console.log('🔍 TESTING REMOTE ENVIRONMENTS');
  console.log('------------------------------');
  console.log('Backend (Render):');
  console.log('  • Visit: https://pb-webhook-server.onrender.com/');
  console.log('  • Should show server info without errors');
  console.log('  • Check Render logs for environment variable errors');
  console.log('');
  console.log('Frontend (Vercel):');
  console.log('  • Visit your Vercel deployment URL');
  console.log('  • Environment validation should show green checkmarks');
  console.log('  • Try creating/updating a lead to test API connection');
  console.log('');
  
  console.log('⚠️  SYNC RECOMMENDATIONS');
  console.log('------------------------');
  console.log('1. Keep a secure note/password manager with all values');
  console.log('2. Use the audit checklist: ENVIRONMENT-AUDIT.md');
  console.log('3. Test changes in one environment before applying to others');
  console.log('4. Consider using the same values across environments for consistency');
}

// Main execution
const command = process.argv[2];

switch (command) {
  case 'check':
    checkEnvironmentVariables();
    validateCriticalVariables();
    break;
  case 'template':
    const type = process.argv[3] || 'backend';
    generateEnvTemplate(type);
    break;
  case 'validate':
    validateCriticalVariables();
    break;
  case 'platforms':
  case 'remote':
    showPlatformGuide();
    break;
  default:
    console.log('Environment Variable Sync Utility');
    console.log('=================================');
    console.log('');
    console.log('Usage:');
    console.log('  node env-sync.js check     - Check current environment variables');
    console.log('  node env-sync.js template  - Generate .env template (backend|frontend)');
    console.log('  node env-sync.js validate  - Validate critical variables only');
    console.log('  node env-sync.js platforms - Show guide for checking Render/Vercel');
    console.log('');
    console.log('Examples:');
    console.log('  node env-sync.js check');
    console.log('  node env-sync.js template backend');
    console.log('  node env-sync.js platforms');
}
