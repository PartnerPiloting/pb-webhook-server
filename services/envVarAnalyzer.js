// services/envVarAnalyzer.js
// AI-powered environment variable analysis utility

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Scans codebase for environment variables and generates AI descriptions
 */
class EnvVarAnalyzer {
    constructor() {
        this.geminiModel = null;
        this.varCache = new Map();
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    }

    /**
     * Initialize Gemini for AI descriptions
     */
    async initializeAI() {
        if (this.geminiModel) return;

        try {
            const geminiConfig = require('../config/geminiClient.js');
            this.geminiModel = geminiConfig.geminiModel;
        } catch (error) {
            console.warn('Gemini not available for env var descriptions:', error.message);
        }
    }

    /**
     * Scan codebase for all process.env references
     * @param {string} branch - Git branch to scan (optional, defaults to current)
     * @returns {Array} List of env var names found
     */
    scanCodeForEnvVars(branch = null) {
        const vars = new Set();
        
        // If branch specified, checkout temporarily
        const originalBranch = branch ? this.checkoutBranch(branch) : null;

        try {
            // Search all .js files for process.env references
            const jsFiles = this.findJSFiles();
            
            for (const file of jsFiles) {
                const content = fs.readFileSync(file, 'utf8');
                
                // Match process.env.VARIABLE_NAME patterns
                const matches = content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
                
                for (const match of matches) {
                    vars.add(match[1]);
                }
            }
        } finally {
            // Restore original branch if we switched
            if (originalBranch) {
                this.checkoutBranch(originalBranch);
            }
        }

        return Array.from(vars).sort();
    }

    /**
     * Get current value of an env var
     * @param {string} varName - Name of environment variable
     * @returns {string|null} Current value or null if not set
     */
    getCurrentValue(varName) {
        return process.env[varName] || null;
    }

