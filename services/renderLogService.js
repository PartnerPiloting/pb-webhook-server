// services/renderLogService.js
// Service for interacting with Render API to retrieve and analyze logs

const axios = require('axios');
const { StructuredLogger } = require('../utils/structuredLogger');

class RenderLogService {
    constructor() {
        this.apiKey = process.env.RENDER_API_KEY;
        this.baseUrl = 'https://api.render.com/v1';
        this.logger = new StructuredLogger('RENDER-API', 'LOG-SERVICE');
        
        if (!this.apiKey) {
            throw new Error('RENDER_API_KEY environment variable is required');
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

            console.log('DEBUG - Response status:', response.status);
            console.log('DEBUG - Raw response data:', JSON.stringify(response.data, null, 2));
            
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
                console.error('DEBUG - Services is not an array:', typeof services, services);
                throw new Error('Services response is not an array');
            }
            
            console.log('DEBUG - Processing', services.length, 'services');
            console.log('DEBUG - First service (if exists):', services[0] || 'No services found');
            
            this.logger.summary('getAllServices', `Found ${services.length} services`);
            
            return services.map(service => {
                console.log('DEBUG - Mapping service:', JSON.stringify(service, null, 2));
                return {
                    id: service.id || service.serviceId || service.service?.id,
                    name: service.name || service.serviceName || service.service?.name,
                    type: service.type || service.serviceType || service.service?.type,
                    env: service.env || service.environment || service.service?.env,
                    suspended: service.suspended || service.service?.suspended || false
                };
            });
        } catch (error) {
            console.error('DEBUG - Error in getAllServices:', error.message);
            console.error('DEBUG - Full error:', error);
            this.logger.error('getAllServices', `Failed to fetch services: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get logs for a specific service
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
            let url = `${this.baseUrl}/services/${serviceId}/logs?limit=${limit}`;
            
            if (startTime) url += `&startTime=${startTime}`;
            if (endTime) url += `&endTime=${endTime}`;
            if (cursor) url += `&cursor=${cursor}`;

            const response = await axios.get(url, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            const data = response.data;
            this.logger.process('getServiceLogs', `Retrieved ${data.logs?.length || 0} log entries for service ${serviceId}`);
            
            return data;
        } catch (error) {
            this.logger.error('getServiceLogs', `Failed to fetch logs for service ${serviceId}: ${error.message}`);
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
     * Helper: Filter logs by search terms
     */
    filterLogsByTerms(logs, searchTerms) {
        return logs.filter(log => {
            const logText = (log.message || log.text || '').toLowerCase();
            return searchTerms.some(term => logText.includes(term.toLowerCase()));
        });
    }

    /**
     * Helper: Categorize and analyze errors
     */
    categorizeErrors(searchResults) {
        const analysis = {
            totalErrors: 0,
            affectedServices: searchResults.length,
            errorsByService: {},
            commonPatterns: {},
            timeline: []
        };

        searchResults.forEach(result => {
            const serviceName = result.service.name;
            analysis.errorsByService[serviceName] = result.totalMatches;
            analysis.totalErrors += result.totalMatches;

            // Analyze error patterns
            result.matchingLogs.forEach(log => {
                const message = log.message || log.text || '';
                
                // Extract common error patterns
                if (message.includes('ERROR')) analysis.commonPatterns['ERROR'] = (analysis.commonPatterns['ERROR'] || 0) + 1;
                if (message.includes('timeout')) analysis.commonPatterns['TIMEOUT'] = (analysis.commonPatterns['TIMEOUT'] || 0) + 1;
                if (message.includes('Failed')) analysis.commonPatterns['FAILED_OPERATION'] = (analysis.commonPatterns['FAILED_OPERATION'] || 0) + 1;
                if (message.includes('5xx')) analysis.commonPatterns['SERVER_ERROR'] = (analysis.commonPatterns['SERVER_ERROR'] || 0) + 1;
            });
        });

        return analysis;
    }
}

module.exports = RenderLogService;
