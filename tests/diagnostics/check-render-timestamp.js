#!/usr/bin/env node

// Quick script to check Render staging logs for activity 56 minutes ago
// Run this to get the exact timestamp to search for

const now = new Date();
const minutesAgo56 = new Date(now.getTime() - (56 * 60 * 1000));

console.log('🕐 TIMESTAMP REFERENCE FOR RENDER LOGS');
console.log('='.repeat(50));
console.log('Current time:', now.toISOString());
console.log('56 minutes ago:', minutesAgo56.toISOString());
console.log('');
console.log('📋 Search patterns for Render logs:');
console.log(`Time range: ${minutesAgo56.toISOString().slice(11, 16)} to ${now.toISOString().slice(11, 16)}`);
console.log('');
console.log('🔍 Look for these patterns:');
console.log('- 🚀 apiAndJobRoutes.js: /run-post-batch-score-v2');
console.log('- 🔄 Background post scoring started');
console.log('- 🎯 Processing client');
console.log('- ✅ or ❌ completion messages');
console.log('- Any ERROR or WARN messages');
console.log('');
console.log('📱 How to check:');
console.log('1. Go to Render Dashboard');
console.log('2. Find pb-webhook-server-staging service');
console.log('3. Click "Logs" tab');
console.log('4. Search around timestamp:', minutesAgo56.toISOString());
console.log('');
console.log('💡 If you find error messages, paste them here and I\'ll help debug!');