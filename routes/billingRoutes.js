/**
 * Billing Routes
 * 
 * API endpoints for client billing and invoice management.
 * Uses Stripe as the source of truth for all payment/invoice data.
 * Integrates with clientService.js for multi-tenant client lookup.
 * 
 * Endpoints:
 * - GET /api/billing/invoices - List all invoices for a client
 * - GET /api/billing/invoice/:id - Get single invoice details
 * - GET /api/billing/invoice/:id/pdf - Download invoice as PDF
 * - GET /api/billing/subscription - Get current subscription status
 * - POST /api/billing/webhook - Stripe webhook handler (new subscriptions)
 */

const express = require('express');
const router = express.Router();

const { stripe, isStripeAvailable } = require('../config/stripeClient');
const { generateInvoicePdf, getBusinessConfig } = require('../services/invoicePdfService');
const { createLogger } = require('../utils/contextLogger');
const { getClientById } = require('../services/clientService');

// Middleware to check Stripe availability
const requireStripe = (req, res, next) => {
    if (!isStripeAvailable()) {
        return res.status(503).json({
            success: false,
            error: 'Billing service unavailable',
            message: 'Stripe is not configured. Please set STRIPE_SECRET_KEY.'
        });
    }
    next();
};

/**
 * Helper: Get client email from x-client-id header or query param
 * Uses clientService to look up client from Master Clients table
 */
async function getClientEmail(req) {
    // First try query param (for direct access)
    if (req.query.email) {
        return req.query.email.toLowerCase().trim();
    }
    
    // Then try x-client-id header (multi-tenant pattern)
    const clientId = req.headers['x-client-id'];
    if (clientId) {
        try {
            const client = await getClientById(clientId);
            if (client && client.clientEmailAddress) {
                return client.clientEmailAddress.toLowerCase().trim();
            }
        } catch (e) {
            // Log but don't fail - will check for email below
            console.warn('Could not get client by ID:', clientId, e.message);
        }
    }
    
    return null;
}

/**
 * GET /api/billing/status
 * Health check for billing service
 */
router.get('/api/billing/status', (req, res) => {
    const config = getBusinessConfig();
    res.json({
        success: true,
        stripeAvailable: isStripeAvailable(),
        businessName: config.name,
        abn: config.abn,
        gstRegistered: config.gstRegistered
    });
});

/**
 * GET /api/billing/invoices
 * List all invoices for a client
 * 
 * Uses x-client-id header to look up client email from Master Clients table,
 * or accepts email as query param for direct access.
 * 
 * Query params:
 * - email: Customer email address (optional if x-client-id header is set)
 * - limit: Max invoices to return (default 100)
 */
router.get('/api/billing/invoices', requireStripe, async (req, res) => {
    const logger = createLogger({ 
        runId: 'BILLING', 
        clientId: req.headers['x-client-id'] || 'UNKNOWN', 
        operation: 'list_invoices' 
    });

    try {
        const { limit = 100 } = req.query;
        
        // Get email from client service or query param
        const email = await getClientEmail(req);

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email required',
                message: 'Could not determine client email. Ensure x-client-id header is set or provide email parameter.'
            });
        }

        logger.info(`Fetching invoices for: ${email}`);

        // First, find the customer by email
        const customers = await stripe.customers.list({
            email: email.toLowerCase().trim(),
            limit: 1
        });

        if (customers.data.length === 0) {
            logger.info(`No Stripe customer found for: ${email}`);
            return res.json({
                success: true,
                invoices: [],
                message: 'No billing history found for this email.'
            });
        }

        const customer = customers.data[0];
        logger.info(`Found customer: ${customer.id}`);

        // Fetch invoices for this customer
        const invoices = await stripe.invoices.list({
            customer: customer.id,
            limit: parseInt(limit),
            expand: ['data.subscription']
        });

        // Transform invoice data for frontend
        const invoiceList = invoices.data.map(inv => ({
            id: inv.id,
            number: inv.number,
            date: inv.created,
            dateFormatted: new Date(inv.created * 1000).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            }),
            amount: inv.amount_paid / 100,
            amountFormatted: `$${(inv.amount_paid / 100).toFixed(2)}`,
            status: inv.status,
            description: inv.lines?.data?.[0]?.description || 'Subscription',
            pdfUrl: `/api/billing/invoice/${inv.id}/pdf`
        }));

        logger.info(`Found ${invoiceList.length} invoices`);

        res.json({
            success: true,
            customer: {
                id: customer.id,
                name: customer.name,
                email: customer.email
            },
            invoices: invoiceList,
            total: invoiceList.length
        });

    } catch (error) {
        logger.error('Error fetching invoices:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch invoices',
            message: error.message
        });
    }
});

/**
 * GET /api/billing/invoice/:id
 * Get single invoice details
 */
router.get('/api/billing/invoice/:id', requireStripe, async (req, res) => {
    const logger = createLogger({ 
        runId: 'BILLING', 
        clientId: req.headers['x-client-id'] || 'UNKNOWN', 
        operation: 'get_invoice' 
    });

    try {
        const { id } = req.params;

        logger.info(`Fetching invoice: ${id}`);

        const invoice = await stripe.invoices.retrieve(id, {
            expand: ['customer', 'subscription', 'lines.data']
        });

        res.json({
            success: true,
            invoice: {
                id: invoice.id,
                number: invoice.number,
                date: invoice.created,
                dateFormatted: new Date(invoice.created * 1000).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                }),
                amount: invoice.amount_paid / 100,
                amountFormatted: `$${(invoice.amount_paid / 100).toFixed(2)}`,
                status: invoice.status,
                customer: {
                    name: invoice.customer_name || invoice.customer?.name,
                    email: invoice.customer_email || invoice.customer?.email
                },
                lineItems: invoice.lines?.data?.map(item => ({
                    description: item.description,
                    amount: item.amount / 100
                })) || []
            }
        });

    } catch (error) {
        logger.error('Error fetching invoice:', error.message);
        
        if (error.code === 'resource_missing') {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to fetch invoice',
            message: error.message
        });
    }
});

