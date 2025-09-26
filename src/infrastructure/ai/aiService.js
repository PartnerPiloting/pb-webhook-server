/**
 * aiService.js
 * 
 * Unified service for AI operations using Gemini (primary) and OpenAI (backup).
 * Handles prompting, token management, and error recovery.
 */

require('dotenv').config();
const { VertexAI } = require('@google-cloud/vertexai');
const { HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const { OpenAI } = require('openai');
const { Logger } = require('../logging/logger');

// Initialize the logger
const logger = new Logger('SYSTEM', null, 'ai-service');

/**
 * AI Service for generating content and scoring
 */
class AIService {
  /**
   * Initialize the AI service
   */
  constructor() {
    this.vertexAI = null;
    this.geminiModel = null;
    this.openai = null;
    
    this.initialized = false;
    this.initPromise = this._initialize();
    
    // Default configuration
    this.config = {
      temperature: 0.2,
      maxOutputTokens: 1024,
      timeout: parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10),
      useOpenAIFallback: true
    };
  }
  
  /**
   * Initialize AI clients
   * @private
   */
  async _initialize() {
    try {
      // Initialize Gemini
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GCP_PROJECT_ID && process.env.GCP_LOCATION) {
        logger.info('Initializing Gemini client...');
        
        this.vertexAI = new VertexAI({
          project: process.env.GCP_PROJECT_ID,
          location: process.env.GCP_LOCATION
        });
        
        const modelId = process.env.GEMINI_MODEL_ID || 'gemini-2.5-pro-preview-05-06';
        
        this.geminiModel = this.vertexAI.getGenerativeModel({
          model: modelId,
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            }
          ],
          generationConfig: {
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxOutputTokens
          }
        });
        
        logger.info(`Gemini model initialized: ${modelId}`);
      } else {
        logger.warn('Missing required environment variables for Gemini client');
      }
      
      // Initialize OpenAI
      if (process.env.OPENAI_API_KEY) {
        logger.info('Initializing OpenAI client...');
        
        this.openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY
        });
        
        logger.info('OpenAI client initialized');
      } else {
        logger.warn('Missing OPENAI_API_KEY environment variable');
      }
      
      this.initialized = true;
      logger.info('AI service initialization complete');
    } catch (error) {
      logger.error(`Failed to initialize AI service: ${error.message}`, error.stack);
      throw new Error(`AI service initialization failed: ${error.message}`);
    }
  }
  
  /**
   * Ensure the service is initialized before use
   * @private
   */
  async _ensureInitialized() {
    if (!this.initialized) {
      await this.initPromise;
    }
    
    if (!this.geminiModel && !this.openai) {
      throw new Error('No AI models available - both Gemini and OpenAI failed to initialize');
    }
  }
  
  /**
   * Generate content using Gemini with OpenAI fallback
   * @param {string} prompt - The prompt to send to the AI
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Generated content and metadata
   */
  async generateContent(prompt, options = {}) {
    await this._ensureInitialized();
    
    const contextLogger = options.logger || logger;
    const requestId = options.requestId || 'unknown';
    
    contextLogger.debug(`Generating content for request ${requestId}`);
    
    // Combine default config with options
    const config = {
      ...this.config,
      ...options
    };
    
    // Try Gemini first
    if (this.geminiModel) {
      try {
        contextLogger.debug('Using Gemini for content generation');
        
        // Create the request
        const request = {
          contents: [{
            role: 'user',
            parts: [{ text: prompt }]
          }],
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            }
          ],
          generationConfig: {
            temperature: config.temperature,
            maxOutputTokens: config.maxOutputTokens
          }
        };
        
        // Set timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini request timed out after ${config.timeout}ms`)), config.timeout)
        );
        
        // Send the request with timeout
        const responsePromise = this.geminiModel.generateContent(request);
        const response = await Promise.race([responsePromise, timeoutPromise]);
        
        // Extract the response
        const result = response.response;
        
        // Calculate token usage (estimated)
        const promptTokens = Math.ceil(prompt.length / 4); // Rough estimate
        const completionTokens = Math.ceil(result.text().length / 4); // Rough estimate
        
        contextLogger.info(`Gemini response received (${promptTokens} prompt tokens, ${completionTokens} completion tokens)`);
        
        return {
          text: result.text(),
          model: 'gemini',
          tokenUsage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens
          }
        };
      } catch (error) {
        contextLogger.error(`Gemini request failed: ${error.message}`);
        
        // If fallback is disabled or OpenAI is not available, throw the error
        if (!config.useOpenAIFallback || !this.openai) {
          throw error;
        }
        
        // Otherwise, try OpenAI as fallback
        contextLogger.warn('Falling back to OpenAI');
      }
    }
    
    // Use OpenAI if Gemini is not available or failed
    if (this.openai) {
      try {
        contextLogger.debug('Using OpenAI for content generation');
        
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: config.temperature,
          max_tokens: config.maxOutputTokens
        });
        
        const result = response.choices[0].message.content;
        
        contextLogger.info(`OpenAI response received (${response.usage.prompt_tokens} prompt tokens, ${response.usage.completion_tokens} completion tokens)`);
        
        return {
          text: result,
          model: 'openai',
          tokenUsage: {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens
          }
        };
      } catch (error) {
        contextLogger.error(`OpenAI request failed: ${error.message}`);
        throw error;
      }
    }
    
    // If we get here, both Gemini and OpenAI failed or were not available
    throw new Error('No AI models available for content generation');
  }
  
  /**
   * Get health status of the AI service
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      initialized: this.initialized,
      geminiAvailable: !!this.geminiModel,
      openaiAvailable: !!this.openai,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens
    };
  }
}

module.exports = new AIService();