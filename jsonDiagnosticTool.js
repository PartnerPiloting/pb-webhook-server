// jsonDiagnosticTool.js - Advanced JSON Quality Analysis and Remediation Tool
const { createLogger } = require('./utils/contextLogger');
const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'json-diagnostic' });


require("dotenv").config();

const clientService = require('./services/clientService');
const { getClientBase } = require('./config/airtableClient');
const dirtyJSON = require('dirty-json');

/**
 * Comprehensive JSON quality analysis and remediation tool
 * Identifies specific issues with JSON data and suggests fixes
 */
async function analyzeJsonQuality(clientId = null, limit = 20, mode = 'analyze') {
    logger.info("=== JSON QUALITY DIAGNOSTIC TOOL ===");
    logger.info(`Mode: ${mode} | Client: ${clientId || 'ALL'} | Limit: ${limit}`);
    
    const results = {
        totalRecords: 0,
        qualityBreakdown: {},
        specificIssues: [],
        recommendedActions: [],
        sampleProblems: []
    };
    
    try {
        const clients = clientId ? 
            [await clientService.getClientById(clientId)] : 
            await clientService.getAllClients();
        
        for (const client of clients) {
            logger.info(`\nAnalyzing client: ${client.clientName} (${client.clientId})`);
            
            const clientBase = getClientBase(client.clientId);
            const config = {
                leadsTableName: 'Leads',
                fields: {
                    postsContent: 'Posts Content',
                    linkedinUrl: 'LinkedIn Profile URL',
                    dateScored: 'Date Posts Scored'
                }
            };
            
            // Get all records with Posts Content
            const selectOptions = {
                fields: [config.fields.postsContent, config.fields.linkedinUrl],
                filterByFormula: `AND(
                    NOT({${config.fields.postsContent}} = ''),
                    OR(
                        {${config.fields.dateScored}} = '',
                        {JSON Quality} = 'CORRUPTED',
                        {JSON Quality} = ''
                    )
                )`,
                maxRecords: limit
            };
            
            let allRecords = [];
            await clientBase(config.leadsTableName).select(selectOptions).eachPage((records, fetchNextPage) => {
                allRecords = allRecords.concat(records);
                fetchNextPage();
            });
            
            logger.info(`Found ${allRecords.length} records to analyze`);
            results.totalRecords += allRecords.length;
            
            // Analyze each record
            for (const record of allRecords) {
                const analysis = await analyzeJsonRecord(record, config);
                
                // Update quality breakdown
                if (!results.qualityBreakdown[analysis.quality]) {
                    results.qualityBreakdown[analysis.quality] = 0;
                }
                results.qualityBreakdown[analysis.quality]++;
                
                // Collect specific issues
                if (analysis.issues.length > 0) {
                    results.specificIssues.push(...analysis.issues);
                }
                
                // Collect sample problems for manual review
                if (analysis.quality === 'CORRUPTED' && results.sampleProblems.length < 5) {
                    results.sampleProblems.push({
                        recordId: record.id,
                        clientId: client.clientId,
                        issues: analysis.issues,
                        rawContent: analysis.rawContent.substring(0, 500) + '...'
                    });
                }
                
                // Update the record with quality status if in repair mode
                if (mode === 'repair') {
                    try {
                        await clientBase(config.leadsTableName).update(record.id, {
                            'JSON Quality': analysis.quality,
                            'JSON Issues': analysis.issues.join('; ')
                        });
                        logger.info(`Updated record ${record.id} with quality: ${analysis.quality}`);
                    } catch (updateError) {
                        logger.warn(`Failed to update record ${record.id}:`, updateError.message);
                    }
                }
            }
        }
        
        // Generate recommendations
        results.recommendedActions = generateRecommendations(results);
        
        // Display summary
        logger.info("\n=== ANALYSIS SUMMARY ===");
        logger.info(`Total records analyzed: ${results.totalRecords}`);
        logger.info("\nQuality breakdown:");
        Object.entries(results.qualityBreakdown).forEach(([quality, count]) => {
            const percentage = ((count / results.totalRecords) * 100).toFixed(1);
            logger.info(`  ${quality}: ${count} (${percentage}%)`);
        });
        
        logger.info("\nTop issues found:");
        const issueCount = {};
        results.specificIssues.forEach(issue => {
            issueCount[issue] = (issueCount[issue] || 0) + 1;
        });
        Object.entries(issueCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .forEach(([issue, count]) => {
                logger.info(`  ${issue}: ${count} occurrences`);
            });
        
        logger.info("\nRecommended actions:");
        results.recommendedActions.forEach((action, index) => {
            logger.info(`  ${index + 1}. ${action}`);
        });
        
        if (results.sampleProblems.length > 0) {
            logger.info("\nSample corrupted records for manual review:");
            results.sampleProblems.forEach((sample, index) => {
                logger.info(`  ${index + 1}. Record ${sample.recordId} (${sample.clientId})`);
                logger.info(`     Issues: ${sample.issues.join(', ')}`);
                logger.info(`     Content preview: ${sample.rawContent}`);
            });
        }
        
        return results;
        
    } catch (error) {
        logger.error("Error in JSON quality analysis:", error);
        throw error;
    }
}

/**
 * Analyze a single JSON record for quality issues
 */
async function analyzeJsonRecord(record, config) {
    const rawContent = record.fields[config.fields.postsContent] || '';
    const result = {
        recordId: record.id,
        quality: 'UNKNOWN',
        issues: [],
        rawContent: rawContent
    };
    
    if (!rawContent) {
        result.quality = 'EMPTY';
        result.issues.push('No content');
        return result;
    }
    
    if (typeof rawContent !== 'string') {
        if (Array.isArray(rawContent)) {
            result.quality = 'CLEAN_ARRAY';
            return result;
        } else {
            result.quality = 'INVALID_TYPE';
            result.issues.push(`Invalid type: ${typeof rawContent}`);
            return result;
        }
    }
    
    // Check for common issues
    const issues = [];
    
    // Length checks
    if (rawContent.length === 0) {
        issues.push('Empty string');
    } else if (rawContent.length > 1000000) {
        issues.push('Extremely large content (>1MB)');
    }
    
    // Character encoding issues
    if (/\u0000/.test(rawContent)) {
        issues.push('Contains null characters');
    }
    
    if (/[\u0000-\u001F\u007F-\u009F]/.test(rawContent)) {
        issues.push('Contains control characters');
    }
    
    // Basic JSON structure checks
    const trimmed = rawContent.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
        issues.push('Does not start with [ or {');
    }
    
    if (!trimmed.endsWith(']') && !trimmed.endsWith('}')) {
        issues.push('Does not end with ] or }');
    }
    
    // Bracket/brace balance check
    const openBrackets = (trimmed.match(/\[/g) || []).length;
    const closeBrackets = (trimmed.match(/\]/g) || []).length;
    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;
    
    if (openBrackets !== closeBrackets) {
        issues.push(`Unbalanced brackets: ${openBrackets} open, ${closeBrackets} close`);
    }
    
    if (openBraces !== closeBraces) {
        issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
    }
    
    // Quote balance check
    const quotes = (trimmed.match(/"/g) || []).length;
    if (quotes % 2 !== 0) {
        issues.push('Unbalanced quotes');
    }
    
    // Try parsing with different methods
    let parseResults = {
        standard: false,
        dirty: false,
        cleaned: false
    };
    
    // Standard JSON.parse
    try {
        JSON.parse(rawContent);
        parseResults.standard = true;
    } catch (e) {
        issues.push(`JSON.parse failed: ${e.message.substring(0, 100)}`);
    }
    
    // Clean and try again
    const cleaned = rawContent
        .trim()
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
    
    try {
        JSON.parse(cleaned);
        parseResults.cleaned = true;
    } catch (e) {
        // Continue to dirty-json
    }
    
    // Try dirty-json
    try {
        dirtyJSON.parse(cleaned);
        parseResults.dirty = true;
    } catch (e) {
        issues.push(`dirty-json failed: ${e.message.substring(0, 100)}`);
    }
    
    // Determine quality level
    if (parseResults.standard) {
        result.quality = 'CLEAN';
    } else if (parseResults.cleaned) {
        result.quality = 'CLEAN_AFTER_PREPROCESSING';
    } else if (parseResults.dirty) {
        result.quality = 'DIRTY_SUCCESS';
    } else {
        result.quality = 'CORRUPTED';
    }
    
    result.issues = issues;
    return result;
}

/**
 * Generate specific recommendations based on analysis results
 */
function generateRecommendations(results) {
    const recommendations = [];
    const { qualityBreakdown, specificIssues } = results;
    
    // Calculate percentages
    const total = results.totalRecords;
    const corruptedPercent = ((qualityBreakdown.CORRUPTED || 0) / total * 100);
    const dirtyPercent = ((qualityBreakdown.DIRTY_SUCCESS || 0) / total * 100);
    
    if (corruptedPercent > 10) {
        recommendations.push("HIGH PRIORITY: >10% of records are completely corrupted - investigate PhantomBuster data pipeline immediately");
    }
    
    if (dirtyPercent > 20) {
        recommendations.push("MEDIUM PRIORITY: >20% of records require dirty-json parsing - review PhantomBuster JSON output quality");
    }
    
    // Issue-specific recommendations
    const issueCount = {};
    specificIssues.forEach(issue => {
        issueCount[issue] = (issueCount[issue] || 0) + 1;
    });
    
    if (issueCount['Contains null characters'] > 5) {
        recommendations.push("Fix null character injection in PhantomBuster scraping or data transmission");
    }
    
    if (issueCount['Contains control characters'] > 5) {
        recommendations.push("Review text encoding/decoding in PhantomBuster → Airtable pipeline");
    }
    
    if (issueCount['Unbalanced brackets'] > 3 || issueCount['Unbalanced braces'] > 3) {
        recommendations.push("Investigate JSON truncation or corruption during PhantomBuster data extraction");
    }
    
    if (issueCount['Unbalanced quotes'] > 3) {
        recommendations.push("Review quote escaping in PhantomBuster post content extraction");
    }
    
    // General recommendations
    if (total > 0) {
        recommendations.push("Deploy enhanced JSON preprocessing and quality tracking to production");
        recommendations.push("Set up automated alerts for JSON quality degradation");
        recommendations.push("Schedule weekly JSON quality reports");
    }
    
    if (qualityBreakdown.CORRUPTED > 0) {
        recommendations.push("Create a data repair script for the most common corruption patterns");
        recommendations.push("Implement upstream validation in PhantomBuster before sending to Airtable");
    }
    
    return recommendations;
}

/**
 * Repair common JSON issues automatically
 */
async function repairCommonJsonIssues(clientId = null, limit = 10, dryRun = true) {
    logger.info("=== JSON REPAIR TOOL ===");
    logger.info(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE REPAIR'} | Client: ${clientId || 'ALL'} | Limit: ${limit}`);
    
    const repairResults = {
        totalAttempted: 0,
        successfulRepairs: 0,
        failedRepairs: 0,
        repairMethods: {}
    };
    
    // Implementation would go here for common repair patterns
    // For now, just return the structure
    
    return repairResults;
}

// Command line interface
if (require.main === module) {
    const args = process.argv.slice(2);
    const mode = args[0] || 'analyze'; // analyze, repair, or fix
    const clientId = args[1] || null;
    const limit = parseInt(args[2]) || 20;
    
    if (mode === 'analyze') {
        analyzeJsonQuality(clientId, limit, 'analyze')
            .then(results => {
                logger.info("\nAnalysis complete. Results saved to memory.");
                process.exit(0);
            })
            .catch(error => {
                logger.error("Analysis failed:", error);
                process.exit(1);
            });
    } else if (mode === 'repair') {
        analyzeJsonQuality(clientId, limit, 'repair')
            .then(results => {
                logger.info("\nRepair mode complete. Records updated with quality status.");
                process.exit(0);
            })
            .catch(error => {
                logger.error("Repair mode failed:", error);
                process.exit(1);
            });
    } else {
        logger.info("Usage: node jsonDiagnosticTool.js [analyze|repair] [clientId] [limit]");
        process.exit(1);
    }
}

module.exports = {
    analyzeJsonQuality,
    analyzeJsonRecord,
    repairCommonJsonIssues
};
