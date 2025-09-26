/**
 * test-post-scoring-service.js
 * 
 * A test script to verify the post scoring service works correctly.
 * Tests the ability to score LinkedIn posts using AI.
 */

require('dotenv').config();
const { Logger } = require('../infrastructure/logging/logger');
const { PostScoringService } = require('../domain/services/postScoringService');
const { generateRunId } = require('../domain/models/runIdGenerator');
const { AirtableClient } = require('../infrastructure/airtable/airtableClient');
const { AiService } = require('../infrastructure/ai/aiService');
const { STATUS, FIELDS } = require('../domain/models/constants');

// Create a logger
const logger = new Logger('TEST', null, 'test-post-scoring');

/**
 * Mock AI service for testing
 */
class MockAiService extends AiService {
  async generateContent(prompt, options = {}) {
    logger.info(`Mock AI generating content with ${prompt.length} characters`);
    
    // Simulate token usage
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = 200;
    const totalTokens = inputTokens + outputTokens;
    
    // Generate mock response based on prompt content
    let score, reason;
    
    if (prompt.includes('pain point') || prompt.includes('challenge')) {
      score = 8;
      reason = 'The post directly mentions pain points our solution addresses and indicates active interest in solutions. The timing appears good for outreach.';
    } else if (prompt.includes('interested') || prompt.includes('looking for')) {
      score = 7;
      reason = 'The post shows clear interest in relevant topics and the author appears to be in an active buying consideration phase.';
    } else {
      score = 4;
      reason = 'While the post is from our target demographic, it does not contain specific signals of interest or pain points we address.';
    }
    
    const content = `
Based on my analysis, this post should be scored:

{
  "score": ${score},
  "reason": "${reason}"
}

I've scored it based on the signals of interest, relevance to your solution, and timeliness for outreach.`;
    
    return {
      content,
      inputTokens,
      outputTokens,
      totalTokens
    };
  }
}

/**
 * Mock post data for testing
 */
const mockPosts = [
  {
    id: 'post1',
    fields: {
      'Post Content': 'Looking for recommendations on sales automation tools. Our team has been struggling with manual follow-ups and we need a solution that can help us scale our outreach efforts. Any suggestions?',
      'Post URL': 'https://linkedin.com/post/123',
      'Post Date': '2023-12-01',
      'Lead Record ID': 'lead1'
    }
  },
  {
    id: 'post2',
    fields: {
      'Post Content': 'Just completed my first quarter as Sales Director. Excited about the growth, but we definitely need better tools for tracking our pipeline and automating routine tasks.',
      'Post URL': 'https://linkedin.com/post/456',
      'Post Date': '2023-11-15',
      'Lead Record ID': 'lead1'
    }
  },
  {
    id: 'post3',
    fields: {
      'Post Content': 'Enjoyed my vacation in Hawaii last week. The beaches were amazing!',
      'Post URL': 'https://linkedin.com/post/789',
      'Post Date': '2023-10-20',
      'Lead Record ID': 'lead2'
    }
  }
];

/**
 * Mock lead data for testing
 */
const mockLeads = [
  {
    id: 'lead1',
    fields: {
      'Full Name': 'John Smith',
      'LinkedIn Profile URL': 'https://linkedin.com/in/johnsmith',
      'ICP Score': 8,
      'Lead Status': 'Active'
    },
    posts: [mockPosts[0], mockPosts[1]]
  },
  {
    id: 'lead2',
    fields: {
      'Full Name': 'Jane Doe',
      'LinkedIn Profile URL': 'https://linkedin.com/in/janedoe',
      'ICP Score': 6,
      'Lead Status': 'New'
    },
    posts: [mockPosts[2]]
  }
];

/**
 * Test the post scoring service with mock data
 * @param {string} clientId - The client ID to test with
 */
