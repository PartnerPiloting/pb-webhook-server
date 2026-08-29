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

/**
 * Plain admin alert email (Mailgun) - same plumbing as the onboarding
 * notification, different subject/body. Never throws.
 */
async function sendAdminAlert({ subject, text }, logger) {
    try {
        // Alerts fired from the staging test bench must never look real - Guy
        // took a signed staging drill for a genuine failed charge (26 Aug).
        if ((process.env.ENVIRONMENT || '').toLowerCase() === 'staging') {
            subject = `[TEST - staging drill, not a real charge] ${subject}`;
            text = `THIS IS A TEST from the staging server - no real payment event occurred.\n\n${text}`;
        }
        const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com';
        if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
            logger.warn(`Mailgun not configured - alert logged only: ${subject}`);
            return;
        }
        const fromEmail = process.env.FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`;
        await sendMailgunEmail({ from: fromEmail, to: adminEmail, subject, text });
        logger.info(`📧 Admin alert sent: ${subject}`);
    } catch (error) {
        logger.error('Failed to send admin alert:', error.message);
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
 * Helper: Find the authenticated client's Stripe customer.
 * Prefers the stored Stripe Customer ID (the durable join key, stage 2 of the
 * PMPro->Stripe cutover); falls back to email search for clients not yet mapped.
 */
async function findStripeCustomer(req, logger) {
    const storedId = req.client?.stripeCustomerId;
    if (storedId) {
        try {
            const customer = await stripe.customers.retrieve(storedId);
            if (customer && !customer.deleted) return customer;
            logger.warn(`Stored Stripe customer ${storedId} is deleted - falling back to email lookup`);
        } catch (e) {
            logger.warn(`Stored Stripe customer ${storedId} not retrievable (${e.message}) - falling back to email lookup`);
        }
    }
    const email = getClientEmail(req);
    if (!email) return null;
    const customers = await stripe.customers.list({ email, limit: 1 });
    return customers.data[0] || null;
}

/**
 * Helper: Does this invoice/charge belong to the authenticated client?
 * Match on the stored customer id first, else on email.
 */
function belongsToClient(req, { customerId, customerEmail }) {
    const storedId = req.client?.stripeCustomerId;
    if (storedId && customerId && customerId === storedId) return true;
    const email = getClientEmail(req);
    return !!(email && customerEmail && customerEmail.toLowerCase().trim() === email);
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

        const customer = await findStripeCustomer(req, logger);

        if (!customer) {
            logger.info(`No Stripe customer found for client ${req.client?.clientId}`);
            return res.json({
                success: true,
                invoices: [],
                message: 'No billing history found for this account.'
            });
        }

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
        const customer = await findStripeCustomer(req, logger);

        if (!customer) {
            logger.info(`No Stripe customer found for client ${req.client?.clientId}`);
            return res.status(404).json({
                success: false,
                error: 'Customer not found',
                message: 'No billing account found for this account.'
            });
        }

        logger.info(`Creating portal session for customer: ${customer.id}`);

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

        logger.info(`Fetching invoice: ${id}`);

        const invoice = await stripe.invoices.retrieve(id, {
            expand: ['customer', 'subscription', 'lines.data']
        });

        // The invoice ID alone doesn't prove ownership - confirm it actually
        // belongs to the calling client before returning it to them.
        const ownerOk = belongsToClient(req, {
            customerId: typeof invoice.customer === 'object' ? invoice.customer?.id : invoice.customer,
            customerEmail: invoice.customer_email || invoice.customer?.email
        });
        if (!ownerOk) {
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

        logger.info(`Generating PDF for: ${id}`);

        let pdfData;
        let filename;

        if (id.startsWith('in_')) {
            // It's a formal Stripe invoice
            const invoice = await stripe.invoices.retrieve(id, {
                expand: ['customer', 'lines.data']
            });

            const ownerOk = belongsToClient(req, {
                customerId: typeof invoice.customer === 'object' ? invoice.customer?.id : invoice.customer,
                customerEmail: invoice.customer_email || invoice.customer?.email
            });
            if (!ownerOk) {
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

            const ownerOk = belongsToClient(req, {
                customerId: charge.customer,
                customerEmail: customer.email || charge.billing_details?.email
            });
            if (!ownerOk) {
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
        const customer = await findStripeCustomer(req, logger);

        if (!customer) {
            return res.json({
                success: true,
                subscription: null,
                message: 'No subscription found'
            });
        }

        logger.info(`Fetching subscription for customer: ${customer.id}`);

        // Get the client's live subscription. Stripe caps expand at 4 levels, so
        // the price's product is fetched with its own retrieve below rather than
        // expanded here. 'trialing' counts as live: the legacy PMPro checkout
        // charges the joining fee up front and starts the monthly cycle a month
        // later as a trial (first seen with Paul Salvage, 25 Aug 2026). past_due
        // shows too - the card is in Stripe's retry window, not cancelled.
        const LIVE_STATUSES = ['active', 'trialing', 'past_due'];
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'all',
            limit: 10,
            expand: ['data.items.data.price']
        });
        const sub = subscriptions.data.find(s => LIVE_STATUSES.includes(s.status));

        if (!sub) {
            return res.json({
                success: true,
                subscription: null,
                message: 'No active subscription'
            });
        }
        const item = sub.items.data[0];

        let planName = 'Subscription';
        const productRef = item?.price?.product;
        if (typeof productRef === 'string') {
            try {
                const product = await stripe.products.retrieve(productRef);
                if (product?.name) planName = product.name;
            } catch (e) {
                logger.warn(`Could not retrieve product ${productRef}: ${e.message}`);
            }
        } else if (productRef?.name) {
            planName = productRef.name;
        }

        // Newer Stripe API versions carry the billing period on the item, older on
        // the subscription - accept either. A trialing sub's first real charge is
        // its trial end.
        const periodEnd = sub.current_period_end || item?.current_period_end || sub.trial_end || null;

        res.json({
            success: true,
            subscription: {
                id: sub.id,
                status: sub.status,
                planName,
                amount: item?.price?.unit_amount / 100,
                amountFormatted: `$${(item?.price?.unit_amount / 100).toFixed(2)}`,
                interval: item?.price?.recurring?.interval,
                currentPeriodEnd: periodEnd,
                nextBillingDate: periodEnd ? new Date(periodEnd * 1000).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                }) : null,
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
 * - checkout.session.completed (knowaguy join -> create Clients row)
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

        // Stage 2b: the entitlement watcher, in shadow mode. Subscription events
        // are judged (would-keep / would-pause) and recorded; nothing writes
        // Status until STRIPE_ENTITLEMENT_MODE=live after the proving window.
        const shadow = require('../services/stripeEntitlementShadow');

        switch (event.type) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                // deleted events sometimes arrive before the object shows 'canceled'
                const subStatus = event.type === 'customer.subscription.deleted'
                    ? 'canceled'
                    : subscription.status;
                if (event.type === 'customer.subscription.created') {
                    // The admin email for a new signup comes from
                    // invoice.payment_succeeded, which carries name/email/amount -
                    // this event has no customer details attached.
                    logger.info(`🎉 NEW SUBSCRIPTION: customer ${subscription.customer}`);
                }
                const client = await shadow.findClientForCustomer(subscription.customer, subscription.customer_email);
                await shadow.captureSubscriptionId(client, subscription.id);
                const verdict = await shadow.recordShadowDecision({
                    eventId: event.id,
                    eventType: event.type,
                    customerId: subscription.customer,
                    subscriptionId: subscription.id,
                    subscriptionStatus: subStatus,
                    client
                });
                await shadow.applyShadowDecision(client, verdict.wouldStatus, `stripe ${event.type}: ${subStatus}`);
                break;
            }

            case 'checkout.session.completed': {
                const session = event.data.object;
                if (((session.metadata && session.metadata.source) || '') !== 'knowaguy-join') {
                    logger.info('Checkout session completed (not a knowaguy join) - no action');
                    break;
                }
                // Stage 4: the full provisioning chain, run out-of-band on a
                // resumable ledger (services/joinProvisioningService).
                await require('../services/joinProvisioningService').enqueueFromSession(session, logger);
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;

                // Only notify for first-time payments (onboarding)
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

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                logger.warn(`⚠️ PAYMENT FAILED: ${invoice.customer_email || invoice.id}`);

                const client = await shadow.findClientForCustomer(invoice.customer, invoice.customer_email);
                await shadow.recordShadowDecision({
                    eventId: event.id,
                    eventType: event.type,
                    customerId: invoice.customer,
                    subscriptionId: typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id,
                    subscriptionStatus: null,
                    client
                });

                // The day-0 promise from the cutover brief: Guy hears about a
                // failed payment immediately. Stripe keeps retrying (the
                // three-week dunning window) - access is untouched here.
                const nextTry = invoice.next_payment_attempt
                    ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                    : 'no further retries scheduled';
                await sendAdminAlert({
                    subject: `⚠️ Payment failed: ${client?.clientName || invoice.customer_name || invoice.customer_email || invoice.customer}`,
                    text: [
                        `A payment just failed - Stripe is handling the retries; nothing for you to do yet.`,
                        ``,
                        `Client: ${client?.clientName || 'not matched to a client record'}`,
                        `Email: ${invoice.customer_email || 'unknown'}`,
                        `Amount: $${(invoice.amount_due / 100).toFixed(2)}`,
                        `Attempt: ${invoice.attempt_count || 1}`,
                        `Next retry: ${nextTry}`,
                        ``,
                        `If the card recovers, everything continues on its own. If Stripe gives up`,
                        `after its retry window, the subscription cancels and (once the entitlement`,
                        `watcher is live) their access switches off automatically.`
                    ].join('\n')
                }, logger);
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

/**
 * Join provisioning admin doors (stage 4). Same debug-key convention as
 * /api/onboard-client: x-debug-key header must match DEBUG_API_KEY (or
 * PB_WEBHOOK_SECRET). List the ledger, inspect one job, retry a failed one
 * from the step it stopped at.
 */
function requireDebugKey(req, res) {
    const key = req.headers['x-debug-key'] || req.query.debugKey;
    if (!key || key !== (process.env.DEBUG_API_KEY || process.env.PB_WEBHOOK_SECRET)) {
        res.status(401).json({ success: false, error: 'Admin authentication required. Provide debugKey.' });
        return false;
    }
    return true;
}

router.get('/api/join-provision/jobs', async (req, res) => {
    if (!requireDebugKey(req, res)) return;
    const provisioning = require('../services/joinProvisioningService');
    res.json({ jobs: await provisioning.listJobs(req.query.limit) });
});

router.get('/api/join-provision/jobs/:id', async (req, res) => {
    if (!requireDebugKey(req, res)) return;
    const provisioning = require('../services/joinProvisioningService');
    const job = await provisioning.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
});

router.post('/api/join-provision/jobs/:id/retry', async (req, res) => {
    if (!requireDebugKey(req, res)) return;
    const logger = createLogger({ runId: 'JOIN', clientId: 'SYSTEM', operation: 'join_provision_retry' });
    const provisioning = require('../services/joinProvisioningService');
    const job = await provisioning.runJob(req.params.id, logger);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: { id: job.id, state: job.state, current_step: job.current_step, error: job.error || null } });
});

module.exports = router;
