/**
 * Stripe Client Configuration
 * 
 * Initializes Stripe SDK for payment/invoice operations.
 * Used by billing routes to fetch invoices and subscription data.
 */

const { createLogger } = require('../utils/contextLogger');
const logger = createLogger({ runId: 'STRIPE', clientId: 'SYSTEM', operation: 'stripe_init' });

let stripe = null;

try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
        logger.warn('STRIPE_SECRET_KEY not set - billing features will be disabled');
    } else {
        stripe = require('stripe')(stripeSecretKey);
        logger.info('Stripe client initialized successfully');
    }
} catch (error) {
    logger.error('Failed to initialize Stripe client:', error.message);
}

/**
 * Check if Stripe is available
 * @returns {boolean}
 */
function isStripeAvailable() {
    return stripe !== null;
}

/**
 * Get the Stripe client instance
 * @returns {object|null}
 */
function getStripeClient() {
    return stripe;
}

module.exports = {
    stripe,
    isStripeAvailable,
    getStripeClient
};
