// Test script for multi-tenant webhook
const axios = require('axios');

const testWebhook = async () => {
    const testData = [
        {
            firstName: "John",
            lastName: "Doe", 
            profileUrl: "https://www.linkedin.com/in/johndoe/",
            headline: "Software Engineer",
            companyName: "Tech Corp",
            email: "john@example.com",
            connectionDegree: "2nd"
        }
    ];

    try {
        console.log('Testing webhook with client parameter...');
        
        const response = await axios.post('http://localhost:3000/lh-webhook/upsertLeadOnly?client=CLIENT123', testData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('Webhook Response:', response.data);
        console.log('Test completed successfully!');
        
    } catch (error) {
        console.error('Webhook Test Failed:', error.response?.data || error.message);
    }
};

testWebhook();
