// runRecordAdapterSimpleUpdater.js
// Script to update all StructuredLogger instances in runRecordAdapterSimple.js

const fs = require('fs');
const path = require('path');

// Path to the file we're updating
const filePath = path.join(__dirname, '..', 'services', 'runRecordAdapterSimple.js');

// Read the file
let fileContent = fs.readFileSync(filePath, 'utf8');

// Replace direct StructuredLogger instantiations
// 1. Replace sysLogger instances
fileContent = fileContent.replace(
  /const sysLogger = new StructuredLogger\('SYSTEM', ([^,]+), '([^']+)'\);/g,
  "const sysLogger = createSafeLogger('SYSTEM', $1, '$2');"
);

// 2. Replace logger instances
fileContent = fileContent.replace(
  /const logger = options\.logger \|\| new StructuredLogger\(([^,]+), ([^,]+), '([^']+)'\);/g,
  "const logger = getLoggerFromOptions(options, $1, $2, '$3');"
);

// 3. Handle special case of processType || 'metrics'
fileContent = fileContent.replace(
  /const logger = options\.logger \|\| new StructuredLogger\(([^,]+), ([^,]+), processType \|\| '([^']+)'\);/g,
  "const logger = getLoggerFromOptions(options, $1, $2, processType || '$3');"
);

// Write the file back
fs.writeFileSync(filePath, fileContent);

console.log('Updated all StructuredLogger instances in runRecordAdapterSimple.js');