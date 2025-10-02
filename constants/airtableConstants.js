/**
 * constants/airtableConstants.js
 * 
 * ⚠️ DEPRECATED ⚠️
 * This file is deprecated and maintained only for backward compatibility.
 * Please use constants/airtableUnifiedConstants.js for all new code.
 * 
 * DO NOT ADD NEW CONSTANTS TO THIS FILE.
 * DO NOT MODIFY CONSTANTS IN THIS FILE.
 * 
 * This file will eventually be removed once all code has been migrated
 * to use airtableUnifiedConstants.js instead.
 * 
 * For more information, see CONSTANTS-MIGRATION-GUIDE.md
 */

// Table names in Master Clients Base
const MASTER_TABLES = {
  CLIENTS: 'Clients',
  CLIENT_RUN_RESULTS: 'Client Run Results',
  JOB_TRACKING: 'Job Tracking',
  CLIENT_EXECUTION_LOG: 'Client Execution Log'
};

// Table names in individual client bases
const CLIENT_TABLES = {
  LEADS: 'Leads',
  LINKEDIN_POSTS: 'LinkedIn Posts',
  CONNECTIONS: 'Connections'
};

// Field names for Leads table
const LEAD_FIELDS = {
  // Identity fields
  LINKEDIN_URL: 'LinkedIn URL',
  LEAD_NAME: 'Lead Name',
  COMPANY: 'Company',
  
  // Scoring fields
  AI_SCORE: 'AI Score',
  AI_PROFILE_ASSESSMENT: 'AI Profile Assessment',
  SCORING_STATUS: 'Scoring Status',
  DATE_SCORED: 'Date Scored',
  
  // Post scoring fields
  POSTS_AI_EVALUATION: 'Posts AI Evaluation',
  DATE_POSTS_SCORED: 'Date Posts Scored',
  
  // Connection fields
  DATE_CONNECTED: 'Date Connected',
  CONVERSATION_STAGE: 'Conversation Stage',
  
  // Formula fields (read-only)
  DAYS_SINCE_CONNECTED: 'Days Since Connected',
  SCORE_CATEGORY: 'Score Category'
};

// Field names for Client Run Results table
const CLIENT_RUN_FIELDS = {
  // Key fields
  RUN_ID: 'Run ID',
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  
  // Time fields
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  DURATION: 'Duration', // Formula field
  
  // Status fields
  STATUS: 'Status',
  
  // Lead scoring metrics
  PROFILES_EXAMINED: 'Profiles Examined for Scoring',
  PROFILES_SCORED: 'Profiles Successfully Scored',
  PROFILE_SCORING_SUCCESS_RATE: 'Profile Scoring Success Rate', // Formula field
  PROFILE_SCORING_TOKENS: 'Profile Scoring Tokens',
  
  // Post scoring metrics
  POSTS_EXAMINED: 'Posts Examined for Scoring',
  POSTS_SCORED: 'Posts Successfully Scored',
  POST_SCORING_SUCCESS_RATE: 'Post Scoring Success Rate', // Formula field
  POST_SCORING_TOKENS: 'Post Scoring Tokens',
  
  // Harvesting metrics
  PROFILES_SUBMITTED: 'Profiles Submitted for Post Harvesting',
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  APIFY_RUN_ID: 'Apify Run ID',
  APIFY_API_COSTS: 'Apify API Costs',
  
  // System fields
  SYSTEM_NOTES: 'System Notes'
};

// Field names for Job Tracking table
const JOB_TRACKING_FIELDS = {
  RUN_ID: 'Run ID',
  // JOB_TYPE field removed - doesn't exist in Airtable schema
  STREAM: 'Stream',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  DURATION: 'Duration', // Formula field
  STATUS: 'Status',
  PROGRESS: 'Progress',
  LAST_CLIENT: 'Last Client',
  
  // Aggregate metrics
  CLIENTS_PROCESSED: 'Clients Processed', // Corrected field name
  CLIENTS_SUCCEEDED: 'Clients Succeeded', // Added for consistency with airtableFields.js
  CLIENTS_FAILED: 'Clients Failed', // Added for consistency with airtableFields.js
  TOTAL_PROFILES_EXAMINED: 'Total Profiles Examined',
  TOTAL_PROFILES_SCORED: 'Total Profiles Scored',
  SUCCESS_RATE: 'Success Rate', // Formula field
  TOTAL_TOKENS_USED: 'Total Tokens Used',
  
  SYSTEM_NOTES: 'System Notes'
};

// List of formula fields that should NEVER be updated directly
const FORMULA_FIELDS = [
  // Client Run Results formula fields
  CLIENT_RUN_FIELDS.DURATION,
  CLIENT_RUN_FIELDS.PROFILE_SCORING_SUCCESS_RATE,
  CLIENT_RUN_FIELDS.POST_SCORING_SUCCESS_RATE,
  
  // Job Tracking formula fields
  JOB_TRACKING_FIELDS.DURATION,
  JOB_TRACKING_FIELDS.SUCCESS_RATE,
  
  // Lead formula fields
  LEAD_FIELDS.DAYS_SINCE_CONNECTED,
  LEAD_FIELDS.SCORE_CATEGORY,
  
  // Generic patterns (for safety)
  'Success Rate',
  'Profile Scoring Success Rate',
  'Post Scoring Success Rate',
  'Duration',
  'Days Since Connected',
  'Score Category'
];

// Status values
const STATUS_VALUES = {
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  NO_LEADS: 'No Leads To Score',
  COMPLETED_WITH_ERRORS: 'Completed with Errors'
};

// Scoring status values
const SCORING_STATUS_VALUES = {
  NOT_SCORED: 'Not Scored',
  PENDING: 'Pending',
  SCORED: 'Scored',
  ERROR: 'Error',
  EXCLUDED: 'Excluded'
};

module.exports = {
  MASTER_TABLES,
  CLIENT_TABLES,
  LEAD_FIELDS,
  CLIENT_RUN_FIELDS,
  JOB_TRACKING_FIELDS,
  FORMULA_FIELDS,
  STATUS_VALUES,
  SCORING_STATUS_VALUES
};