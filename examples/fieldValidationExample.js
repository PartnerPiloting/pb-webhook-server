/**
 * examples/fieldValidationExample.js
 * 
 * Example of how to use the Airtable field validation tools
 * in a typical service method.
 */

// Import the validation tools
const { 
  FIELD_NAMES, 
  createValidatedObject, 
  validateFieldNames 
} = require('../utils/airtableFieldValidator');

// Import status constants
const { CLIENT_RUN_STATUS_VALUES } = require('../constants/airtableUnifiedConstants');

// Import error handling tools
const { 
  FieldNameError, 
  handleAirtableError 
} = require('../utils/airtableErrors');

// Example service method that uses field validation
async function updateClientRunWithValidation(runId, clientId, metrics) {
  const logger = console; // Use proper logger in real code
  
  try {
    logger.info(`Updating client run metrics for ${clientId} in run ${runId}`);
    
    // Step 1: Validate the metrics object
    const validation = validateFieldNames(metrics, true); // Allow unknown fields
    if (!validation.success) {
      logger.warn(`Field validation warnings: ${validation.errors.join(', ')}`);
    }
    
    // Step 2: Create a validated object with correct field names
    const validatedMetrics = createValidatedObject(metrics);
    
    // Step 3: Add standard fields using constants
    const updates = {
      ...validatedMetrics,
      [FIELD_NAMES.SYSTEM_NOTES]: `Metrics updated at ${new Date().toISOString()}`,
    };
    
    // Log the before/after for demonstration
    logger.debug('Original metrics:', metrics);
    logger.debug('Validated metrics:', updates);
    
    // In real code, you would now update the Airtable record:
    // await airtableBase('Client Run Results').update(recordId, updates);
    
    return {
      success: true,
      message: 'Metrics updated successfully',
      validatedFields: Object.keys(updates)
    };
    
  } catch (error) {
    // Handle field validation errors specifically
    if (error instanceof FieldNameError) {
      logger.error(`Field validation error: ${error.message}`);
      
      return {
        success: false,
        error: 'field_validation_error',
        message: error.message,
        fieldName: error.fieldName,
        correctFieldName: error.correctFieldName
      };
    }
    
    // For Airtable API errors, use the standard handler
    if (error.statusCode) {
      return handleAirtableError(error, logger);
    }
    
    // Handle other errors
    logger.error(`Error updating client run: ${error.message}`);
    return {
      success: false,
      error: 'unknown_error',
      message: error.message
    };
  }
}

// Example usage
async function runExample() {
  // Example with field name case issues
  const metricsWithCaseIssues = {
    'profiles examined for scoring': 100,
    'profiles successfully scored': 90, 
    'status': 'Completed successfully',
    'system notes': 'Process completed'
  };
  
  console.log('\nExample 1: Field name case issues');
  const result1 = await updateClientRunWithValidation(
    'RUN_123', 
    'CLIENT_ABC',
    metricsWithCaseIssues
  );
  console.log('Result:', result1);
  
  // Example with unknown fields
  const metricsWithUnknownFields = {
    [FIELD_NAMES.PROFILES_EXAMINED]: 100,
    [FIELD_NAMES.PROFILES_SCORED]: 90,
    'Unknown Field': 'Some value',
    'Another Unknown': 123
  };
  
  console.log('\nExample 2: Unknown fields');
  const result2 = await updateClientRunWithValidation(
    'RUN_123', 
    'CLIENT_ABC',
    metricsWithUnknownFields
  );
  console.log('Result:', result2);
  
  // Example with correct fields
  const correctMetrics = {
    [FIELD_NAMES.PROFILES_EXAMINED]: 100,
    [FIELD_NAMES.PROFILES_SCORED]: 90,
    [FIELD_NAMES.STATUS]: CLIENT_RUN_STATUS_VALUES.COMPLETED
  };
  
  console.log('\nExample 3: Correct field names');
  const result3 = await updateClientRunWithValidation(
    'RUN_123', 
    'CLIENT_ABC',
    correctMetrics
  );
  console.log('Result:', result3);
}

module.exports = {
  updateClientRunWithValidation,
  runExample
};

// Run the example if called directly
if (require.main === module) {
  runExample()
    .then(() => console.log('Example completed'))
    .catch(err => console.error('Example error:', err));
}