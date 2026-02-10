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
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const { createLogger } = require('../utils/contextLogger');
const { SMART_FUP_STATE_FIELDS } = require('../scripts/setup-smart-fup-airtable');
const { getAllClients, getClientBase, initializeClientsBase } = require('./clientService');
const { vertexAIClient } = require('../config/geminiClient');

// Create module-level logger
const logger = createLogger({
  runId: 'SMART-FUP',
  clientId: 'SYSTEM',
  operation: 'smart-followup-sweep'
});

// ============================================
// CONSTANTS
// ============================================

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
// FILTER LOGIC
// ============================================

/**
 * Build Airtable filter for candidate leads
 * Returns leads that are:
 * - Not ceased (Cease FUP != 'Yes')
 * - AND have a Follow-Up Date on or before today
 * 
 * Note: Safety net logic was removed because the UI now enforces that every lead
 * must have either a Follow-Up Date OR Cease FUP = 'Yes'. This makes the filter
 * much simpler and more efficient.
 */
function buildCandidateFilter() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Simple filter: not ceased AND has follow-up date due
  return `AND(
    OR({${LEAD_FIELDS.CEASE_FUP}} != 'Yes', {${LEAD_FIELDS.CEASE_FUP}} = BLANK()),
    {${LEAD_FIELDS.FOLLOW_UP_DATE}} != '',
    {${LEAD_FIELDS.FOLLOW_UP_DATE}} <= '${today}'
  )`.replace(/\s+/g, ' ').trim();
}

// ============================================
// AI ANALYSIS (Gemini)
// ============================================

// Model configuration - using Flash for speed
const SMART_FUP_MODEL = 'gemini-2.0-flash';
const AI_TIMEOUT_MS = 30000; // 30 second timeout

/**
 * Build the system prompt for Smart Follow-Up analysis
 */
function buildSmartFupSystemPrompt(clientType, clientInstructions) {
  // Extract client type letter (A/B/C) from full value like "A - Partner Selection"
  const typeCode = clientType ? clientType.charAt(0).toUpperCase() : 'A';
  
  let philosophyContext = '';
  if (typeCode === 'A') {
    philosophyContext = `
FOLLOW-UP PHILOSOPHY (Type A - Partner Selection):
- Early conviction over perfect timing
- Energy as filter - comfortable losing people who don't resonate
- Selection > reply rate - you're choosing partners, not chasing leads
- Leadership signalling, not chasing
- "Come with me if this resonates" posture
- Enthusiasm is intentional, not accidental
- Don't optimise for reply rate - optimise for resonance`;
  } else if (typeCode === 'B') {
    philosophyContext = `
FOLLOW-UP PHILOSOPHY (Type B - Client Acquisition):
- Softer sequencing, nurture before conviction
- Reply rate matters more
- Optimised for momentum and pipeline`;
  }

  return `You are a Smart Follow-Up AI assistant. Your task is to analyze the conversation notes for a lead and provide actionable follow-up recommendations.

${philosophyContext}

${clientInstructions ? `CLIENT-SPECIFIC INSTRUCTIONS:\n${clientInstructions}\n` : ''}

ANALYSIS TASK:
Given the lead's Notes (containing conversation history), you must determine:

1. STORY: A brief 2-3 sentence summary of the relationship so far. What stage are they at? What was discussed?

2. WAITING_ON: Who should act next?
   - "User" = The lead replied/messaged, and the user (our client) owes a response. This is HIGH priority.
   - "Lead" = The user sent a message/email, waiting for the lead to respond
   - "None" = No active conversation thread or unclear

3. PRIORITY: How urgent is this follow-up?
   - "High" = Lead replied and needs response, OR had a meeting, OR showed strong interest
   - "Medium" = Normal follow-up cadence, nothing urgent
   - "Low" = Cold lead, minimal engagement, or long time since contact

4. RECOMMENDED_CHANNEL: Best way to follow up
   - "LinkedIn" = Default for most follow-ups
   - "Email" = If email is available and conversation was via email, or more formal follow-up needed
   - "None" = Cannot determine or no follow-up needed

5. SUGGESTED_MESSAGE: A short, personalised follow-up message (2-4 sentences). 
   - Make it specific to their conversation history
   - Match the client's follow-up philosophy
   - Keep it under 500 characters for LinkedIn

6. AI_SUGGESTED_DATE: If no follow-up date is set, suggest when to follow up (YYYY-MM-DD format)
   - Look for time references in notes ("next week", "in a few days", "Monday")
   - Default to 3-5 days if unclear

7. AI_DATE_REASONING: One sentence explaining why you suggested that date

OUTPUT FORMAT:
Return a JSON object with these exact keys:
{
  "story": "...",
  "waitingOn": "User" | "Lead" | "None",
  "priority": "High" | "Medium" | "Low",
  "recommendedChannel": "LinkedIn" | "Email" | "None",
  "suggestedMessage": "...",
  "aiSuggestedDate": "YYYY-MM-DD" | null,
  "aiDateReasoning": "..." | null
}`;
}

