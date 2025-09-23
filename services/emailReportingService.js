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
        
        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .success { color: #28a745; }
        .warning { color: #fd7e14; }
        .error { color: #dc3545; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .metric-card { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
        .metric-value { font-size: 24px; font-weight: bold; }
        .client-section { margin: 20px 0; }
        .client-item { background: #f1f3f4; padding: 12px; margin: 8px 0; border-radius: 4px; }
        .job-list { margin-left: 20px; font-size: 14px; color: #666; }
        .footer { margin-top: 30px; padding: 20px; background: #e9ecef; border-radius: 8px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Smart Resume Processing Report</h1>
        <p><strong>Run ID:</strong> ${runId}</p>
        <p><strong>Stream:</strong> ${stream} | <strong>Duration:</strong> ${this.formatDuration(duration)} | <strong>Time:</strong> ${new Date(startTime).toLocaleString()}</p>
    </div>
    
    <div class="metrics">
        <div class="metric-card">
            <div class="metric-value ${successClass}">${Math.round(successRate)}%</div>
            <div>Success Rate</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${clientsProcessed}</div>
            <div>Clients Processed</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${totalJobsStarted}</div>
            <div>Jobs Started</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${clientsSkipped}</div>
            <div>Clients Skipped</div>
        </div>
    </div>
    
    ${executionResults && executionResults.length > 0 ? `
    <div class="client-section">
        <h3>📊 Processed Clients</h3>
        ${executionResults.map(client => `
            <div class="client-item">
                <strong>${client.clientName}</strong>
                <div class="job-list">
                    ${client.results && client.results.length > 0 ? client.results.map(job => `
                        • ${job.operation}: ${job.success ? '✅' : '❌'} ${job.jobId || job.error || ''}
                    `).join('<br>') : 'No job details available'}
                </div>
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    ${skippedClients && skippedClients.length > 0 ? `
    <div class="client-section">
        <h3>⏭️ Skipped Clients (Up to Date)</h3>
        ${skippedClients.map(client => `
            <div class="client-item">
                <strong>${client}</strong> - All operations completed recently
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    ${errors && errors.length > 0 ? `
    <div class="client-section">
        <h3>⚠️ Errors Encountered</h3>
        ${errors.map(error => `
            <div class="client-item error">
                <strong>Error:</strong> ${error}
            </div>
        `).join('')}
    </div>
    ` : ''}
    
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
        
        return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .alert-header { background: #dc3545; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .error-details { background: #f8d7da; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .context-section { background: #f1f3f4; padding: 15px; border-radius: 6px; margin: 15px 0; }
        .footer { margin-top: 20px; padding: 15px; background: #e9ecef; border-radius: 8px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="alert-header">
        <h1>🚨 Smart Resume Processing Failed</h1>
        <p><strong>Run ID:</strong> ${runId}</p>
        <p><strong>Stream:</strong> ${stream} | <strong>Time:</strong> ${new Date(timestamp).toLocaleString()}</p>
    </div>
    
    <div class="error-details">
        <h3>Error Details</h3>
        <p><strong>Error:</strong> ${error}</p>
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