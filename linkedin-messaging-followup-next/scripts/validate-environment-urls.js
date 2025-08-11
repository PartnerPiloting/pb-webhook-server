#!/usr/bin/env node
/**
 * Environment URL Validation Script
 * Ensures all hardcoded URLs match the current environment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ENVIRONMENT = process.env.NODE_ENV || 'hotfix';
const EXPECTED_DOMAIN = ENVIRONMENT === 'hotfix' 
  ? 'pb-webhook-server-hotfix.onrender.com'
  : 'pb-webhook-server.onrender.com';

const WRONG_DOMAIN = ENVIRONMENT === 'hotfix'
  ? 'pb-webhook-server.onrender.com'
  : 'pb-webhook-server-hotfix.onrender.com';

console.log(`🔍 Validating URLs for environment: ${ENVIRONMENT}`);
console.log(`Expected domain: ${EXPECTED_DOMAIN}`);
console.log(`Checking for incorrect domain: ${WRONG_DOMAIN}`);

try {
  // Search for wrong domain in source files
  const result = execSync(`grep -r "${WRONG_DOMAIN}" . --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next`, 
    { encoding: 'utf8' }).trim();
  
  if (result) {
    console.error('❌ Found incorrect URLs for current environment:');
    console.error(result);
    console.error('\n💡 Run the following to fix:');
    console.error(`find . -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" | xargs grep -l "${WRONG_DOMAIN}" | xargs sed -i 's/${WRONG_DOMAIN}/${EXPECTED_DOMAIN}/g'`);
    process.exit(1);
  } else {
    console.log('✅ All URLs are correctly configured for current environment');
  }
} catch (error) {
  if (error.status === 1) {
    console.log('✅ No incorrect URLs found - all good!');
  } else {
    console.error('❌ Error running validation:', error.message);
    process.exit(1);
  }
}