async function testPostScoringServiceWithMocks(clientId) {
  logger.info('Starting post scoring service test with mock data');
  
  try {
    // Generate a unique run ID for testing
    const runId = generateRunId();
    logger.info(`Generated run ID: ${runId}`);
    
    // Create mock AI service
    const mockAiService = new MockAiService();
    
    // Create mock repository
    class MockRepository {
      constructor() {
        this.records = new Map();
        this.updates = [];
      }
      
      async findRecords(table, query) {
        logger.info(`Mock findRecords for table ${table}`);
        if (table === 'Leads') {
          return mockLeads;
        } else if (table === 'Posts') {
          return mockPosts;
        }
        return [];
      }
      
      async updateRecord(table, id, fields) {
        logger.info(`Mock updateRecord for ${table} ${id}`);
        this.updates.push({ table, id, fields });
        return { id, fields };
      }
      
      getUpdates() {
        return this.updates;
      }
    }
    
    const mockRepository = new MockRepository();
    
    // Create the post scoring service
    const postScoringService = new PostScoringService({
      aiService: mockAiService
    });
    
    // Set up mock repository
    postScoringService.repository = mockRepository;
    
    // Mock run record service
    postScoringService.runRecordService = {
      createOrUpdateRunRecord: async (runId, data) => {
        logger.info(`Mock createOrUpdateRunRecord: ${runId}`);
        return { id: 'run-record-1', ...data };
      },
      updateRunRecord: async (runId, data) => {
        logger.info(`Mock updateRunRecord: ${runId}`);
        return { id: 'run-record-1', ...data };
      }
    };
    
    postScoringService.logger = logger;
    
    // Test the private _processLeadsWithPosts method directly
    logger.info('Testing _processLeadsWithPosts method...');
    const client = {
      id: clientId,
      fields: {
        'ICP Description': 'Decision makers in sales and marketing at mid-to-large companies who are looking for automation and efficiency tools.'
      }
    };
    
    const processingResult = await postScoringService._processLeadsWithPosts(mockLeads, client, runId);
    
    logger.info(`Processing result: ${JSON.stringify(processingResult, null, 2)}`);
    logger.info(`Updates made: ${mockRepository.getUpdates().length}`);
    
    // Verify results
    if (processingResult.postsScored > 0) {
      logger.info(`✅ Successfully scored ${processingResult.postsScored} posts`);
      logger.info(`Total tokens used: ${processingResult.totalTokens}`);
    } else {
      logger.error('❌ No posts were scored');
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Test failed: ${error.message}`, error.stack);
    return false;
  }
}

/**
 * Test the post scoring service with real data
 * @param {string} clientId - The client ID to test with
 */
async function testPostScoringServiceReal(clientId) {
  logger.info('Starting post scoring service test with real data');
  
  try {
    // Generate a unique run ID for testing
    const runId = generateRunId();
    logger.info(`Generated run ID: ${runId}`);
    
    // Initialize Airtable client
    const airtableClient = new AirtableClient();
    
    // Create the post scoring service
    const postScoringService = new PostScoringService({
      airtableClient,
      aiService: new AiService()
    });
    
    // Initialize the service
    await postScoringService.initialize(clientId, runId, {
      logger
    });
    
    // Test scorePosts method
    logger.info('Starting post scoring test...');
    const result = await postScoringService.scorePosts(clientId, runId, {
      logger,
      // Optionally limit number of posts to process
      limit: 3,
      defaultIcpDescription: 'Decision makers in sales and marketing at mid-to-large companies looking for automation tools.'
    });
    
    // Log the results
    logger.info(`Post scoring result: ${JSON.stringify(result, null, 2)}`);
    
    // Verify results
    if (result.status === STATUS.COMPLETED) {
      logger.info(`✅ Post scoring completed successfully`);
      logger.info(`Leads processed: ${result.leadsProcessed}`);
      logger.info(`Posts processed: ${result.postsProcessed}`);
      logger.info(`Posts scored: ${result.postsScored}`);
      logger.info(`Total tokens used: ${result.totalTokens}`);
    } else {
      logger.error(`❌ Post scoring failed: ${result.errors.join(', ')}`);
      return false;
    }
    
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
  const mockOnly = process.argv[3] === '--mock-only';
  
  if (!clientId) {
    console.log('Usage: node test-post-scoring-service.js <clientId> [--mock-only]');
    process.exit(1);
  }
  
  logger.info(`Testing with client ID: ${clientId}, mock only: ${mockOnly}`);
  
  // First run the mock test
  const mockSuccess = await testPostScoringServiceWithMocks(clientId);
  
  // Then run the real test if not mock only
  let realSuccess = true;
  if (!mockOnly) {
    realSuccess = await testPostScoringServiceReal(clientId);
  }
  
  if (mockSuccess && realSuccess) {
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

module.exports = { testPostScoringServiceWithMocks, testPostScoringServiceReal };