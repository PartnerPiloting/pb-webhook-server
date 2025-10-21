/**
 * schema.js
 * Airtable schema and field name mappings
 */

// Field name mapping to avoid hardcoding field names throughout the application
const FIELDS = {
  CLIENTS: {
    ID: 'Client ID',
    NAME: 'Name',
    STATUS: 'Status',
    SERVICE_LEVEL: 'Service Level',
    BASE_ID: 'Base ID',
    API_KEY: 'API Key',
    EMAIL: 'Email',
    LAST_SYNC: 'Last Sync',
    CREATED_AT: 'Created At'
  },
  LEADS: {
    ID: 'ID',
    NAME: 'Name',
    POSITION: 'Position',
    COMPANY: 'Company',
    LOCATION: 'Location',
    LINKEDIN_URL: 'LinkedIn URL',
    SCORE: 'Score',
    SCORING_STATUS: 'Scoring Status',
    DATE_SCORED: 'Date Scored',
    LAST_SCORE_CHECK_AT: 'Last Score Check At',
    POSTS_HARVEST_STATUS: 'Posts Harvest Status',
    POSTS_SCORED: 'Posts Scored',
    POSTS_ACTIONED: 'Posts Actioned',
    DATE_POSTS_SCORED: 'Date Posts Scored',
    LAST_POST_CHECK_AT: 'Last Post Check At',
    CREATED_AT: 'Created At',
    UPDATED_AT: 'Updated At'
  },
  POSTS: {
    ID: 'ID',
    LEAD_ID: 'Lead ID',
    CONTENT: 'Content',
    URL: 'URL',
    DATE: 'Date',
    LIKES: 'Likes',
    COMMENTS: 'Comments',
    SCORE: 'Score',
    SCORED_AT: 'Scored At',
    CREATED_AT: 'Created At'
  },
  RUN_RECORDS: {
    ID: 'ID',
    CLIENT_ID: 'Client ID',
    PROCESS_TYPE: 'Process Type',
    STATUS: 'Status',
    ITEMS_TOTAL: 'Items Total',
    ITEMS_PROCESSED: 'Items Processed',
    ITEMS_FAILED: 'Items Failed',
    START_TIME: 'Start Time',
    END_TIME: 'End Time',
    ERROR: 'Error',
    CREATED_AT: 'Created At',
    UPDATED_AT: 'Updated At'
  }
};

// Table names
const TABLES = {
  CLIENTS: 'Clients',
  LEADS: 'Leads',
  POSTS: 'Posts',
  RUN_RECORDS: 'Run Records',
  CLIENT_EXECUTION_LOG: 'Client Execution Log'
};

module.exports = {
  FIELDS,
  TABLES
};