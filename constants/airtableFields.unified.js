/**
 * constants/airtableFields.unified.js
 * 
 * Single source of truth for all Airtable field and table names
 * Consolidates existing constants files to prevent inconsistencies
 */

// Tables in Master Base
const TABLES = {
  CLIENTS: 'Clients',
  CLIENT_RUN_RESULTS: 'Client Run Results',
  JOB_TRACKING: 'Job Tracking',
  CLIENT_EXECUTION_LOG: 'Client Execution Log'
};

// Fields in Client Run Results table
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
  
  // Post harvesting metrics
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  APIFY_RUN_ID: 'Apify Run ID',
  APIFY_COSTS: 'Apify API Costs',
  
  // Post scoring metrics
  POSTS_EXAMINED: 'Posts Examined for Scoring',
  POSTS_SCORED: 'Posts Successfully Scored',
  POST_SCORING_TOKENS: 'Post Scoring Tokens',
  
  // Error tracking
  ERRORS: 'Errors',
  POST_SCORING_ERRORS: 'Post Scoring Errors',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  ERROR_DETAILS: 'Error Details'
};

// Fields in Job Tracking table
const JOB_FIELDS = {
  // Core fields
  RUN_ID: 'Run ID',
  STATUS: 'Status',
  STREAM: 'Stream',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  
  // Client metrics
  CLIENTS_PROCESSED: 'Clients Processed',
  CLIENTS_SUCCEEDED: 'Clients Succeeded',
  CLIENTS_FAILED: 'Clients Failed',
  
  // Aggregate metrics
  TOTAL_PROFILES_SCORED: 'Total Profiles Scored',
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  TOTAL_POSTS_SCORED: 'Total Posts Scored',
  TOTAL_TOKENS_USED: 'Total Tokens Used',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  ERROR_SUMMARY: 'Error Summary'
};

// Formula fields that should never be directly updated
const FORMULA_FIELDS = [
  'Duration',
  'Success Rate',
  'Profile Scoring Success Rate',
  'Post Scoring Success Rate',
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

module.exports = {
  TABLES,
  CLIENT_RUN_FIELDS,
  JOB_FIELDS,
  FORMULA_FIELDS,
  STATUS_VALUES
};