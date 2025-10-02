/**
 * constants/airtableUnifiedConstants.js
 * 
 * SINGLE SOURCE OF TRUTH for all Airtable constants
 * This file consolidates all field names, table names, and other Airtable-related constants
 * to ensure consistency across the entire codebase.
 * 
 * NEVER use hardcoded field names or table names anywhere in the code.
 * ALWAYS import constants from this file.
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
  // Core fields
  RUN_ID: 'Run ID',
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  STATUS: 'Status',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  DURATION: 'Duration', // Formula field
  
  // Lead scoring metrics
  PROFILES_EXAMINED: 'Profiles Examined for Scoring',
  PROFILES_SCORED: 'Profiles Successfully Scored',
  PROFILE_SCORING_SUCCESS_RATE: 'Profile Scoring Success Rate', // Formula field
  PROFILE_SCORING_TOKENS: 'Profile Scoring Tokens',
  LEAD_SCORING_ERRORS: 'Errors',
  
  // Post scoring metrics
  POSTS_EXAMINED: 'Posts Examined for Scoring',
  POSTS_SCORED: 'Posts Successfully Scored',
  POST_SCORING_SUCCESS_RATE: 'Post Scoring Success Rate', // Formula field
  POST_SCORING_TOKENS: 'Post Scoring Tokens',
  POST_SCORING_ERRORS: 'Post Scoring Errors',
  
  // Harvesting metrics
  PROFILES_SUBMITTED: 'Profiles Submitted for Post Harvesting',
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  APIFY_RUN_ID: 'Apify Run ID',
  APIFY_STATUS: 'Apify Status',
  APIFY_API_COSTS: 'Apify API Costs',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  ERROR_DETAILS: 'Error Details',
  LAST_WEBHOOK: 'Last Webhook',
  
  // Aggregate metrics
  TOTAL_TOKENS_USED: 'Total Tokens Used',
  TOTAL_API_COST: 'Total API Cost',
  SUCCESS_RATE: 'Success Rate'
};

// Field names for Job Tracking table
// NOTE: Some fields may need verification against the current Airtable schema
const JOB_TRACKING_FIELDS = {
  // Core fields - Verified against Airtable schema (Oct 2025)
  RUN_ID: 'Run ID',
  STATUS: 'Status',
  STREAM: 'Stream',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  DURATION: 'Duration', // Formula field
  
  // Fields intentionally removed to simplify the codebase
  // PROGRESS: 'Progress', - Removed 2025-10-02
  // LAST_CLIENT: 'Last Client', - Removed 2025-10-02
  
  // Client metrics - Now calculated on-the-fly instead of stored
  // These fields are being removed from the Job Tracking table as they can be
  // calculated when needed by summing the values from Client Run Results
  // CLIENTS_PROCESSED: 'Clients Processed', - Removed 2025-10-02 (now calculated on-the-fly)
  // CLIENTS_WITH_ERRORS: 'Clients With Errors', - Removed 2025-10-02 (now calculated on-the-fly)
  
  // Fields intentionally removed to simplify the codebase
  // CLIENTS_SUCCEEDED: 'Clients Succeeded', - Removed 2025-10-02
  // CLIENTS_FAILED: 'Clients Failed', - Removed 2025-10-02
  
  // Aggregate metrics - Now calculated on-the-fly instead of stored
  // These fields are being removed from the Job Tracking table as they can be
  // calculated when needed by summing the values from Client Run Results
  // TOTAL_PROFILES_EXAMINED: 'Total Profiles Examined', - Removed 2025-10-02 (now calculated on-the-fly)
  // TOTAL_POSTS_HARVESTED: 'Total Posts Harvested', - Removed 2025-10-02 (now calculated on-the-fly)
  // TOTAL_TOKENS_USED: 'Total Tokens Used', - Removed 2025-10-02 (now calculated on-the-fly)
  // SUCCESSFUL_PROFILES: 'Successful Profiles', - Removed 2025-10-02 (now calculated on-the-fly)
  // TOTAL_PROFILES_SCORED: 'Total Profiles Scored', - Removed 2025-10-02 (now calculated on-the-fly)
  // TOTAL_POSTS_SCORED: 'Total Posts Scored', - Removed 2025-10-02 (now calculated on-the-fly)
  // TOTAL_API_COST: 'Total API Cost', - Removed 2025-10-02 (now calculated on-the-fly)
  
  // System fields
  SYSTEM_NOTES: 'System Notes' // Verified against schema
  
  // Formula fields removed as they depend on the removed aggregate fields
  // POST_SCORING_SUCCESS_RATE: 'Post Scoring Success Rate', - Removed 2025-10-02 (now calculated on-the-fly)
  // ERROR_SUMMARY: 'Error Summary', - Removed 2025-10-02 (now calculated on-the-fly)
  // SUCCESS_RATE: 'Success Rate' - Removed 2025-10-02 (now calculated on-the-fly)
};

// List of formula fields that should NEVER be updated directly
const FORMULA_FIELDS = [
  // Client Run Results formula fields
  CLIENT_RUN_FIELDS.DURATION,
  CLIENT_RUN_FIELDS.PROFILE_SCORING_SUCCESS_RATE,
  CLIENT_RUN_FIELDS.POST_SCORING_SUCCESS_RATE,
  CLIENT_RUN_FIELDS.SUCCESS_RATE,
  
  // Job Tracking formula fields
  JOB_TRACKING_FIELDS.DURATION,
  // Removed formula fields that depended on the removed aggregate fields
  // JOB_TRACKING_FIELDS.SUCCESS_RATE, - Removed 2025-10-02
  // JOB_TRACKING_FIELDS.POST_SCORING_SUCCESS_RATE, - Removed 2025-10-02
  
  // Lead formula fields
  LEAD_FIELDS.DAYS_SINCE_CONNECTED,
  LEAD_FIELDS.SCORE_CATEGORY
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