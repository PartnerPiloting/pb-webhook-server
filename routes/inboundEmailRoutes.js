// routes/inboundEmailRoutes.js
// Webhook routes for processing inbound emails via Mailgun
// Handles BCC-to-CRM functionality for automatic lead note updates

const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/contextLogger');
const inboundEmailService = require('../services/inboundEmailService');

// Create logger for this module
const logger = createLogger({ 
    runId: 'INBOUND-EMAIL', 
    clientId: 'SYSTEM', 
    operation: 'inbound-email-routes' 
});

/**
 * POST /api/webhooks/inbound-email
 * 
 * Mailgun inbound email webhook endpoint
 * Receives emails sent to *@mail.australiansidehustles.com.au
 * 
 * Flow:
 * 1. Validate Mailgun signature
 * 2. Find client by sender email
 * 3. Find lead by recipient (To:) email
 * 4. Update lead notes with email content
 * 5. Set follow-up date to +14 days
 */
router.post('/api/webhooks/inbound-email', async (req, res) => {
    const startTime = Date.now();
    
    try {
        logger.info('📧 Inbound email webhook received');
        
        // Mailgun sends form-urlencoded data
        const mailgunData = req.body;
        
        // Log basic info (not full content for privacy)
        logger.info(`From: ${mailgunData.sender || mailgunData.from}`);
        logger.info(`To: ${mailgunData.To || mailgunData.to}`);
        logger.info(`Subject: ${mailgunData.subject}`);
        logger.info(`Recipient (BCC): ${mailgunData.recipient}`);

        // Validate Mailgun signature if signing key is configured
        if (process.env.MAILGUN_WEBHOOK_SIGNING_KEY) {
            const { timestamp, token, signature } = mailgunData;
            
            if (!inboundEmailService.validateMailgunSignature(timestamp, token, signature)) {
                logger.warn('Invalid Mailgun signature - rejecting webhook');
                return res.status(401).json({ 
                    error: 'Invalid signature',
                    message: 'Webhook signature validation failed'
                });
            }
            logger.info('✓ Mailgun signature validated');
        }

        // Process the inbound email
        const result = await inboundEmailService.processInboundEmail(mailgunData);
        
        const duration = Date.now() - startTime;
        
        if (result.success) {
            logger.info(`✅ Email processed successfully in ${duration}ms`);
            logger.info(`   Client: ${result.clientName} (${result.clientId})`);
            logger.info(`   Lead: ${result.leadName} (${result.leadEmail})`);
            logger.info(`   Follow-up: ${result.followUpDate}`);
            
            // Return 200 to Mailgun so it doesn't retry
            return res.status(200).json({
                success: true,
                message: 'Email processed and lead updated',
                data: {
                    clientId: result.clientId,
                    leadId: result.leadId,
                    leadName: result.leadName,
                    followUpDate: result.followUpDate,
                    processingTimeMs: duration
                }
            });
        } else {
            // Still return 200 to Mailgun (we handled it, just with an error)
            // Error notification was already sent to sender
            logger.warn(`⚠️ Email processing issue: ${result.error}`);
            logger.warn(`   Message: ${result.message}`);
            
            return res.status(200).json({
                success: false,
                error: result.error,
                message: result.message,
                notificationSent: true,
                processingTimeMs: duration
            });
        }

    } catch (error) {
        logger.error(`❌ Inbound email webhook error: ${error.message}`);
        logger.error(error.stack);
        
        // Still return 200 to prevent Mailgun retries for unrecoverable errors
        // Return 500 only for transient errors we want Mailgun to retry
        const isTransient = error.message.includes('ETIMEDOUT') || 
                           error.message.includes('ECONNRESET') ||
                           error.message.includes('rate limit');
        
        if (isTransient) {
            return res.status(500).json({
                error: 'Temporary error',
                message: 'Please retry',
                details: error.message
            });
        }
        
        return res.status(200).json({
            success: false,
            error: 'processing_error',
            message: error.message
        });
    }
});

/**
 * GET /api/webhooks/inbound-email/health
 * Health check for the inbound email system
 */
