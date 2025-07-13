// exportTableData.js
// Export complete Scoring Attributes table data to text file for development

require('dotenv').config();
const Airtable = require('airtable');
const fs = require('fs');

async function exportScoringAttributesData() {
    console.log('📊 Exporting Scoring Attributes table data...');
    
    try {
        // Connect to Airtable
        if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
            console.error("❌ Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID environment variables");
            return;
        }

        Airtable.configure({
            apiKey: process.env.AIRTABLE_API_KEY
        });

        const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
        const tableName = 'Scoring Attributes';
        
        console.log(`✅ Connected to base: ${process.env.AIRTABLE_BASE_ID}`);
        console.log(`📋 Reading table: "${tableName}"`);
        
        // Get all records from the table
        const records = await base(tableName)
            .select({
                // Get all records, no filtering
            })
            .all();
            
        console.log(`📄 Found ${records.length} records`);
        
        if (records.length === 0) {
            console.log('❌ No records found in table');
            return;
        }
        
        // Analyze table structure
        const firstRecord = records[0];
        const allFields = new Set();
        
        // Collect all possible field names from all records
        records.forEach(record => {
            Object.keys(record.fields).forEach(fieldName => {
                allFields.add(fieldName);
            });
        });
        
        const fieldNames = Array.from(allFields).sort();
        
        // Build comprehensive export data
        let exportData = '';
        exportData += '='.repeat(80) + '\n';
        exportData += 'SCORING ATTRIBUTES TABLE - COMPLETE DATA EXPORT\n';
        exportData += '='.repeat(80) + '\n\n';
        
        exportData += `Export Date: ${new Date().toISOString()}\n`;
        exportData += `Base ID: ${process.env.AIRTABLE_BASE_ID}\n`;
        exportData += `Table Name: ${tableName}\n`;
        exportData += `Total Records: ${records.length}\n\n`;
        
        // Field Analysis
        exportData += 'FIELD STRUCTURE ANALYSIS:\n';
        exportData += '-'.repeat(40) + '\n';
        
        fieldNames.forEach((fieldName, index) => {
            // Analyze field types and sample values
            const fieldValues = records
                .map(record => record.fields[fieldName])
                .filter(value => value !== undefined && value !== null);
                
            const uniqueTypes = [...new Set(fieldValues.map(val => typeof val))];
            const sampleValues = fieldValues.slice(0, 3);
            
            exportData += `${index + 1}. "${fieldName}"\n`;
            exportData += `   Type(s): ${uniqueTypes.join(', ')}\n`;
            exportData += `   Sample values: ${sampleValues.map(val => JSON.stringify(val)).join(', ')}\n`;
            exportData += `   Records with data: ${fieldValues.length}/${records.length}\n\n`;
        });
        
        // Complete Records Data
        exportData += '\n' + '='.repeat(80) + '\n';
        exportData += 'COMPLETE RECORDS DATA:\n';
        exportData += '='.repeat(80) + '\n\n';
        
        records.forEach((record, index) => {
            exportData += `RECORD ${index + 1}:\n`;
            exportData += `Record ID: ${record.id}\n`;
            exportData += `Created Time: ${record.createdTime || 'Not available'}\n`;
            exportData += 'Fields:\n';
            
            fieldNames.forEach(fieldName => {
                const value = record.fields[fieldName];
                if (value !== undefined && value !== null) {
                    // Format value for display
                    let displayValue;
                    if (typeof value === 'string' && value.length > 100) {
                        displayValue = value.substring(0, 100) + '... (truncated)';
                    } else {
                        displayValue = JSON.stringify(value);
                    }
                    exportData += `  ${fieldName}: ${displayValue}\n`;
                } else {
                    exportData += `  ${fieldName}: (empty)\n`;
                }
            });
            exportData += '\n' + '-'.repeat(60) + '\n\n';
        });
        
        // Data Patterns Analysis
        exportData += 'DATA PATTERNS ANALYSIS:\n';
        exportData += '-'.repeat(40) + '\n';
        
        // Analyze categories
        const categories = records
            .map(record => record.fields['Category'])
            .filter(cat => cat)
            .reduce((acc, cat) => {
                acc[cat] = (acc[cat] || 0) + 1;
                return acc;
            }, {});
            
        exportData += `Categories found: ${Object.keys(categories).join(', ')}\n`;
        Object.entries(categories).forEach(([cat, count]) => {
            exportData += `  ${cat}: ${count} records\n`;
        });
        exportData += '\n';
        
        // Analyze point ranges
        const maxPoints = records
            .map(record => record.fields['Max Points'])
            .filter(points => typeof points === 'number');
            
        if (maxPoints.length > 0) {
            exportData += `Max Points range: ${Math.min(...maxPoints)} - ${Math.max(...maxPoints)}\n`;
            exportData += `Unique Max Points values: ${[...new Set(maxPoints)].sort((a,b) => a-b).join(', ')}\n\n`;
        }
        
        // API Development Notes
        exportData += 'API DEVELOPMENT NOTES:\n';
        exportData += '-'.repeat(40) + '\n';
        exportData += `✅ Table name confirmed: "${tableName}"\n`;
        exportData += `✅ Primary key field: "Attribute Id" (values like: ${records.slice(0,3).map(r => r.fields['Attribute Id']).join(', ')})\n`;
        exportData += `✅ Editable fields: ${fieldNames.filter(f => f !== 'Attribute Id').join(', ')}\n`;
        exportData += `✅ Record IDs available for updates: Yes\n`;
        exportData += `✅ Field types suitable for web editing: Yes\n\n`;
        
        exportData += 'RECOMMENDED WEB INTERFACE FIELDS:\n';
        fieldNames.forEach(field => {
            if (field === 'Attribute Id') {
                exportData += `  ${field}: Read-only identifier\n`;
            } else if (field === 'Category') {
                exportData += `  ${field}: Dropdown (${Object.keys(categories).join(', ')})\n`;
            } else if (field.includes('Points') || field.includes('Penalty')) {
                exportData += `  ${field}: Number input\n`;
            } else if (field === 'Instructions') {
                exportData += `  ${field}: Textarea (long text)\n`;
            } else {
                exportData += `  ${field}: Text input\n`;
            }
        });
        
        exportData += '\n' + '='.repeat(80) + '\n';
        exportData += 'END OF EXPORT\n';
        exportData += '='.repeat(80) + '\n';
        
        // Write to file
        const filename = 'scoring-attributes-data.txt';
        fs.writeFileSync(filename, exportData, 'utf8');
        
        console.log(`✅ Export complete!`);
        console.log(`📁 Data saved to: ${filename}`);
        console.log(`📊 Exported ${records.length} records with ${fieldNames.length} fields`);
        console.log(`\n🎯 Next step: Attach "${filename}" to your chat message`);
        
    } catch (error) {
        console.error('❌ Export failed:', error.message);
        console.error('Full error:', error);
    }
}

// Run the export
exportScoringAttributesData();
