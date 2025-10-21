// services/costGovernanceService.js - Cost governance and token budgeting for multi-tenant scoring

const airtable = require('../config/airtableClient');
const { createLogger } = require('../utils/contextLogger');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'system' });

/* ============================================================================
   TOKEN LIMITS AND COST CALCULATIONS
============================================================================ */

// Gemini 2.5 Flash limits (as of 2025)
const GEMINI_LIMITS = {
    INPUT_TOKEN_LIMIT: 1048576,      // 1M tokens
    OUTPUT_TOKEN_LIMIT: 65536,       // 65K tokens
    SAFE_INPUT_THRESHOLD: 900000,    // 90% of limit (safety buffer)
    
    // Approximate costs (update based on current pricing)
    INPUT_COST_PER_1K_TOKENS: 0.00015,   // $0.15 per 1M tokens
    OUTPUT_COST_PER_1K_TOKENS: 0.0006,   // $0.6 per 1M tokens
};

// Client budget defaults (can be overridden per client)
const DEFAULT_BUDGETS = {
    DAILY_TOKEN_LIMIT: 500000,       // 500K tokens per day per client
    MONTHLY_TOKEN_LIMIT: 10000000,   // 10M tokens per month per client
    DAILY_COST_LIMIT: 200,           // $200 per day per client
    MONTHLY_COST_LIMIT: 4000,        // $4000 per month per client
    MAX_BATCH_SIZE: 10,              // Max leads per batch
    MAX_PROMPT_TOKENS: 100000,       // Max tokens in a single prompt
};

/* ============================================================================
   UTILITY FUNCTIONS
============================================================================ */

// Estimate token count (rough approximation: 1 token ≈ 4 characters)
function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
}

// Calculate cost from token usage
function calculateCost(inputTokens, outputTokens) {
    const inputCost = (inputTokens / 1000) * GEMINI_LIMITS.INPUT_COST_PER_1K_TOKENS;
    const outputCost = (outputTokens / 1000) * GEMINI_LIMITS.OUTPUT_COST_PER_1K_TOKENS;
    return inputCost + outputCost;
}

// Get date keys for tracking
function getDateKeys() {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const thisMonth = today.substring(0, 7); // YYYY-MM
    return { today, thisMonth };
}

/* ============================================================================
   CLIENT BUDGET MANAGEMENT
============================================================================ */