router.get('/api/webhooks/inbound-email/health', (req, res) => {
    const config = {
        mailgunConfigured: !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
        signingKeyConfigured: !!process.env.MAILGUN_WEBHOOK_SIGNING_KEY,
        masterClientsConfigured: !!process.env.MASTER_CLIENTS_BASE_ID
    };

    const healthy = config.mailgunConfigured && config.masterClientsConfigured;

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        service: 'inbound-email',
        config,
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/webhooks/inbound-email/test
 * Test endpoint to simulate inbound email processing (requires auth)
 * 
 * Body: {
 *   senderEmail: "client@example.com",
 *   recipientEmail: "lead@company.com", 
 *   subject: "Test Subject",
 *   body: "Test email body"
 * }
 */
router.post('/api/webhooks/inbound-email/test', async (req, res) => {
    // Require debug API key for test endpoint
    const authHeader = req.headers.authorization;
    const debugKey = process.env.DEBUG_API_KEY || process.env.PB_WEBHOOK_SECRET;
    
    if (!authHeader || !authHeader.includes(debugKey)) {
        return res.status(401).json({ error: 'Unauthorized - debug key required' });
    }

    const { senderEmail, recipientEmail, subject, body } = req.body;

    if (!senderEmail || !recipientEmail) {
        return res.status(400).json({ 
            error: 'Missing required fields',
            required: ['senderEmail', 'recipientEmail']
        });
    }

    // Simulate Mailgun data format
    const mockMailgunData = {
        sender: senderEmail,
        from: senderEmail,
        To: recipientEmail,
        to: recipientEmail,
        subject: subject || 'Test Email',
        'body-plain': body || 'This is a test email body.',
        'stripped-text': body || 'This is a test email body.',
        recipient: 'test@mail.australiansidehustles.com.au',
        timestamp: Math.floor(Date.now() / 1000)
    };

    try {
        // Use dry-run mode for testing
        logger.info('🧪 Running inbound email test...');
        
        // Test client lookup
        const client = await inboundEmailService.findClientByEmail(senderEmail);
        if (!client) {
            return res.json({
                testResult: 'client_not_found',
                senderEmail,
                message: 'No client found with this email. Add to Client Email Address or Alternative Email Addresses.'
            });
        }

        // Test lead lookup
        const lead = await inboundEmailService.findLeadByEmail(client, recipientEmail);
        if (!lead) {
            return res.json({
                testResult: 'lead_not_found',
                senderEmail,
                clientFound: { id: client.clientId, name: client.clientName },
                recipientEmail,
                message: 'Client found but no lead with this email exists.'
            });
        }

        // If both found, show what would happen (don't actually update)
        return res.json({
            testResult: 'success',
            wouldProcess: true,
            client: {
                id: client.clientId,
                name: client.clientName,
                matchedVia: client.primaryEmail === senderEmail.toLowerCase() ? 'primary' : 'alternative'
            },
            lead: {
                id: lead.id,
                name: `${lead.firstName} ${lead.lastName}`.trim(),
                email: lead.email,
                currentFollowUp: lead.followUpDate
            },
            wouldSetFollowUp: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            message: 'Test successful - email would be processed. Use POST /api/webhooks/inbound-email to actually process.'
        });

    } catch (error) {
        logger.error(`Test error: ${error.message}`);
        return res.status(500).json({
            testResult: 'error',
            error: error.message
        });
    }
});

/**
 * POST /api/webhooks/inbound-email/clear-cache
 * Clear the client cache (useful after adding Alternative Email Addresses)
 */
router.post('/api/webhooks/inbound-email/clear-cache', (req, res) => {
    const authHeader = req.headers.authorization;
    const debugKey = process.env.DEBUG_API_KEY || process.env.PB_WEBHOOK_SECRET;
    
    if (!authHeader || !authHeader.includes(debugKey)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    inboundEmailService.clearCache();
    
    res.json({
        success: true,
        message: 'Inbound email service cache cleared'
    });
});

module.exports = router;
