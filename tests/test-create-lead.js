const https = require('https');

// Test data for creating a new lead
const testLead = {
    firstName: 'Test',
    lastName: 'User',
    source: 'Follow-Up Personally',
    status: 'On The Radar',
    email: 'test@example.com',
    notes: 'Test lead created via API test script'
};

// API endpoint
const apiUrl = 'https://pb-webhook-server.onrender.com/api/linkedin/leads?client=Guy-Wilson';

function testCreateLead() {
    console.log('🧪 Testing POST /api/linkedin/leads endpoint...');
    console.log('📤 Sending test data:', JSON.stringify(testLead, null, 2));
    
    const postData = JSON.stringify(testLead);
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    
    const req = https.request(apiUrl, options, (res) => {
        let responseBody = '';
        
        res.on('data', (chunk) => {
            responseBody += chunk;
        });
        
        res.on('end', () => {
            console.log(`\n📥 Response Status: ${res.statusCode}`);
            
            try {
                const response = JSON.parse(responseBody);
                
                if (res.statusCode === 201) {
                    console.log('✅ SUCCESS: Lead created successfully!');
                    console.log('📋 Created Lead Details:');
                    console.log(`   • ID: ${response.id}`);
                    console.log(`   • Name: ${response.firstName} ${response.lastName}`);
                    console.log(`   • LinkedIn URL: ${response.linkedinProfileUrl}`);
                    console.log(`   • Source: ${response.source}`);
                    console.log(`   • Status: ${response.status}`);
                    console.log(`   • Email: ${response.email}`);
                    
                    // Verify field mappings exist
                    console.log('\n🔍 Field Mapping Verification:');
                    console.log(`   • Spaced format - First Name: ${response['First Name']}`);
                    console.log(`   • CamelCase format - firstName: ${response.firstName}`);
                    console.log(`   • Both formats match: ${response['First Name'] === response.firstName ? '✅' : '❌'}`);
                    
                    // Check if LinkedIn URL was auto-generated
                    if (response.linkedinProfileUrl.startsWith('unknown-')) {
                        console.log('✅ LinkedIn URL auto-generation working');
                    } else {
                        console.log('⚠️  LinkedIn URL auto-generation may not be working');
                    }
                    
                } else {
                    console.log('❌ FAILED: Error creating lead');
                    console.log('📄 Error Response:', JSON.stringify(response, null, 2));
                }
                
            } catch (parseError) {
                console.log('❌ FAILED: Could not parse response');
                console.log('📄 Raw Response:', responseBody);
            }
        });
    });
    
    req.on('error', (error) => {
        console.log('❌ FAILED: Request error');
        console.log('📄 Error:', error.message);
    });
    
    req.write(postData);
    req.end();
}

// Test cases
console.log('🚀 Starting Backend Route Test for New Lead Creation');
console.log('🎯 Target API:', apiUrl);
console.log('⏱️  This may take 10-30 seconds if Render needs to wake up...\n');

testCreateLead();

// Additional test with LinkedIn URL provided
setTimeout(() => {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 Testing with provided LinkedIn URL...');
    
    const testLeadWithLinkedIn = {
        ...testLead,
        firstName: 'Test2',
        lastName: 'User2',
        linkedinProfileUrl: 'https://www.linkedin.com/in/testuser2',
        email: 'test2@example.com'
    };
    
    const postData2 = JSON.stringify(testLeadWithLinkedIn);
    
    const req2 = https.request(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData2)
        }
    }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => responseBody += chunk);
        res.on('end', () => {
            console.log(`📥 Response Status: ${res.statusCode}`);
            try {
                const response = JSON.parse(responseBody);
                if (res.statusCode === 201) {
                    console.log('✅ SUCCESS: Lead with LinkedIn URL created!');
                    console.log(`   • LinkedIn URL: ${response.linkedinProfileUrl}`);
                    console.log(`   • URL preserved: ${response.linkedinProfileUrl === testLeadWithLinkedIn.linkedinProfileUrl ? '✅' : '❌'}`);
                } else {
                    console.log('❌ FAILED:', response.message || 'Unknown error');
                }
            } catch (e) {
                console.log('❌ Parse error:', responseBody);
            }
        });
    });
    
    req2.write(postData2);
    req2.end();
}, 2000);

console.log('\n💡 Note: If this test fails due to duplicate LinkedIn URLs, that means previous tests worked!');
console.log('💡 Check your Airtable to see if the test leads were created successfully.'); 