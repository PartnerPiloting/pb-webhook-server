/**
 * verify-services.js
 * 
 * A simple script to verify that the new clean architecture services are working on staging.
 * This script does NOT require complex mock setups - it just verifies the services can initialize 
 * and access their dependencies.
 */

require('dotenv').config();
const { WorkflowOrchestrator } = require('./domain/services/workflowOrchestrator');
const { AirtableClient } = require('./infrastructure/airtable/airtableClient');
const { AiService } = require('./infrastructure/ai/aiService');
const { generateRunId } = require('./domain/models/runIdGenerator');

// Simple verification class
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
      
      // Print summary
      this.printSummary();
      
      return this.allPassed();
    } catch (error) {
      console.error(`\n❌ Verification process failed: ${error.message}`);
      this.printSummary();
      return false;
    }
  }
  
  async verifyAirtable(clientId) {
    console.log('\n📊 Verifying Airtable connectivity...');
    try {
      // Initialize Airtable client
      const airtableClient = new AirtableClient();
      
      // Test getting master base
      const masterBase = await airtableClient.getMasterBase();
      console.log('  ✓ Connected to Master base');
      
      // Test getting client base
      const clientBase = await airtableClient.getClientBase(clientId);
      console.log('  ✓ Connected to Client base');
      
      // Check client record in master base
      const clients = await masterBase('Clients').select({
        filterByFormula: `{Client ID} = "${clientId}"`,
        maxRecords: 1
      }).all();
      
      if (clients.length > 0) {
        console.log(`  ✓ Found client "${clients[0].fields['Client Name']}" in Master base`);
        this.results.airtable.status = 'passed';
        this.results.airtable.message = 'Successfully connected to Airtable and found client';
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
    console.log('\n🤖 Verifying AI service connectivity...');
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
        console.log('  ✓ Gemini AI service responded correctly');
        this.results.ai.status = 'passed';
        this.results.ai.message = 'Successfully connected to AI service';
      } else {
        console.log('  ⚠️ Gemini AI service responded but with unexpected content');
        this.results.ai.status = 'warning';
        this.results.ai.message = 'AI service connected but response was unexpected';
      }
    } catch (error) {
      console.error(`  ❌ AI service verification failed: ${error.message}`);
      console.log('  ⚠️ Will continue verification since other services might work');
      this.results.ai.status = 'failed';
      this.results.ai.message = error.message;
      // Don't throw - continue verification
    }
  }
  
  async verifyLeadScoringService(clientId, runId) {
    console.log('\n📈 Verifying Lead Scoring Service...');
    try {
      // Import the service dynamically to avoid errors if file doesn't exist
      const { LeadScoringService } = require('./domain/services/leadScoringService');
      
      // Initialize the service
      const leadScoringService = new LeadScoringService({
        airtableClient: new AirtableClient(),
        aiService: new AiService()
      });
      
      // Initialize the service with client and run ID
      await leadScoringService.initialize(clientId, runId);
      
      console.log('  ✓ Lead Scoring Service initialized successfully');
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
    console.log('\n🌾 Verifying Post Harvesting Service...');
    try {
      // Import the service dynamically to avoid errors if file doesn't exist
      const { PostHarvestingService } = require('./domain/services/postHarvestingService');
      
      // Initialize the service (mock Apify client since we're just testing initialization)
      const postHarvestingService = new PostHarvestingService({
        airtableClient: new AirtableClient(),
        // Simple mock Apify client for initialization testing
        apifyClient: { startTask: () => Promise.resolve({ id: 'test-run' }) }
      });
      
      // Initialize the service with client and run ID
      await postHarvestingService.initialize(clientId, runId);
      
      console.log('  ✓ Post Harvesting Service initialized successfully');
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
    console.log('\n🎯 Verifying Post Scoring Service...');
    try {
      // Import the service dynamically to avoid errors if file doesn't exist
      const { PostScoringService } = require('./domain/services/postScoringService');
      
      // Initialize the service
      const postScoringService = new PostScoringService({
        airtableClient: new AirtableClient(),
        aiService: new AiService()
      });
      
      // Initialize the service with client and run ID
      await postScoringService.initialize(clientId, runId);
      
      console.log('  ✓ Post Scoring Service initialized successfully');
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
    console.log('\n🔄 Verifying Workflow Orchestrator...');
    try {
      // Initialize orchestrator
      const workflowOrchestrator = new WorkflowOrchestrator({
        airtableClient: new AirtableClient(),
        aiService: new AiService(),
        apifyClient: { startTask: () => Promise.resolve({ id: 'test-run' }) }
      });
      
      // Initialize the orchestrator
      await workflowOrchestrator.initialize(clientId, runId);
      
      console.log('  ✓ Workflow Orchestrator initialized successfully');
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
  
  printSummary() {
    console.log('\n=== Verification Summary ===');
    
    for (const [service, result] of Object.entries(this.results)) {
      const icon = result.status === 'passed' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      console.log(`${icon} ${service}: ${result.status.toUpperCase()} - ${result.message}`);
    }
    
    if (this.allPassed()) {
      console.log('\n✅ ALL SERVICES VERIFIED SUCCESSFULLY');
    } else {
      console.log('\n⚠️ SOME SERVICES FAILED VERIFICATION');
    }
  }
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const clientId = process.argv[2];
  
  if (!clientId) {
    console.log('Usage: node verify-services.js <clientId>');
    process.exit(1);
  }
  
  const verifier = new ServiceVerifier();
  const success = await verifier.verifyServices(clientId);
  
  if (success) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { ServiceVerifier };