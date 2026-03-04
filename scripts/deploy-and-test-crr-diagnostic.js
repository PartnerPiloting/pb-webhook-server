#!/usr/bin/env node

/**
 * Deploy and test the Client Run Results diagnostic
 * 
 * 1. Commits and pushes the diagnostic endpoint + service
 * 2. Waits for Render to deploy (~2-3 min)
 * 3. Calls the live endpoint to verify it works
 * 
 * Run: node scripts/deploy-and-test-crr-diagnostic.js
 * 
 * Requires: git, curl (or fetch), env vars for auth
 */

const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://pb-webhook-server.onrender.com';
const AUTH_SECRET = process.env.PB_WEBHOOK_SECRET;
const DEPLOY_WAIT_SEC = parseInt(process.env.DEPLOY_WAIT_SEC || '150', 10); // 2.5 min default
const SKIP_DEPLOY = process.env.SKIP_DEPLOY === 'true'; // Set to just test without pushing

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...opts });
  } catch (e) {
    if (opts.ignoreError) return null;
    throw e;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('DEPLOY AND TEST: Client Run Results Diagnostic');
  console.log('='.repeat(60));
  console.log('');

  if (!AUTH_SECRET) {
    console.error('ERROR: PB_WEBHOOK_SECRET must be set in .env');
    console.error('   Or: set PB_WEBHOOK_SECRET=your_secret node scripts/deploy-and-test-crr-diagnostic.js');
    process.exit(1);
  }

  if (SKIP_DEPLOY) {
    console.log('SKIP_DEPLOY=true - testing existing deployment only');
    console.log('');
  }

  console.log('1. Staging changes...');
  const filesToAdd = [
    'services/diagnoseClientRunResultsService.js',
    'scripts/diagnose-client-run-results.js',
    'scripts/deploy-and-test-crr-diagnostic.js',
    'routes/apiAndJobRoutes.js'
  ];
  run(`git add ${filesToAdd.join(' ')}`, { ignoreError: true });
  const status = run('git status --short', { ignoreError: true }) || '';
  if (!status.trim() || SKIP_DEPLOY) {
    if (!SKIP_DEPLOY) {
      console.log('   No changes to commit (already up to date?)');
    }
    console.log('   Proceeding to test existing deployment...');
  } else {
    console.log('   Staged:', status.trim().split('\n').join(', '));
    console.log('');
    console.log('2. Committing...');
    run('git commit -m "Add Client Run Results diagnostic API endpoint + deploy-and-test script"');
    console.log('   Committed.');
    console.log('');
    console.log('3. Pushing to origin main...');
    run('git push origin main');
    console.log('   Pushed.');
    console.log('');
    if (SKIP_DEPLOY) {
      console.log('4. Skipping deploy wait (SKIP_DEPLOY=true)');
    } else {
      console.log(`4. Waiting ${DEPLOY_WAIT_SEC}s for Render to deploy...`);
      for (let i = DEPLOY_WAIT_SEC; i > 0; i -= 30) {
        process.stdout.write(`   ${i}s remaining...\r`);
        await sleep(Math.min(30, i) * 1000);
      }
      console.log('   Wait complete.');
    }
  }

  console.log('');
  console.log('5. Testing endpoint...');
  const url = `${BASE_URL}/debug-client-run-results`;
  const authHeader = `Bearer ${AUTH_SECRET}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader }
    });
    const data = await res.json();

    if (res.ok) {
      console.log('   ✅ Endpoint OK');
      console.log('   Status:', data.overallStatus || data.message || 'unknown');
      if (data.clientRunResults?.summary) {
        const s = data.clientRunResults.summary;
        console.log(`   Records: ${s.total} total, ${s.withProgressLog} with Progress Log`);
      }
      console.log('');
      console.log('   Full response:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`   ❌ ${res.status} ${res.statusText}`);
      console.log(JSON.stringify(data, null, 2));
      process.exit(1);
    }
  } catch (err) {
    console.log(`   ❌ Request failed: ${err.message}`);
    console.log('');
    console.log('   Try manually:');
    console.log(`   curl.exe -s -H "Authorization: Bearer YOUR_SECRET" "${BASE_URL}/debug-client-run-results"`);
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('DONE');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
