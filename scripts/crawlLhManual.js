#!/usr/bin/env node
const { crawl } = require('../lhManualCrawler');
crawl().then(r=>{ console.log('[lh:crawl] Done', r); }).catch(e=>{ console.error('[lh:crawl] Failed', e); process.exit(1); });