class CostGovernanceService {
    constructor() {
        this.usageCache = new Map(); // Cache for recent usage data
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get client-specific budgets from Airtable
     */
    async getClientBudgets(clientId) {
        try {
            const clientBase = airtable.getClientBase(clientId);
            if (!clientBase) {
                logger.warn(`costGovernanceService: No base found for client ${clientId}, using defaults`);
                return DEFAULT_BUDGETS;
            }

            // Try to get custom budgets from a "Client Settings" table
            try {
                const settingsRecords = await clientBase("Client Settings")
                    .select({ maxRecords: 1 })
                    .firstPage();
                
                if (settingsRecords.length > 0) {
                    const settings = settingsRecords[0];
                    return {
                        DAILY_TOKEN_LIMIT: settings.get("Daily Token Limit") || DEFAULT_BUDGETS.DAILY_TOKEN_LIMIT,
                        MONTHLY_TOKEN_LIMIT: settings.get("Monthly Token Limit") || DEFAULT_BUDGETS.MONTHLY_TOKEN_LIMIT,
                        DAILY_COST_LIMIT: settings.get("Daily Cost Limit") || DEFAULT_BUDGETS.DAILY_COST_LIMIT,
                        MONTHLY_COST_LIMIT: settings.get("Monthly Cost Limit") || DEFAULT_BUDGETS.MONTHLY_COST_LIMIT,
                        MAX_BATCH_SIZE: settings.get("Max Batch Size") || DEFAULT_BUDGETS.MAX_BATCH_SIZE,
                        MAX_PROMPT_TOKENS: settings.get("Max Prompt Tokens") || DEFAULT_BUDGETS.MAX_PROMPT_TOKENS,
                    };
                }
            } catch (settingsError) {
                logger.info(`costGovernanceService: No Client Settings table for ${clientId}, using defaults`);
    logCriticalError(settingsError, { operation: 'unknown', isSearch: true }).catch(() => {});
            }

            return DEFAULT_BUDGETS;
        } catch (error) {
            logger.error(`costGovernanceService: Error loading budgets for ${clientId}:`, error.message);
    logCriticalError(error, { operation: 'unknown', isSearch: true }).catch(() => {});
            return DEFAULT_BUDGETS;
        }
    }

    /**
     * Get current usage for a client (daily and monthly)
     */
    async getClientUsage(clientId) {
        const { today, thisMonth } = getDateKeys();
        const cacheKey = `${clientId}-${today}-${thisMonth}`;

        // Check cache first
        if (this.usageCache.has(cacheKey)) {
            const cached = this.usageCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }

        try {
            const clientBase = airtable.getClientBase(clientId);
            if (!clientBase) {
                return { dailyTokens: 0, monthlyTokens: 0, dailyCost: 0, monthlyCost: 0 };
            }

            // Try to get usage from a "Usage Tracking" table
            let dailyTokens = 0, monthlyTokens = 0, dailyCost = 0, monthlyCost = 0;

            try {
                const usageRecords = await clientBase("Usage Tracking")
                    .select({
                        filterByFormula: `OR({Date} = "${today}", LEFT({Date}, 7) = "${thisMonth}")`,
                        fields: ["Date", "Input Tokens", "Output Tokens", "Cost"]
                    })
                    .all();

                for (const record of usageRecords) {
                    const recordDate = record.get("Date");
                    const inputTokens = record.get("Input Tokens") || 0;
                    const outputTokens = record.get("Output Tokens") || 0;
                    const cost = record.get("Cost") || 0;

                    if (recordDate === today) {
                        dailyTokens += inputTokens + outputTokens;
                        dailyCost += cost;
                    }
                    if (recordDate && recordDate.startsWith(thisMonth)) {
                        monthlyTokens += inputTokens + outputTokens;
                        monthlyCost += cost;
                    }
                }
            } catch (usageError) {
                logger.info(`costGovernanceService: No Usage Tracking table for ${clientId}`);
    logCriticalError(usageError, { operation: 'unknown', isSearch: true }).catch(() => {});
            }

            const usage = { dailyTokens, monthlyTokens, dailyCost, monthlyCost };
            
            // Cache the result
            this.usageCache.set(cacheKey, {
                data: usage,
                timestamp: Date.now()
            });

            return usage;
        } catch (error) {
            logger.error(`costGovernanceService: Error loading usage for ${clientId}:`, error.message);
    logCriticalError(error, { operation: 'unknown' }).catch(() => {});
            return { dailyTokens: 0, monthlyTokens: 0, dailyCost: 0, monthlyCost: 0 };
        }
    }

    /**
     * Pre-flight validation before batch scoring
     */
    async validateBatchRequest(clientId, systemPrompt, leadData, requestedBatchSize) {
        logger.info(`costGovernanceService: Validating batch request for client ${clientId}`);

        const budgets = await this.getClientBudgets(clientId);
        const usage = await this.getClientUsage(clientId);

        // 1. Check batch size
        if (requestedBatchSize > budgets.MAX_BATCH_SIZE) {
            return {
                allowed: false,
                reason: `Batch size ${requestedBatchSize} exceeds limit of ${budgets.MAX_BATCH_SIZE}`,
                code: 'BATCH_SIZE_EXCEEDED'
            };
        }

        // 2. Estimate prompt tokens
        const systemPromptTokens = estimateTokens(systemPrompt);
        const leadDataTokens = estimateTokens(JSON.stringify(leadData));
        const totalInputTokens = systemPromptTokens + leadDataTokens;

        // 3. Check single request token limits
        if (totalInputTokens > GEMINI_LIMITS.SAFE_INPUT_THRESHOLD) {
            return {
                allowed: false,
                reason: `Estimated input tokens ${totalInputTokens} exceeds safe threshold of ${GEMINI_LIMITS.SAFE_INPUT_THRESHOLD}`,
                code: 'PROMPT_TOO_LARGE',
                estimatedTokens: totalInputTokens
            };
        }

        if (totalInputTokens > budgets.MAX_PROMPT_TOKENS) {
            return {
                allowed: false,
                reason: `Estimated input tokens ${totalInputTokens} exceeds client limit of ${budgets.MAX_PROMPT_TOKENS}`,
                code: 'CLIENT_PROMPT_LIMIT',
                estimatedTokens: totalInputTokens
            };
        }

        // 4. Check daily limits
        const projectedDailyTokens = usage.dailyTokens + totalInputTokens;
        if (projectedDailyTokens > budgets.DAILY_TOKEN_LIMIT) {
            return {
                allowed: false,
                reason: `Daily token limit exceeded: ${projectedDailyTokens}/${budgets.DAILY_TOKEN_LIMIT}`,
                code: 'DAILY_TOKEN_LIMIT',
                currentUsage: usage.dailyTokens,
                requestTokens: totalInputTokens,
                limit: budgets.DAILY_TOKEN_LIMIT
            };
        }

        // 5. Check monthly limits
        const projectedMonthlyTokens = usage.monthlyTokens + totalInputTokens;
        if (projectedMonthlyTokens > budgets.MONTHLY_TOKEN_LIMIT) {
            return {
                allowed: false,
                reason: `Monthly token limit exceeded: ${projectedMonthlyTokens}/${budgets.MONTHLY_TOKEN_LIMIT}`,
                code: 'MONTHLY_TOKEN_LIMIT',
                currentUsage: usage.monthlyTokens,
                requestTokens: totalInputTokens,
                limit: budgets.MONTHLY_TOKEN_LIMIT
            };
        }

        // 6. Estimate cost and check cost limits
        const estimatedOutputTokens = requestedBatchSize * 1000; // Rough estimate
        const estimatedCost = calculateCost(totalInputTokens, estimatedOutputTokens);
        
        if (usage.dailyCost + estimatedCost > budgets.DAILY_COST_LIMIT) {
            return {
                allowed: false,
                reason: `Daily cost limit exceeded: $${(usage.dailyCost + estimatedCost).toFixed(2)}/$${budgets.DAILY_COST_LIMIT}`,
                code: 'DAILY_COST_LIMIT',
                currentCost: usage.dailyCost,
                estimatedCost: estimatedCost,
                limit: budgets.DAILY_COST_LIMIT
            };
        }

        if (usage.monthlyCost + estimatedCost > budgets.MONTHLY_COST_LIMIT) {
            return {
                allowed: false,
                reason: `Monthly cost limit exceeded: $${(usage.monthlyCost + estimatedCost).toFixed(2)}/$${budgets.MONTHLY_COST_LIMIT}`,
                code: 'MONTHLY_COST_LIMIT',
                currentCost: usage.monthlyCost,
                estimatedCost: estimatedCost,
                limit: budgets.MONTHLY_COST_LIMIT
            };
        }

        // All checks passed
        return {
            allowed: true,
            estimatedTokens: totalInputTokens,
            estimatedCost: estimatedCost,
            budgetStatus: {
                dailyTokensUsed: usage.dailyTokens,
                dailyTokensLimit: budgets.DAILY_TOKEN_LIMIT,
                monthlyTokensUsed: usage.monthlyTokens,
                monthlyTokensLimit: budgets.MONTHLY_TOKEN_LIMIT,
                dailyCostUsed: usage.dailyCost,
                dailyCostLimit: budgets.DAILY_COST_LIMIT,
                monthlyCostUsed: usage.monthlyCost,
                monthlyCostLimit: budgets.MONTHLY_COST_LIMIT
            }
        };
    }

    /**
     * Record usage after a successful API call
     */
    async recordUsage(clientId, inputTokens, outputTokens, actualCost = null) {
        const { today } = getDateKeys();
        
        try {
            const clientBase = airtable.getClientBase(clientId);
            if (!clientBase) {
                logger.warn(`costGovernanceService: Cannot record usage for ${clientId} - no base`);
                return;
            }

            const cost = actualCost || calculateCost(inputTokens, outputTokens);

            // Try to create/update usage record
            try {
                await clientBase("Usage Tracking").create({
                    "Date": today,
                    "Input Tokens": inputTokens,
                    "Output Tokens": outputTokens,
                    "Cost": cost,
                    "Timestamp": new Date().toISOString()
                });

                logger.info(`costGovernanceService: Recorded usage for ${clientId}: ${inputTokens}+${outputTokens} tokens, $${cost.toFixed(4)}`);

                // Clear cache for this client
                const cacheKeys = Array.from(this.usageCache.keys()).filter(key => key.startsWith(clientId));
                cacheKeys.forEach(key => this.usageCache.delete(key));

            } catch (trackingError) {
                logger.warn(`costGovernanceService: Could not record usage for ${clientId}:`, trackingError.message);
    logCriticalError(trackingError, { operation: 'unknown' }).catch(() => {});
            }

        } catch (error) {
            logger.error(`costGovernanceService: Error recording usage for ${clientId}:`, error.message);
    logCriticalError(error, { operation: 'unknown' }).catch(() => {});
        }
    }

    /**
     * Get governance summary for a client
     */
    async getGovernanceSummary(clientId) {
        const budgets = await this.getClientBudgets(clientId);
        const usage = await this.getClientUsage(clientId);

        return {
            clientId,
            budgets,
            usage,
            remainingQuotas: {
                dailyTokens: Math.max(0, budgets.DAILY_TOKEN_LIMIT - usage.dailyTokens),
                monthlyTokens: Math.max(0, budgets.MONTHLY_TOKEN_LIMIT - usage.monthlyTokens),
                dailyCost: Math.max(0, budgets.DAILY_COST_LIMIT - usage.dailyCost),
                monthlyCost: Math.max(0, budgets.MONTHLY_COST_LIMIT - usage.monthlyCost)
            },
            utilizationPercentages: {
                dailyTokens: (usage.dailyTokens / budgets.DAILY_TOKEN_LIMIT * 100).toFixed(1),
                monthlyTokens: (usage.monthlyTokens / budgets.MONTHLY_TOKEN_LIMIT * 100).toFixed(1),
                dailyCost: (usage.dailyCost / budgets.DAILY_COST_LIMIT * 100).toFixed(1),
                monthlyCost: (usage.monthlyCost / budgets.MONTHLY_COST_LIMIT * 100).toFixed(1)
            }
        };
    }
}

/* ============================================================================
   EXPORTS
============================================================================ */

const costGovernanceService = new CostGovernanceService();

module.exports = {
    costGovernanceService,
    GEMINI_LIMITS,
    DEFAULT_BUDGETS,
    estimateTokens,
    calculateCost,
    getDateKeys
};
