#!/usr/bin/env node

/**
 * Environment Variable Conflict Checker
 * 
 * Prevents naming conflicts between Render (backend) and Vercel (frontend) environments
 */

// Define your current environment variables by platform
const RENDER_VARIABLES = [
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

const VERCEL_VARIABLES = [
  'NEXT_PUBLIC_API_BASE_URL',
  'NEXT_PUBLIC_WP_BASE_URL'
];

function checkForConflicts() {
  console.log('🔍 Environment Variable Conflict Check');
  console.log('======================================\n');
  
  const conflicts = [];
  const renderSet = new Set(RENDER_VARIABLES);
  
  VERCEL_VARIABLES.forEach(vercelVar => {
    if (renderSet.has(vercelVar)) {
      conflicts.push(vercelVar);
    }
  });
  
  if (conflicts.length === 0) {
    console.log('✅ NO CONFLICTS FOUND!');
    console.log('All variable names are unique between platforms.\n');
  } else {
    console.log('❌ CONFLICTS DETECTED:');
    conflicts.forEach(conflict => {
      console.log(`   • ${conflict} exists in both Render and Vercel`);
    });
    console.log('');
  }
  
  return conflicts;
}

function showCurrentVariables() {
  console.log('📋 CURRENT VARIABLE INVENTORY:');
  console.log('------------------------------');
  
  console.log('\n🖥️  RENDER (Backend) Variables:');
  RENDER_VARIABLES.forEach(varName => {
    console.log(`   • ${varName}`);
  });
  
  console.log('\n🌐 VERCEL (Frontend) Variables:');
  VERCEL_VARIABLES.forEach(varName => {
    console.log(`   • ${varName}`);
  });
  
  console.log(`\nTotal: ${RENDER_VARIABLES.length + VERCEL_VARIABLES.length} variables across both platforms`);
}

function validateNewVariable(newVarName, platform) {
  console.log(`🔍 Checking if "${newVarName}" is safe to add to ${platform}...`);
  
  const otherPlatformVars = platform === 'render' ? VERCEL_VARIABLES : RENDER_VARIABLES;
  const otherPlatformName = platform === 'render' ? 'Vercel' : 'Render';
  
  if (otherPlatformVars.includes(newVarName)) {
    console.log(`❌ CONFLICT: "${newVarName}" already exists in ${otherPlatformName}`);
    console.log(`💡 Suggestion: Use a prefix like "${platform.toUpperCase()}_${newVarName}"`);
    return false;
  } else {
    console.log(`✅ SAFE: "${newVarName}" is unique and safe to add to ${platform}`);
    return true;
  }
}

function suggestNamingConventions() {
  console.log('\n💡 NAMING CONVENTION RECOMMENDATIONS:');
  console.log('====================================');
  
  console.log('\n🎯 BACKEND (Render) Variables:');
  console.log('• Use descriptive names: AIRTABLE_API_KEY');
  console.log('• Add purpose prefix: SCORING_AI_MODEL, ATTRIBUTE_AI_MODEL');
  console.log('• Keep sensitive data here (not NEXT_PUBLIC_)');
  
  console.log('\n🎯 FRONTEND (Vercel) Variables:');
  console.log('• MUST start with NEXT_PUBLIC_ to be accessible in browser');
  console.log('• Examples: NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_FEATURE_FLAG');
  console.log('• NEVER put secrets in NEXT_PUBLIC_ variables!');
  
  console.log('\n🎯 AVOID CONFLICTS:');
  console.log('• Different AI models: BACKEND_AI_MODEL vs NEXT_PUBLIC_FRONTEND_AI_MODEL');
  console.log('• Different timeouts: BACKEND_TIMEOUT vs NEXT_PUBLIC_UI_TIMEOUT');
  console.log('• Different URLs: API_BASE_URL vs NEXT_PUBLIC_API_BASE_URL');
}

function generateConflictFreeNames(baseName) {
  console.log(`\n🔧 Conflict-Free Naming for "${baseName}":`);
  console.log('=========================================');
  
  console.log(`Backend (Render) options:`);
  console.log(`   • BACKEND_${baseName}`);
  console.log(`   • SERVER_${baseName}`);
  console.log(`   • API_${baseName}`);
  
  console.log(`Frontend (Vercel) options:`);
  console.log(`   • NEXT_PUBLIC_FRONTEND_${baseName}`);
  console.log(`   • NEXT_PUBLIC_UI_${baseName}`);
  console.log(`   • NEXT_PUBLIC_CLIENT_${baseName}`);
}

// Main execution
const command = process.argv[2];
const varName = process.argv[3];
const platform = process.argv[4];

switch (command) {
  case 'check':
    checkForConflicts();
    showCurrentVariables();
    suggestNamingConventions();
    break;
  case 'validate':
    if (!varName || !platform) {
      console.log('Usage: node conflict-checker.js validate VARIABLE_NAME render|vercel');
      process.exit(1);
    }
    validateNewVariable(varName, platform.toLowerCase());
    break;
  case 'suggest':
    if (!varName) {
      console.log('Usage: node conflict-checker.js suggest BASE_NAME');
      process.exit(1);
    }
    generateConflictFreeNames(varName);
    break;
  case 'list':
    showCurrentVariables();
    break;
  default:
    console.log('Environment Variable Conflict Checker');
    console.log('====================================');
    console.log('');
    console.log('Usage:');
    console.log('  node conflict-checker.js check                    - Check for conflicts');
    console.log('  node conflict-checker.js validate VAR_NAME PLATFORM - Check if variable is safe');
    console.log('  node conflict-checker.js suggest BASE_NAME        - Generate conflict-free names');
    console.log('  node conflict-checker.js list                     - Show all current variables');
    console.log('');
    console.log('Examples:');
    console.log('  node conflict-checker.js check');
    console.log('  node conflict-checker.js validate AI_MODEL render');
    console.log('  node conflict-checker.js suggest TIMEOUT');
    
    // Show a quick check by default
    console.log('\n' + '='.repeat(50));
    checkForConflicts();
}
