/**
 * Smart Follow-Up Service
 * 
 * Handles the daily sweep that populates the Smart FUP State table.
 * This service:
 * 1. Finds leads needing follow-up (two-stage filter)
 * 2. Analyzes Notes to generate AI outputs
 * 3. Upserts records to Smart FUP State table
 * 
 * See: docs/SMART-FOLLOWUP-DECISIONS.md for design decisions
 */

require('dotenv').config();
const Airtable = require('airtable');
const { createLogger } = require('../utils/contextLogger');
const { SMART_FUP_STATE_FIELDS } = require('../scripts/setup-smart-fup-airtable');
const { getAllClients, getClientBase, initializeClientsBase } = require('./clientService');

// Create module-level logger
const logger = createLogger({
  runId: 'SMART-FUP',
  clientId: 'SYSTEM',
  operation: 'smart-followup-sweep'
});

// ============================================
// CONSTANTS
// ============================================

// How many days back to look for "recent activity" safety net
const SAFETY_NET_DAYS = 14;

// Leads table field names
const LEAD_FIELDS = {
  FIRST_NAME: 'First Name',
  LAST_NAME: 'Last Name',
  EMAIL: 'Email',
  LINKEDIN_URL: 'LinkedIn Profile URL',
  FOLLOW_UP_DATE: 'Follow-Up Date',
  CEASE_FUP: 'Cease FUP',
  NOTES: 'Notes',
  STATUS: 'Status',
  PRIORITY: 'Priority',
};

// ============================================
// BASE CONNECTIONS
// ============================================

// Note: Using getClientBase and initializeClientsBase from clientService.js
// to avoid duplication. initializeClientsBase() returns Master Clients base.

// ============================================
// TWO-STAGE FILTER LOGIC
// ============================================

/**
 * Stage 1: Airtable filter - get candidate leads
 * Returns leads that are:
 * - Not ceased
 * - AND (Follow-Up Date <= today OR no Follow-Up Date but recently modified)
 */
function buildCandidateFilter() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Build the filter formula
  // Note: LAST_MODIFIED_TIME() returns record modification time
  return `AND(
    OR({${LEAD_FIELDS.CEASE_FUP}} != 'Yes', {${LEAD_FIELDS.CEASE_FUP}} = BLANK()),
    OR(
      AND({${LEAD_FIELDS.FOLLOW_UP_DATE}} != '', {${LEAD_FIELDS.FOLLOW_UP_DATE}} <= '${today}'),
      AND(
        OR({${LEAD_FIELDS.FOLLOW_UP_DATE}} = '', {${LEAD_FIELDS.FOLLOW_UP_DATE}} = BLANK()),
        LAST_MODIFIED_TIME() >= DATEADD(TODAY(), -${SAFETY_NET_DAYS}, 'days')
      )
    )
  )`.replace(/\s+/g, ' ').trim();
}

/**
 * Stage 2: Code filter - check if Notes indicate conversation activity
 * Returns true if the lead should be processed
 */
function hasConversationActivity(notes) {
  if (!notes || typeof notes !== 'string') return false;
  
  // Look for conversation indicators
  const indicators = [
    // Date patterns in notes (e.g., "[05-Feb-26]", "2026-02-05")
    /\[\d{1,2}-[A-Za-z]{3}-\d{2}\]/,
    /\d{4}-\d{2}-\d{2}/,
    // LinkedIn message patterns
    /linkedin message/i,
    /sent message/i,
    /replied/i,
    /response from/i,
    // Meeting patterns
    /meeting/i,
    /call with/i,
    /spoke with/i,
    /fathom/i,
    // Email patterns
    /email sent/i,
    /emailed/i,
    // Manual note headers
    /## MANUAL/i,
    /## LinkedIn/i,
    /## Email/i,
  ];
  
  return indicators.some(pattern => pattern.test(notes));
}

// ============================================
// AI ANALYSIS (Placeholder for now)
// ============================================

/**
 * Analyze a lead's Notes to generate AI outputs
 * TODO: Implement actual AI call (Gemini)
 * 
 * For now, returns placeholder data for testing the pipeline
 */
