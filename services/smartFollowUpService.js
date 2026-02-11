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
const { getSection } = require('../utils/notesSectionManager');
const fetch = require('node-fetch');

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
// FATHOM INTEGRATION
// ============================================

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';
const FATHOM_TIMEOUT_MS = 30000;

/**
 * Fetch Fathom transcripts for a lead's email
 * 
 * @param {string} email - Lead's email address
 * @param {string} fathomApiKey - Fathom API key
 * @returns {string|null} Combined transcripts or null if none found
 */
async function fetchFathomTranscripts(email, fathomApiKey) {
  if (!email || !fathomApiKey) {
    return null;
  }
  
  try {
    // Fetch meetings from last 90 days with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FATHOM_TIMEOUT_MS);
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const meetingsUrl = new URL(`${FATHOM_API_BASE}/meetings`);
    meetingsUrl.searchParams.set('limit', '100');
    meetingsUrl.searchParams.set('include_transcript', 'true');
    meetingsUrl.searchParams.set('include_summary', 'true');
    meetingsUrl.searchParams.set('created_after', ninetyDaysAgo.toISOString());
    
    const response = await fetch(meetingsUrl.toString(), {
      method: 'GET',
      headers: {
        'X-Api-Key': fathomApiKey,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn(`Fathom API error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    const meetings = data.items || [];
    
    // Filter meetings that include this email as an invitee
    const matchingMeetings = meetings.filter(meeting => {
      const invitees = meeting.calendar_invitees || [];
      return invitees.some(invitee => 
        invitee.email && invitee.email.toLowerCase() === email.toLowerCase()
      );
    });
    
    if (matchingMeetings.length === 0) {
      return null;
    }
    
    // Extract transcripts from matching meetings (already included in response)
    const transcripts = [];
    for (const meeting of matchingMeetings.slice(0, 5)) { // Limit to 5 most recent
      // Format transcript - array of utterance objects: { speaker: { display_name }, text, timestamp }
      let transcriptText = '';
      if (meeting.transcript && Array.isArray(meeting.transcript)) {
        transcriptText = meeting.transcript.map(utterance => {
          // speaker is an object with display_name
          const speakerName = utterance.speaker?.display_name || 'Speaker';
          const text = utterance.text || '';
          const timestamp = utterance.timestamp || '';
          return `[${timestamp}] ${speakerName}: ${text}`;
        }).join('\n');
      }
      
      // Summary is at default_summary.markdown_formatted
      const summaryText = meeting.default_summary?.markdown_formatted || '';
      
      if (transcriptText || summaryText) {
        transcripts.push({
          date: meeting.created_at,
          title: meeting.title || meeting.meeting_title || 'Meeting',
          transcript: transcriptText,
          summary: summaryText
        });
      }
    }
    
    if (transcripts.length === 0) {
      return null;
    }
    
    // Format transcripts for storage (include summary if available)
    return transcripts.map(t => {
      let content = `=== ${t.title} (${t.date}) ===\n`;
      if (t.summary) {
        content += `SUMMARY:\n${t.summary}\n\n`;
      }
      if (t.transcript) {
        content += `TRANSCRIPT:\n${t.transcript}`;
      }
      return content;
    }).join('\n\n---\n\n');
    
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn(`Fathom API timeout for email: ${email}`);
    } else {
      logger.warn(`Fathom fetch error for ${email}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Check if Fathom transcripts should be fetched for a lead
 * 
 * @param {string} notes - Lead's notes field
 * @param {Object} existingRecord - Existing Smart FUP State record (if any)
 * @returns {Object} { shouldFetch: boolean, meetingNotesLength: number }
 */
function shouldFetchFathomTranscripts(notes, existingRecord) {
  // Get meeting section content
  const meetingNotes = getSection(notes || '', 'meeting');
  const meetingNotesLength = meetingNotes.length;
  
  // No meeting notes section = no Fathom fetch needed
  if (meetingNotesLength === 0) {
    return { shouldFetch: false, meetingNotesLength: 0 };
  }
  
  // Get existing values from state record
  const existingTranscripts = existingRecord?.fields?.[SMART_FUP_STATE_FIELDS.FATHOM_TRANSCRIPTS] || '';
  const previousMeetingNotesLength = existingRecord?.fields?.[SMART_FUP_STATE_FIELDS.LAST_PROCESSED_MEETING_NOTES_LENGTH] || 0;
  
  // Fetch if:
  // 1. Has meeting notes content AND no cached transcripts, OR
  // 2. Meeting notes section grew since last processed
  const hasNoTranscripts = !existingTranscripts;
  const meetingNotesGrew = meetingNotesLength > previousMeetingNotesLength;
  
  const shouldFetch = hasNoTranscripts || meetingNotesGrew;
  
  return { shouldFetch, meetingNotesLength };
}

// ============================================
// FILTER LOGIC
// ============================================

// How many days back to look for modified leads
const MODIFIED_WINDOW_DAYS = 7;

/**
 * Build Airtable filter for candidate leads
 * Returns leads that are:
 * - Not ceased (Cease FUP != 'Yes')
 * - AND modified in last 7 days (catches notes updates and user date changes)
 * 
 * Decision 17: We query by modification time to catch:
 * - Notes updated (email via track@, manual entry)
 * - User FUP date changes
 * Then we compare notes length to decide if AI re-analysis is needed.
 */
function buildCandidateFilter() {
  // Query leads modified in the last N days that aren't ceased
  return `AND(
    OR({${LEAD_FIELDS.CEASE_FUP}} != 'Yes', {${LEAD_FIELDS.CEASE_FUP}} = BLANK()),
    {${LEAD_FIELDS.FOLLOW_UP_DATE}} != '',
    LAST_MODIFIED_TIME() >= DATEADD(TODAY(), -${MODIFIED_WINDOW_DAYS}, 'days')
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
 * 
 * @param {Object} lead - Lead record from Airtable
 * @param {string} clientInstructions - Client's FUP AI Instructions
 * @param {string} clientType - Client type (A/B/C)
 * @param {string} [newNotesPortion] - Optional: only the NEW notes to focus on (Decision 17)
 *                                     If provided, AI will focus analysis on new content
 *                                     but still has full notes for context
 */
async function analyzeLeadNotes(lead, clientInstructions, clientType, newNotesPortion = null) {
  const fullNotes = lead.fields[LEAD_FIELDS.NOTES] || '';
  const firstName = lead.fields[LEAD_FIELDS.FIRST_NAME] || 'Lead';
  const lastName = lead.fields[LEAD_FIELDS.LAST_NAME] || '';
  const email = lead.fields[LEAD_FIELDS.EMAIL] || '';
  const hasFollowUpDate = !!lead.fields[LEAD_FIELDS.FOLLOW_UP_DATE];
  
  // If no Gemini client available, fall back to placeholder
  if (!vertexAIClient) {
    logger.warn('Gemini client not available, using placeholder logic');
    return generatePlaceholderAnalysis(lead, fullNotes, firstName);
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

    // Decision 17: If we have a newNotesPortion, focus analysis on it
    // but provide full notes for context understanding
    let notesSection;
    if (newNotesPortion) {
      notesSection = `FULL CONVERSATION HISTORY (for context):
${fullNotes || '[No notes recorded]'}

--- NEW CONTENT TO ANALYZE (focus your recommendations on this) ---
${newNotesPortion}`;
    } else {
      notesSection = `NOTES/CONVERSATION HISTORY:
${fullNotes || '[No notes recorded]'}`;
    }

    const userPrompt = `Analyze this lead and provide follow-up recommendations.

LEAD INFO:
- Name: ${firstName} ${lastName}
- Email: ${email || 'Not available'}
- Has Follow-Up Date Set: ${hasFollowUpDate ? 'Yes' : 'No'}

${notesSection}

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
    return generatePlaceholderAnalysis(lead, fullNotes, firstName);
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
 * 
 * @param {string} clientId - Client ID
 * @param {Object} lead - Lead record from Airtable
 * @param {Object} aiOutput - AI analysis output (may be null if no new notes)
 * @param {Object} options - Additional options
 * @param {number} options.notesLength - Current notes length to store
 * @param {number} options.meetingNotesLength - Current meeting section length to store
 * @param {string} options.fathomTranscripts - Fetched Fathom transcripts (if any)
 * @param {string} options.userFupDate - User's follow-up date from Leads table
 * @param {Object} options.existingRecord - Existing state record (to avoid re-query)
 * @param {boolean} options.dryRun - If true, don't write to Airtable
 */
async function upsertStateRecord(clientId, lead, aiOutput, options = {}) {
  const { 
    notesLength = 0, 
    meetingNotesLength = 0,
    fathomTranscripts = null,
    userFupDate = null, 
    existingRecord = null, 
    dryRun = false 
  } = options;
  const base = initializeClientsBase();
  const leadId = lead.id;
  
  // Always include these fields (synced every sweep)
  const recordData = {
    [SMART_FUP_STATE_FIELDS.CLIENT_ID]: clientId,
    [SMART_FUP_STATE_FIELDS.LEAD_ID]: leadId,
    [SMART_FUP_STATE_FIELDS.LEAD_FIRST_NAME]: lead.fields[LEAD_FIELDS.FIRST_NAME] || '',
    [SMART_FUP_STATE_FIELDS.LEAD_LAST_NAME]: lead.fields[LEAD_FIELDS.LAST_NAME] || '',
    [SMART_FUP_STATE_FIELDS.LEAD_EMAIL]: lead.fields[LEAD_FIELDS.EMAIL] || '',
    [SMART_FUP_STATE_FIELDS.LEAD_LINKEDIN]: lead.fields[LEAD_FIELDS.LINKEDIN_URL] || '',
    [SMART_FUP_STATE_FIELDS.GENERATED_TIME]: new Date().toISOString(),
    [SMART_FUP_STATE_FIELDS.LAST_PROCESSED_NOTES_LENGTH]: notesLength,
    [SMART_FUP_STATE_FIELDS.LAST_PROCESSED_MEETING_NOTES_LENGTH]: meetingNotesLength,
  };
  
  // Always sync User FUP Date from Leads table
  if (userFupDate) {
    recordData[SMART_FUP_STATE_FIELDS.USER_FUP_DATE] = userFupDate;
  }
  
  // Update Fathom transcripts if we fetched new ones
  if (fathomTranscripts) {
    recordData[SMART_FUP_STATE_FIELDS.FATHOM_TRANSCRIPTS] = fathomTranscripts;
  }
  
  // Only update AI fields if we have new AI output
  if (aiOutput) {
    recordData[SMART_FUP_STATE_FIELDS.STORY] = aiOutput.story;
    recordData[SMART_FUP_STATE_FIELDS.PRIORITY] = aiOutput.priority;
    recordData[SMART_FUP_STATE_FIELDS.SUGGESTED_MESSAGE] = aiOutput.suggestedMessage;
    recordData[SMART_FUP_STATE_FIELDS.RECOMMENDED_CHANNEL] = aiOutput.recommendedChannel;
    recordData[SMART_FUP_STATE_FIELDS.WAITING_ON] = aiOutput.waitingOn;
    
    // Add AI suggested date fields if present
    if (aiOutput.aiSuggestedDate) {
      recordData[SMART_FUP_STATE_FIELDS.AI_SUGGESTED_FUP_DATE] = aiOutput.aiSuggestedDate;
    }
    if (aiOutput.aiDateReasoning) {
      recordData[SMART_FUP_STATE_FIELDS.AI_DATE_REASONING] = aiOutput.aiDateReasoning;
    }
  }
  
  if (dryRun) {
    logger.info(`[DRY RUN] Would upsert: ${clientId} / ${leadId} (aiAnalyzed=${!!aiOutput})`);
    return { dryRun: true, data: recordData, aiAnalyzed: !!aiOutput };
  }
  
  try {
    // Use provided existing record or query for it
    const existing = existingRecord || await findExistingStateRecord(clientId, leadId);
    
    if (existing) {
      // Update existing record
      const updated = await base('Smart FUP State').update(existing.id, recordData);
      logger.info(`Updated state record for ${clientId}/${leadId} (aiAnalyzed=${!!aiOutput})`);
      return { action: 'updated', recordId: updated.id, aiAnalyzed: !!aiOutput };
    } else {
      // Create new record
      const created = await base('Smart FUP State').create(recordData);
      logger.info(`Created state record for ${clientId}/${leadId}`);
      return { action: 'created', recordId: created.id, aiAnalyzed: !!aiOutput };
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
 * @param {string} options.fathomApiKey - Client's Fathom API key (optional)
 * @param {boolean} options.dryRun - If true, don't write to Airtable
 * @param {number} options.limit - Max leads to process (for testing)
 * @param {boolean} options.forceAll - If true, re-analyze ALL leads regardless of notes changes
 * 
 * @returns {Object} Summary of results
 */
async function sweepClient(options) {
  const { 
    clientId, 
    baseId, 
    clientType = 'A',
    fupInstructions = '',
    fathomApiKey = null,
    dryRun = false, 
    limit = null,
    forceAll = false
  } = options;
  
  logger.info(`Starting sweep for client: ${clientId} (dryRun=${dryRun}, limit=${limit}, forceAll=${forceAll})`);
  
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
    
    // Apply limit if specified
    let leadsToProcess = candidates;
    if (limit && leadsToProcess.length > limit) {
      leadsToProcess = leadsToProcess.slice(0, limit);
    }
    
    // Track stats for Decision 17 logic
    results.aiAnalyzed = 0;
    results.dateOnlySync = 0;
    results.fathomFetched = 0;
    
    // Process each lead
    for (const lead of leadsToProcess) {
      try {
        const notes = lead.fields[LEAD_FIELDS.NOTES] || '';
        const currentNotesLength = notes.length;
        const userFupDate = lead.fields[LEAD_FIELDS.FOLLOW_UP_DATE] || null;
        const leadEmail = lead.fields[LEAD_FIELDS.EMAIL] || null;
        
        // Fetch existing state record to check for notes changes
        const existingRecord = await findExistingStateRecord(clientId, lead.id);
        const previousNotesLength = existingRecord?.fields?.[SMART_FUP_STATE_FIELDS.LAST_PROCESSED_NOTES_LENGTH] || 0;
        
        let aiOutput = null;
        let fathomTranscripts = null;
        let meetingNotesLength = 0;
        
        // Check if Fathom transcripts should be fetched
        const fathomCheck = shouldFetchFathomTranscripts(notes, existingRecord);
        meetingNotesLength = fathomCheck.meetingNotesLength;
        
        if (fathomCheck.shouldFetch && fathomApiKey && leadEmail) {
          logger.info(`Lead ${lead.id}: Fetching Fathom transcripts for ${leadEmail}`);
          fathomTranscripts = await fetchFathomTranscripts(leadEmail, fathomApiKey);
          if (fathomTranscripts) {
            results.fathomFetched++;
            logger.info(`Lead ${lead.id}: Fathom transcripts fetched (${fathomTranscripts.length} chars)`);
          }
        }
        
        // Decision 17: Only run AI analysis if notes have grown (or forceAll is set)
        const hasNewNotes = currentNotesLength > previousNotesLength;
        
        if (forceAll || hasNewNotes) {
          // When forceAll, analyze full notes; otherwise just the new portion
          const newNotesPortion = forceAll ? null : notes.slice(previousNotesLength);
          const analyzeMode = forceAll ? 'forceAll' : `new notes (${previousNotesLength} -> ${currentNotesLength})`;
          logger.info(`Lead ${lead.id}: Analyzing - ${analyzeMode}`);
          
          // Run AI analysis (null newNotesPortion = analyze full notes)
          aiOutput = await analyzeLeadNotes(lead, fupInstructions, clientType, newNotesPortion);
          results.aiAnalyzed++;
        } else {
          // No new notes - just sync User FUP Date, don't re-analyze
          logger.info(`Lead ${lead.id}: No new notes (length=${currentNotesLength}), syncing date only`);
          results.dateOnlySync++;
        }
        
        // Upsert to Smart FUP State (always syncs User FUP Date)
        const upsertResult = await upsertStateRecord(clientId, lead, aiOutput, {
          notesLength: currentNotesLength,
          meetingNotesLength,
          fathomTranscripts,
          userFupDate,
          existingRecord,
          dryRun
        });
        
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
 * @param {boolean} options.forceAll - If true, re-analyze ALL leads regardless of notes changes
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
  
  logger.info(`Starting Smart Follow-Up sweep (dryRun=${dryRun}, clientId=${clientId || 'ALL'}, forceAll=${forceAll})`);
  
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
        fathomApiKey: client.fathomApiKey || null,
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
// QUEUE RETRIEVAL (for UI)
// ============================================

/**
 * Get the Smart Follow-up queue for a client
 * Returns records from Smart FUP State, sorted by MIN(User FUP Date, AI Suggested FUP Date)
 * 
 * @param {string} clientId - Client ID to fetch queue for
 * @returns {Array} Array of queue items ready for UI display
 */
async function getSmartFollowupQueue(clientId) {
  const base = initializeClientsBase();
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Fetch all Smart FUP State records for this client
    // Filter: has a date that's due (user OR AI date <= today)
    const filterFormula = `AND(
      {${SMART_FUP_STATE_FIELDS.CLIENT_ID}} = '${clientId}',
      OR(
        AND({${SMART_FUP_STATE_FIELDS.USER_FUP_DATE}} != '', {${SMART_FUP_STATE_FIELDS.USER_FUP_DATE}} <= '${today}'),
        AND({${SMART_FUP_STATE_FIELDS.AI_SUGGESTED_FUP_DATE}} != '', {${SMART_FUP_STATE_FIELDS.AI_SUGGESTED_FUP_DATE}} <= '${today}')
      )
    )`.replace(/\s+/g, ' ').trim();
    
    logger.info(`Queue filter for ${clientId}: ${filterFormula}`);
    
    const records = await base('Smart FUP State').select({
      filterByFormula: filterFormula,
    }).all();
    
    logger.info(`Found ${records.length} queue items for ${clientId}`);
    
    // Transform and sort by effective date (MIN of user and AI dates)
    const queue = records.map(record => {
      const fields = record.fields;
      const userDate = fields[SMART_FUP_STATE_FIELDS.USER_FUP_DATE] || null;
      const aiDate = fields[SMART_FUP_STATE_FIELDS.AI_SUGGESTED_FUP_DATE] || null;
      
      // Calculate effective date (MIN of the two)
      let effectiveDate = null;
      if (userDate && aiDate) {
        effectiveDate = userDate < aiDate ? userDate : aiDate;
      } else {
        effectiveDate = userDate || aiDate;
      }
      
      // Calculate days overdue
      let daysOverdue = 0;
      if (effectiveDate) {
        const effDate = new Date(effectiveDate);
        const todayDate = new Date(today);
        daysOverdue = Math.max(0, Math.floor((todayDate.getTime() - effDate.getTime()) / (1000 * 60 * 60 * 24)));
      }
      
      return {
        id: record.id,
        leadId: fields[SMART_FUP_STATE_FIELDS.LEAD_ID] || '',
        leadEmail: fields[SMART_FUP_STATE_FIELDS.LEAD_EMAIL] || '',
        leadLinkedin: fields[SMART_FUP_STATE_FIELDS.LEAD_LINKEDIN] || '',
        generatedTime: fields[SMART_FUP_STATE_FIELDS.GENERATED_TIME] || '',
        // User's follow-up date
        userFupDate: userDate,
        // AI suggestion
        aiSuggestedDate: aiDate,
        aiDateReasoning: fields[SMART_FUP_STATE_FIELDS.AI_DATE_REASONING] || null,
        // Effective date for sorting
        effectiveDate,
        daysOverdue,
        // AI-generated content
        story: fields[SMART_FUP_STATE_FIELDS.STORY] || '',
        priority: fields[SMART_FUP_STATE_FIELDS.PRIORITY] || 'Medium',
        waitingOn: fields[SMART_FUP_STATE_FIELDS.WAITING_ON] || 'None',
        suggestedMessage: fields[SMART_FUP_STATE_FIELDS.SUGGESTED_MESSAGE] || '',
        recommendedChannel: fields[SMART_FUP_STATE_FIELDS.RECOMMENDED_CHANNEL] || 'LinkedIn',
      };
    });
    
    // Sort by: Priority (High first), then by effectiveDate (oldest first)
    const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
    queue.sort((a, b) => {
      // First by priority
      const pDiff = (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
      if (pDiff !== 0) return pDiff;
      
      // Then by effective date (oldest first = most overdue)
      if (a.effectiveDate && b.effectiveDate) {
        return a.effectiveDate.localeCompare(b.effectiveDate);
      }
      return 0;
    });
    
    return queue;
    
  } catch (error) {
    logger.error(`Failed to get queue for ${clientId}: ${error.message}`);
    throw error;
  }
}

/**
 * Acknowledge an AI-suggested date (clears it from the record)
 * User has seen the suggestion and doesn't need it anymore
 * 
 * @param {string} clientId - Client ID
 * @param {string} leadId - Lead ID (Airtable record ID from Leads table)
 * @returns {Object} Result of the update
 */
async function acknowledgeAiDate(clientId, leadId) {
  const base = initializeClientsBase();
  
  try {
    // Find the state record
    const existing = await findExistingStateRecord(clientId, leadId);
    
    if (!existing) {
      throw new Error(`No Smart FUP State record found for ${clientId}/${leadId}`);
    }
    
    // Clear the AI date fields
    const updated = await base('Smart FUP State').update(existing.id, {
      [SMART_FUP_STATE_FIELDS.AI_SUGGESTED_FUP_DATE]: null,
      [SMART_FUP_STATE_FIELDS.AI_DATE_REASONING]: null,
    });
    
    logger.info(`Acknowledged (cleared) AI date for ${clientId}/${leadId}`);
    
    return { 
      success: true, 
      recordId: updated.id,
      message: 'AI date cleared'
    };
    
  } catch (error) {
    logger.error(`Failed to acknowledge AI date: ${error.message}`);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runSweep,
  sweepClient,
  buildCandidateFilter,
  analyzeLeadNotes,
  getSmartFollowupQueue,
  acknowledgeAiDate,
  LEAD_FIELDS,
};
