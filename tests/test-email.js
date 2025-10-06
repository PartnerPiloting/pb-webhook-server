// Quick test of Mailgun email functionality
require('dotenv').config();
const emailService = require('./services/emailReportingService');

async function testEmail() {
    console.log('Testing Mailgun email...');
    
    const testReport = {
        runId: 'test_123',
        stream: 1,
        startTime: Date.now(),
        endTime: Date.now() + 5000,
        duration: 5000,
        clientsAnalyzed: 2,
        clientsSkipped: 0,
        clientsProcessed: 2,
        totalOperationsTriggered: 2,
        totalJobsStarted: 2,
        successRate: 100,
        executionResults: [
            {
                clientName: 'Test Client',
                results: [
                    { operation: 'lead_scoring', success: true, jobId: 'test_job_123' }
                ]
            }
        ],
        skippedClients: [],
        errors: []
    };
    
    const result = await emailService.sendExecutionReport(testReport);
    console.log('Email result:', result);
}

testEmail().catch(console.error);