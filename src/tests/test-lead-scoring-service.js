/**
 * test-lead-scoring-service.js
 * 
 * A simple test script to verify the lead scoring service works correctly.
 * This tests the ability to score leads using the AI service.
 */

require('dotenv').config();
const { Logger } = require('../infrastructure/logging/logger');
const leadScoringService = require('../domain/services/leadScoringService');
const { generateRunId } = require('../domain/models/runIdGenerator');

// Create a logger
const logger = new Logger('TEST', null, 'test-lead-scoring');

/**
 * Mock lead data for testing
 */
const mockLeads = [
  {
    id: 'mock1',
    fields: {
      'Full Name': 'John Smith',
      'LinkedIn Profile URL': 'https://linkedin.com/in/johnsmith',
      'LinkedIn Profile Data': JSON.stringify({
        headline: 'Director of Sales at SaaS Company',
        location: 'San Francisco, CA',
        summary: 'Experienced sales leader with 10+ years in B2B SaaS',
        experience: [
          {
            title: 'Director of Sales',
            company: 'SaaS Company',
            dateRange: '2020 - Present',
            description: 'Leading a team of 15 sales representatives'
          },
          {
            title: 'Sales Manager',
            company: 'Tech Solutions Inc',
            dateRange: '2015 - 2020',
            description: 'Managed a team of 8 sales representatives'
          }
        ]
      })
    }
  },
  {
    id: 'mock2',
    fields: {
      'Full Name': 'Jane Doe',
      'LinkedIn Profile URL': 'https://linkedin.com/in/janedoe',
      'LinkedIn Profile Data': JSON.stringify({
        headline: 'Marketing Director at Enterprise Solutions',
        location: 'New York, NY',
        summary: '12 years of marketing experience in the tech industry',
        experience: [
          {
            title: 'Marketing Director',
            company: 'Enterprise Solutions',
            dateRange: '2018 - Present',
            description: 'Oversee all marketing initiatives'
          },
          {
            title: 'Marketing Manager',
            company: 'Digital Innovations',
            dateRange: '2014 - 2018',
            description: 'Managed digital marketing campaigns'
          }
        ]
      })
    }
  }
];

/**
 * Test the lead scoring service
 * @param {string} clientId - The client ID to test with
 */
async function testLeadScoringService(clientId) {
  logger.info('Starting lead scoring service test');
  
  try {
    // Generate a unique run ID for testing
    const runId = generateRunId();
    logger.info(`Generated run ID: ${runId}`);
    
    // Test with mock ICP description
    const icpDescription = 'Decision makers (Director level and above) in sales, marketing, or revenue operations at B2B SaaS companies with 50+ employees.';
    
    // Score the mock leads
    logger.info('Scoring mock leads...');
    const results = await leadScoringService.scoreLeads(mockLeads, clientId, runId, {
      logger,
      icpDescription
    });
    
    // Log the results
    logger.info(`Scoring complete: ${results.successful} successful, ${results.failed} failed`);
    logger.info(`Total tokens used: ${results.totalTokens}`);
    
    // Log individual results
    results.details.forEach(detail => {
      if (detail.success) {
        logger.info(`Lead ${detail.leadId}: Score = ${detail.score}, Reason = ${detail.reason}`);
      } else {
        logger.error(`Lead ${detail.leadId}: Failed - ${detail.error}`);
      }
    });
    
    logger.info('Lead scoring service test completed successfully');
    return true;
  } catch (error) {
    logger.error(`Test failed: ${error.message}`, error.stack);
    return false;
  }
}

/**
 * Main entry point
 */
async function main() {
  // Check if client ID is provided
  const clientId = process.argv[2];
  if (!clientId) {
    console.log('Usage: node test-lead-scoring-service.js <clientId>');
    process.exit(1);
  }
  
  logger.info(`Testing with client ID: ${clientId}`);
  const success = await testLeadScoringService(clientId);
  
  if (success) {
    logger.info('✅ All tests passed');
    process.exit(0);
  } else {
    logger.error('❌ Test failed');
    process.exit(1);
  }
}

// Run the test if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testLeadScoringService };