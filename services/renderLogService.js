// services/renderLogService.js
// Service for interacting with Render API to retrieve and analyze logs

const axios = require('axios');
const { StructuredLogger } = require('../utils/structuredLogger');
const { createSafeLogger } = require('../utils/loggerHelper');

class RenderLogService {
    constructor() {
        this.apiKey = process.env.RENDER_API_KEY;
        this.ownerId = process.env.RENDER_OWNER_ID; // Workspace ID
        this.baseUrl = 'https://api.render.com/v1';
        this.logger = createSafeLogger('RENDER-API', 'LOG-SERVICE');
        
        if (!this.apiKey) {
            throw new Error('RENDER_API_KEY environment variable is required');
        }
        
        if (!this.ownerId) {
            throw new Error('RENDER_OWNER_ID environment variable is required');
        }
    }

    /**
     * Get all services for the account
     */
    async getAllServices() {
        this.logger.setup('getAllServices', 'Fetching all Render services');
        
        try {
            const response = await axios.get(`${this.baseUrl}/services`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            // Handle different possible response structures
            let services = response.data;
            
            // If response is wrapped in a services property
            if (services && services.services) {
                services = services.services;
            }
            
            // If response has a data property
            if (services && services.data) {
                services = services.data;
            }
            
            // Ensure services is an array
            if (!Array.isArray(services)) {
                throw new Error('Services response is not an array');
            }
            
            this.logger.summary('getAllServices', `Found ${services.length} services`);
            
            return services.map(service => ({
                id: service.id || service.serviceId || service.service?.id,
                name: service.name || service.serviceName || service.service?.name,
                type: service.type || service.serviceType || service.service?.type,
                env: service.env || service.environment || service.service?.env,
                suspended: service.suspended || service.service?.suspended || false
            }));
        } catch (error) {
            this.logger.error('getAllServices', `Failed to fetch services: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get logs for a specific service
     * Using the correct Render API v1 logs endpoint
     */
    async getServiceLogs(serviceId, options = {}) {
        const {
            startTime = null,
            endTime = null,
            limit = 1000,
            cursor = null
        } = options;

        this.logger.setup('getServiceLogs', `Fetching logs for service ${serviceId}`);

        try {
            // Build query parameters for the correct /v1/logs endpoint
            const params = new URLSearchParams({
                ownerId: this.ownerId,
                limit: limit.toString(),
                direction: 'backward', // Most recent first
            });
            
            // Add resource filter (service ID)
            params.append('resource[]', serviceId);
            
            // Add time range if provided
            if (startTime) params.append('startTime', startTime);
            if (endTime) params.append('endTime', endTime);
            
            // Build final URL
            const url = `${this.baseUrl}/logs?${params.toString()}`;
            
            this.logger.debug('getServiceLogs', `Fetching from: ${url.replace(this.ownerId, 'OWNER_ID')}`);

            const response = await axios.get(url, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            const data = response.data;
            
            // Render API v1 returns: { logs: [...], hasMore: bool, nextStartTime, nextEndTime }
            const logCount = data.logs?.length || 0;
            this.logger.process('getServiceLogs', `Retrieved ${logCount} log entries for service ${serviceId}`);
            
            if (data.hasMore) {
                this.logger.debug('getServiceLogs', `More logs available. Use nextStartTime: ${data.nextStartTime}, nextEndTime: ${data.nextEndTime}`);
            }
            
            return {
                logs: data.logs || [],
                hasMore: data.hasMore || false,
                nextStartTime: data.nextStartTime,
                nextEndTime: data.nextEndTime,
            };
        } catch (error) {
            this.logger.error('getServiceLogs', `Failed to fetch logs for service ${serviceId}: ${error.message}`);
            
            // Add helpful debugging info
            if (error.response?.status === 404) {
                this.logger.error('getServiceLogs', 'API returned 404. Check that RENDER_OWNER_ID is set correctly.');
            } else if (error.response?.status === 403) {
                this.logger.error('getServiceLogs', 'API returned 403. Check that RENDER_API_KEY has correct permissions.');
            }
            
            throw error;
        }
    }

    /**
     * Search logs across multiple services for specific patterns
     */
    async searchLogsAcrossServices(searchTerms, timeRange = '1h') {
        this.logger.setup('searchLogsAcrossServices', `Searching for: ${searchTerms.join(', ')} in last ${timeRange}`);

        try {
            // Get all services first
            const services = await this.getAllServices();
            const results = [];

            // Calculate time range
            const endTime = new Date().toISOString();
            const startTime = this.calculateStartTime(timeRange);

            // Search each service
            for (const service of services) {
                if (service.suspended) {
                    this.logger.debug('searchLogsAcrossServices', `Skipping suspended service: ${service.name}`);
                    continue;
                }

                try {
                    const logData = await this.getServiceLogs(service.id, { startTime, endTime });
                    const matchingLogs = this.filterLogsByTerms(logData.logs || [], searchTerms);
                    
                    if (matchingLogs.length > 0) {
                        results.push({
                            service,
                            matchingLogs,
                            totalMatches: matchingLogs.length
                        });
                    }
                } catch (serviceError) {
                    this.logger.warn('searchLogsAcrossServices', `Failed to search service ${service.name}: ${serviceError.message}`);
                }
            }

            this.logger.summary('searchLogsAcrossServices', `Found matches in ${results.length} services`);
            return results;
        } catch (error) {
            this.logger.error('searchLogsAcrossServices', `Search failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Analyze logs for common error patterns
     */
    async analyzeErrorPatterns(timeRange = '1h') {
        this.logger.setup('analyzeErrorPatterns', `Analyzing error patterns in last ${timeRange}`);

        const errorPatterns = [
            'ERROR',
            'WARN',
            'Failed',
            'Exception',
            'timeout',
            'connection refused',
            '5xx',
            'Internal Server Error'
        ];

        try {
            const results = await this.searchLogsAcrossServices(errorPatterns, timeRange);
            
            // Group and analyze patterns
            const analysis = this.categorizeErrors(results);
            
            this.logger.summary('analyzeErrorPatterns', `Analysis complete - found ${analysis.totalErrors} errors across ${analysis.affectedServices} services`);
            return analysis;
        } catch (error) {
            this.logger.error('analyzeErrorPatterns', `Error analysis failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Helper: Calculate start time based on range
     */
    calculateStartTime(timeRange) {
        const now = new Date();
        const ranges = {
            '15m': 15 * 60 * 1000,
            '30m': 30 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '2h': 2 * 60 * 60 * 1000,
            '6h': 6 * 60 * 60 * 1000,
            '12h': 12 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000
        };
        
        const milliseconds = ranges[timeRange] || ranges['1h'];
        return new Date(now.getTime() - milliseconds).toISOString();
    }

    /**
     * Helper: Filter logs by search terms - handles mixed format logs
     */
    filterLogsByTerms(logs, searchTerms) {
        return logs.filter(log => {
            const logText = (log.message || log.text || '').toLowerCase();
            
            // Enhanced search for mixed format logs
            return searchTerms.some(term => {
                const termLower = term.toLowerCase();
                
                // Direct text match (works for both old and new formats)
                if (logText.includes(termLower)) {
                    return true;
                }
                
                // Special handling for CLIENT: patterns in new structured logs
                if (termLower.startsWith('client:')) {
                    const clientPattern = termLower;
                    return logText.includes(clientPattern);
                }
                
                // Pattern-based matching for common log elements
                if (termLower === 'error' || termLower === 'fail') {
                    return logText.includes('error') || 
                           logText.includes('fail') || 
                           logText.includes('exception') ||
                           logText.includes('fatal');
                }
                
                if (termLower === 'success' || termLower === 'complete') {
                    return logText.includes('success') || 
                           logText.includes('complete') || 
                           logText.includes('finished') ||
                           logText.includes('done');
                }
                
                return false;
            });
        });
    }

    /**
     * Helper: Categorize and analyze errors - handles mixed format logs
     */
    categorizeErrors(searchResults) {
        const analysis = {
            totalErrors: 0,
            affectedServices: searchResults.length,
            errorsByService: {},
            commonPatterns: {},
            timeline: [],
            formatAnalysis: {
                structuredLogs: 0,
                unstructuredLogs: 0,
                mixedFormat: false
            }
        };

        searchResults.forEach(result => {
            const serviceName = result.service.name;
            analysis.errorsByService[serviceName] = result.totalMatches;
            analysis.totalErrors += result.totalMatches;

            // Analyze error patterns and log formats
            result.matchingLogs.forEach(log => {
                const message = log.message || log.text || '';
                
                // Detect if this is a structured log (has CLIENT: pattern)
                if (message.includes('CLIENT:')) {
                    analysis.formatAnalysis.structuredLogs++;
                } else {
                    analysis.formatAnalysis.unstructuredLogs++;
                }
                
                // Extract common error patterns for both formats
                const patterns = this.extractErrorPatterns(message);
                patterns.forEach(pattern => {
                    analysis.commonPatterns[pattern] = (analysis.commonPatterns[pattern] || 0) + 1;
                });

                // Build timeline
                analysis.timeline.push({
                    timestamp: log.timestamp,
                    service: serviceName,
                    message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
                    isStructured: message.includes('CLIENT:')
                });
            });
        });
        
        // Determine if we have mixed format data
        analysis.formatAnalysis.mixedFormat = 
            analysis.formatAnalysis.structuredLogs > 0 && 
            analysis.formatAnalysis.unstructuredLogs > 0;

        // Sort timeline by timestamp
        analysis.timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return analysis;
    }

    /**
     * Helper: Extract error patterns from log messages (works with both formats)
     */
    extractErrorPatterns(message) {
        const patterns = [];
        const lowerMessage = message.toLowerCase();
        
        // Common error patterns that work for both old and new formats
        if (lowerMessage.includes('failed to')) patterns.push('failed_to_operation');
        if (lowerMessage.includes('connection') && lowerMessage.includes('error')) patterns.push('connection_error');
        if (lowerMessage.includes('timeout')) patterns.push('timeout_error');
        if (lowerMessage.includes('not found') || lowerMessage.includes('404')) patterns.push('not_found_error');
        if (lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) patterns.push('auth_error');
        if (lowerMessage.includes('rate limit')) patterns.push('rate_limit_error');
        if (lowerMessage.includes('database') || lowerMessage.includes('db')) patterns.push('database_error');
        if (lowerMessage.includes('airtable')) patterns.push('airtable_error');
        if (lowerMessage.includes('gemini') || lowerMessage.includes('vertex')) patterns.push('ai_service_error');
        
        // Structured log specific patterns
        if (lowerMessage.includes('client:')) {
            const clientMatch = message.match(/CLIENT:([A-Z0-9_]+)/i);
            if (clientMatch) {
                patterns.push(`client_${clientMatch[1].toLowerCase()}_error`);
            }
        }
        
        return patterns;
    }
}

module.exports = RenderLogService;
