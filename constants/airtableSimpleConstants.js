/**
 * constants/airtableSimpleConstants.js
 * 
 * Unified constants for Airtable field names - single source of truth
 * 
 * FIELD NAME STANDARDIZATION:
 * - JOB_TRACKING_FIELDS: Use for all Job Tracking table field references
 * - CLIENT_RUN_FIELDS: Use for all Client Run Results table field references
 * - Always use constants rather than string literals for field names
 * 
 * IMPORTANT: Constants match EXACT field names in Airtable (case-sensitive)
 * 
 * NOTE: Deprecated aliases (JOB_FIELDS, CLIENT_RUN_RESULTS_FIELDS) have been removed.
 * All code should use the standardized constant names.
 */

// Table names in Master Clients Base
const TABLES = {
  CLIENTS: 'Clients',
  CLIENT_RUN_RESULTS: 'Client Run Results',
  JOB_TRACKING: 'Job Tracking',
  CLIENT_EXECUTION_LOG: 'Client Execution Log'
};

// Field names for Job Tracking table
const JOB_TRACKING_FIELDS = {
  RUN_ID: 'Run ID',
  STATUS: 'Status',
  STREAM: 'Stream',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  
  // Client metrics
  CLIENTS_PROCESSED: 'Clients Processed',
  CLIENTS_SUCCEEDED: 'Clients Succeeded',
  CLIENTS_FAILED: 'Clients Failed',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  ERROR_SUMMARY: 'Error Summary',
  ERROR: 'Error', // Added this field since we reference it in jobTracking.js
  PROGRESS: 'Progress', // Added this field since we reference it in jobTracking.js
  LAST_CLIENT: 'Last Client Processed', // Added this field since we reference it in jobTracking.js
  
  // Formula fields - never update directly
  DURATION: 'Duration',
  SUCCESS_RATE: 'Success Rate'
};

// Field names for Client Run Results table
const CLIENT_RUN_FIELDS = {
  RUN_ID: 'Run ID',
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  STATUS: 'Status',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  
  // Lead scoring metrics
  PROFILES_EXAMINED: 'Profiles Examined for Scoring',
  PROFILES_SCORED: 'Profiles Successfully Scored',
  
  // Post harvesting metrics
  TOTAL_POSTS_HARVESTED: 'Total Posts Harvested',
  APIFY_RUN_ID: 'Apify Run ID',
  
  // Post scoring metrics
  POSTS_EXAMINED: 'Posts Examined for Scoring',
  POSTS_SCORED: 'Posts Successfully Scored',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  
  // Formula fields - never update directly
  DURATION: 'Duration',
  PROFILE_SCORING_SUCCESS_RATE: 'Profile Scoring Success Rate',
  POST_SCORING_SUCCESS_RATE: 'Post Scoring Success Rate'
};

// Status values
const STATUS_VALUES = {
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  NO_LEADS: 'No Leads To Score',
  COMPLETED_WITH_ERRORS: 'Completed with Errors'
};

// Formula fields that should never be updated directly
const FORMULA_FIELDS = [
  JOB_TRACKING_FIELDS.DURATION,
  JOB_TRACKING_FIELDS.SUCCESS_RATE,
  CLIENT_RUN_FIELDS.DURATION,
  CLIENT_RUN_FIELDS.PROFILE_SCORING_SUCCESS_RATE,
  CLIENT_RUN_FIELDS.POST_SCORING_SUCCESS_RATE
];

// Export standardized constants only - deprecated aliases removed
module.exports = {
  TABLES,
  MASTER_TABLES: TABLES, // For backward compatibility
  
  // Primary field constants
  JOB_TRACKING_FIELDS,
  CLIENT_RUN_FIELDS,
  
  STATUS_VALUES,
  FORMULA_FIELDS
};