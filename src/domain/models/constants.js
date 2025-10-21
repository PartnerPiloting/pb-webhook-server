/**
 * constants.js
 * Single Source of Truth for all system constants
 * This file defines ALL status values, field names, and configuration constants
 * used throughout the system to ensure consistency.
 */

// Status values for different processes
const STATUS = {
  // Lead Scoring statuses
  LEAD_SCORING: {
    PENDING: 'Pending',
    PROCESSING: 'Processing',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    ERROR: 'Error'
  },
  
  // Post Harvesting statuses
  POST_HARVESTING: {
    PENDING: 'Pending',
    PROCESSING: 'Processing',
    DONE: 'Done',
    NO_POSTS: 'No Posts',
    FAILED: 'Failed'
  },
  
  // Post Scoring statuses
  POST_SCORING: {
    PENDING: 'Pending',
    PROCESSING: 'Processing',
    COMPLETED: 'Completed',
    FAILED: 'Failed'
  },
  
  // Run Record statuses (unified across all tables)
  RUN_RECORD: {
    RUNNING: 'Running',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    PARTIAL: 'Partial'
  }
};

// Airtable field names (ensuring consistency)
const FIELDS = {
  // Leads table fields
  LEADS: {
    LINKEDIN_URL: 'LinkedIn Profile URL',
    LEAD_SCORE: 'Lead Score',
    LEAD_SCORE_REASON: 'Lead Score Reason',
    LEAD_STATUS: 'Lead Status',
    SCORING_STATUS: 'Scoring Status',
    POSTS_HARVEST_STATUS: 'Posts Harvest Status',
    LAST_POST_CHECK_AT: 'Last Post Check At',
    POSTS_FOUND_LAST_RUN: 'Posts Found (Last Run)',
    POSTS_HARVEST_RUN_ID: 'Posts Harvest Run ID',
    POSTS_ACTIONED: 'Posts Actioned',
    DATE_POSTS_SCORED: 'Date Posts Scored',
    CREATED_TIME: 'Created Time',
    SCORING_RUN_ID: 'Scoring Run ID',
    DATE_LEAD_SCORED: 'Date Lead Scored',
    FULL_NAME: 'Full Name',
    POSTS_CONTENT: 'Posts Content'
  },
  
  // Posts table fields
  POSTS: {
    POST_URL: 'Post URL',
    POST_TEXT: 'Post Text',
    POST_SCORE: 'Post Score',
    POST_ANALYSIS: 'Post Analysis',
    POSTED_DATE: 'Posted Date',
    LEAD_RECORD: 'Lead Record',
    SCORING_STATUS: 'Scoring Status',
    DATE_SCORED: 'Date Scored',
    RUN_ID: 'Run ID'
  },
  
  // Client Run Results table fields
  RUN_RESULTS: {
    RUN_ID: 'Run ID',
    CLIENT_ID: 'Client ID',
    STATUS: 'Status',
    START_TIME: 'Start Time',
    END_TIME: 'End Time',
    TOTAL_LEADS_SCORED: 'Total Leads Scored',
    TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
    TOTAL_POSTS_SCORED: 'Total Posts Scored',
    PROFILES_SUBMITTED: 'Profiles Submitted for Post Harvesting',
    APIFY_RUN_ID: 'Apify Run ID',
    APIFY_API_COSTS: 'Apify API Costs',
    ERROR_MESSAGE: 'Error Message',
    ERROR_DETAILS: 'Error Details',
    TOKEN_USAGE: 'Token Usage',
    SCORING_COST: 'Scoring Cost'
  },
  
  // Job Tracking table fields
  JOB_TRACKING: {
    RUN_ID: 'Run ID',
    START_TIME: 'Start Time',
    END_TIME: 'End Time',
    STATUS: 'Status',
    STREAM: 'Stream',
    CLIENTS_PROCESSED: 'Clients Processed',
    CLIENTS_WITH_ERRORS: 'Clients With Errors',
    TOTAL_PROFILES_EXAMINED: 'Total Profiles Examined',
    SUCCESSFUL_PROFILES: 'Successful Profiles',
    TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
    POSTS_EXAMINED: 'Posts Examined for Scoring',
    POSTS_SCORED: 'Posts Successfully Scored',
    PROFILE_SCORING_TOKENS: 'Profile Scoring Tokens',
    POST_SCORING_TOKENS: 'Post Scoring Tokens',
    SYSTEM_NOTES: 'System Notes'
  },
  
  // Clients table fields
  CLIENTS: {
    CLIENT_ID: 'Client ID',
    CLIENT_NAME: 'Client Name',
    STATUS: 'Status',
    SERVICE_LEVEL: 'Service Level',
    STREAM: 'Stream',
    POSTS_DAILY_TARGET: 'Posts Daily Target',
    LEADS_BATCH_SIZE: 'Leads Batch Size For Post Collection',
    MAX_POST_BATCHES: 'Max Post Batches Per Day Guardrail',
    ICP_DESCRIPTION: 'ICP Description'
  }
};

// Processing limits and defaults
const LIMITS = {
  // Lead scoring
  LEAD_SCORING_BATCH_SIZE: 20,
  LEAD_SCORING_TIMEOUT_MS: 60000,
  
  // Post harvesting
  POST_HARVEST_BATCH_SIZE: 20,
  POST_HARVEST_DAILY_TARGET: 100,
  POST_HARVEST_MAX_BATCHES: 10,
  PROCESSING_STATUS_TIMEOUT_MINUTES: 30,
  
  // Post scoring
  POST_SCORING_BATCH_SIZE: 10,
  POST_SCORING_TIMEOUT_MS: 30000,
  
  // System limits
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 2000,
  CLIENT_CACHE_TTL_MS: 5 * 60 * 1000 // 5 minutes
};

// Service levels
const SERVICE_LEVELS = {
  BASIC: 1,      // Lead scoring only
  STANDARD: 2,   // Lead scoring + Post harvesting + Post scoring
  PREMIUM: 3     // Same as standard but with higher limits
};

// Table names
const TABLES = {
  LEADS: 'Leads',
  POSTS: 'Posts',
  CLIENT_RUN_RESULTS: 'Client Run Results',
  CLIENTS: 'Clients',
  JOB_TRACKING: 'Job Tracking',
  ICP: 'ICP'
};

// Environment modes
const MODES = {
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production',
  TESTING: 'testing'
};

// Export everything
module.exports = {
  STATUS,
  FIELDS,
  LIMITS,
  SERVICE_LEVELS,
  TABLES,
  MODES
};