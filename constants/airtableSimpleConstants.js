/**
 * constants/airtableSimpleConstants.js
 * 
 * Unified constants for Airtable field names - single source of truth
 */

// Table names in Master Clients Base
const TABLES = {
  CLIENTS: 'Clients',
  CLIENT_RUN_RESULTS: 'Client Run Results',
  JOB_TRACKING: 'Job Tracking',
  CLIENT_EXECUTION_LOG: 'Client Execution Log'
};

// Field names for Job Tracking table
const JOB_FIELDS = {
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
  JOB_FIELDS.DURATION,
  JOB_FIELDS.SUCCESS_RATE,
  CLIENT_RUN_FIELDS.DURATION,
  CLIENT_RUN_FIELDS.PROFILE_SCORING_SUCCESS_RATE,
  CLIENT_RUN_FIELDS.POST_SCORING_SUCCESS_RATE
];

// Export with both the new names and the old names for backward compatibility
module.exports = {
  TABLES,
  MASTER_TABLES: TABLES, // For backward compatibility
  JOB_FIELDS,
  JOB_TRACKING_FIELDS: JOB_FIELDS, // For backward compatibility
  CLIENT_RUN_FIELDS,
  CLIENT_RUN_RESULTS_FIELDS: CLIENT_RUN_FIELDS, // For backward compatibility
  STATUS_VALUES,
  FORMULA_FIELDS
};