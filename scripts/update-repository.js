// Script to update unifiedJobTrackingRepository.js
// Find and replace all instances of unifiedRunIdService methods with runIdSystem equivalents

const fs = require('fs');
const path = require('path');

// File path
const filePath = path.join(__dirname, '..', 'services', 'unifiedJobTrackingRepository.js');

// Read the file
let fileContent = fs.readFileSync(filePath, 'utf8');

// Replace patterns
fileContent = fileContent
  // Replace convertToStandardFormat
  .replace(/unifiedRunIdService\.convertToStandardFormat\(([^)]+)\)/g, 'runIdSystem.validateAndStandardizeRunId($1)')
  
  // Replace addClientSuffix
  .replace(/unifiedRunIdService\.addClientSuffix\(([^,]+),\s*([^)]+)\)/g, 'runIdSystem.createClientRunId($1, $2)')
  
  // Replace getCachedRecordId
  .replace(/unifiedRunIdService\.getCachedRecordId\(([^)]+)\)/g, 'runIdSystem.getRunRecordId($1, null)')
  
  // Replace cacheRecordId
  .replace(/unifiedRunIdService\.cacheRecordId\(([^,]+),\s*([^)]+)\)/g, 'runIdSystem.registerRunRecord($1, null, $2)');

// Write the file
fs.writeFileSync(filePath, fileContent);

console.log('File updated successfully.');