async function analyzeLeadNotes(lead, clientInstructions, clientType) {
  const notes = lead.fields[LEAD_FIELDS.NOTES] || '';
  
  // Placeholder AI analysis - replace with actual Gemini call
  // For testing, we generate deterministic outputs based on notes content
  
  // Determine waiting_on based on notes patterns
  let waitingOn = 'None';
  if (/they replied|their response|waiting to hear/i.test(notes)) {
    waitingOn = 'Lead';
  } else if (/need to follow up|should reach out|owe them/i.test(notes)) {
    waitingOn = 'User';
  }
  
  // Determine priority
  let priority = 'Medium';
  if (waitingOn === 'User') {
    priority = 'High'; // They replied, user owes response
  } else if (/meeting|call scheduled/i.test(notes)) {
    priority = 'High'; // Had meeting engagement
  } else if (!notes || notes.length < 100) {
    priority = 'Low'; // Minimal engagement
  }
  
  // Determine channel
  let channel = 'LinkedIn';
  if (lead.fields[LEAD_FIELDS.EMAIL] && /email/i.test(notes)) {
    channel = 'Email';
  }
  
  // Generate story placeholder
  const firstName = lead.fields[LEAD_FIELDS.FIRST_NAME] || 'Lead';
  const story = `[AI Placeholder] Relationship with ${firstName}. ` +
    `Notes contain ${notes.length} characters. ` +
    `Last activity detected in notes. Waiting on: ${waitingOn}.`;
  
  // Generate suggested message placeholder
  const suggestedMessage = `[AI Placeholder] Hi ${firstName}, ` +
    `following up on our previous conversation. ` +
    `Would love to reconnect and hear how things are going.`;
  
  // AI suggested date - placeholder logic
  let aiSuggestedDate = null;
  let aiDateReasoning = null;
  
  if (!lead.fields[LEAD_FIELDS.FOLLOW_UP_DATE]) {
    // No user date set - AI suggests one
    const suggestDate = new Date();
    suggestDate.setDate(suggestDate.getDate() + 3); // Suggest 3 days from now
    aiSuggestedDate = suggestDate.toISOString().split('T')[0];
    aiDateReasoning = '[AI Placeholder] No follow-up date set. Suggesting 3 days from now based on typical follow-up cadence.';
  }
  
  return {
    story,
    priority,
    waitingOn,
    suggestedMessage,
    recommendedChannel: channel,
    aiSuggestedDate,
    aiDateReasoning,
  };
}

// ============================================
// SMART FUP STATE TABLE OPERATIONS
// ============================================

/**
 * Find existing Smart FUP State record for a client+lead combination
 */
async function findExistingStateRecord(clientId, leadId) {
  const base = initializeClientsBase();
  
  try {
    const records = await base('Smart FUP State').select({
      filterByFormula: `AND({${SMART_FUP_STATE_FIELDS.CLIENT_ID}} = '${clientId}', {${SMART_FUP_STATE_FIELDS.LEAD_ID}} = '${leadId}')`,
      maxRecords: 1
    }).firstPage();
    
    return records.length > 0 ? records[0] : null;
  } catch (error) {
    logger.warn(`Error finding existing state record: ${error.message}`);
    return null;
  }
}

/**
 * Upsert a Smart FUP State record
 */
