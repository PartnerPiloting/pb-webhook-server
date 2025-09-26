// Debug routes for testing and verification
const express = require('express');
const router = express.Router();

// Import for clean architecture verification
const { generateRunId } = require('../src/domain/models/runIdGenerator');
const { AirtableClient } = require('../src/infrastructure/airtable/airtableClient');
const { AiService } = require('../src/infrastructure/ai/aiService');

// Simple verification class for the clean architecture
class ServiceVerifier {
  constructor() {
    this.results = {
      airtable: { status: 'pending', message: '' },
      ai: { status: 'pending', message: '' },
      leadScoring: { status: 'pending', message: '' },
      postHarvesting: { status: 'pending', message: '' },
      postScoring: { status: 'pending', message: '' },
      workflow: { status: 'pending', message: '' },
    };
  }

  async verifyServices(clientId) {
    console.log(`\n=== Verifying Services for Client: ${clientId} ===\n`);
    
    // Generate a unique run ID for this verification
    const runId = generateRunId();
    console.log(`Run ID: ${runId}`);
    
    try {
      // 1. Verify Airtable connectivity
      await this.verifyAirtable(clientId);
      
      // 2. Verify AI service connectivity
      await this.verifyAiService();
      
      // 3. Verify Lead Scoring Service can initialize
      await this.verifyLeadScoringService(clientId, runId);
      
      // 4. Verify Post Harvesting Service can initialize
      await this.verifyPostHarvestingService(clientId, runId);
      
      // 5. Verify Post Scoring Service can initialize
      await this.verifyPostScoringService(clientId, runId);
      
      // 6. Verify Workflow Orchestrator can initialize
      await this.verifyWorkflowOrchestrator(clientId, runId);
      
      return {
        success: this.allPassed(),
        results: this.results,
        runId
      };
    } catch (error) {
      console.error(`\n❌ Verification process failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        results: this.results,
        runId
      };
    }
  }
  
  async verifyAirtable(clientId) {
    try {
      // Initialize Airtable client
      const airtableClient = new AirtableClient();
      
      // Test getting master base
      const masterBase = await airtableClient.getMasterBase();
      
      // Test getting client base
      const clientBase = await airtableClient.getClientBase(clientId);
      
      // Check client record in master base
      const clients = await masterBase('Clients').select({
        filterByFormula: `{Client ID} = "${clientId}"`,
        maxRecords: 1
      }).all();
      
      if (clients.length > 0) {
        this.results.airtable.status = 'passed';
        this.results.airtable.message = `Successfully connected to Airtable and found client "${clients[0].fields['Client Name']}"`;
      } else {
        throw new Error(`Client ${clientId} not found in Master base`);
      }
    } catch (error) {
      console.error(`  ❌ Airtable verification failed: ${error.message}`);
      this.results.airtable.status = 'failed';
      this.results.airtable.message = error.message;
      throw error;
    }
  }
  
  async verifyAiService() {
    try {
      // Initialize AI service
      const aiService = new AiService();
      
      // Test a simple prompt to verify connectivity
      const result = await aiService.generateContent('Return the word "CONNECTED" if you can read this.', {
        model: 'gemini',
        temperature: 0.1,
        maxTokens: 10
      });
      
      if (result.content.includes('CONNECTED')) {
        this.results.ai.status = 'passed';
        this.results.ai.message = 'Successfully connected to AI service';
      } else {
        this.results.ai.status = 'warning';
        this.results.ai.message = 'AI service connected but response was unexpected';
      }
    } catch (error) {
      console.error(`  ❌ AI service verification failed: ${error.message}`);
      this.results.ai.status = 'failed';
      this.results.ai.message = error.message;
      // Don't throw - continue verification
    }
  }
  
  async verifyLeadScoringService(clientId, runId) {
    try {
      // Import the service dynamically to avoid errors if file doesn't exist
      const { LeadScoringService } = require('../src/domain/services/leadScoringService');
      
      // Initialize the service
      const leadScoringService = new LeadScoringService({
        airtableClient: new AirtableClient(),
        aiService: new AiService()
      });
      
      // Initialize the service with client and run ID
      await leadScoringService.initialize(clientId, runId);
      
      this.results.leadScoring.status = 'passed';
      this.results.leadScoring.message = 'Successfully initialized Lead Scoring Service';
    } catch (error) {
      console.error(`  ❌ Lead Scoring Service verification failed: ${error.message}`);
      this.results.leadScoring.status = 'failed';
      this.results.leadScoring.message = error.message;
      // Don't throw - continue verification
    }
  }
  
  async verifyPostHarvestingService(clientId, runId) {
    try {
      // Import the service dynamically to avoid errors if file doesn't exist
      const { PostHarvestingService } = require('../src/domain/services/postHarvestingService');
      
      // Initialize the service (mock Apify client since we're just testing initialization)
      const postHarvestingService = new PostHarvestingService({
        airtableClient: new AirtableClient(),
        // Simple mock Apify client for initialization testing
        apifyClient: { startTask: () => Promise.resolve({ id: 'test-run' }) }
      });
      
      // Initialize the service with client and run ID
      await postHarvestingService.initialize(clientId, runId);
      
      this.results.postHarvesting.status = 'passed';
      this.results.postHarvesting.message = 'Successfully initialized Post Harvesting Service';
    } catch (error) {
      console.error(`  ❌ Post Harvesting Service verification failed: ${error.message}`);
      this.results.postHarvesting.status = 'failed';
      this.results.postHarvesting.message = error.message;
      // Don't throw - continue verification
    }
  }
  
  async verifyPostScoringService(clientId, runId) {
    try {
      // Import the service dynamically to avoid errors if file doesn't exist
      const { PostScoringService } = require('../src/domain/services/postScoringService');
      
      // Initialize the service
      const postScoringService = new PostScoringService({
        airtableClient: new AirtableClient(),
        aiService: new AiService()
      });
      
      // Initialize the service with client and run ID
      await postScoringService.initialize(clientId, runId);
      
      this.results.postScoring.status = 'passed';
      this.results.postScoring.message = 'Successfully initialized Post Scoring Service';
    } catch (error) {
      console.error(`  ❌ Post Scoring Service verification failed: ${error.message}`);
      this.results.postScoring.status = 'failed';
      this.results.postScoring.message = error.message;
      // Don't throw - continue verification
    }
  }
  
  async verifyWorkflowOrchestrator(clientId, runId) {
    try {
      // Import the service dynamically
      const { WorkflowOrchestrator } = require('../src/domain/services/workflowOrchestrator');
      
      // Initialize orchestrator
      const workflowOrchestrator = new WorkflowOrchestrator({
        airtableClient: new AirtableClient(),
        aiService: new AiService(),
        apifyClient: { startTask: () => Promise.resolve({ id: 'test-run' }) }
      });
      
      // Initialize the orchestrator
      await workflowOrchestrator.initialize(clientId, runId);
      
      this.results.workflow.status = 'passed';
      this.results.workflow.message = 'Successfully initialized Workflow Orchestrator';
    } catch (error) {
      console.error(`  ❌ Workflow Orchestrator verification failed: ${error.message}`);
      this.results.workflow.status = 'failed';
      this.results.workflow.message = error.message;
    }
  }
  
  allPassed() {
    return Object.values(this.results).every(result => result.status === 'passed');
  }
}

// Endpoint to verify clean architecture services - can be called from Postman
router.get('/verify-clean-architecture', async (req, res) => {
  const clientId = req.query.clientId || req.headers['x-client-id'];
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const pbApiKey = process.env.PB_API_KEY;
  
  // Validate API key
  if (!apiKey || apiKey !== pbApiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key'
    });
  }
  
  // Validate client ID
  if (!clientId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Missing clientId parameter',
      usage: 'GET /debug/verify-clean-architecture?clientId=<clientId> or provide x-client-id header'
    });
  }
  
  try {
    const verifier = new ServiceVerifier();
    const results = await verifier.verifyServices(clientId);
    
    res.json(results);
  } catch (error) {
    console.error('Error verifying clean architecture:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// Original debug-json endpoint
router.get('/debug-json', (req, res) => {
  try {
    // Create the exact same response structure as authTestRoutes.js
    const response = {
      status: 'success',
      message: 'Authentication successful!',
      client: {
        clientId: 'test-client',
        clientName: 'Test Client',
        status: 'Active',
        airtableBaseId: 'test-base',
        serviceLevel: 2
      },
      authentication: {
        wpUserId: 1,
        testMode: false
      },
      features: {
        leadSearch: true,
        leadManagement: true,
        postScoring: true,
        topScoringPosts: true
      }
    };

    console.log('Debug JSON: Response object:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error('Debug JSON: Error', error);
    res.status(500).json({
      status: 'error',
      message: 'Debug endpoint error',
      details: error.message
    });
  }
});

module.exports = router;
