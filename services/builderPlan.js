/**
 * The network builder plan (Guy, 14 Oct 2026).
 *
 * A private $30/month membership for the people Guy invites to build the network with him (the
 * inCruises builders - Alex Solti and David Gould first). Everything a full member gets, no set-up
 * fee, joined only through the unlisted /join/builder link.
 *
 * Two rules hang off it, both enforced where the money moves:
 *   - a builder never counts toward anyone's three paying referrals (services/referralRateService);
 *   - a builder never gets the $120 referral credit - $30 is already their rate.
 * And a lapsed builder's restart link reopens the $30 price, not the $150 one (routes/marketingRoutes).
 *
 * A subscription is a builder's when its metadata says plan=builder OR any of its prices carries the
 * builder lookup key - the price check covers a sub created or edited by hand in the dashboard.
 */
const BUILDER_LOOKUP = 'ikag_builder_30_monthly';
const BUILDER_PLAN = 'builder';

function isBuilderSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (sub.metadata && sub.metadata.plan === BUILDER_PLAN) return true;
  const items = (sub.items && sub.items.data) || [];
  return items.some((it) => it && it.price && it.price.lookup_key === BUILDER_LOOKUP);
}

module.exports = { BUILDER_LOOKUP, BUILDER_PLAN, isBuilderSubscription };
