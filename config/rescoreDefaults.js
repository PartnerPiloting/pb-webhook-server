// config/rescoreDefaults.js
// Re-score Leads is on for every client (Guy, 5 Oct 2026). Both new-client doors - the Stripe join
// (services/joinProvisioningService.js) and the onboarding door (routes/apiAndJobRoutes.js) - spread
// these in, so a new client starts with it like everyone else. Same allowance the 5 Oct roll-out
// gave (scripts/add-rescore-credit-fields.js): 1,500 leads, the +200/month accrual counting from
// the day they join. Missed until 7 Oct 2026, when Joshua Tunstall joined without it.

const RESCORE_STARTING_CREDITS = 1500;

function rescoreDefaults(now = new Date()) {
  return {
    'Rescore Enabled': 'Yes',
    'Rescore Credits Granted': RESCORE_STARTING_CREDITS,
    'Rescore Credits Consumed': 0,
    'Rescore Credits Start': now.toISOString().slice(0, 10),
  };
}

module.exports = { rescoreDefaults, RESCORE_STARTING_CREDITS };
