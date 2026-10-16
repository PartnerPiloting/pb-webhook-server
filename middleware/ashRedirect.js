// middleware/ashRedirect.js
//
// Retiring Australian Side Hustles: the old WordPress site (twice hacked, suspended by SiteGround)
// goes, and australiansidehustles.com.au points at this server instead. Every web request on that
// host gets a permanent redirect to the matching I Know A Guy page, so old links, bookmarks and
// search results land somewhere real.
//
// Only the WEBSITE moves. Email on the domain (track@mail..., alerts@, noreply@, Google Workspace)
// runs on DNS records this code never sees - it is untouched.

const ASH_HOSTS = new Set(['australiansidehustles.com.au', 'www.australiansidehustles.com.au']);
const KNOWAGUY = 'https://knowaguy.com.au';

// Old WordPress paths worth a better landing than the homepage. First match wins; the
// trailing-slash and sub-path variants WordPress produced all count.
const PATH_MAP = [
  [/^\/(renew-membership|portal-benefits|benefits-page[^/]*|membership[^/]*|join|checkout|pricing)(\/|$)/i, '/join'],
  [/^\/(contact[^/]*|about[^/]*)(\/|$)/i, '/guy'],
  [/^\/privacy[^/]*(\/|$)/i, '/privacy'],
  [/^\/terms[^/]*(\/|$)/i, '/terms'],
];

function knowaguyPathFor(path) {
  for (const [re, target] of PATH_MAP) {
    if (re.test(path)) return target;
  }
  return '/';
}

function ashRedirect(req, res, next) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!ASH_HOSTS.has(host)) return next();
  return res.redirect(301, KNOWAGUY + knowaguyPathFor(req.path || '/'));
}

module.exports = { ashRedirect, knowaguyPathFor, ASH_HOSTS };
