// services/envVarDocumenter.js
// Environment Variable Documentation & Airtable Sync Service
// Scans code, analyzes usage, generates plain English descriptions, and syncs to Airtable

const EnvVarAnalyzer = require('./envVarAnalyzer');
const { getMasterClientsBase } = require('../config/airtableClient');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ operation: 'env-var-documenter' });

/**
 * Extended environment variable analyzer with Airtable integration
 * Automatically documents all env vars in the Environment Variables table
 */
class EnvVarDocumenter {
    constructor() {
        this.analyzer = new EnvVarAnalyzer();
        this.masterBase = null;
        this.envVarsTable = 'Environment Variables';
    }

    /**
     * Initialize Airtable connection
     */
    async initialize() {
        try {
            this.masterBase = await getMasterClientsBase();
            logger.info('Airtable connection initialized for env var documentation');
        } catch (error) {
            logger.error('Failed to initialize Airtable connection:', error);
            throw error;
        }
    }

    /**
     * Scan entire codebase and sync to Airtable
     * This is the main function you'll call
     * @param {Object} options - Scan options
     * @param {boolean} options.includeAi - Whether to generate AI descriptions (default: false for speed)
     */
    async scanAndSync(options = {}) {
        const { includeAi = false } = options;
        
        logger.info(`🔍 Starting environment variable scan (AI mode: ${includeAi ? 'ON' : 'OFF'})...`);
        
        await this.initialize();

        // Step 1: Scan codebase for all env vars
        const varNames = this.analyzer.scanCodeForEnvVars();
        logger.info(`Found ${varNames.length} environment variables in code`);

        // Step 2: Get existing records from Airtable
        const existingRecords = await this.getExistingRecords();
        const existingVarNames = new Set(existingRecords.map(r => r.fields['Variable Name']));
        
        logger.info(`Found ${existingRecords.length} existing records in Airtable`);

        // Step 3: Analyze all variables
        let analyses;
        if (includeAi) {
            logger.info('🤖 Generating AI descriptions (this will take 5-10 minutes)...');
            analyses = await this.analyzer.analyzeAll();
        } else {
            logger.info('⚡ Fast mode: Creating basic records (AI descriptions can be added later)');
            analyses = varNames.map(varName => {
                const usage = this.analyzer.findVarUsage(varName);
                return {
                    name: varName,
                    description: `Used in ${usage.length} location(s) - AI description pending`,
                    category: 'Configuration',
                    currentValue: process.env[varName] || '',
                    usageLocations: usage,
                    effect: 'See code for usage details',
                    recommended: 'Set appropriate value for environment'
                };
            });
        }

        // Step 4: Sync to Airtable
        const stats = {
            created: 0,
            updated: 0,
            deleted: 0,
            unchanged: 0
        };

        for (const analysis of analyses) {
            const existing = existingRecords.find(r => r.fields['Variable Name'] === analysis.name);
            
            if (existing) {
                // Update existing record
                const needsUpdate = this.needsUpdate(existing.fields, analysis);
                
                if (needsUpdate) {
                    await this.updateRecord(existing.id, analysis);
                    stats.updated++;
                    logger.info(`✅ Updated: ${analysis.name}`);
                } else {
                    stats.unchanged++;
                }
            } else {
                // Create new record
                await this.createRecord(analysis);
                stats.created++;
                logger.info(`➕ Created: ${analysis.name}`);
            }
        }

        // Step 5: Find obsolete variables (in Airtable but not in code)
        const codeVarNames = new Set(varNames);
        const obsoleteRecords = existingRecords.filter(r => 
            !codeVarNames.has(r.fields['Variable Name'])
        );

        logger.info(`\n📊 Sync Summary:`);
        logger.info(`   Created: ${stats.created}`);
        logger.info(`   Updated: ${stats.updated}`);
        logger.info(`   Unchanged: ${stats.unchanged}`);
        logger.info(`   Obsolete: ${obsoleteRecords.length}`);

        if (obsoleteRecords.length > 0) {
            logger.warn(`\n⚠️  Found ${obsoleteRecords.length} obsolete variables in Airtable:`);
            obsoleteRecords.forEach(r => {
                logger.warn(`   - ${r.fields['Variable Name']} (last used in: ${r.fields['Used In Files'] || 'unknown'})`);
            });
            logger.warn(`   These variables are in Airtable but not found in current code.`);
            logger.warn(`   Review and mark as Status="Obsolete" if no longer needed.`);
        }

        return { stats, obsoleteRecords };
    }