    /**
     * Find all JavaScript files in project
     * @returns {Array} List of file paths
     */
    findJSFiles() {
        const files = [];
        const excludeDirs = ['node_modules', '.git', 'dist', 'build', 'coverage'];
        
        const walk = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
                    walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    files.push(fullPath);
                }
            }
        };
        
        walk(process.cwd());
        return files;
    }

    /**
     * Checkout git branch
     * @param {string} branch - Branch name
     * @returns {string} Previous branch name
     */
    checkoutBranch(branch) {
        try {
            // Get current branch
            const current = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
            
            // Checkout target branch
            execSync(`git checkout ${branch}`, { stdio: 'ignore' });
            
            return current;
        } catch (error) {
            console.error(`Failed to checkout branch ${branch}:`, error.message);
            return null;
        }
    }

    /**
     * Generate AI description for an environment variable
     * @param {string} varName - Name of environment variable
     * @returns {Promise<Object>} Description object
     */
    async generateDescription(varName) {
        // Check cache first
        const cached = this.varCache.get(varName);
        if (cached && (Date.now() - cached.timestamp < this.cacheExpiry)) {
            return cached.data;
        }

        await this.initializeAI();

        if (!this.geminiModel) {
            return {
                name: varName,
                description: 'AI description unavailable (Gemini not configured)',
                usage: [],
                effect: 'Unknown'
            };
        }

        // Find code usage examples
        const usageLocations = this.findVarUsage(varName);
        
        // Get code context around usage
        const codeContext = usageLocations.slice(0, 3).map(loc => {
            return this.getCodeContext(loc.file, loc.line, 5);
        }).join('\n\n---\n\n');

        // Generate AI description
        const prompt = `Analyze this environment variable usage in a Node.js application:

Environment Variable: ${varName}
Current Value: ${this.getCurrentValue(varName) || 'Not set'}

Code Usage Examples:
${codeContext}

Provide a JSON response with:
1. "description": Clear 1-sentence explanation of what this variable does
2. "effect": What happens if you change this value (practical impact)
3. "recommended": Recommended value or range
4. "category": One of: database, api, auth, performance, feature-flag, debug

Keep it simple and practical. Focus on what a developer needs to know.`;

        // Retry logic for Gemini API calls (3 attempts with exponential backoff)
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const result = await this.geminiModel.generateContent(prompt);
                // Access text as property, not function (Vertex AI SDK)
                const response = result.response.candidates[0].content.parts[0].text;
                
                // Try to parse JSON from response
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {
                    description: response.split('\n')[0],
                    effect: 'Unknown',
                    recommended: 'See documentation',
                    category: 'other'
                };

                const output = {
                    name: varName,
                    currentValue: this.getCurrentValue(varName),
                    description: analysis.description,
                    effect: analysis.effect,
                    recommended: analysis.recommended,
                    category: analysis.category,
                    usage: usageLocations.map(u => `${u.file}:${u.line}`)
                };

                // Cache result
                this.varCache.set(varName, {
                    data: output,
                    timestamp: Date.now()
                });

                return output;
            } catch (error) {
                lastError = error;
                console.error(`Attempt ${attempt}/3 failed for ${varName}: ${error.message}`);
                
                // Wait before retry (exponential backoff: 1s, 2s, 4s)
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
                }
            }
        }
        
        // All retries failed, return fallback
        console.error(`All retries failed for ${varName}:`, lastError.message);
        return {
            name: varName,
            currentValue: this.getCurrentValue(varName),
            description: `Used in ${usageLocations.length} locations`,
            effect: 'See code for details',
            recommended: 'Unknown',
            category: 'other',
            usage: usageLocations.slice(0, 5).map(u => `${u.file}:${u.line}`)
        };
    }

    /**
     * Find all locations where a variable is used
     * @param {string} varName - Variable name
     * @returns {Array} Usage locations
     */
    findVarUsage(varName) {
        const locations = [];
        const files = this.findJSFiles();
        
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            
            lines.forEach((line, index) => {
                if (line.includes(`process.env.${varName}`)) {
                    locations.push({
                        file: path.relative(process.cwd(), file),
                        line: index + 1,
                        content: line.trim()
                    });
                }
            });
        }
        
        return locations;
    }

    /**
     * Get code context around a specific line
     * @param {string} filePath - File path
     * @param {number} lineNum - Line number
     * @param {number} contextLines - Lines before/after to include
     * @returns {string} Code snippet
     */
    getCodeContext(filePath, lineNum, contextLines = 5) {
        try {
            const fullPath = path.join(process.cwd(), filePath);
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            
            const start = Math.max(0, lineNum - contextLines - 1);
            const end = Math.min(lines.length, lineNum + contextLines);
            
            const snippet = lines.slice(start, end)
                .map((line, i) => {
                    const num = start + i + 1;
                    const marker = num === lineNum ? '→' : ' ';
                    return `${marker} ${num.toString().padStart(4)}: ${line}`;
                })
                .join('\n');
            
            return `File: ${filePath}\n${snippet}`;
        } catch (error) {
            return `Error reading ${filePath}: ${error.message}`;
        }
    }

    /**
     * Compare environment variables between two branches
     * @param {string} branch1 - First branch
     * @param {string} branch2 - Second branch
     * @returns {Object} Comparison results
     */
    compareEnvVars(branch1, branch2) {
        const vars1 = this.scanCodeForEnvVars(branch1);
        const vars2 = this.scanCodeForEnvVars(branch2);
        
        const set1 = new Set(vars1);
        const set2 = new Set(vars2);
        
        const same = vars1.filter(v => set2.has(v));
        const onlyIn1 = vars1.filter(v => !set2.has(v));
        const onlyIn2 = vars2.filter(v => !set1.has(v));
        
        return {
            branch1,
            branch2,
            same: same.sort(),
            onlyInBranch1: onlyIn1.sort(),
            onlyInBranch2: onlyIn2.sort(),
            summary: {
                total: new Set([...vars1, ...vars2]).size,
                same: same.length,
                different: onlyIn1.length + onlyIn2.length
            }
        };
    }

    /**
     * Analyze all env vars in current codebase
     * Process in small batches with delays to avoid rate limits
     * @param {string} branch - Optional branch to analyze
     * @returns {Promise<Array>} Array of analyzed variables
     */
    async analyzeAll(branch = null) {
        const varNames = this.scanCodeForEnvVars(branch);
        const results = [];
        
        console.log(`Analyzing ${varNames.length} environment variables...`);
        
        // Process in batches of 5 with 2 second delays between batches
        const BATCH_SIZE = 5;
        const DELAY_MS = 2000;
        
        for (let i = 0; i < varNames.length; i += BATCH_SIZE) {
            const batch = varNames.slice(i, i + BATCH_SIZE);
            console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(varNames.length / BATCH_SIZE)}...`);
            
            // Process batch in parallel
            const batchPromises = batch.map(varName => 
                this.generateDescription(varName).catch(err => {
                    console.error(`Failed to analyze ${varName}: ${err.message}`);
                    return {
                        name: varName,
                        currentValue: this.getCurrentValue(varName),
                        description: `Analysis failed: ${err.message}`,
                        effect: 'See code for details',
                        recommended: 'Unknown',
                        category: 'other',
                        usage: this.findVarUsage(varName).slice(0, 5).map(u => `${u.file}:${u.line}`)
                    };
                })
            );
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Delay between batches (except for last batch)
            if (i + BATCH_SIZE < varNames.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }
        
        return results;
    }
}

module.exports = EnvVarAnalyzer;

