/**
 * Phase 2: Enhance Environment Variable Descriptions with AI
 * Processes one variable at a time, updating Airtable after each analysis
 */

require('dotenv').config();
const Airtable = require('airtable');
const { VertexAI } = require('@google-cloud/vertexai');

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
    .base(process.env.MASTER_CLIENTS_BASE_ID);

// Initialize Gemini
const vertex_ai = new VertexAI({
    project: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION
});
const model = vertex_ai.preview.getGenerativeModel({
    model: process.env.GEMINI_MODEL_ID || 'gemini-2.0-flash-exp'
});

// Simple analyzer to find where variables are used
class SimpleAnalyzer {
    constructor() {
        const fs = require('fs');
        const path = require('path');
        this.projectRoot = __dirname;
    }

    scanCodeForEnvVars() {
        const fs = require('fs');
        const path = require('path');
        const varNames = new Set();
        
        const scanDir = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                // Skip node_modules, .git, etc
                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        scanDir(fullPath);
                    }
                } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const matches = content.match(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
                        if (matches) {
                            matches.forEach(match => {
                                const varName = match.replace('process.env.', '');
                                varNames.add(varName);
                            });
                        }
                    } catch (err) {
                        // Skip files that can't be read
                    }
                }
            }
        };
        
        scanDir(this.projectRoot);
        return Array.from(varNames);
    }

    findVarUsage(varName) {
        const fs = require('fs');
        const path = require('path');
        const usages = [];
        
        const searchPattern = new RegExp(`process\\.env\\.${varName}`, 'g');
        
        const scanDir = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        scanDir(fullPath);
                    }
                } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        if (searchPattern.test(content)) {
                            const relativePath = path.relative(this.projectRoot, fullPath);
                            usages.push(relativePath);
                        }
                    } catch (err) {
                        // Skip files that can't be read
                    }
                }
            }
        };
        
        scanDir(this.projectRoot);
        return usages;
    }

    getCurrentValue(varName) {
        return process.env[varName] || '';
    }
}

async function generateAIDescription(varName, usage, currentValue) {
    const fs = require('fs');
    const path = require('path');
    
    // Collect code snippets from usage locations
    const snippets = [];
    for (const file of usage.slice(0, 5)) { // Limit to first 5 files
        try {
            const fullPath = path.join(__dirname, file);
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            
            // Find lines containing the variable
            const relevantLines = [];
            lines.forEach((line, idx) => {
                if (line.includes(`process.env.${varName}`)) {
                    // Get context: 2 lines before and after
                    const start = Math.max(0, idx - 2);
                    const end = Math.min(lines.length, idx + 3);
                    relevantLines.push({
                        file,
                        lineNum: idx + 1,
                        context: lines.slice(start, end).join('\n')
                    });
                }
            });
            
            snippets.push(...relevantLines.slice(0, 2)); // Max 2 snippets per file
        } catch (err) {
            // Skip if can't read file
        }
    }
    
    const prompt = `Analyze this environment variable and provide a clear, concise description for documentation.

Variable Name: ${varName}
Current Value: ${currentValue || '(not set)'}
Used in ${usage.length} file(s): ${usage.slice(0, 3).join(', ')}${usage.length > 3 ? ` and ${usage.length - 3} more` : ''}

Code Examples:
${snippets.map(s => `${s.file}:${s.lineNum}\n${s.context}`).join('\n\n---\n\n')}

Provide a 2-3 sentence description that explains:
1. What this variable controls
2. How it's used in the application
3. What the default behavior is if not set

Be specific and practical. Write for a developer who needs to understand this quickly.`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        return response.candidates[0].content.parts[0].text.trim();
    } catch (error) {
        console.error(`   ❌ AI generation failed: ${error.message}`);
        return `Used in ${usage.length} location(s) - ${usage.join(', ')}`;
    }
}

async function enhanceDescriptions() {
    console.log('🚀 Starting Phase 2: AI Description Enhancement\n');
    
    const analyzer = new SimpleAnalyzer();
    
    // Get all records from Airtable that need AI descriptions
    const records = await base('Environment Variables')
        .select({
            filterByFormula: "OR({Status} = '', {Status} = 'Active', {Status} = 'Deprecated')"
        })
        .all();
    
    console.log(`📋 Found ${records.length} variables to enhance\n`);
    
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const record of records) {
        const varName = record.fields['Variable Name'];
        const currentDescription = record.fields['AI Description'] || '';
        
        processed++;
        console.log(`\n[${processed}/${records.length}] Processing: ${varName}`);
        
        // Skip if already has a good AI description (not "pending")
        if (currentDescription && !currentDescription.includes('AI description pending')) {
            console.log(`   ⏭️  Skipped (already has AI description)`);
            skipped++;
            continue;
        }
        
        try {
            // Find usage
            const usage = analyzer.findVarUsage(varName);
            console.log(`   📍 Found in ${usage.length} file(s)`);
            
            if (usage.length === 0) {
                console.log(`   ⚠️  Not found in code - marking as obsolete`);
                await base('Environment Variables').update(record.id, {
                    'Status': 'Obsolete',
                    'AI Description': 'Not found in current codebase - may be obsolete or only used at runtime'
                });
                updated++;
                continue;
            }
            
            // Generate AI description
            console.log(`   🤖 Generating AI description...`);
            const currentValue = analyzer.getCurrentValue(varName);
            const aiDescription = await generateAIDescription(varName, usage, currentValue);
            
            // Update Airtable
            await base('Environment Variables').update(record.id, {
                'AI Description': aiDescription,
                'Used In Files': usage.join(', '),
                'Staging Value': currentValue
            });
            
            console.log(`   ✅ Updated with AI description`);
            console.log(`   💬 "${aiDescription.substring(0, 100)}${aiDescription.length > 100 ? '...' : ''}"`);
            updated++;
            
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            errors++;
        }
    }
    
    console.log(`\n\n✅ Enhancement Complete!`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);
}

// Run the enhancement
enhanceDescriptions()
    .then(() => {
        console.log('\n🎉 All done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Fatal error:', err);
        process.exit(1);
    });
