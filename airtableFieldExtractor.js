// airtableFieldExtractor.js
// Utility to extract field names and types from an Airtable table and save to text file

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Airtable = require('airtable');

/**
 * Extract field information from an Airtable table
 * @param {string} tableName - Name of the table to analyze
 * @param {string} outputFile - Path to save the extracted field information
 * @param {string} baseId - Optional: specific base ID to use (defaults to env variable)
 */
async function extractTableFields(tableName, outputFile, baseId = null) {
    try {
        console.log(`Starting field extraction for table: ${tableName}`);
        
        // Use environment variables for direct base connection
        if (!process.env.AIRTABLE_API_KEY) {
            throw new Error("AIRTABLE_API_KEY environment variable is not set");
        }
        
        const targetBaseId = baseId || process.env.AIRTABLE_BASE_ID;
        if (!targetBaseId) {
            throw new Error("AIRTABLE_BASE_ID environment variable is not set and no baseId provided");
        }
        
        // Configure Airtable client
        Airtable.configure({
            apiKey: process.env.AIRTABLE_API_KEY
        });
        
        // Get the Airtable base directly
        const base = Airtable.base(targetBaseId);
        console.log(`✅ Connected to base: ${targetBaseId}`);
        
        // Fetch all records from the table to analyze field structure
        console.log(`Fetching records from table: ${tableName}`);
        const records = await base(tableName).select({
            maxRecords: 10, // Only need a sample to understand structure
        }).all();
        
        if (records.length === 0) {
            throw new Error(`No records found in table: ${tableName}`);
        }
        
        // Extract field information from the first few records
        const fieldInfo = new Map();
        
        records.forEach((record, recordIndex) => {
            console.log(`Analyzing record ${recordIndex + 1}/${records.length}`);
            
            // Get all fields from this record
            const fields = record.fields;
            
            Object.keys(fields).forEach(fieldName => {
                const value = fields[fieldName];
                
                if (!fieldInfo.has(fieldName)) {
                    fieldInfo.set(fieldName, {
                        name: fieldName,
                        types: new Set(),
                        sampleValues: [],
                        isArray: false,
                        hasNull: false
                    });
                }
                
                const info = fieldInfo.get(fieldName);
                
                // Determine field type
                if (value === null || value === undefined) {
                    info.hasNull = true;
                } else if (Array.isArray(value)) {
                    info.isArray = true;
                    info.types.add('Array');
                    if (value.length > 0) {
                        info.types.add(`Array of ${typeof value[0]}`);
                    }
                } else {
                    info.types.add(typeof value);
                    
                    // Special type detection
                    if (typeof value === 'string') {
                        if (value.includes('http')) {
                            info.types.add('URL');
                        }
                        if (value.includes('@')) {
                            info.types.add('Email');
                        }
                        if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
                            info.types.add('Date');
                        }
                        if (value.length > 200) {
                            info.types.add('Long Text');
                        }
                    }
                    
                    if (typeof value === 'number') {
                        if (Number.isInteger(value)) {
                            info.types.add('Integer');
                        } else {
                            info.types.add('Decimal');
                        }
                    }
                }
                
                // Store sample values (limit to 3 per field)
                if (info.sampleValues.length < 3 && value !== null && value !== undefined) {
                    const sampleValue = Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
                    if (!info.sampleValues.includes(sampleValue)) {
                        info.sampleValues.push(sampleValue);
                    }
                }
            });
        });
        
        // Generate the output text
        const output = generateFieldReport(tableName, targetBaseId, fieldInfo, records.length);
        
        // Save to file
        fs.writeFileSync(outputFile, output, 'utf8');
        
        console.log(`✅ Field extraction complete!`);
        console.log(`📊 Analyzed ${records.length} records`);
        console.log(`🔍 Found ${fieldInfo.size} fields`);
        console.log(`💾 Results saved to: ${outputFile}`);
        
        return { fieldCount: fieldInfo.size, recordCount: records.length };
        
    } catch (error) {
        console.error(`❌ Error extracting fields:`, error.message);
        throw error;
    }
}

/**
 * Generate a formatted report of the field analysis
 */