/**
 * Analyze a lead's Notes using Gemini AI
 */
async function analyzeLeadNotes(lead, clientInstructions, clientType) {
  const notes = lead.fields[LEAD_FIELDS.NOTES] || '';
  const firstName = lead.fields[LEAD_FIELDS.FIRST_NAME] || 'Lead';
  const lastName = lead.fields[LEAD_FIELDS.LAST_NAME] || '';
  const email = lead.fields[LEAD_FIELDS.EMAIL] || '';
  const hasFollowUpDate = !!lead.fields[LEAD_FIELDS.FOLLOW_UP_DATE];
  
  // If no Gemini client available, fall back to placeholder
  if (!vertexAIClient) {
    logger.warn('Gemini client not available, using placeholder logic');
    return generatePlaceholderAnalysis(lead, notes, firstName);
  }
  
  try {
    const model = vertexAIClient.getGenerativeModel({
      model: SMART_FUP_MODEL,
      systemInstruction: { parts: [{ text: buildSmartFupSystemPrompt(clientType, clientInstructions) }] },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      generationConfig: {
        temperature: 0.3, // Slightly creative but mostly deterministic
        responseMimeType: 'application/json',
        maxOutputTokens: 1024
      }
    });

    const userPrompt = `Analyze this lead and provide follow-up recommendations.

LEAD INFO:
- Name: ${firstName} ${lastName}
- Email: ${email || 'Not available'}
- Has Follow-Up Date Set: ${hasFollowUpDate ? 'Yes' : 'No'}

NOTES/CONVERSATION HISTORY:
${notes || '[No notes recorded]'}

Today's date is: ${new Date().toISOString().split('T')[0]}`;

    const requestPayload = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
    };

    // Race between API call and timeout
    const callPromise = model.generateContent(requestPayload);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Smart FUP AI analysis timed out')), AI_TIMEOUT_MS);
    });

    const result = await Promise.race([callPromise, timeoutPromise]);

    if (!result || !result.response) {
      throw new Error('Gemini API returned no response');
    }

    const candidate = result.response.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error('AI returned no content');
    }

    const responseText = candidate.content.parts[0].text;
    
    // Parse the JSON response
    let aiOutput;
    try {
      aiOutput = JSON.parse(responseText);
    } catch (parseError) {
      logger.error(`Failed to parse AI response as JSON: ${responseText.substring(0, 200)}`);
      throw new Error('AI response was not valid JSON');
    }
    
    // Validate and normalize the output
    return {
      story: aiOutput.story || `Relationship with ${firstName}`,
      priority: ['High', 'Medium', 'Low'].includes(aiOutput.priority) ? aiOutput.priority : 'Medium',
      waitingOn: ['User', 'Lead', 'None'].includes(aiOutput.waitingOn) ? aiOutput.waitingOn : 'None',
      suggestedMessage: aiOutput.suggestedMessage || '',
      recommendedChannel: ['LinkedIn', 'Email', 'None'].includes(aiOutput.recommendedChannel) ? aiOutput.recommendedChannel : 'LinkedIn',
      aiSuggestedDate: (!hasFollowUpDate && aiOutput.aiSuggestedDate) ? aiOutput.aiSuggestedDate : null,
      aiDateReasoning: (!hasFollowUpDate && aiOutput.aiDateReasoning) ? aiOutput.aiDateReasoning : null,
    };
    
  } catch (error) {
    logger.error(`AI analysis failed for lead ${lead.id}: ${error.message}`);
    // Fall back to placeholder on error
    return generatePlaceholderAnalysis(lead, notes, firstName);
  }
}

