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
  CLIENT_EXECUTION_LOG: 'Client Execution Log',
  APIFY: 'Apify',
  PRODUCTION_ISSUES: 'Production Issues', // Replaced Error Log table
  VALID_PMPRO_LEVELS: 'Valid PMPro Levels' // PMPro membership levels
};

// Table names in individual client bases
const CLIENT_TABLES = {
  LEADS: 'Leads',
  LINKEDIN_POSTS: 'LinkedIn Posts',
  CONNECTIONS: 'Connections',
  CREDENTIALS: 'Credentials'
};

// Field names for Clients table in Master Clients Base
const CLIENT_FIELDS = {
  CLIENT_ID: 'Client ID',
  CLIENT_NAME: 'Client Name',
  STATUS: 'Status',
  AIRTABLE_BASE_ID: 'Airtable Base ID',
  WORDPRESS_USER_ID: 'WordPress User ID',
  SERVICE_LEVEL: 'Service Level',
  COMMENT: 'Comment',
  CLIENT_FIRST_NAME: 'Client First Name',
  CLIENT_EMAIL_ADDRESS: 'Client Email Address',
  PROFILE_SCORING_TOKEN_LIMIT: 'Profile Scoring Token Limit',
  POST_SCORING_TOKEN_LIMIT: 'Post Scoring Token Limit',
  POSTS_DAILY_TARGET: 'Posts Daily Target',
  LEADS_BATCH_SIZE_FOR_POST_COLLECTION: 'Leads Batch Size for Post Collection',
  MAX_POST_BATCHES_PER_DAY_GUARDRAIL: 'Max Post Batches Per Day Guardrail',
  PRIMARY_FLOOR: 'Primary Floor',
  SECONDARY_FLOOR: 'Secondary Floor',
  MINIMUM_FLOOR: 'Minimum Floor',
  FLOOR_STRATEGY: 'Floor Strategy',
  AUTO_ADJUST_FLOORS: 'Auto Adjust Floors',
  ACTIVE: 'Active'
};

