// services/seriesDrip.js
//
// The weekly send. One run: find who is due, build each person's next email,
// send it, record it.
//
// Ordering is deliberate — build, then send, then mark. If the send fails we
// have NOT advanced their count, so they simply come round again on the next
// run rather than silently skipping a piece. The failure mode is a late email,
// never a missing one.
//
// The reverse (mark then send) would lose a piece permanently on any transient
// Mailgun error, and nobody would ever know which one.

const { createLogger } = require('../utils/contextLogger');
const store = require('./siteEnquiryStore');
const mailer = require('./seriesMailer');
const { buildEmail, totalEmails } = require('./onePagerEmail');

const logger = createLogger({ runId: 'SYSTEM', clientId: 'SYSTEM', operation: 'series_drip' });

const AUDIENCE = 'prospect';           // everyone who signs up on the website
const CADENCE_DAYS = 7;
const DEFAULT_BATCH = 25;

function baseUrl() {
  return (process.env.SERIES_PUBLIC_BASE_URL || 'https://knowaguy.com.au').replace(/\/+$/, '');
}

function unsubscribeUrl(token) {
  return `${baseUrl()}/series/unsubscribe?t=${encodeURIComponent(token)}`;
}

/**
 * Run one pass of the drip.
 *
 * dryRun builds everything and reports exactly what would go out without
 * sending or recording — the only safe way to inspect a real run before it
 * reaches real people.
 */
async function runDrip({ dryRun = false, limit = DEFAULT_BATCH, cadenceDays = CADENCE_DAYS } = {}) {
  const started = new Date().toISOString();
  const total = totalEmails(AUDIENCE);

  if (!dryRun && !mailer.isConfigured()) {
    logger.error('[drip] MAILGUN_API_KEY not set — refusing to run');
    return { ok: false, error: 'mail not configured', sent: 0, failed: 0, results: [] };
  }

  const due = await store.dueSubscribers({ cadenceDays, maxEmails: total, limit });
  logger.info(`[drip] ${due.length} due (cadence ${cadenceDays}d, limit ${limit}${dryRun ? ', DRY RUN' : ''})`);

  const results = [];
  let sent = 0;
  let failed = 0;

  for (const person of due) {
    const position = person.sent_count + 1;
    let email;
    try {
      email = await buildEmail({
        audience: AUDIENCE,
        recipientName: person.name,
        sentCount: person.sent_count,
        unsubscribeUrl: unsubscribeUrl(person.unsub_token),
        baseUrl: baseUrl(),
      });
    } catch (err) {
      logger.error(`[drip] build failed for ${person.email} (#${position}): ${err.message}`);
      results.push({ email: person.email, position, status: 'build-failed', error: err.message });
      failed++;
      continue;
    }

    // Finished their run. Park them at the end so they stop being picked up.
    if (!email) {
      results.push({ email: person.email, position, status: 'run-complete' });
      if (!dryRun) await store.markSent(person.id, person.sent_count);
      continue;
    }

    const subject = `#${email.position} · ${email.subject}`;
    const preheader = `Network building, rethought · part ${email.position} of ${email.total}`;

    if (dryRun) {
      results.push({ email: person.email, position: email.position, slug: email.slug, subject, status: 'would-send' });
      continue;
    }

    const res = await mailer.sendSeriesEmail({
      to: person.email,
      subject,
      html: email.html,
      unsubscribeUrl: unsubscribeUrl(person.unsub_token),
      preheader,
      tag: `series-${AUDIENCE}-${email.position}`,
    });

    if (!res.ok) {
      failed++;
      results.push({ email: person.email, position: email.position, slug: email.slug, status: 'send-failed', error: res.error });
      continue; // count NOT advanced — they come round again next run
    }

    const marked = await store.markSent(person.id, person.sent_count);
    if (!marked) {
      // Someone else advanced them between our read and now. The email has gone,
      // so log loudly rather than pretend: this is the one case that could
      // double-send if two runs overlap.
      logger.warn(`[drip] sent to ${person.email} #${email.position} but count had already moved — check for overlapping runs`);
    }
    sent++;
    results.push({ email: person.email, position: email.position, slug: email.slug, subject, status: 'sent', id: res.id });
  }

  logger.info(`[drip] finished: ${sent} sent, ${failed} failed, ${due.length} considered`);
  return { ok: true, dryRun, startedAt: started, considered: due.length, sent, failed, results };
}

module.exports = { runDrip, AUDIENCE, CADENCE_DAYS };