function generateFieldReport(tableName, baseId, fieldInfo, recordCount) {
    const timestamp = new Date().toISOString();
    
    let output = `# Airtable Field Analysis Report
Generated: ${timestamp}
Table: "${tableName}"
Base ID: ${baseId}
Records Analyzed: ${recordCount}
Total Fields: ${fieldInfo.size}

## Field Definitions

| Field Name | Primary Type | All Types | Sample Values | Notes |
|------------|--------------|-----------|---------------|-------|
`;
    
    // Sort fields alphabetically
    const sortedFields = Array.from(fieldInfo.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    
    sortedFields.forEach(([fieldName, info]) => {
        const primaryType = getPrimaryType(info.types);
        const allTypes = Array.from(info.types).join(', ');
        const samples = info.sampleValues.length > 0 ? info.sampleValues.join(' | ') : 'No samples';
        const notes = [];
        
        if (info.hasNull) notes.push('Nullable');
        if (info.isArray) notes.push('Array field');
        
        output += `| \`${fieldName}\` | ${primaryType} | ${allTypes} | ${samples} | ${notes.join(', ') || '-'} |\n`;
    });
    
    output += `\n## Detailed Field Information\n\n`;
    
    sortedFields.forEach(([fieldName, info]) => {
        output += `### \`${fieldName}\`\n`;
        output += `- **Primary Type:** ${getPrimaryType(info.types)}\n`;
        output += `- **All Detected Types:** ${Array.from(info.types).join(', ')}\n`;
        output += `- **Sample Values:**\n`;
        if (info.sampleValues.length > 0) {
            info.sampleValues.forEach(sample => {
                output += `  - ${sample}\n`;
            });
        } else {
            output += `  - No sample values available\n`;
        }
        output += `- **Nullable:** ${info.hasNull ? 'Yes' : 'No'}\n`;
        output += `- **Array Field:** ${info.isArray ? 'Yes' : 'No'}\n\n`;
    });
    
    output += `## Recommended Airtable Field Types\n\n`;
    output += `Based on the analysis, here are the recommended Airtable field types:\n\n`;
    
    sortedFields.forEach(([fieldName, info]) => {
        const recommended = getRecommendedAirtableType(info);
        output += `- **\`${fieldName}\`**: ${recommended}\n`;
    });
    
    return output;
}

/**
 * Get the primary type from a set of detected types
 */
function getPrimaryType(types) {
    const typeArray = Array.from(types);
    
    // Priority order for determining primary type
    const typePriority = ['Long Text', 'URL', 'Email', 'Date', 'Decimal', 'Integer', 'Array', 'string', 'number', 'boolean'];
    
    for (const priority of typePriority) {
        if (typeArray.includes(priority)) {
            return priority;
        }
    }
    
    return typeArray[0] || 'Unknown';
}

/**
 * Recommend appropriate Airtable field type based on detected characteristics
 */
function getRecommendedAirtableType(info) {
    const types = Array.from(info.types);
    
    if (types.includes('URL')) return 'URL';
    if (types.includes('Email')) return 'Email';
    if (types.includes('Date')) return 'Date';
    if (types.includes('Long Text')) return 'Long Text';
    if (types.includes('Array')) return 'Multiple Select or Linked Records';
    if (types.includes('Decimal')) return 'Number (Allow decimals)';
    if (types.includes('Integer')) return 'Number (Integer only)';
    if (types.includes('boolean')) return 'Checkbox';
    if (types.includes('string')) return 'Single Line Text';
    
    return 'Single Line Text (default)';
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log(`
Usage: node airtableFieldExtractor.js <tableName> [outputFile] [baseId]

Examples:
  node airtableFieldExtractor.js "Post Scoring Attributes"
  node airtableFieldExtractor.js "Post Scoring Attributes" post-scoring-fields.txt
  node airtableFieldExtractor.js "Scoring Attributes" profile-scoring-fields.txt

Arguments:
  tableName   - Name of the table to analyze (use quotes if it contains spaces)
  outputFile  - Optional: Path to save the report (default: <tableName>-fields-<timestamp>.txt)
  baseId      - Optional: Specific base ID to use (default: uses AIRTABLE_BASE_ID env var)
        `);
        process.exit(1);
    }
    
    const tableName = args[0];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const defaultOutputFile = `${tableName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-fields-${timestamp}.txt`;
    const outputFile = args[1] || defaultOutputFile;
    const baseId = args[2] || null;
    
    try {
        await extractTableFields(tableName, outputFile, baseId);
    } catch (error) {
        console.error('❌ Failed to extract fields:', error.message);
        process.exit(1);
    }
}

// Export for use as module
module.exports = {
    extractTableFields,
    generateFieldReport,
    getPrimaryType,
    getRecommendedAirtableType
};

// Run CLI if called directly
if (require.main === module) {
    main();
}
