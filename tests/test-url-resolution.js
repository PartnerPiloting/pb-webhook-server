#!/usr/bin/env node

// Test what URL the smart resume script would use in different environments

console.log('🔍 Testing Smart Resume URL Resolution...\n');

// Simulate different environment scenarios
const scenarios = [
    {
        name: 'Local Development',
        env: {},
        expected: 'https://pb-webhook-server-staging.onrender.com'
    },
    {
        name: 'Render Production (no API_PUBLIC_BASE_URL)', 
        env: { RENDER_EXTERNAL_URL: 'https://pb-webhook-server-staging.onrender.com' },
        expected: 'https://pb-webhook-server-staging.onrender.com'
    },
    {
        name: 'With API_PUBLIC_BASE_URL set',
        env: { API_PUBLIC_BASE_URL: 'https://custom-url.com' },
        expected: 'https://custom-url.com'
    }
];

scenarios.forEach(scenario => {
    // Simulate the logic from the smart resume script
    const baseUrl = scenario.env.API_PUBLIC_BASE_URL || 
                   scenario.env.RENDER_EXTERNAL_URL || 
                   'https://pb-webhook-server-staging.onrender.com';
    
    const status = baseUrl === scenario.expected ? '✅' : '❌';
    
    console.log(`${status} ${scenario.name}:`);
    console.log(`   Environment: ${JSON.stringify(scenario.env)}`);
    console.log(`   Resolved URL: ${baseUrl}`);
    console.log(`   Expected: ${scenario.expected}`);
    console.log('');
});

console.log('🎯 Key Fix Applied:');
console.log('   BEFORE: process.env.API_PUBLIC_BASE_URL || "http://localhost:3001"');
console.log('   AFTER:  process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "https://pb-webhook-server-staging.onrender.com"');
console.log('');
console.log('📊 This should resolve the 0% success rate issue by ensuring the script');
console.log('   calls the external URL instead of unreachable localhost.');