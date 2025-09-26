/**
 * postScoringService.js
 * 
 * This service handles the scoring of LinkedIn posts for leads.
 * It processes posts harvested by the post harvesting service,
 * scores them using AI, and updates the lead records with the results.
 */

const { Logger } = require('../../infrastructure/logging/logger');
const { AirtableRepository } = require('../../infrastructure/airtable/airtableRepository');
const { RunRecordService } = require('./runRecordService');
const { validateClient } = require('../models/validators');
const { STATUS, FIELDS } = require('../models/constants');
const { AiService } = require('../../infrastructure/ai/aiService');

class PostScoringService {
  /**
   * Create a PostScoringService instance
   * 
   * @param {Object} options - Options for the service
   * @param {Object} options.airtableClient - Initialized Airtable client
   * @param {Object} options.aiService - Initialized AI service
   */
  constructor(options = {}) {
    this.airtableClient = options.airtableClient;
    this.aiService = options.aiService || new AiService();
    this.repository = null;
    this.runRecordService = null;
    this.logger = null;
  }
  
  /**
   * Initialize services required for post scoring
   * 
   * @param {string} clientId - The client ID
   * @param {string} runId - The run ID
   * @param {Object} options - Additional options
   * @returns {Promise<void>}
   */
  async initialize(clientId, runId, options = {}) {
    const logContext = options.logContext || 'PostScoringService';
    
    // Set up logger
    this.logger = options.logger || new Logger(clientId, runId, logContext);
    
    // Initialize repository
    this.repository = new AirtableRepository({
      airtableClient: this.airtableClient,
      clientId,
      logger: this.logger
    });
    
    // Initialize run record service
    this.runRecordService = new RunRecordService({
      repository: this.repository,
      logger: this.logger
    });
    
    this.logger.info('Post scoring service initialized');
  }
  
  /**
   * Score posts for a client
   * 
   * @param {string} clientId - The client ID
   * @param {string} runId - The run ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Results of the post scoring operation
   */
  async scorePosts(clientId, runId, options = {}) {
    // Initialize the service if not already initialized
    if (!this.repository || !this.runRecordService) {
      await this.initialize(clientId, runId, options);
    }
    
    const results = {
      clientId,
      runId,
      status: STATUS.FAILED,
      leadsProcessed: 0,
      postsProcessed: 0,
      postsScored: 0,
      totalTokens: 0,
      errors: [],
      timestamp: new Date().toISOString()
    };
    
    try {
      // Validate client
      const client = await validateClient(clientId, {
        repository: this.repository,
        logger: this.logger
      });
      
      this.logger.info(`Starting post scoring for client ${clientId}`);
      
      // Create or update run record
      const runRecord = await this.runRecordService.createOrUpdateRunRecord(runId, {
        status: STATUS.IN_PROGRESS,
        operation: 'post_scoring',
        clientId
      });
      
      // Get leads with unscored posts
      const leads = await this._getLeadsWithUnscoredPosts(clientId);
      results.leadsProcessed = leads.length;
      
      if (leads.length === 0) {
        this.logger.info('No leads with unscored posts found');
        results.status = STATUS.COMPLETED;
        
        // Update run record with completion status
        await this.runRecordService.updateRunRecord(runId, {
          status: STATUS.COMPLETED,
          message: 'No leads with unscored posts found'
        });
        
        return results;
      }
      
      this.logger.info(`Found ${leads.length} leads with unscored posts`);
      
      // Process each lead with unscored posts
      const postsResults = await this._processLeadsWithPosts(leads, client, runId, options);
      
      // Update results
      results.postsProcessed = postsResults.postsProcessed;
      results.postsScored = postsResults.postsScored;
      results.totalTokens = postsResults.totalTokens;
      if (postsResults.errors.length > 0) {
        results.errors = postsResults.errors;
      }
      
      // Update run record with completion status
      await this.runRecordService.updateRunRecord(runId, {
        status: STATUS.COMPLETED,
        message: `Scored ${postsResults.postsScored} posts for ${leads.length} leads`,
        additionalData: {
          leadsProcessed: results.leadsProcessed,
          postsProcessed: results.postsProcessed,
          postsScored: results.postsScored,
          totalTokens: results.totalTokens
        }
      });
      
      results.status = STATUS.COMPLETED;
      this.logger.info(`Post scoring completed for client ${clientId}`);
      
      return results;
    } catch (error) {
      this.logger.error(`Post scoring failed: ${error.message}`, error.stack);
      results.errors.push(error.message);
      
      // Update run record with failure status
      if (this.runRecordService) {
        try {
          await this.runRecordService.updateRunRecord(runId, {
            status: STATUS.FAILED,
            message: `Post scoring failed: ${error.message}`
          });
        } catch (runRecordError) {
          this.logger.error(`Failed to update run record: ${runRecordError.message}`);
        }
      }
      
      return results;
    }
  }
  
