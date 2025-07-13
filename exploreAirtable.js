// exploreAirtable.js
// Script to discover all tables in your Airtable base and find scoring attributes

require('dotenv').config();
const Airtable = require('airtable');

async function discoverAllTables() {
    console.log("🔍 Discovering all tables in your Airtable base...");
    
    try {
        // Use your existing environment variables
        if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
            console.error("❌ Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID environment variables");
            return;
        }

        Airtable.configure({
            apiKey: process.env.AIRTABLE_API_KEY
        });

        const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
        
        console.log(`✅ Connected to base: ${process.env.AIRTABLE_BASE_ID}`);
        
        // Try a comprehensive list of possible table names
        const possibleTableNames = [
            // Common lead/scoring tables
            'Leads',
            'Posts', 
            'Companies',
            'Contacts',
            
            // Scoring-related tables
            'Scoring Attributes',
            'Attributes', 
            'Lead Scoring Attributes',
            'Positive Attributes',
            'Negative Attributes',
            'Scoring',
            'Lead Scoring',
            'Rubric',
            'Criteria',
            'Lead Attributes',
            'Post Attributes',
            'Scoring Criteria',
            'Lead Criteria',
            'Post Scoring',
            'Content Scoring',
            
            // Configuration tables
            'Config',
            'Configuration',
            'Settings',
            'Parameters',
            
            // Other common names
            'Data',
            'Records',
            'Main',
            'Primary'
        ];
        
        const existingTables = [];
        
        console.log("\n🔍 Testing table names...");
        
        for (const tableName of possibleTableNames) {
            try {
                const records = await base(tableName)
                    .select({
                        maxRecords: 1
                    })
                    .firstPage();
                
                existingTables.push({
                    name: tableName,
                    hasRecords: records.length > 0,
                    sampleRecord: records.length > 0 ? records[0] : null
                });
                
                console.log(`✅ Found: "${tableName}" ${records.length > 0 ? '(has data)' : '(empty)'}`);
                
            } catch (tableError) {
                // Table doesn't exist - that's fine
            }
        }
        
        if (existingTables.length === 0) {
            console.log('\n❌ No tables found with standard names.');
            console.log('This might indicate:');
            console.log('1. Permission issues with your API key');
            console.log('2. Incorrect base ID');
            console.log('3. Tables have non-standard names');
            console.log('\nPlease check your Airtable base directly and share the exact table names.');
            return;
        }
        
        console.log(`\n📋 DISCOVERED ${existingTables.length} ACCESSIBLE TABLES:`);
        existingTables.forEach((table, index) => {
            console.log(`${index + 1}. "${table.name}" ${table.hasRecords ? '(has data)' : '(empty)'}`);
        });
        
        // Now examine each table for scoring-related fields
        console.log('\n🎯 ANALYZING TABLES FOR SCORING CONTENT...');
        
        let bestScoringTable = null;
        let bestScore = 0;
        
        for (const tableInfo of existingTables) {
            if (!tableInfo.hasRecords) continue;
            
            console.log(`\n� Analyzing: "${tableInfo.name}"`);
            
            try {
                const records = await base(tableInfo.name)
                    .select({
                        maxRecords: 2
                    })
                    .firstPage();
                
                if (records.length > 0) {
                    const fields = Object.keys(records[0].fields);
                    console.log(`   Fields (${fields.length}): ${fields.join(', ')}`);
                    
                    // Score this table based on scoring-related field names
                    const scoringKeywords = [
                        'point', 'score', 'weight', 'penalty', 'criteria', 
                        'rubric', 'attribute', 'max', 'min', 'qualify',
                        'instruction', 'label'
                    ];
                    
                    let tableScore = 0;
                    const matchingFields = [];
                    
                    fields.forEach(field => {
                        const fieldLower = field.toLowerCase();
                        scoringKeywords.forEach(keyword => {
                            if (fieldLower.includes(keyword)) {
                                tableScore++;
                                matchingFields.push(field);
                            }
                        });
                    });
                    
                    if (tableScore > 0) {
                        console.log(`   🎯 Scoring relevance: ${tableScore} (fields: ${matchingFields.join(', ')})`);
                        if (tableScore > bestScore) {
                            bestScore = tableScore;
                            bestScoringTable = tableInfo;
                        }
                    } else {
                        console.log(`   ⚪ No obvious scoring fields`);
                    }
                }
                
            } catch (error) {
                console.log(`   ❌ Error analyzing: ${error.message}`);
            }
        }
        
        if (bestScoringTable) {
            console.log(`\n🏆 BEST SCORING TABLE CANDIDATE: "${bestScoringTable.name}"`);
            await analyzeTableInDetail(base, bestScoringTable.name);
        } else {
            console.log('\n❌ No table appears to contain scoring attributes.');
            console.log('Please check which table in your base contains the scoring rubric data.');
        }
        
    } catch (error) {
        console.error("❌ Exploration failed:", error.message);
        console.error("Full error:", error);
    }
}

async function analyzeTableInDetail(base, tableName) {
    console.log(`\n📊 DETAILED ANALYSIS OF "${tableName}":`);
    
    try {
        const records = await base(tableName)
            .select({
                maxRecords: 3
            })
            .firstPage();
            
        if (records.length === 0) {
            console.log("   (Table is empty)");
            return;
        }
        
        console.log(`   Total sample records: ${records.length}`);
        
        // Analyze field structure
        const firstRecord = records[0];
        const fields = firstRecord.fields;
        
        console.log("\n   📋 FIELD ANALYSIS:");
        Object.keys(fields).forEach(fieldName => {
            const value = fields[fieldName];
            const type = typeof value;
            const preview = type === 'string' && value.length > 50 
                ? value.substring(0, 50) + "..." 
                : value;
            console.log(`      "${fieldName}": ${type} = ${JSON.stringify(preview)}`);
        });
        
        console.log("\n   📄 SAMPLE RECORDS:");
        records.forEach((record, index) => {
            console.log(`   Record ${index + 1} (ID: ${record.id}):`);
            Object.keys(record.fields).forEach(fieldName => {
                const value = record.fields[fieldName];
                console.log(`      ${fieldName}: ${JSON.stringify(value)}`);
            });
            console.log("");
        });
        
    } catch (error) {
        console.log(`   ❌ Error analyzing table details: ${error.message}`);
    }
}

// Run the discovery
discoverAllTables();