// Field names for Leads table
const LEAD_FIELDS = {
  // Identity fields
  LINKEDIN_URL: 'LinkedIn URL',
  LINKEDIN_PROFILE_URL: 'LinkedIn Profile URL', // Added from leadService.js
  LEAD_NAME: 'Lead Name',
  COMPANY: 'Company',
  COMPANY_NAME: 'Company Name', // Added from leadService.js
  FIRST_NAME: 'First Name', // Added from leadService.js
  LAST_NAME: 'Last Name', // Added from leadService.js
  HEADLINE: 'Headline', // Added from leadService.js
  JOB_TITLE: 'Job Title', // Added from leadService.js
  ABOUT: 'About', // Added from leadService.js
  JOB_HISTORY: 'Job History', // Added from leadService.js
  LOCATION: 'Location', // Added from leadService.js
  EMAIL: 'Email', // Added from leadService.js
  PHONE: 'Phone', // Added from leadService.js
  
  // Status and connection fields
  STATUS: 'Status', // Added from leadService.js
  LINKEDIN_CONNECTION_STATUS: 'LinkedIn Connection Status', // Added from leadService.js
  DATE_CONNECTED: 'Date Connected',
  DATE_CREATED: 'Date Created', // Airtable created time field
  CONVERSATION_STAGE: 'Conversation Stage',
  
  // Scoring fields
  AI_SCORE: 'AI Score', // Verified against Airtable
  AI_PROFILE_ASSESSMENT: 'AI Profile Assessment', // Verified against Airtable
  AI_ATTRIBUTES_DETAIL: 'AI Attributes Detail', // Corrected to match Airtable exactly
  SCORING_STATUS: 'Scoring Status', // Need to verify - might be "Status" in Airtable
  DATE_SCORED: 'Date Scored', // Need to verify in Airtable
  
  // Post scoring fields
  POSTS_AI_EVALUATION: 'Posts AI Evaluation',
  DATE_POSTS_SCORED: 'Date Posts Scored',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  AU: 'AU',
  AI_EXCLUDED: 'AI_Excluded',
  EXCLUDE_DETAILS: 'Exclude Details',
  REFRESHED_AT: 'Refreshed At', // Added from leadService.js
  PROFILE_FULL_JSON: 'Profile Full JSON', // Added from leadService.js
  RAW_PROFILE_DATA: 'Raw Profile Data', // Added from leadService.js
  VIEW_IN_SALES_NAVIGATOR: 'View In Sales Navigator', // Added from leadService.js
  
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
  
  // CRR REDESIGN (Oct 14, 2025): New Progress Log replaces Status/Time fields
  PROGRESS_LOG: 'Progress Log', // NEW - Single source of truth for run progress
  
  // DEPRECATED (Oct 14, 2025): These fields being removed in CRR redesign
  // STATUS: 'Status',           // DEPRECATED - causes bugs (stuck at "Running")
  // START_TIME: 'Start Time',   // DEPRECATED - redundant with Created At
  // END_TIME: 'End Time',       // DEPRECATED - meaningless for fire-and-forget operations
  // DURATION: 'Duration',       // DEPRECATED - formula based on wrong End Time
  
  // Temporary: Keep for backward compatibility during migration
  STATUS: 'Status',
  START_TIME: 'Start Time',
  END_TIME: 'End Time',
  DURATION: 'Duration', // Formula field
  
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
  APIFY_STATUS: 'Apify Status',
  APIFY_API_COSTS: 'Apify API Costs',
  
  // System fields
  SYSTEM_NOTES: 'System Notes',
  ERROR_DETAILS: 'Error Details',
  LAST_WEBHOOK: 'Last Webhook',
  FULL_RUN_LOG: 'Full Run Log', // Complete log output for validation and debugging
  
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
  LAST_UPDATED: 'Last Updated', // Added Oct 2025 for field name standardization
  
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
  SYSTEM_NOTES: 'System Notes', // Verified against schema
  
  // Phase 2 catch-up logic field (added Oct 11, 2025)
  LAST_ANALYZED_LOG_ID: 'Last Analyzed Log ID' // Stores last log entry ID processed for catch-up
  
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

// CRR REDESIGN (Oct 14, 2025): Status field being removed, Progress Log is new approach
// Client Run Result status values - DEPRECATED
// These are kept temporarily for backward compatibility during migration
const CLIENT_RUN_STATUS_VALUES = {
  RUNNING: 'Running',            // DEPRECATED - causes bugs (stuck at "Running")
  COMPLETED: 'Completed',        // DEPRECATED - meaningless for fire-and-forget ops
  FAILED: 'Failed',              // DEPRECATED - moving to Progress Log
  NO_LEADS: 'No Leads To Score', // DEPRECATED - Progress Log shows this better
  COMPLETED_WITH_ERRORS: 'Completed with Errors' // DEPRECATED
};

// Scoring status values
const SCORING_STATUS_VALUES = {
  NOT_SCORED: 'Not Scored',
  PENDING: 'Pending',
  SCORED: 'Scored',
  ERROR: 'Error',
  EXCLUDED: 'Excluded'
};

// LinkedIn connection status values
const CONNECTION_STATUS_VALUES = {
  CANDIDATE: 'Candidate',
  CONNECTED: 'Connected',
  PENDING: 'Pending'
};

// Lead status values
const LEAD_STATUS_VALUES = {
  NEW: 'New',
  IN_PROCESS: 'In Process',
  CONTACTED: 'Contacted',
  ENGAGED: 'Engaged',
  QUALIFIED: 'Qualified',
  CLOSED: 'Closed'
};

// LinkedIn post media types
const POST_MEDIA_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  DOCUMENT: 'document',
  LINK: 'link',
  POLL: 'poll'
};

// LinkedIn post types
const POST_TYPES = {
  REGULAR: 'regular',
  ARTICLE: 'article',
  SHARE: 'share',
  JOB: 'job'
};

// Client execution log fields
const CLIENT_EXECUTION_LOG_FIELDS = {
  EXECUTION_LOG: 'Execution Log',
  STATUS: 'Status',
  LEADS_PROCESSED: 'Leads Processed',
  POSTS_SCORED: 'Posts Scored',
  DURATION: 'Duration',
  TOKENS_USED: 'Tokens Used',
  ERRORS: 'Errors',
  PERFORMANCE: 'Performance',
  NEXT_ACTION: 'Next Action'
};