    /**
     * Get all existing env var records from Airtable
     */
    async getExistingRecords() {
        const records = [];
        
        try {
            await this.masterBase(this.envVarsTable)
                .select()
                .eachPage((pageRecords, fetchNextPage) => {
                    records.push(...pageRecords);
                    fetchNextPage();
                });
            
            return records;
        } catch (error) {
            logger.error('Error fetching existing records:', error);
            throw error;
        }
    }

    /**
     * Check if a record needs updating
     */
    needsUpdate(existingFields, analysis) {
        // Always update if key fields changed
        const currentValue = this.analyzer.getCurrentValue(analysis.name);
        
        return (
            existingFields['Staging Value'] !== currentValue ||
            existingFields['AI Description'] !== analysis.description ||
            existingFields['Used In Files'] !== analysis.usage.join(', ')
        );
    }

    /**
     * Create new Airtable record
     */
    async createRecord(analysis) {
        const currentValue = this.analyzer.getCurrentValue(analysis.name);
        
        const fields = {
            'Variable Name': analysis.name,
            'AI Description': analysis.description,
            'Business Purpose': this.generateBusinessPurpose(analysis),
            'Category': this.mapCategory(analysis.category),
            'Staging Value': currentValue || '',
            'Production Value': '', // Leave empty - you'll fill this from Render
            'Used In Files': analysis.usage.join(', '),
            'Status': currentValue ? 'Active' : 'Not Set',
            'Last Synced': new Date().toISOString()
        };

        try {
            await this.masterBase(this.envVarsTable).create([{ fields }]);
        } catch (error) {
            logger.error(`Error creating record for ${analysis.name}:`, error);
            throw error;
        }
    }

    /**
     * Update existing Airtable record
     */
    async updateRecord(recordId, analysis) {
        const currentValue = this.analyzer.getCurrentValue(analysis.name);
        
        const fields = {
            'AI Description': analysis.description,
            'Business Purpose': this.generateBusinessPurpose(analysis),
            'Category': this.mapCategory(analysis.category),
            'Staging Value': currentValue || '',
            'Used In Files': analysis.usage.join(', '),
            'Status': currentValue ? 'Active' : 'Not Set',
            'Last Synced': new Date().toISOString()
        };

        try {
            await this.masterBase(this.envVarsTable).update([{ id: recordId, fields }]);
        } catch (error) {
            logger.error(`Error updating record ${recordId}:`, error);
            throw error;
        }
    }

    /**
     * Generate business-friendly purpose from technical description
     */
    generateBusinessPurpose(analysis) {
        const businessMap = {
            'database': 'Data Storage Configuration',
            'api': 'External Service Integration',
            'auth': 'Security & Authentication',
            'performance': 'System Performance Tuning',
            'feature-flag': 'Feature Toggle Control',
            'debug': 'Development & Debugging',
            'email': 'Email Notification Setup',
            'ai': 'AI Service Configuration',
            'deployment': 'Deployment Environment Settings'
        };

        const category = analysis.category?.toLowerCase() || 'other';
        const baseDescription = businessMap[category] || 'Application Configuration';

        return `${baseDescription} - ${analysis.effect}`;
    }

    /**
     * Map analyzer category to Airtable single-select options
     */
    mapCategory(analyzerCategory) {
        const categoryMap = {
            'database': 'Data & Storage',
            'api': 'API & Integration',
            'auth': 'Authentication',
            'performance': 'Performance',
            'feature-flag': 'Feature Flags',
            'debug': 'Debugging',
            'email': 'Email',
            'ai': 'AI Services',
            'deployment': 'Deployment',
            'other': 'Other'
        };

        return categoryMap[analyzerCategory?.toLowerCase()] || 'Other';
    }

    /**
     * Find variables that can be safely removed
     * Returns variables that are:
     * - Not set in any environment
     * - Used in deprecated/backup code only
     */
    async identifyRemovableCandidates() {
        logger.info('🔍 Identifying potentially removable variables...');

        const varNames = this.analyzer.scanCodeForEnvVars();
        const removableCandidates = [];

        for (const varName of varNames) {
            const value = this.analyzer.getCurrentValue(varName);
            const usage = this.analyzer.findVarUsage(varName);

            // Criteria for removal candidates:
            const notSet = !value;
            const onlyInBackupCode = usage.every(u => 
                u.file.includes('Backup') || 
                u.file.includes('archive') ||
                u.file.includes('deprecated')
            );
            const lowUsage = usage.length <= 2;

            if (notSet && (onlyInBackupCode || lowUsage)) {
                removableCandidates.push({
                    name: varName,
                    reason: notSet ? 'Not set in any environment' : null,
                    backupCodeOnly: onlyInBackupCode,
                    usageCount: usage.length,
                    locations: usage.map(u => `${u.file}:${u.line}`)
                });
            }
        }

        return removableCandidates;
    }

