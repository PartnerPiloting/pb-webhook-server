// trigger-redeploy.js
// This file is just to trigger a redeploy on Render
// Render will automatically run npm install which will fix the missing dependency issue

console.log('Triggering Render redeploy to resolve dependencies...');
console.log('Fix for express-rate-limit dependency applied.');

module.exports = {
  triggerTimestamp: new Date().toISOString(),
  fixesApplied: [
    'Added run_record_recovery to allowedSources',
    'Enhanced updateRunRecord with recovery path',
    'Express-rate-limit dependency resolution'
  ]
};