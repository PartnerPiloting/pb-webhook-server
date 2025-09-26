/**
 * leadScoringService.js
 * 
 * Domain service for scoring leads using AI.
 * Manages the lead scoring workflow, including prompt building and score calculation.
 */

const { TABLES, FIELDS, STATUS, LIMITS } = require('../models/constants');
const aiService = require('../../infrastructure/ai/aiService');
const { Logger } = require('../../infrastructure/logging/logger');

/**
 * Lead Scoring Service
 */
class LeadScoringService {
  /**
   * Score a batch of leads
   * @param {Array} leads - Array of leads to score
   * @param {string} clientId - Client ID
   * @param {string} runId - Run ID for tracking
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Result of scoring operation
   */
  async scoreLeads(leads, clientId, runId, options = {}) {
    const logger = options.logger || new Logger(clientId, runId, 'lead_scoring');
    logger.info(`Scoring ${leads.length} leads for client ${clientId}`);
    
    const results = {
      totalProcessed: leads.length,
      successful: 0,
      failed: 0,
      totalTokens: 0,
      details: []
    };
    
    // Process each lead
    for (const lead of leads) {
      try {
        logger.debug(`Processing lead: ${lead.id}`);
        
        // Build the prompt
        const prompt = this._buildPrompt(lead, options.icpDescription);
        
        // Call the AI service
        const aiResult = await aiService.generateContent(prompt, {
          requestId: lead.id,
          logger: logger.child(`lead_${lead.id}`)
        });
        
        // Parse the result
        const scoreResult = this._parseScoreResult(aiResult.text);
        
        // Add token usage
        results.totalTokens += aiResult.tokenUsage.totalTokens;
        
        // Update success count
        results.successful++;
        
        // Add to details
        results.details.push({
          leadId: lead.id,
          success: true,
          score: scoreResult.score,
          reason: scoreResult.reason,
          model: aiResult.model,
          tokens: aiResult.tokenUsage.totalTokens
        });
        
        logger.info(`Successfully scored lead ${lead.id}: Score ${scoreResult.score}`);
      } catch (error) {
        // Update failed count
        results.failed++;
        
        // Add to details
        results.details.push({
          leadId: lead.id,
          success: false,
          error: error.message
        });
        
        logger.error(`Failed to score lead ${lead.id}: ${error.message}`);
      }
    }
    
    logger.info(`Scoring complete: ${results.successful} successful, ${results.failed} failed`);
    return results;
  }
  
  /**
   * Build a prompt for lead scoring
   * @private
   * @param {Object} lead - The lead to score
   * @param {string} icpDescription - Ideal Customer Profile description
   * @returns {string} - The prompt
   */
  _buildPrompt(lead, icpDescription) {
    // Extract lead information
    const name = lead.fields?.[FIELDS.LEADS.FULL_NAME] || 'Unknown';
    const linkedInUrl = lead.fields?.[FIELDS.LEADS.LINKEDIN_URL] || '';
    const profileData = lead.fields?.['LinkedIn Profile Data'] || '{}';
    
    let profile;
    try {
      // Try to parse the profile data JSON
      profile = JSON.parse(profileData);
    } catch (error) {
      profile = { error: 'Failed to parse profile data' };
    }
    
    // Format the profile information
    const headline = profile.headline || 'Unknown';
    const location = profile.location || 'Unknown';
    const summary = profile.summary || '';
    const experience = Array.isArray(profile.experience) 
      ? profile.experience.map(exp => {
          return `
- ${exp.title || 'Unknown Title'} at ${exp.company || 'Unknown Company'}
  ${exp.dateRange || 'Unknown dates'}
  ${exp.description || ''}
          `.trim();
        }).join('\n\n')
      : 'No experience data available';
    
    // Build the prompt
    return `
You are a LinkedIn profile evaluator for a B2B sales team. Analyze this profile to determine if this person is a good lead based on the Ideal Customer Profile (ICP) below.

IDEAL CUSTOMER PROFILE:
${icpDescription || 'Decision makers (Director level and above) in sales, marketing, or revenue operations at B2B SaaS companies with 50+ employees.'}

LINKEDIN PROFILE:
Name: ${name}
URL: ${linkedInUrl}
Headline: ${headline}
Location: ${location}
Summary: ${summary}

Work Experience:
${experience}

INSTRUCTIONS:
1. Analyze how well this profile matches our Ideal Customer Profile.
2. Assign a score from 0-100 where:
   - 90-100: Perfect match to ICP
   - 70-89: Strong match
   - 50-69: Moderate match
   - 25-49: Weak match
   - 0-24: Not a match
3. Provide a brief explanation (2-3 sentences) of your score.
4. Format your response EXACTLY as follows:
   SCORE: [number]
   REASON: [your explanation]

Remember to evaluate based ONLY on the information provided. If critical information is missing, note that in your explanation.
`.trim();
  }
  
  /**
   * Parse the AI result to extract the score and reason
   * @private
   * @param {string} result - The AI result text
   * @returns {Object} - The parsed score and reason
   */
  _parseScoreResult(result) {
    // Extract the score
    const scoreMatch = result.match(/SCORE:\s*(\d+)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    
    // Extract the reason
    const reasonMatch = result.match(/REASON:\s*(.*?)(?:\n|$)/is);
    const reason = reasonMatch ? reasonMatch[1].trim() : 'No reason provided';
    
    return { score, reason };
  }
  
  /**
   * Format lead data for AI processing (slim version)
   * @param {Object} lead - The lead data
   * @returns {Object} - Simplified lead data
   */
  slimLead(lead) {
    // Extract only the necessary fields to reduce payload size
    return {
      id: lead.id,
      fields: {
        [FIELDS.LEADS.FULL_NAME]: lead.fields[FIELDS.LEADS.FULL_NAME] || '',
        [FIELDS.LEADS.LINKEDIN_URL]: lead.fields[FIELDS.LEADS.LINKEDIN_URL] || '',
        'LinkedIn Profile Data': lead.fields['LinkedIn Profile Data'] || '{}'
      }
    };
  }
}

module.exports = new LeadScoringService();