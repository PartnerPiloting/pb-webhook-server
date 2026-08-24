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
 * - POST /api/billing/portal - Create Stripe Customer Portal session
 * - POST /api/billing/webhook - Stripe webhook handler (new subscriptions)
 */

const express = require('express');
const router = express.Router();

const { stripe, isStripeAvailable } = require('../config/stripeClient');
const { generateInvoicePdf, getBusinessConfig } = require('../services/invoicePdfService');
const { createLogger } = require('../utils/contextLogger');
const { sendMailgunEmail } = require('../services/emailNotificationService');
const { authenticateUserWithTestMode } = require('../middleware/authMiddleware');

/**
 * Send email notification to admin when someone onboards (makes first payment)
 * Uses existing Mailgun configuration
 */
async function sendOnboardingNotification(data, logger) {
    try {
        const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com';
        
        // Check if Mailgun is configured
        if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
            logger.warn('Mailgun not configured - logging notification instead');
            logger.info(`📧 ONBOARDING NOTIFICATION: ${data.customerName || data.customerEmail} paid $${data.amount} for ${data.description || data.planName}`);
            return;
        }

        const subject = `🎉 New Client Onboarded: ${data.customerName || data.customerEmail}`;
        const textBody = `
New client has made their first payment!

Customer: ${data.customerName || 'N/A'}
Email: ${data.customerEmail}
Amount: $${data.amount?.toFixed(2) || 'N/A'}
Product: ${data.description || data.planName || 'N/A'}
Type: ${data.type === 'subscription' ? 'Subscription' : 'One-time Payment'}

Please set up their account in Airtable.

Stripe Customer ID: ${data.customerId}
        `.trim();

        const fromEmail = process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`;
        
        await sendMailgunEmail({
            from: fromEmail,
            to: adminEmail,
            subject,
            text: textBody
        });

        logger.info(`📧 Onboarding notification sent to ${adminEmail}`);

    } catch (error) {
        logger.error('Failed to send onboarding notification:', error.message);
        // Don't throw - we don't want webhook to fail just because email failed
    }
}

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
 * Helper: Get the billing email for the authenticated client.
 * req.client is set by authenticateUserWithTestMode from a verified portal
 * token (or dev key) - never trust a client-supplied email/x-client-id for
 * something that can mint a Stripe Customer Portal session.
 */
function getClientEmail(req) {
    return req.client?.clientEmailAddress?.toLowerCase().trim() || null;
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
router.get('/api/billing/invoices', authenticateUserWithTestMode, requireStripe, async (req, res) => {
    const logger = createLogger({
        runId: 'BILLING',
        clientId: req.client?.clientId || 'UNKNOWN',
        operation: 'list_invoices'
    });

    try {
        const { limit = 100 } = req.query;

        const email = getClientEmail(req);

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email required',
                message: 'No email address on file for this account.'
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

        // Also fetch one-time charges (payments not attached to invoices)
        const charges = await stripe.charges.list({
            customer: customer.id,
            limit: parseInt(limit)
        });

        // Filter out charges that are already part of an invoice
        // Check charge ID, payment_intent, AND amount+date to catch all duplicates
        const invoiceChargeIds = new Set();
        const invoicePaymentIntents = new Set();
        const invoiceAmountDateKeys = new Set(); // "amount_timestamp" for same-day same-amount dedup
        
        invoices.data.forEach(inv => {
            if (inv.charge) invoiceChargeIds.add(inv.charge);
            if (inv.payment_intent) invoicePaymentIntents.add(inv.payment_intent);
            // Create a key for amount + date (same day) to catch duplicates from checkout sessions
            const dateKey = new Date(inv.created * 1000).toISOString().split('T')[0];
            invoiceAmountDateKeys.add(`${inv.amount_paid}_${dateKey}`);
        });

        const oneTimeCharges = charges.data.filter(charge => {
            // Must be paid and successful
            if (!charge.paid || charge.status !== 'succeeded') return false;
            
            // Exclude if charge is linked to an invoice
            if (invoiceChargeIds.has(charge.id)) return false;
            
            // Exclude if payment_intent is linked to an invoice
            if (charge.payment_intent && invoicePaymentIntents.has(charge.payment_intent)) return false;
            
            // Exclude if same amount on same date as an invoice (likely same transaction)
            const dateKey = new Date(charge.created * 1000).toISOString().split('T')[0];
            if (invoiceAmountDateKeys.has(`${charge.amount}_${dateKey}`)) {
                logger.info(`Filtering duplicate charge ${charge.id} - same amount/date as invoice`);
                return false;
            }
            
            return true;
        });

        // Transform invoice data for frontend
        const invoiceList = invoices.data.map(inv => ({
            id: inv.id,
            type: 'invoice',
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

        // Transform one-time charges
        const chargeList = oneTimeCharges.map(charge => ({
            id: charge.id,
            type: 'charge',
            number: charge.id.replace('ch_', 'CHG-'),
            date: charge.created,
            dateFormatted: new Date(charge.created * 1000).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            }),
            amount: charge.amount / 100,
            amountFormatted: `$${(charge.amount / 100).toFixed(2)}`,
            status: 'paid',
            description: charge.description || 'One-time payment',
            pdfUrl: `/api/billing/invoice/${charge.id}/pdf`
        }));

        // Combine and sort by date descending
        const allBillingItems = [...invoiceList, ...chargeList].sort((a, b) => b.date - a.date);

        logger.info(`Found ${invoiceList.length} invoices and ${chargeList.length} one-time charges`);

        res.json({
            success: true,
            customer: {
                id: customer.id,
                name: customer.name,
                email: customer.email
            },
            invoices: allBillingItems,
            total: allBillingItems.length
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
 * POST /api/billing/portal
 * Create a Stripe Customer Portal session
 * 
 * Allows customers to manage their payment methods via Stripe's hosted portal.
 * Configure portal features in Stripe Dashboard → Settings → Billing → Customer Portal
 * 
 * Returns a URL to redirect the customer to.
 */
router.post('/api/billing/portal', authenticateUserWithTestMode, requireStripe, async (req, res) => {
    const logger = createLogger({
        runId: 'BILLING',
        clientId: req.client?.clientId || 'UNKNOWN',
        operation: 'create_portal'
    });

    try {
        const email = getClientEmail(req);

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email required',
                message: 'No email address on file for this account.'
            });
        }

        logger.info(`Creating portal session for: ${email}`);

        // Find the customer by email
        const customers = await stripe.customers.list({
            email: email.toLowerCase().trim(),
            limit: 1
        });

        if (customers.data.length === 0) {
            logger.info(`No Stripe customer found for: ${email}`);
            return res.status(404).json({
                success: false,
                error: 'Customer not found',
                message: 'No billing account found for this email.'
            });
        }

        const customer = customers.data[0];
        logger.info(`Found customer: ${customer.id}`);

        // Determine return URL (where customer goes after portal)
        const returnUrl = req.body.returnUrl || 
                         process.env.FRONTEND_URL || 
                         'https://ashportal.com.au/settings';

        // Create the portal session
        const session = await stripe.billingPortal.sessions.create({
            customer: customer.id,
            return_url: returnUrl
        });

        logger.info(`Portal session created: ${session.id}`);

        res.json({
            success: true,
            url: session.url
        });

    } catch (error) {
        logger.error('Error creating portal session:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to create portal session',
            message: error.message
        });
    }
});

/**
 * GET /api/billing/invoice/:id
 * Get single invoice details
 */
router.get('/api/billing/invoice/:id', authenticateUserWithTestMode, requireStripe, async (req, res) => {
    const logger = createLogger({
        runId: 'BILLING',
        clientId: req.client?.clientId || 'UNKNOWN',
        operation: 'get_invoice'
    });

    try {
        const { id } = req.params;
        const email = getClientEmail(req);

        logger.info(`Fetching invoice: ${id}`);

        const invoice = await stripe.invoices.retrieve(id, {
            expand: ['customer', 'subscription', 'lines.data']
        });

        // The invoice ID alone doesn't prove ownership - confirm it actually
        // belongs to the calling client before returning it to them.
        const invoiceEmail = (invoice.customer_email || invoice.customer?.email || '').toLowerCase().trim();
        if (!email || invoiceEmail !== email) {
            logger.warn(`Invoice ${id} does not belong to authenticated client`);
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

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
 * Supports both formal invoices (in_) and one-time charges (ch_)
 */
router.get('/api/billing/invoice/:id/pdf', authenticateUserWithTestMode, requireStripe, async (req, res) => {
    const logger = createLogger({
        runId: 'BILLING',
        clientId: req.client?.clientId || 'UNKNOWN',
        operation: 'download_invoice_pdf'
    });

    try {
        const { id } = req.params;
        const email = getClientEmail(req);

        logger.info(`Generating PDF for: ${id}`);

        let pdfData;
        let filename;

        if (id.startsWith('in_')) {
            // It's a formal Stripe invoice
            const invoice = await stripe.invoices.retrieve(id, {
                expand: ['customer', 'lines.data']
            });

            const invoiceEmail = (invoice.customer_email || invoice.customer?.email || '').toLowerCase().trim();
            if (!email || invoiceEmail !== email) {
                logger.warn(`Invoice ${id} does not belong to authenticated client`);
                return res.status(404).json({ success: false, error: 'Invoice not found' });
            }

            pdfData = {
                id: invoice.id,
                number: invoice.number,
                created: invoice.created,
                amount_paid: invoice.amount_paid,
                status: invoice.status,
                customer_name: invoice.customer_name || invoice.customer?.name,
                customer_email: invoice.customer_email || invoice.customer?.email,
                lines: invoice.lines
            };
            filename = `Invoice-${invoice.number || 'ASH-' + invoice.id.slice(-8)}.pdf`;

        } else if (id.startsWith('ch_')) {
            // It's a one-time charge
            const charge = await stripe.charges.retrieve(id);
            const customer = await stripe.customers.retrieve(charge.customer);

            const chargeEmail = (customer.email || charge.billing_details?.email || '').toLowerCase().trim();
            if (!email || chargeEmail !== email) {
                logger.warn(`Charge ${id} does not belong to authenticated client`);
                return res.status(404).json({ success: false, error: 'Invoice not found' });
            }

            // For one-time charges, create invoice-like structure
            pdfData = {
                id: charge.id,
                number: charge.id.replace('ch_', 'CHG-'),
                created: charge.created,
                amount_paid: charge.amount,
                status: charge.paid ? 'paid' : charge.status,
                customer_name: customer.name || charge.billing_details?.name,
                customer_email: customer.email || charge.billing_details?.email,
                lines: {
                    data: [{
                        description: charge.description || 'One-time payment',
                        amount: charge.amount
                    }]
                }
            };
            filename = `Invoice-${pdfData.number}.pdf`;

        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid ID format',
                message: 'ID must start with in_ (invoice) or ch_ (charge)'
            });
        }

        // Generate PDF
        const pdfBuffer = await generateInvoicePdf(pdfData);

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
router.get('/api/billing/subscription', authenticateUserWithTestMode, requireStripe, async (req, res) => {
    const logger = createLogger({
        runId: 'BILLING',
        clientId: req.client?.clientId || 'UNKNOWN',
        operation: 'get_subscription'
    });

    try {
        const email = getClientEmail(req);

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email required',
                message: 'No email address on file for this account.'
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

        // Signature verification is mandatory - an unverified payload could be
        // forged by anyone who finds this URL, and this webhook is about to
        // start driving client entitlement, not just sending an FYI email.
        if (!webhookSecret) {
            logger.error('STRIPE_WEBHOOK_SECRET is not configured - refusing to process webhook');
            return res.status(500).json({ error: 'Webhook not configured' });
        }
        if (!sig) {
            return res.status(400).json({ error: 'Missing stripe-signature header' });
        }

        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err) {
            logger.error('Webhook signature verification failed:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        logger.info(`Webhook received: ${event.type}`);

        switch (event.type) {
            case 'customer.subscription.created': {
                const subscription = event.data.object;
                const customerEmail = subscription.customer_email || 'Unknown';
                logger.info(`🎉 NEW SUBSCRIPTION: ${customerEmail}`);
                
                // Send email notification to admin
                await sendOnboardingNotification({
                    type: 'subscription',
                    customerEmail,
                    amount: subscription.items?.data?.[0]?.price?.unit_amount / 100,
                    planName: subscription.items?.data?.[0]?.price?.nickname || 'Subscription',
                    customerId: subscription.customer
                }, logger);
                
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                
                // Only notify for first-time payments (onboarding)
                // Check if this is the customer's first invoice
                const isFirstPayment = invoice.billing_reason === 'subscription_create' || 
                                       invoice.billing_reason === 'manual';
                
                if (isFirstPayment) {
                    logger.info(`🎉 NEW CUSTOMER PAYMENT: ${invoice.customer_email || invoice.id}`);
                    
                    await sendOnboardingNotification({
                        type: 'payment',
                        customerEmail: invoice.customer_email,
                        customerName: invoice.customer_name,
                        amount: invoice.amount_paid / 100,
                        description: invoice.lines?.data?.[0]?.description || 'Payment',
                        customerId: invoice.customer
                    }, logger);
                }
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