    /**
     * Find variables that might be duplicates or can be consolidated
     */
    async findConsolidationOpportunities() {
        logger.info('🔍 Looking for consolidation opportunities...');

        const varNames = this.analyzer.scanCodeForEnvVars();
        const groups = {};

        // Group by similar names
        for (const varName of varNames) {
            const prefix = varName.split('_')[0];
            
            if (!groups[prefix]) {
                groups[prefix] = [];
            }
            groups[prefix].push(varName);
        }

        // Find groups with multiple similar variables
        const opportunities = [];
        
        for (const [prefix, vars] of Object.entries(groups)) {
            if (vars.length > 1) {
                // Check if they have similar values or purposes
                const analyses = await Promise.all(
                    vars.map(v => this.analyzer.generateDescription(v))
                );

                opportunities.push({
                    prefix,
                    variables: vars,
                    descriptions: analyses.map(a => a.description),
                    suggestion: this.generateConsolidationSuggestion(vars, analyses)
                });
            }
        }

        return opportunities;
    }

    /**
     * Generate consolidation suggestion
     */
    generateConsolidationSuggestion(varNames, analyses) {
        // Example: AIRTABLE_API_KEY and AIRTABLE_BASE_ID could stay separate
        // But: DEBUG, DEBUG_MODE, DEBUG_LEVEL could be consolidated

        const categories = new Set(analyses.map(a => a.category));
        
        if (categories.size === 1) {
            return `Consider consolidating these ${varNames.length} ${Array.from(categories)[0]} variables into a single configuration object or fewer variables.`;
        }
        
        return 'Review if these similarly-named variables serve distinct purposes or can be combined.';
    }

    /**
     * Export documentation to markdown file
     */
    async exportToMarkdown(outputPath = './ENV-VARIABLES-DOCS.md') {
        logger.info('📝 Exporting documentation to markdown...');

        const varNames = this.analyzer.scanCodeForEnvVars();
        const analyses = await this.analyzer.analyzeAll();

        // Group by category
        const byCategory = {};
        for (const analysis of analyses) {
            const cat = analysis.category || 'other';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(analysis);
        }

        let markdown = `# Environment Variables Documentation\n\n`;
        markdown += `**Last Updated:** ${new Date().toISOString()}\n\n`;
        markdown += `**Total Variables:** ${varNames.length}\n\n`;
        markdown += `---\n\n`;

        // Table of Contents
        markdown += `## Table of Contents\n\n`;
        for (const category of Object.keys(byCategory).sort()) {
            markdown += `- [${this.capitalize(category)}](#${category.toLowerCase()})\n`;
        }
        markdown += `\n---\n\n`;

        // Variables by category
        for (const [category, vars] of Object.entries(byCategory)) {
            markdown += `## ${this.capitalize(category)}\n\n`;

            for (const analysis of vars.sort((a, b) => a.name.localeCompare(b.name))) {
                const currentValue = analysis.currentValue || '*(not set)*';
                const masked = this.shouldMaskValue(analysis.name) 
                    ? this.maskValue(currentValue) 
                    : currentValue;

                markdown += `### ${analysis.name}\n\n`;
                markdown += `**Description:** ${analysis.description}\n\n`;
                markdown += `**Current Value (Staging):** \`${masked}\`\n\n`;
                markdown += `**What it does:** ${analysis.effect}\n\n`;
                markdown += `**Recommended:** ${analysis.recommended}\n\n`;
                markdown += `**Used in ${analysis.usage.length} location(s):**\n`;
                analysis.usage.slice(0, 5).forEach(loc => {
                    markdown += `- \`${loc}\`\n`;
                });
                if (analysis.usage.length > 5) {
                    markdown += `- *...and ${analysis.usage.length - 5} more*\n`;
                }
                markdown += `\n---\n\n`;
            }
        }

        const fs = require('fs');
        fs.writeFileSync(outputPath, markdown, 'utf8');
        logger.info(`✅ Documentation exported to ${outputPath}`);
    }

    /**
     * Check if value should be masked in documentation
     */
    shouldMaskValue(varName) {
        const sensitivePatterns = [
            'KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIALS', 
            'API_KEY', 'PRIVATE', 'AUTH'
        ];
        
        return sensitivePatterns.some(pattern => varName.includes(pattern));
    }

    /**
     * Mask sensitive value
     */
    maskValue(value) {
        if (!value || value === '*(not set)*') return value;
        
        if (value.length <= 10) {
            return '***';
        }
        
        // Show first 4 and last 4 characters
        return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
    }

    /**
     * Capitalize first letter
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

module.exports = EnvVarDocumenter;
