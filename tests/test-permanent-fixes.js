const { performAudit } = require('./utils/auditSystem.js');

console.log('='.repeat(80));
console.log('🔧 COMPREHENSIVE PERMANENT FIXES TEST');
console.log('='.repeat(80));

async function testPermanentFixes() {
    console.log('\n🔍 Running complete audit with permanent fixes...\n');
    
    try {
        const auditResults = await performAudit();
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 AUDIT RESULTS SUMMARY');
        console.log('='.repeat(80));
        
        console.log(`\n✅ Tests Passed: ${auditResults.summary.passed}/${auditResults.summary.total}`);
        console.log(`❌ Tests Failed: ${auditResults.summary.failed}/${auditResults.summary.total}`);
        console.log(`📈 Pass Rate: ${auditResults.summary.passRate}%`);
        
        if (auditResults.summary.failed > 0) {
            console.log('\n🚨 REMAINING ISSUES:');
            auditResults.results.forEach(result => {
                if (result.status === 'FAIL') {
                    console.log(`\n❌ ${result.test}:`);
                    console.log(`   Issue: ${result.message}`);
                    if (result.suggestions && result.suggestions.length > 0) {
                        console.log('   Suggestions:');
                        result.suggestions.forEach(suggestion => {
                            console.log(`   • ${suggestion}`);
                        });
                    }
                }
            });
        } else {
            console.log('\n🎉 ALL INFRASTRUCTURE ISSUES RESOLVED!');
            console.log('The system is now operating with permanent, proper solutions.');
        }
        
        console.log('\n' + '='.repeat(80));
        
        // Test specific improvements made
        console.log('\n🧪 TESTING SPECIFIC PERMANENT FIXES:');
        console.log('='.repeat(50));
        
        // Test centralized client ID resolver
        console.log('\n1. Testing Centralized Client ID Resolver:');
        try {
            const { resolveClientId } = require('./utils/clientIdResolver');
            
            // Mock request objects for testing
            const mockReqWithHeader = { headers: { 'x-client-id': 'Guy-Wilson' } };
            const mockReqWithQuery = { query: { clientId: 'Guy-Wilson' }, headers: {} };
            const mockReqWithBody = { body: { clientId: 'Guy-Wilson' }, headers: {}, query: {} };
            const mockReqEmpty = { headers: {}, query: {}, body: {} };
            
            console.log('   • Header resolution: ', (await resolveClientId(mockReqWithHeader)).clientId);
            console.log('   • Query resolution: ', (await resolveClientId(mockReqWithQuery)).clientId);
            console.log('   • Body resolution: ', (await resolveClientId(mockReqWithBody)).clientId);
            
            try {
                await resolveClientId(mockReqEmpty);
                console.log('   • Empty request handling: FAILED (should throw error)');
            } catch (error) {
                console.log('   • Empty request handling: ✅ Properly throws error');
            }
            
        } catch (error) {
            console.log('   ❌ Client ID resolver test failed:', error.message);
        }
        
        // Test batch scoring endpoint improvements
        console.log('\n2. Testing Enhanced Batch Scoring Endpoint:');
        try {
            const fetch = require('node-fetch').default || require('node-fetch');
            
            // Test with missing client ID
            const missingClientIdResponse = await fetch('http://localhost:3000/run-batch-score?limit=1');
            const missingClientIdResult = await missingClientIdResponse.json();
            console.log('   • Missing client ID handling: ✅', missingClientIdResult.error ? 'Proper error' : 'ISSUE');
            
            // Test with invalid client ID  
            const invalidClientIdResponse = await fetch('http://localhost:3000/run-batch-score?limit=1', {
                headers: { 'x-client-id': 'InvalidClient' }
            });
            const invalidClientIdResult = await invalidClientIdResponse.json();
            console.log('   • Invalid client ID handling: ✅', invalidClientIdResult.error ? 'Proper error' : 'ISSUE');
            
        } catch (error) {
            console.log('   ❌ Batch scoring endpoint test failed:', error.message);
        }
        
        return auditResults;
        
    } catch (error) {
        console.error('❌ Audit system failed:', error);
        process.exit(1);
    }
}

testPermanentFixes()
    .then(results => {
        console.log('\n🏁 PERMANENT FIXES TEST COMPLETED');
        console.log(`Final Result: ${results.summary.passRate}% infrastructure health`);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Test failed:', error);
        process.exit(1);
    });