  /**
   * Get leads with unscored posts
   * 
   * @param {string} clientId - The client ID
   * @returns {Promise<Array>} - List of leads with unscored posts
   * @private
   */
  async _getLeadsWithUnscoredPosts(clientId) {
    try {
      // First get posts that need scoring
      const query = {
        filterByFormula: `AND({${FIELDS.POST_SCORE_STATUS}} = "", {${FIELDS.POST_CONTENT}} != "")`,
        fields: [
          FIELDS.POST_ID,
          FIELDS.POST_CONTENT,
          FIELDS.POST_URL,
          FIELDS.POST_DATE,
          FIELDS.LEAD_ID
        ]
      };
      
      this.logger.info('Fetching unscored posts');
      const posts = await this.repository.findRecords('Posts', query);
      
      if (posts.length === 0) {
        return [];
      }
      
      // Get unique lead IDs from posts
      const leadIds = [...new Set(posts.map(post => post.fields[FIELDS.LEAD_ID]))];
      this.logger.info(`Found ${posts.length} unscored posts from ${leadIds.length} leads`);
      
      // Get lead details for these leads
      const leadQuery = {
        filterByFormula: `OR(${leadIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: [
          FIELDS.LEAD_ID,
          FIELDS.FULL_NAME,
          FIELDS.LINKEDIN_URL,
          FIELDS.ICP_SCORE,
          FIELDS.LEAD_STATUS
        ]
      };
      
      const leads = await this.repository.findRecords('Leads', leadQuery);
      
      // Attach posts to each lead
      for (const lead of leads) {
        lead.posts = posts.filter(post => post.fields[FIELDS.LEAD_ID] === lead.id);
      }
      
      return leads;
    } catch (error) {
      this.logger.error(`Error getting leads with unscored posts: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Process leads with unscored posts
   * 
   * @param {Array} leads - The leads with posts to process
   * @param {Object} client - The client object
   * @param {string} runId - The run ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Results of processing
   * @private
   */
  async _processLeadsWithPosts(leads, client, runId, options = {}) {
    const result = {
      postsProcessed: 0,
      postsScored: 0,
      totalTokens: 0,
      errors: []
    };
    
    try {
      // Get client's ICP description for scoring
      let icpDescription = client.fields[FIELDS.CLIENT_ICP_DESCRIPTION] || '';
      if (!icpDescription && options.defaultIcpDescription) {
        icpDescription = options.defaultIcpDescription;
      }
      
      if (!icpDescription) {
        this.logger.warn('No ICP description available for client, using generic description');
        icpDescription = 'A professional with decision-making authority in their organization who would be interested in sales and marketing automation solutions.';
      }
      
      // Process each lead's posts
      for (const lead of leads) {
        if (!lead.posts || lead.posts.length === 0) {
          continue;
        }
        
        this.logger.info(`Processing ${lead.posts.length} posts for lead ${lead.id} (${lead.fields[FIELDS.FULL_NAME]})`);
        
        // Get the lead's ICP score for context
        const icpScore = lead.fields[FIELDS.ICP_SCORE] || 0;
        
        // Score each post
        for (const post of lead.posts) {
          try {
            // Increment processed count
            result.postsProcessed++;
            
            // Extract post content
            const postContent = post.fields[FIELDS.POST_CONTENT];
            if (!postContent || postContent.length < 10) {
              this.logger.warn(`Skipping post ${post.id} - insufficient content`);
              continue;
            }
            
            // Score the post
            const scoreResult = await this._scorePost(post, lead, icpDescription, icpScore);
            
            // Update post with score
            await this.repository.updateRecord('Posts', post.id, {
              [FIELDS.POST_SCORE]: scoreResult.score,
              [FIELDS.POST_SCORE_REASON]: scoreResult.reason,
              [FIELDS.POST_SCORE_STATUS]: STATUS.COMPLETED,
              [FIELDS.POST_SCORE_RUN_ID]: runId
            });
            
            // Increment successful count
            result.postsScored++;
            
            // Add tokens used
            result.totalTokens += scoreResult.tokens;
          } catch (postError) {
            this.logger.error(`Error scoring post ${post.id}: ${postError.message}`);
            result.errors.push(`Error scoring post ${post.id}: ${postError.message}`);
            
            // Update post with error status
            try {
              await this.repository.updateRecord('Posts', post.id, {
                [FIELDS.POST_SCORE_STATUS]: STATUS.FAILED,
                [FIELDS.POST_SCORE_RUN_ID]: runId
              });
            } catch (updateError) {
              this.logger.error(`Error updating post ${post.id} status: ${updateError.message}`);
            }
          }
        }
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Error processing leads with posts: ${error.message}`, error.stack);
      result.errors.push(error.message);
      return result;
    }
  }
  
  /**
   * Score a single post
   * 
   * @param {Object} post - The post to score
   * @param {Object} lead - The lead associated with the post
   * @param {string} icpDescription - The client's ICP description
   * @param {number} icpScore - The lead's ICP score
   * @returns {Promise<Object>} - Score result with score, reason, and tokens
   * @private
   */
  async _scorePost(post, lead, icpDescription, icpScore) {
    try {
      // Build the prompt for scoring
      const prompt = this._buildPostScoringPrompt(post, lead, icpDescription, icpScore);
      
      // Call AI service for scoring
      const aiResponse = await this.aiService.generateContent(prompt, {
        model: 'gemini', // Can be 'gemini' or 'openai'
        temperature: 0.1,
        maxTokens: 500,
      });
      
      // Parse the score result
      const scoreResult = this._parseScoreResult(aiResponse.content);
      
      return {
        score: scoreResult.score,
        reason: scoreResult.reason,
        tokens: aiResponse.totalTokens
      };
    } catch (error) {
      this.logger.error(`Error scoring post ${post.id}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Build the prompt for post scoring
   * 
   * @param {Object} post - The post to score
   * @param {Object} lead - The lead associated with the post
   * @param {string} icpDescription - The client's ICP description
   * @param {number} icpScore - The lead's ICP score
   * @returns {string} - The prompt for AI scoring
   * @private
   */
  _buildPostScoringPrompt(post, lead, icpDescription, icpScore) {
    const postDate = post.fields[FIELDS.POST_DATE] || 'unknown date';
    const postUrl = post.fields[FIELDS.POST_URL] || '';
    const postContent = post.fields[FIELDS.POST_CONTENT] || '';
    
    return `
You are an expert at analyzing LinkedIn posts to identify sales opportunities. Your task is to score the following LinkedIn post based on how valuable it would be for a sales outreach.

IDEAL CUSTOMER PROFILE:
${icpDescription}

LEAD INFORMATION:
Name: ${lead.fields[FIELDS.FULL_NAME]}
LinkedIn: ${lead.fields[FIELDS.LINKEDIN_URL]}
ICP Score: ${icpScore}/10

POST INFORMATION:
Date: ${postDate}
URL: ${postUrl}

POST CONTENT:
${postContent}

SCORING CRITERIA:
- Interest signals: Does the post indicate interest in products/services like ours?
- Pain points: Does the post mention challenges our solution addresses?
- Timing: Does the post suggest this is a good time to reach out?
- Engagement: Is the post showing active engagement on the topic?
- Relevance: Is the content relevant to our offering?

OUTPUT FORMAT:
Provide your analysis as a JSON object with the following structure:
{
  "score": [a number between 0-10, with 10 being the highest value for sales outreach],
  "reason": [2-3 sentence explanation for your score, be specific about why this post is or isn't valuable]
}

Focus on factual information from the post, not assumptions. If the post is not in English or does not contain meaningful content, score it 0.`;
  }
  
  /**
   * Parse the AI response to extract the score and reason
   * 
   * @param {string} aiResponse - The AI response text
   * @returns {Object} - Object with score and reason
   * @private
   */
  _parseScoreResult(aiResponse) {
    try {
      // Try to find JSON in the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        
        // Validate required fields
        if (typeof parsed.score === 'number' && typeof parsed.reason === 'string') {
          return {
            score: parsed.score,
            reason: parsed.reason
          };
        }
      }
      
      // If no valid JSON found, try to extract score and reason manually
      const scoreMatch = aiResponse.match(/score[:\s]*([0-9]+)/i);
      const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
      
      // Extract reason (assuming it follows the score or is the bulk of the text)
      let reason = aiResponse;
      if (reason.length > 500) {
        reason = reason.substring(0, 500) + '...';
      }
      
      return { score, reason };
    } catch (error) {
      this.logger.error(`Error parsing score result: ${error.message}`);
      return { score: 0, reason: 'Failed to parse AI response' };
    }
  }
}

module.exports = { PostScoringService };