// Property keys for execution data objects passed to formatExecutionLog()
// These are lowercase to match JavaScript camelCase naming conventions
const EXECUTION_DATA_KEYS = {
  STATUS: 'status',
  LEADS_PROCESSED: 'leadsProcessed',
  POST_SCORING: 'postScoring',
  DURATION: 'duration',
  TOKENS_USED: 'tokensUsed',
  ERRORS: 'errors',
  PERFORMANCE: 'performance',
  NEXT_ACTION: 'nextAction'
};

// Field names for the Apify table in Master Clients Base
const APIFY_FIELDS = {
  APIFY_RUN_ID: 'Apify Run ID', // Primary field - Apify run identifier
  RUN_ID: 'Run ID', // Our system run ID (for linking to Client Run Results)
  ACTOR_ID: 'Actor ID',
  CLIENT_ID: 'Client ID',
  COMPLETED_AT: 'Completed At',
  CREATED_AT: 'Created At',
  DATASET_ID: 'Dataset ID',
  ERROR: 'Error',
  LAST_UPDATED: 'Last Updated',
  MODE: 'Mode',
  STATUS: 'Status',
  TARGET_URLS: 'Target URLs'
};

// Status values for Apify table (matches Airtable dropdown options - ALL CAPS)
const APIFY_STATUS_VALUES = {
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED'
};

// Field names for the LinkedIn Posts table
const POST_FIELDS = {
  URL: 'URL',
  CONTENT: 'Content',
  AUTHOR_NAME: 'Author Name',
  AUTHOR_URL: 'Author URL',
  POSTED_AT: 'Posted At',
  LIKE_COUNT: 'Like Count',
  COMMENT_COUNT: 'Comment Count',
  MEDIA_TYPE: 'Media Type',
  POST_TYPE: 'Post Type',
  RAW_DATA: 'Raw Data'
};

// Field names for the Credentials table
const CREDENTIAL_FIELDS = {
  PB_MESSAGE_SENDER_ID: 'PB Message Sender ID',
  PHANTOM_API_KEY: 'Phantom API Key',
  LINKEDIN_COOKIE: 'LinkedIn Cookie',
  USER_AGENT: 'User-Agent'
};

// ============================================================================
// LEGACY: Old Error Log table fields (DEPRECATED - use Production Issues)
// ============================================================================
// The Error Log table and these constants are deprecated and should not be used.
// Use services/productionIssueService.js and Production Issues table instead.
// 
// This section kept for reference only - can be deleted after migration complete.
// ============================================================================

// Error type values
const ERROR_TYPE_VALUES = {
  MODULE_IMPORT: 'Module Import',
  AI_SERVICE: 'AI Service',
  AIRTABLE_API: 'Airtable API',
  DATA_VALIDATION: 'Data Validation',
  AUTHENTICATION: 'Authentication',
  MEMORY_RESOURCES: 'Memory/Resources',
  BUSINESS_LOGIC: 'Business Logic',
  JOB_TRACKING: 'Job Tracking',
  NETWORK: 'Network',
  UNKNOWN: 'Unknown'
};

// Error status values
const ERROR_STATUS_VALUES = {
  NEW: 'NEW',
  INVESTIGATING: 'INVESTIGATING',
  FIXED: 'FIXED',
  IGNORED: 'IGNORED'
};

module.exports = {
  MASTER_TABLES,
  CLIENT_TABLES,
  CLIENT_FIELDS,
  LEAD_FIELDS,
  CLIENT_RUN_FIELDS,
  JOB_TRACKING_FIELDS,
  FORMULA_FIELDS,
  CLIENT_RUN_STATUS_VALUES,
  SCORING_STATUS_VALUES,
  CONNECTION_STATUS_VALUES,
  LEAD_STATUS_VALUES,
  CLIENT_EXECUTION_LOG_FIELDS,
  EXECUTION_DATA_KEYS,
  APIFY_FIELDS,
  APIFY_STATUS_VALUES,
  POST_FIELDS,
  CREDENTIAL_FIELDS,
  POST_MEDIA_TYPES,
  POST_TYPES
  // Removed: ERROR_LOG_FIELDS, ERROR_SEVERITY_VALUES, ERROR_TYPE_VALUES, ERROR_STATUS_VALUES
  // (Legacy error logger - replaced with Production Issues system)
};