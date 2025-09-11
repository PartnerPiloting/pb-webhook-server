// Linked Helper Manual Integration Configuration (MVP Quick Win)
module.exports = {
  // Seed pages (fill these with real manual URLs before running crawler)
  seedUrls: [
    // 'https://linkedhelper.example.com/docs/launcher-pad-vs-instance',
    // 'https://linkedhelper.example.com/docs/inbox-management',
    // 'https://linkedhelper.example.com/docs/rate-limits'
  ],
  // Stay within this host (simple guard)
  allowedHostPattern: /linkedhelper/,
  // Maximum pages to crawl in one run (safety cap)
  maxPages: 400,
  // Concurrency level (polite)
  concurrency: 4,
  // Delay between fetch dispatches in ms (approx)
  paceMs: 120,
  // User agent string
  userAgent: 'PB-Webhook-Helpbot/0.1 (+https://partnerpiloting.com)'
};