async function upsertStateRecord(clientId, lead, aiOutput, dryRun = false) {
  const base = initializeClientsBase();
  const leadId = lead.id;
  
  const recordData = {
    [SMART_FUP_STATE_FIELDS.CLIENT_ID]: clientId,
    [SMART_FUP_STATE_FIELDS.LEAD_ID]: leadId,
    [SMART_FUP_STATE_FIELDS.LEAD_EMAIL]: lead.fields[LEAD_FIELDS.EMAIL] || '',
    [SMART_FUP_STATE_FIELDS.LEAD_LINKEDIN]: lead.fields[LEAD_FIELDS.LINKEDIN_URL] || '',
    [SMART_FUP_STATE_FIELDS.GENERATED_TIME]: new Date().toISOString(),
    [SMART_FUP_STATE_FIELDS.STORY]: aiOutput.story,
    [SMART_FUP_STATE_FIELDS.PRIORITY]: aiOutput.priority,
    [SMART_FUP_STATE_FIELDS.SUGGESTED_MESSAGE]: aiOutput.suggestedMessage,
    [SMART_FUP_STATE_FIELDS.RECOMMENDED_CHANNEL]: aiOutput.recommendedChannel,
    [SMART_FUP_STATE_FIELDS.WAITING_ON]: aiOutput.waitingOn,
  };
  
  // Add AI suggested date fields if present
  if (aiOutput.aiSuggestedDate) {
    recordData[SMART_FUP_STATE_FIELDS.AI_SUGGESTED_FUP_DATE] = aiOutput.aiSuggestedDate;
  }
  if (aiOutput.aiDateReasoning) {
    recordData[SMART_FUP_STATE_FIELDS.AI_DATE_REASONING] = aiOutput.aiDateReasoning;
  }
  
  if (dryRun) {
    logger.info(`[DRY RUN] Would upsert: ${clientId} / ${leadId}`);
    return { dryRun: true, data: recordData };
  }
  
  try {
    // Check if record exists
    const existing = await findExistingStateRecord(clientId, leadId);
    
    if (existing) {
      // Update existing record
      const updated = await base('Smart FUP State').update(existing.id, recordData);
      logger.info(`Updated state record for ${clientId}/${leadId}`);
      return { action: 'updated', recordId: updated.id };
    } else {
      // Create new record
      const created = await base('Smart FUP State').create(recordData);
      logger.info(`Created state record for ${clientId}/${leadId}`);
      return { action: 'created', recordId: created.id };
    }
  } catch (error) {
    logger.error(`Error upserting state record: ${error.message}`);
    throw error;
  }
}

// ============================================
// MAIN SWEEP FUNCTION
// ============================================

/**
 * Run the Smart Follow-Up sweep for a single client
 * 
 * @param {Object} options
 * @param {string} options.clientId - Client ID (e.g., "Guy-Wilson")
 * @param {string} options.baseId - Client's Airtable base ID
 * @param {string} options.clientType - Client type (A/B/C)
 * @param {string} options.fupInstructions - Client's FUP AI Instructions
 * @param {boolean} options.dryRun - If true, don't write to Airtable
 * @param {number} options.limit - Max leads to process (for testing)
 * @param {boolean} options.forceAll - Process all leads regardless of change detection
 * 
 * @returns {Object} Summary of results
 */
