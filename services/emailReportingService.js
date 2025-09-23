/**
 * Email Reporting Service
 * 
 * Sends comprehensive execution reports via email using Mailgun
 * Supports both success summaries and failure alerts
 */

const https = require('https');
const querystring = require('querystring');

class EmailReportingService {
    constructor() {
        this.alertEmail = process.env.ALERT_EMAIL;
        this.fromEmail = process.env.FROM_EMAIL || 'alerts@australiansidehustles.com.au';
        this.configured = false;
        
        this.initialize();
    }
    
    initialize() {
        // Check for Mailgun configuration
        if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN || !this.alertEmail) {
            console.log('⚠️  Email service not configured (missing Mailgun credentials)');
            return;
        }
        
        this.configured = true;
        console.log('✅ Email service configured successfully (Mailgun)');
    }
    
    isConfigured() {
        return this.configured;
    }
    
    /**
     * Send email via Mailgun REST API
     */
    async sendMailgunEmail(emailData) {
        if (!this.configured) {
            throw new Error("Email service not configured");
        }

        return new Promise((resolve, reject) => {
            const data = querystring.stringify(emailData);
            const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64');
            
            const options = {
                hostname: 'api.mailgun.net',
                port: 443,
                path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': data.length
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsedData = JSON.parse(responseData);
                            resolve(parsedData);
                        } catch (error) {
                            resolve({ id: 'unknown', message: responseData });
                        }
                    } else {
                        reject(new Error(`Mailgun API error: ${res.statusCode} - ${responseData}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }
    
    formatDuration(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }
    
    generateExecutionSummaryHTML(reportData) {
        const {
            runId,
            stream,
            startTime,
            endTime,
            duration,
            clientsAnalyzed,
            clientsSkipped,
            clientsProcessed,
            totalOperationsTriggered,
            totalJobsStarted,
            successRate,
            executionResults,
            skippedClients,
            errors
        } = reportData;
        
        const successClass = successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'error';
        // Format date in a more readable format
        const formattedDate = new Date(startTime).toLocaleString('en-AU', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 10px; }
        h1, h2, h3 { margin-top: 0.5em; margin-bottom: 0.5em; }
        
        /* Header Styles */
        .header { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ddd; }
        .header h1 { font-size: 24px; color: #333; margin-bottom: 10px; }
        .header-details { font-size: 14px; color: #555; }
        
        /* Status Colors */
        .success { color: #28a745; }
        .warning { color: #fd7e14; }
        .error { color: #dc3545; }
        
        /* Summary Table */
        .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        .summary-table th, .summary-table td { padding: 8px 12px; border: 1px solid #ddd; text-align: left; }
        .summary-table th { background-color: #f2f2f2; font-weight: 600; }
        .summary-table tr:nth-child(even) { background-color: #f9f9f9; }
        
        /* Section Headers */
        .section-header { background-color: #eef2f5; padding: 10px 15px; border-radius: 6px; 
                          margin: 25px 0 15px 0; border-left: 4px solid #6c757d; }
        
        /* Client Cards */
        .client-section { margin: 20px 0; }
        .client-card { border: 1px solid #ddd; border-radius: 6px; margin-bottom: 15px; overflow: hidden; }
        .client-header { background-color: #f8f9fa; padding: 12px 15px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
        .client-name { font-size: 16px; font-weight: bold; margin: 0; }
        .service-level { font-size: 12px; color: #666; margin-left: 8px; }
        .client-metrics { display: flex; flex-wrap: wrap; padding: 10px 15px; background-color: #fbfbfb; border-bottom: 1px solid #eee; }
        .metric-badge { background: #f0f8ff; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px; margin-bottom: 5px; }
        
        /* Operations Table */
        .operations-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .operations-table th, .operations-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
        .operations-table th { font-weight: 600; color: #555; }
        .job-id { font-family: monospace; font-size: 11px; color: #666; }
        
        /* Skipped Clients */
        .skipped-clients { display: flex; flex-wrap: wrap; gap: 10px; margin: 15px 0; }
        .skipped-client-badge { background: #f1f3f4; padding: 6px 10px; border-radius: 4px; font-size: 13px; }
        
        /* Footer */
        .footer { margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 8px; font-size: 13px; border: 1px solid #ddd; }
        
        /* Mobile Responsiveness */
        @media (max-width: 600px) {
            .header { padding: 12px; }
            .header h1 { font-size: 20px; }
            .summary-table th, .summary-table td { padding: 6px 8px; }
            .client-header { flex-direction: column; align-items: flex-start; }
            .client-metrics { flex-direction: column; }
            .metric-badge { margin-bottom: 5px; }
            .operations-table { font-size: 12px; }
            .operations-table th, .operations-table td { padding: 6px 8px; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Smart Resume Processing Report</h1>
        <div class="header-details">
            <p><strong>Run ID:</strong> ${runId}</p>
            <p><strong>Stream:</strong> ${stream} | <strong>Duration:</strong> ${this.formatDuration(duration)} | <strong>Time:</strong> ${formattedDate}</p>
        </div>
    </div>
    
    <div class="section-header">
        <h2>📊 Summary</h2>
    </div>
    
    <table class="summary-table">
        <tr>
            <th>Success Rate</th>
            <td class="${successClass}"><strong>${Math.round(successRate)}%</strong></td>
            <th>Duration</th>
            <td>${this.formatDuration(duration)}</td>
        </tr>
        <tr>
            <th>Operations Triggered</th>
            <td>${totalOperationsTriggered}</td>
            <th>Successful Jobs</th>
            <td>${totalJobsStarted}</td>
        </tr>
        <tr>
            <th>Clients Processed</th>
            <td>${clientsProcessed}/${clientsAnalyzed}</td>
            <th>Clients Skipped</th>
            <td>${clientsSkipped?.length || 0}</td>
        </tr>
    </table>
    
    ${executionResults && executionResults.length > 0 ? `
    <div class="section-header">
        <h2>� Client Results</h2>
    </div>
    
    ${executionResults.map(client => {
        // Calculate operation success rate for this client
        const jobCount = client.jobs?.length || 0;
        const operationsCount = client.operationsRun?.length || 0;
        const successIcon = jobCount === operationsCount ? '✅' : jobCount > 0 ? '⚠️' : '❌';
        
        return `
        <div class="client-card">
            <div class="client-header">
                <div>
                    <span class="client-name">${client.clientName}</span>
                    <span class="service-level">(ID: ${client.clientId})</span>
                </div>
                <div>${successIcon} ${jobCount}/${operationsCount} Operations</div>
            </div>
            
            <div class="client-metrics">
                ${operationsCount > 0 ? 
                  `<div class="metric-badge">Operations: ${operationsCount}</div>
                   <div class="metric-badge">Jobs Started: ${jobCount}</div>` : 
                  `<div class="metric-badge">No operations run</div>`}
            </div>
            
            ${client.jobs && client.jobs.length > 0 ? `
            <table class="operations-table">
                <tr>
                    <th>Operation</th>
                    <th>Job ID</th>
                    <th>Status</th>
                </tr>
                ${client.jobs.map(job => `
                <tr>
                    <td><strong>${job.operation}</strong></td>
                    <td class="job-id">${job.jobId}</td>
                    <td>✅ Triggered</td>
                </tr>
                `).join('')}
            </table>
            ` : ''}
        </div>
        `;
    }).join('')}
    ` : ''}
    
    ${skippedClients && skippedClients.length > 0 ? `
    <div class="section-header">
        <h2>⏭️ Skipped Clients</h2>
        <p>These clients were skipped because all operations completed recently.</p>
    </div>
    
    <div class="skipped-clients">
        ${skippedClients.map(client => {
            // Handle different client object formats
            const clientName = typeof client === 'object' ? client.clientName : client;
            const reason = typeof client === 'object' && client.reason ? ` - ${client.reason}` : '';
            
            return `<div class="skipped-client-badge">✓ ${clientName}${reason}</div>`;
        }).join('')}
    </div>
    ` : ''}
    
    ${errors && errors.length > 0 ? `
    <div class="section-header" style="border-left-color: #dc3545;">
        <h2>⚠️ Errors Encountered</h2>
    </div>
    
    <ul style="color: #dc3545; padding-left: 20px;">
        ${errors.map(error => `<li>${error}</li>`).join('')}
    </ul>
    ` : ''}
    
    <div class="footer">
        <p><strong>Next Steps:</strong></p>
        <ul>
            <li>View detailed metrics in Airtable's Client Run Results and Job Tracking tables</li>
            <li>Jobs will complete independently with timeout protection</li>
            <li>Check lead scoring results in your client base</li>
        </ul>
    </div>
</body>
</html>
    
    <div class="footer">
        <p><strong>Next Steps:</strong></p>
        <ul>
            <li>Monitor Airtable Client table for job completion status</li>
            <li>Jobs will complete independently with timeout protection</li>
            <li>Next resume will check for any remaining incomplete operations</li>
        </ul>
    </div>
</body>
</html>
        `;
    }
    
    generateFailureAlertHTML(reportData) {
        const { error, context, runId, stream, timestamp } = reportData;
        
        // Format date in a more readable format
        const formattedDate = new Date(timestamp || Date.now()).toLocaleString('en-AU', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 10px; }
        h1, h2, h3 { margin-top: 0.5em; margin-bottom: 0.5em; }
        
        /* Header Styles */
        .header { background: #f8d7da; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #f5c6cb; }
        .header h1 { font-size: 24px; color: #721c24; margin-bottom: 10px; }
        .header-details { font-size: 14px; color: #721c24; }
        
        /* Error Details */
        .error-details { background: #fff3f3; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #f5c6cb; }
        .error-details h3 { color: #721c24; }
        
        /* Section Headers */
        .section-header { background-color: #eef2f5; padding: 10px 15px; border-radius: 6px; 
                          margin: 25px 0 15px 0; border-left: 4px solid #dc3545; }
        
        /* Context Section */
        .context-section { background: #f9f9f9; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #ddd; }
        .context-section pre { white-space: pre-wrap; font-size: 12px; background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
        
        /* Footer */
        .footer { margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 8px; font-size: 13px; border: 1px solid #ddd; }
        
        /* Mobile Responsiveness */
        @media (max-width: 600px) {
            .header { padding: 12px; }
            .header h1 { font-size: 20px; }
            .error-details { padding: 10px; }
            .context-section pre { font-size: 11px; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚨 Smart Resume Processing Failed</h1>
        <div class="header-details">
            <p><strong>Run ID:</strong> ${runId}</p>
            <p><strong>Stream:</strong> ${stream} | <strong>Time:</strong> ${formattedDate}</p>
        </div>
    </div>
    
    <div class="section-header">
        <h2>❌ Error Information</h2>
    </div>
    
    <div class="error-details">
        <h3>Error Details</h3>
        <p><strong>Error Message:</strong> ${error}</p>
    </div>
    
    ${context ? `
    <div class="context-section">
        <h3>Context</h3>
        <pre>${JSON.stringify(context, null, 2)}</pre>
    </div>
    ` : ''}
    
    <div class="footer">
        <p><strong>Immediate Actions:</strong></p>
        <ul>
            <li>Check server logs for detailed error information</li>
            <li>Verify Airtable connectivity and client configurations</li>
            <li>Consider manual retry if issue is temporary</li>
            <li>Review client status in Master Clients base</li>
        </ul>
    </div>
</body>
</html>
        `;
    }
    
    // Store the last sent email to prevent duplicates
    #lastSentEmail = {
        timestamp: 0,
        runId: null,
        stream: null
    };

    // Check if this is a duplicate email send (within 30 seconds)
    #isDuplicateEmailSend(reportData) {
        const now = Date.now();
        const runId = reportData.runId;
        const stream = reportData.stream;
        
        // If we have the same runId and stream within 30 seconds, consider it a duplicate
        if (runId && 
            runId === this.#lastSentEmail.runId && 
            stream === this.#lastSentEmail.stream &&
            (now - this.#lastSentEmail.timestamp) < 30000) {
            
            console.log(`📧 DUPLICATE EMAIL DETECTED - Skipping duplicate email for runId: ${runId}`);
            return true;
        }
        
        return false;
    }

    /**
     * Send execution report email
     */
    async sendExecutionReport(reportData) {
        if (!this.configured) {
            console.log('📧 Email not configured - skipping report');
            return { success: false, reason: 'Email not configured' };
        }
        
        // Check for duplicate email sends
        if (this.#isDuplicateEmailSend(reportData)) {
            console.log('📧 Preventing duplicate email send - same runId within 30 seconds');
            return { success: true, sent: true, duplicate: true, message: 'Duplicate email prevented' };
        }
        
        try {
            const isFailureReport = reportData.error;
            
            // Ensure successRate is a valid number between 0-100
            let successRateFormatted = "N/A";
            if (!isFailureReport) {
                // Ensure success rate is a valid number between 0-100
                let successRate = reportData.successRate;
                
                // If undefined or NaN, default to 100%
                if (successRate === undefined || isNaN(successRate)) {
                    console.log('⚠️ Success rate is undefined or NaN, defaulting to 100%');
                    successRate = 100;
                }
                
                // Cap at 100%
                successRate = Math.min(Math.round(successRate), 100);
                successRateFormatted = `${successRate}%`;
                
                // Update the report data
                reportData.successRate = successRate;
            }
            
            const subject = isFailureReport 
                ? `🚨 Smart Resume Processing Failed - Stream ${reportData.stream}`
                : `✅ Smart Resume Processing Complete - Stream ${reportData.stream} (${successRateFormatted} success)`;
            
            const htmlContent = isFailureReport 
                ? this.generateFailureAlertHTML(reportData)
                : this.generateExecutionSummaryHTML(reportData);
            
            const emailData = {
                from: this.fromEmail,
                to: this.alertEmail,
                subject: subject,
                html: htmlContent
            };
            
            // Record this email send attempt to prevent duplicates
            if (reportData.runId) {
                this.#lastSentEmail = {
                    timestamp: Date.now(),
                    runId: reportData.runId,
                    stream: reportData.stream
                };
            }
            
            const result = await this.sendMailgunEmail(emailData);
            
            console.log('📧 Email report sent successfully', { 
                subject, 
                to: this.alertEmail,
                mailgunId: result.id
            });
            
            return { 
                success: true, 
                mailgunId: result.id,
                subject,
                to: this.alertEmail
            };
        } catch (error) {
            console.error('📧 Email report failed:', error.message);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
}

module.exports = new EmailReportingService();