/**
 * GET /api/billing/invoice/:id/pdf
 * Generate and download invoice as PDF
 */
router.get('/api/billing/invoice/:id/pdf', requireStripe, async (req, res) => {
    const logger = createLogger({ 
        runId: 'BILLING', 
        clientId: req.headers['x-client-id'] || 'UNKNOWN', 
        operation: 'download_invoice_pdf' 
    });

    try {
        const { id } = req.params;

        logger.info(`Generating PDF for invoice: ${id}`);

        // Fetch invoice from Stripe
        const invoice = await stripe.invoices.retrieve(id, {
            expand: ['customer', 'lines.data']
        });

        // Generate PDF
        const pdfBuffer = await generateInvoicePdf({
            id: invoice.id,
            number: invoice.number,
            created: invoice.created,
            amount_paid: invoice.amount_paid,
            status: invoice.status,
            customer_name: invoice.customer_name || invoice.customer?.name,
            customer_email: invoice.customer_email || invoice.customer?.email,
            lines: invoice.lines
        });

        // Generate filename
        const invoiceNumber = invoice.number || `ASH-${invoice.id.slice(-8)}`;
        const filename = `Invoice-${invoiceNumber}.pdf`;

        // Send PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);

        logger.info(`PDF sent: ${filename}`);

    } catch (error) {
        logger.error('Error generating PDF:', error.message);
        
        if (error.code === 'resource_missing') {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to generate PDF',
            message: error.message
        });
    }
});

/**
 * GET /api/billing/subscription
 * Get current subscription status for a client
 * 
 * Uses x-client-id header to look up client email from Master Clients table,
 * or accepts email as query param for direct access.
 */
router.get('/api/billing/subscription', requireStripe, async (req, res) => {
    const logger = createLogger({ 
        runId: 'BILLING', 
        clientId: req.headers['x-client-id'] || 'UNKNOWN', 
        operation: 'get_subscription' 
    });

    try {
        // Get email from client service or query param
        const email = await getClientEmail(req);

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email required',
                message: 'Could not determine client email. Ensure x-client-id header is set or provide email parameter.'
            });
        }

        logger.info(`Fetching subscription for: ${email}`);

        // Find customer
        const customers = await stripe.customers.list({
            email: email.toLowerCase().trim(),
            limit: 1
        });

        if (customers.data.length === 0) {
            return res.json({
                success: true,
                subscription: null,
                message: 'No subscription found'
            });
        }

        const customer = customers.data[0];

        // Get active subscriptions
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 1,
            expand: ['data.items.data.price.product']
        });

        if (subscriptions.data.length === 0) {
            return res.json({
                success: true,
                subscription: null,
                message: 'No active subscription'
            });
        }

        const sub = subscriptions.data[0];
        const item = sub.items.data[0];
        const product = item?.price?.product;

        res.json({
            success: true,
            subscription: {
                id: sub.id,
                status: sub.status,
                planName: typeof product === 'object' ? product.name : 'Subscription',
                amount: item?.price?.unit_amount / 100,
                amountFormatted: `$${(item?.price?.unit_amount / 100).toFixed(2)}`,
                interval: item?.price?.recurring?.interval,
                currentPeriodEnd: sub.current_period_end,
                nextBillingDate: new Date(sub.current_period_end * 1000).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                }),
                cancelAtPeriodEnd: sub.cancel_at_period_end
            }
        });

    } catch (error) {
        logger.error('Error fetching subscription:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch subscription',
            message: error.message
        });
    }
});

/**
 * POST /api/billing/webhook
 * Stripe webhook handler for new subscription events
 * 
 * Listens for:
 * - customer.subscription.created (notify admin)
 * - customer.subscription.deleted (notify admin)
 * - invoice.payment_failed (notify admin)
 */
router.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const logger = createLogger({ 
        runId: 'BILLING', 
        clientId: 'STRIPE', 
        operation: 'webhook' 
    });

    try {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        let event;

        if (webhookSecret && sig) {
            // Verify webhook signature
            try {
                event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
            } catch (err) {
                logger.error('Webhook signature verification failed:', err.message);
                return res.status(400).send(`Webhook Error: ${err.message}`);
            }
        } else {
            // No webhook secret configured, parse body directly
            event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            logger.warn('Webhook received without signature verification (STRIPE_WEBHOOK_SECRET not set)');
        }

        logger.info(`Webhook received: ${event.type}`);

        switch (event.type) {
            case 'customer.subscription.created': {
                const subscription = event.data.object;
                const customerEmail = subscription.customer_email || 'Unknown';
                logger.info(`🎉 NEW SUBSCRIPTION: ${customerEmail}`);
                
                // TODO: Send email notification to admin
                // await sendAdminNotification('new_subscription', { customerEmail, subscription });
                
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                logger.info(`❌ SUBSCRIPTION CANCELLED: ${subscription.customer_email || subscription.id}`);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                logger.warn(`⚠️ PAYMENT FAILED: ${invoice.customer_email || invoice.id}`);
                break;
            }

            default:
                logger.info(`Unhandled event type: ${event.type}`);
        }

        res.json({ received: true });

    } catch (error) {
        logger.error('Webhook error:', error.message);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

module.exports = router;