async function sweepClient(options) {
  const { 
    clientId, 
    baseId, 
    clientType = 'A',
    fupInstructions = '',
    dryRun = false, 
    limit = null,
    forceAll = false 
  } = options;
  
  logger.info(`Starting sweep for client: ${clientId} (dryRun=${dryRun}, limit=${limit}, forceAll=${forceAll})`);
  
  const results = {
    clientId,
    started: new Date().toISOString(),
    candidatesFound: 0,
    passedStage2: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  
  try {
    const clientBase = getClientBase(baseId);
    
    // Stage 1: Get candidate leads from Airtable
    const filterFormula = buildCandidateFilter();
    logger.info(`Stage 1 filter: ${filterFormula}`);
    
    const selectOptions = {
      filterByFormula: filterFormula,
      fields: [
        LEAD_FIELDS.FIRST_NAME,
        LEAD_FIELDS.LAST_NAME,
        LEAD_FIELDS.EMAIL,
        LEAD_FIELDS.LINKEDIN_URL,
        LEAD_FIELDS.FOLLOW_UP_DATE,
        LEAD_FIELDS.CEASE_FUP,
        LEAD_FIELDS.NOTES,
        LEAD_FIELDS.STATUS,
        LEAD_FIELDS.PRIORITY,
      ],
    };
    
    if (limit) {
      selectOptions.maxRecords = limit;
    }
    
    const candidates = await clientBase('Leads').select(selectOptions).all();
    results.candidatesFound = candidates.length;
    logger.info(`Stage 1: Found ${candidates.length} candidate leads`);
    
    // Stage 2: Filter by conversation activity (for safety net leads)
    const leadsToProcess = [];
    
    for (const lead of candidates) {
      const hasFollowUpDate = !!lead.fields[LEAD_FIELDS.FOLLOW_UP_DATE];
      
      if (hasFollowUpDate) {
        // Lead has a follow-up date set - include it
        leadsToProcess.push(lead);
      } else {
        // Safety net lead - check if Notes indicate conversation
        const notes = lead.fields[LEAD_FIELDS.NOTES] || '';
        if (hasConversationActivity(notes)) {
          leadsToProcess.push(lead);
        } else {
          results.skipped++;
          logger.debug(`Skipped ${lead.id} - no conversation activity detected`);
        }
      }
    }
    
    results.passedStage2 = leadsToProcess.length;
    logger.info(`Stage 2: ${leadsToProcess.length} leads passed conversation check`);
    
    // Process each lead
    for (const lead of leadsToProcess) {
      try {
        // Analyze with AI (placeholder for now)
        const aiOutput = await analyzeLeadNotes(lead, fupInstructions, clientType);
        
        // Upsert to Smart FUP State
        const upsertResult = await upsertStateRecord(clientId, lead, aiOutput, dryRun);
        
        results.processed++;
        if (upsertResult.action === 'created') results.created++;
        if (upsertResult.action === 'updated') results.updated++;
        
      } catch (error) {
        logger.error(`Error processing lead ${lead.id}: ${error.message}`);
        results.errors.push({
          leadId: lead.id,
          error: error.message
        });
      }
    }
    
  } catch (error) {
    logger.error(`Sweep failed for ${clientId}: ${error.message}`);
    results.errors.push({
      phase: 'sweep',
      error: error.message
    });
  }
  
  results.completed = new Date().toISOString();
  logger.info(`Sweep complete for ${clientId}: ${results.processed} processed, ${results.created} created, ${results.updated} updated`);
  
  return results;
}

/**
 * Run the Smart Follow-Up sweep for all clients (or a specific client)
 * 
 * @param {Object} options
 * @param {string} options.clientId - Optional: specific client to process
 * @param {boolean} options.dryRun - If true, don't write to Airtable
 * @param {number} options.limit - Max leads per client (for testing)
 * @param {boolean} options.forceAll - Process all leads regardless of change detection
 * 
 * @returns {Object} Summary of all results
 */
async function runSweep(options = {}) {
  const { 
    clientId = null, 
    dryRun = false, 
    limit = null,
    forceAll = false 
  } = options;
  
  logger.info(`Starting Smart Follow-Up sweep (dryRun=${dryRun}, clientId=${clientId || 'ALL'})`);
  
  const overallResults = {
    started: new Date().toISOString(),
    options: { clientId, dryRun, limit, forceAll },
    clients: [],
    totalProcessed: 0,
    totalCreated: 0,
    totalUpdated: 0,
    totalErrors: 0,
  };
  
  try {
    // Use existing clientService which handles Airtable auth correctly
    const allClients = await getAllClients();
    
    // Filter to specific client if requested
    let clientRecords = allClients;
    if (clientId) {
      clientRecords = allClients.filter(c => c.fields['Client ID'] === clientId);
    }
    
    logger.info(`Found ${clientRecords.length} client(s) to process`);
    
    for (const client of clientRecords) {
      const cid = client.fields['Client ID'];
      const baseId = client.fields['Leads Base'];
      
      if (!baseId) {
        logger.warn(`Client ${cid} has no Leads Base configured - skipping`);
        continue;
      }
      
      const clientResult = await sweepClient({
        clientId: cid,
        baseId: baseId,
        clientType: client.fields['Client Type'] || 'A',
        fupInstructions: client.fields['FUP AI Instructions'] || '',
        dryRun,
        limit,
        forceAll,
      });
      
      overallResults.clients.push(clientResult);
      overallResults.totalProcessed += clientResult.processed;
      overallResults.totalCreated += clientResult.created;
      overallResults.totalUpdated += clientResult.updated;
      overallResults.totalErrors += clientResult.errors.length;
    }
    
  } catch (error) {
    logger.error(`Sweep failed: ${error.message}`);
    overallResults.error = error.message;
  }
  
  overallResults.completed = new Date().toISOString();
  logger.info(`Smart Follow-Up sweep complete: ${overallResults.totalProcessed} leads processed across ${overallResults.clients.length} clients`);
  
  return overallResults;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runSweep,
  sweepClient,
  buildCandidateFilter,
  hasConversationActivity,
  analyzeLeadNotes,
  LEAD_FIELDS,
  SAFETY_NET_DAYS,
};
