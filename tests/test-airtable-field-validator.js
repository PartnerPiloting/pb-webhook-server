/**
 * test-airtable-field-validator.js
 * 
 * Unit tests for the airtableFieldValidator module.
 * Run with: node test-airtable-field-validator.js
 */

const { 
  FIELD_NAMES, 
  STATUS_VALUES, 
  validateFieldNames, 
  createValidatedObject, 
  getFieldName 
} = require('./utils/airtableFieldValidator');

console.log('===============================================');
console.log('AIRTABLE FIELD VALIDATOR - UNIT TEST');
console.log('===============================================');

function runTests() {
  // Test the validateFieldNames function
  testValidateFieldNames();
  
  // Test the createValidatedObject function
  testCreateValidatedObject();
  
  // Test the getFieldName function
  testGetFieldName();
  
  console.log('\n✅ All tests completed!\n');
}

function testValidateFieldNames() {
  console.log('\n📋 Testing validateFieldNames function...');
  
  // Test Case 1: Valid fields
  const validData = {
    [FIELD_NAMES.STATUS]: 'Running',
    [FIELD_NAMES.CLIENT_ID]: '123',
    [FIELD_NAMES.START_TIME]: new Date().toISOString()
  };
  
  const validResult = validateFieldNames(validData);
  console.log(`✓ Valid field validation result: ${validResult.success ? 'PASS' : 'FAIL'}`);
  
  // Test Case 2: Invalid fields
  const invalidData = {
    'status': 'Running',  // Lowercase 's' - wrong case
    [FIELD_NAMES.CLIENT_ID]: '123',
    'Start time': new Date().toISOString() // Space instead of proper casing
  };
  
  const invalidResult = validateFieldNames(invalidData);
  console.log(`✓ Invalid field validation result: ${!invalidResult.success ? 'PASS' : 'FAIL'}`);
  console.log(`  - Error count: ${invalidResult.errors.length}`);
  console.log(`  - First error: ${invalidResult.errors[0]}`);
  
  // Test Case 3: Mixed valid and unknown fields with allowUnknown=true
  const mixedData = {
    [FIELD_NAMES.STATUS]: 'Running',
    'Unknown Field': 'Some value',
    'customField': 123
  };
  
  const mixedResult = validateFieldNames(mixedData, true);
  console.log(`✓ Mixed field validation with allowUnknown=true result: ${mixedResult.success ? 'PASS' : 'FAIL'}`);
}

function testCreateValidatedObject() {
  console.log('\n📋 Testing createValidatedObject function...');
  
  // Test Case 1: Correcting field case
  const incorrectCaseData = {
    'status': 'Running',  // Should be 'Status'
    'client id': '123',   // Should be 'Client ID'
    [FIELD_NAMES.START_TIME]: new Date().toISOString()
  };
  
  const correctedData = createValidatedObject(incorrectCaseData);
  const statusFieldCorrect = correctedData[FIELD_NAMES.STATUS] === 'Running';
  const clientIdFieldCorrect = correctedData[FIELD_NAMES.CLIENT_ID] === '123';
  
  console.log(`✓ Correcting field case: ${statusFieldCorrect && clientIdFieldCorrect ? 'PASS' : 'FAIL'}`);
  
  // Test Case 2: Preserving unknown fields
  const mixedData = {
    'status': 'Running',    // Known field with wrong case
    'customField': 'value', // Unknown field
    '_internal': true       // Internal field (prefixed with _)
  };
  
  const preservedData = createValidatedObject(mixedData);
  const hasCustomField = preservedData.customField === 'value';
  const hasInternalField = preservedData._internal === true;
  
  console.log(`✓ Preserving unknown fields: ${hasCustomField ? 'PASS' : 'FAIL'}`);
  console.log(`✓ Preserving internal fields: ${hasInternalField ? 'PASS' : 'FAIL'}`);
}

function testGetFieldName() {
  console.log('\n📋 Testing getFieldName function...');
  
  // Test Case 1: Getting valid field name
  const statusField = getFieldName('STATUS');
  console.log(`✓ Getting STATUS field: ${statusField === 'Status' ? 'PASS' : 'FAIL'}`);
  
  // Test Case 2: Getting unknown field name
  const unknownField = getFieldName('UNKNOWN_FIELD');
  console.log(`✓ Getting unknown field: ${unknownField === 'UNKNOWN_FIELD' ? 'PASS' : 'FAIL'}`);
}

runTests();