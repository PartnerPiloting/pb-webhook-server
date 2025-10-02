/**
 * constants/airtableFields.js
 * 
 * Single source of truth for all Airtable field names.
 * This prevents field name mismatches across the codebase.
 */

// Field names for Client Run Results table
// IMPORTANT: Primary constant is now CLIENT_RUN_FIELDS 
// This remains for backward compatibility but should be updated
const CLIENT_RUN_FIELDS = {
  // Core fields
  RUN_ID: 'Run ID',
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  STATUS: 'Status',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  
  // Lead scoring metrics
  PROFILES_EXAMINED: 'Profiles Examined for Scoring',
  PROFILES_SCORED: 'Profiles Successfully Scored',
  LEAD_SCORING_TOKENS: 'Profile Scoring Tokens',
  LEAD_SCORING_ERRORS: 'Errors',
  
  // Post harvesting metrics
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  APIFY_RUN_ID: 'Apify Run ID',
  APIFY_STATUS: 'Apify Status',
  APIFY_COST: 'Apify API Costs',
  
  // Post scoring metrics
  POSTS_EXAMINED: 'Posts Examined for Scoring',
  POSTS_SCORED: 'Posts Successfully Scored',
  POST_SCORING_TOKENS: 'Post Scoring Tokens',
  POST_SCORING_ERRORS: 'Post Scoring Errors',
  
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
const JOB_TRACKING_FIELDS = {
  // Core fields
  RUN_ID: 'Run ID',
  STATUS: 'Status',
  STREAM: 'Stream',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  
  // Client metrics - CORRECTED FIELD NAMES
  CLIENTS_PROCESSED: 'Clients Processed', // NOT "Total Clients Processed"
  CLIENTS_SUCCEEDED: 'Clients Succeeded',
  CLIENTS_FAILED: 'Clients Failed',
  
  // Aggregate metrics
  TOTAL_PROFILES_SCORED: 'Total Profiles Scored',
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  TOTAL_POSTS_SCORED: 'Total Posts Scored',
  TOTAL_TOKENS_USED: 'Total Tokens Used',
  TOTAL_API_COST: 'Total API Cost',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  ERROR_SUMMARY: 'Error Summary',
  SUCCESS_RATE: 'Success Rate'
};

// Table names
const TABLES = {
  CLIENT_RUN_RESULTS: 'Client Run Results',
  JOB_TRACKING: 'Job Tracking',
  CLIENTS: 'Clients',
  LEADS: 'Leads'
};

module.exports = {
  CLIENT_RUN_FIELDS,
  JOB_TRACKING_FIELDS,
  TABLES
};