/**
 * Generate placeholder analysis when AI is unavailable
 */
function generatePlaceholderAnalysis(lead, notes, firstName) {
  let waitingOn = 'None';
  if (/they replied|their response|waiting to hear|replied saying|responded with/i.test(notes)) {
    waitingOn = 'Lead';
  } else if (/need to follow up|should reach out|owe them|I need to|I should/i.test(notes)) {
    waitingOn = 'User';
  }
  
  let priority = 'Medium';
  if (waitingOn === 'User') {
    priority = 'High';
  } else if (/meeting|call scheduled|spoke with|had a call/i.test(notes)) {
    priority = 'High';
  } else if (!notes || notes.length < 100) {
    priority = 'Low';
  }
  
  let channel = 'LinkedIn';
  if (lead.fields[LEAD_FIELDS.EMAIL] && /email/i.test(notes)) {
    channel = 'Email';
  }
  
  const hasFollowUpDate = !!lead.fields[LEAD_FIELDS.FOLLOW_UP_DATE];
  let aiSuggestedDate = null;
  let aiDateReasoning = null;
  
  if (!hasFollowUpDate) {
    const suggestDate = new Date();
    suggestDate.setDate(suggestDate.getDate() + 3);
    aiSuggestedDate = suggestDate.toISOString().split('T')[0];
    aiDateReasoning = '[Placeholder] No follow-up date set. Suggesting 3 days from now.';
  }
  
  return {
    story: `[AI Unavailable] Relationship with ${firstName}. Notes contain ${notes.length} characters.`,
    priority,
    waitingOn,
    suggestedMessage: `[AI Unavailable] Hi ${firstName}, following up on our previous conversation.`,
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
    limit = null
  } = options;
  
  logger.info(`Starting sweep for client: ${clientId} (dryRun=${dryRun}, limit=${limit})`);
  
  const results = {
    clientId,
    started: new Date().toISOString(),
    candidatesFound: 0,
    processed: 0,
    created: 0,
    updated: 0,
    errors: [],
  };
  
  try {
    const clientBase = getClientBase(baseId);
    
    // Get candidate leads from Airtable (not ceased AND follow-up date due)
    const filterFormula = buildCandidateFilter();
    logger.info(`Filter: ${filterFormula}`);
    
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
    
    // Apply limit at query level if specified
    if (limit) {
      selectOptions.maxRecords = limit;
    }
    
    const candidates = await clientBase('Leads').select(selectOptions).all();
    results.candidatesFound = candidates.length;
    logger.info(`Found ${candidates.length} leads with due follow-up dates`);
    
    // All candidates are ready to process (no Stage 2 filtering needed anymore)
    // The filter already ensures: not ceased AND has follow-up date due
    let leadsToProcess = candidates;
    
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
 * 
 * @returns {Object} Summary of all results
 */
async function runSweep(options = {}) {
  const { 
    clientId = null, 
    dryRun = false, 
    limit = null
  } = options;
  
  logger.info(`Starting Smart Follow-Up sweep (dryRun=${dryRun}, clientId=${clientId || 'ALL'})`);
  
  const overallResults = {
    started: new Date().toISOString(),
    options: { clientId, dryRun, limit },
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
      clientRecords = allClients.filter(c => c.clientId === clientId);
    }
    
    logger.info(`Found ${clientRecords.length} client(s) to process`);
    
    for (const client of clientRecords) {
      const cid = client.clientId;
      const baseId = client.airtableBaseId;
      
      if (!baseId) {
        logger.warn(`Client ${cid} has no Leads Base configured - skipping`);
        continue;
      }
      
      const clientResult = await sweepClient({
        clientId: cid,
        baseId: baseId,
        clientType: client.clientType || 'A - Partner Selection',
        fupInstructions: client.fupInstructions || '',
        dryRun,
        limit,
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
  analyzeLeadNotes,
  LEAD_FIELDS,
};
