/**
 * Topping up a campaign - the server end. Takes a search link from a client (chat tool or the
 * top-up page), checks it, picks their campaign, queues the job for their machine, and when the
 * machine reports the collect finished, emails them what happened.
 *
 * WHY (Guy, 5 Nov 2026): the whole point of the Monday numbers was that a client who sees the
 * queue running down tops up before it runs dry. They didn't, because topping up meant
 * remembering clicks inside Linked Helper. Now it means pasting a link. The machine side is
 * scripts/linked-helper/lh-topup.py (Linked Helper's own auto-collect step, proven 5 Nov 2026).
 *
 * WHAT IS CHECKED HERE, honestly: that the link is a people search (LinkedIn or Sales Navigator)
 * or a Sales Navigator lead list, and - where the link carries the filter - that it does not
 * include 1st-degree connections (the campaign invites; you cannot invite someone you already
 * know, so they would sit in the queue forever). What CANNOT be checked from a link: whether the
 * people look right, how many there are, who is already in the list. Those are said every time.
 *
 * WHICH CAMPAIGN: one connect campaign per client is the method (project_lh_campaign_automation_
 * discovery), so the live, unpaused campaign with people flowing is the answer. Several live -> ask.
 * None known -> the machine has never reported, or runs no campaign - say so, point at Guy.
 *
 * WHO CAN: a client for their own machine; a coach for one of their coached clients. Clients on
 * their own computer (no machine) get the how-to instead - nothing can reach their Linked Helper.
 */

const { createSafeLogger } = require('../utils/loggerHelper');
const { checkSearchUrl, degreeObjection, degreeNote } = require('../utils/linkedinSearchUrl');
const store = require('./lhTopUpStore');

const log = createSafeLogger('SYSTEM', null, 'lh_topup');

const HOW_TO_URL = 'https://knowaguy.com.au/how-campaigns-work';
const PICK_URL = 'https://knowaguy.com.au/pick-your-people';

/** Pick the campaign a top-up goes into. Returns { campaign } or { error } or { choose: [...] }. */
async function pickCampaign(clientId, named = '') {
  const list = require('./lhCampaignList');
  let res;
  try {
    res = await list.listCampaigns(clientId);
  } catch (e) {
    return { error: `Couldn't read the campaign list: ${e.message}` };
  }
  const live = (res.campaigns || []).filter((c) => c.live && c.id > 0);
  if (!live.length) {
    return { error: res.source === 'none'
      ? 'No campaign has come through from a Linked Helper machine for this client - either Linked Helper runs on their own computer (nothing can reach it from here; the how-to page is the answer), or the machine has never reported. Ask Guy.'
      : 'No live campaign is known for this client yet. Ask Guy.' };
  }
  const q = String(named || '').trim().toLowerCase();
  if (q) {
    const hit = live.find((c) => String(c.id) === q) || live.find((c) => (c.name || '').toLowerCase() === q)
      || live.filter((c) => (c.name || '').toLowerCase().includes(q));
    const arr = Array.isArray(hit) ? hit : (hit ? [hit] : []);
    if (arr.length === 1) return { campaign: arr[0] };
    if (arr.length > 1) return { choose: arr };
    return { error: `No campaign called "${named}". Their campaigns: ${live.map((c) => `${c.name || `Campaign ${c.id}`} (${c.id})`).join(', ')}.` };
  }
  const running = live.filter((c) => !c.paused);
  if (running.length === 1) return { campaign: running[0] };
  if (!running.length && live.length === 1) return { campaign: live[0] };
  return { choose: running.length ? running : live };
}

/**
 * Queue a top-up. Returns { ok, text } for a person, or { ok:false, text } with the reason.
 * `requestedBy` is who asked (client id of the caller, or 'top-up page').
 */
async function requestTopUp({ client, url, campaign: named = '', requestedBy = null }) {
  if (!client || !client.clientId) return { ok: false, text: 'No client.' };
  const check = checkSearchUrl(url);
  if (!check.ok) {
    return { ok: false, text: `That link won't work as a top-up - ${check.problem}. A top-up needs the address of a LinkedIn people search, a Sales Navigator people search, or a Sales Navigator lead list, copied from the address bar. How to build one: ${PICK_URL}` };
  }
  const objection = degreeObjection(check);
  if (objection) return { ok: false, text: objection };

  const pick = await pickCampaign(client.clientId, named);
  if (pick.error) return { ok: false, text: pick.error };
  if (pick.choose) {
    const names = pick.choose.map((c) => `"${c.name || `Campaign ${c.id}`}"${c.paused ? ' (paused)' : ''}`).join(', ');
    return { ok: false, text: `Which campaign should this go into? ${names}. Say the name and I'll queue it.`, choose: pick.choose };
  }
  const campaign = pick.campaign;
  let job;
  try {
    job = await store.request({
      clientId: client.clientId, campaignId: campaign.id, campaignName: campaign.name || `Campaign ${campaign.id}`,
      url: check.url, urlKind: check.kind, degrees: check.degrees, requestedBy,
    });
  } catch (e) {
    return { ok: false, text: `Couldn't queue the top-up: ${e.message}` };
  }
  const note = degreeNote(check);
  const lines = [
    `Queued. Your Linked Helper machine picks it up within about five minutes and puts the search into "${campaign.name || `Campaign ${campaign.id}`}"${campaign.paused ? ', and starts the campaign (it is paused right now)' : ''}.`,
    'Your other campaigns pause while it collects and start again by themselves, so you usually have the answer within half an hour - a very big search takes longer, and pauses overnight if it is huge. You get an email when it has finished, with how many people it added. If the number is not what you expected, change the search and send the new link straight away.',
    'Anyone from this search who was already in your list is skipped, so the number collected will be less than the search shows.',
  ];
  if (note) lines.push(note);
  return { ok: true, text: lines.join('\n\n'), jobId: job.jobId, campaign };
}

/** Words for "what happened to my top-up?" from the latest job on record. */
function describeJob(j, { own = true } = {}) {
  if (!j) return own ? 'No top-up has been asked for yet.' : 'No top-up on record for them.';
  const d = j.detail || {};
  const camp = j.campaignName || `Campaign ${j.campaignId}`;
  const when = new Date(j.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const head = `Top-up asked for ${when} (Brisbane) into "${camp}":`;
  switch (j.status) {
    case 'queued': return `${head} waiting for the Linked Helper machine to collect it (it checks in every few minutes - if this is still waiting after an hour, the machine may be off).`;
    case 'applying': return `${head} the machine has it and is putting the search into the campaign.`;
    case 'collecting': return `${head} Linked Helper is reading the search now - ${d.collected ?? 0} people added so far${d.last_collect_at ? `, the latest ${d.minutes_since_last ?? '?'} minutes ago` : ''}. You'll get an email when it finishes.`;
    case 'done': return `${head} finished - ${d.collected ?? 0} people added to the campaign${d.waiting_now !== null && d.waiting_now !== undefined ? `, ${d.waiting_now} now waiting to be invited` : ''}.${d.finished_because ? ` (${d.finished_because})` : ''}`;
    case 'failed': return `${head} did not work - ${d.error || 'no reason given'}.`;
    case 'replaced': return `${head} replaced by a later top-up.`;
    default: return `${head} ${j.status}.`;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function degreesLine(degrees = {}) {
  const first = Number(degrees.DISTANCE_1 || 0);
  if (!first) return null;
  return `${first} of them are already 1st-degree connections, so Linked Helper will skip those at the invite step.`;
}

/** The email a client gets when their top-up finishes (or fails). Returns { subject, text, html }. */
function finishedEmail({ firstName, job, coachName, machineLink }) {
  const d = job.detail || {};
  const camp = job.campaignName || `Campaign ${job.campaignId}`;
  const first = String(firstName || '').trim() || 'there';
  let body;
  if (job.status === 'done') {
    const collected = Number(d.collected || 0);
    const waiting = d.waiting_now;
    body = [
      `Your top-up has finished. Linked Helper added ${collected} ${collected === 1 ? 'person' : 'people'} from your search to "${camp}"${waiting !== null && waiting !== undefined ? `, so ${waiting} ${waiting === 1 ? 'person is' : 'people are'} now waiting to be invited` : ''}.`,
      collected ? 'The number added is usually less than the search shows - anyone from the search who was already in your list is skipped, and that is normal.' : 'Nobody new was added. Most often that means everyone in the search was already in your list - a fresh search with different filters will find new people.',
      degreesLine(d.degrees),
      d.finished_because && /credit|limit|day/i.test(d.finished_because) ? 'Linked Helper reads about 95 pages of a search a day to stay inside LinkedIn\'s limits, so a very large search carries on tomorrow by itself.' : null,
      'Want different people next time? Change the search on LinkedIn - 2nd and 3rd degree only - and send the new link.',
    ].filter(Boolean);
  } else {
    body = [
      `Your top-up into "${camp}" did not go through - ${d.error || 'no reason came back from the machine'}.`,
      'Reply to this email and I\'ll sort it out, or send a fresh search link and try again.',
    ];
  }
  const { signoffName } = require('./lhSignoutWatch');
  const signed = signoffName(coachName);
  const text = [
    `Hi ${first},`, ...body,
    machineLink ? `To look at the campaign: ${machineLink}` : 'To look at the campaign, ask your Claude to "open my Linked Helper machine".',
    `Cheers,\n${signed}`,
  ].join('\n\n');
  const html = [
    `<p>Hi ${esc(first)},</p>`, ...body.map((p) => `<p>${esc(p)}</p>`),
    machineLink ? `<p><a href="${esc(machineLink)}">Open your Linked Helper machine</a></p>` : '<p>To look at the campaign, ask your Claude to "open my Linked Helper machine".</p>',
    `<p>Cheers,<br>${esc(signed)}</p>`,
  ].join('\n');
  return { subject: job.status === 'done' ? `Your campaign top-up - ${Number(d.collected || 0)} added to ${camp}` : `Your campaign top-up didn't go through`, text, html };
}

/**
 * Called by the machine route after every report. When a job has just finished and nobody has
 * been told, email the client (coach cc, reply-to the coach) and record the comm.
 */
async function afterMachineReport(clientId, row, deps = {}) {
  if (!row || !['done', 'failed'].includes(row.status) || row.notifiedAt) return false;
  const clientService = deps.clientService || require('./clientService');
  let client;
  try { client = await clientService.getClientById(clientId); } catch (_e) { client = null; }
  if (!client) return false;
  const to = String(client.clientEmailAddress || '').trim();
  const coach = client.coach ? await Promise.resolve(clientService.getClientById(client.coach)).catch(() => null) : null;
  const coachName = (coach && coach.clientName) || 'Guy Wilson';
  const coachEmail = String((coach && coach.clientEmailAddress) || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim();
  const mail = finishedEmail({ firstName: client.clientFirstName || String(client.clientName || '').split(/\s+/)[0], job: row, coachName, machineLink: client.machineLink });
  try {
    const addr = require('./mailgunCreds').fromEmail();
    const send = deps.sendMailgunEmail || require('./emailNotificationService').sendMailgunEmail;
    // The coach's own row has no coach: the email goes to them alone.
    const recipient = to || coachEmail;
    await send({
      from: addr.includes('<') ? addr : `${coachName} <${addr}>`,
      to: recipient, ...(to && coachEmail !== to ? { cc: coachEmail } : {}), 'h:Reply-To': coachEmail,
      subject: mail.subject, text: mail.text, html: mail.html,
    });
    await store.markNotified(row.jobId);
    const record = deps.recordComm || require('./commsLog').recordComm;
    await Promise.resolve(record({
      coachClientId: clientId, channel: 'lh-topup', recipient, subject: mail.subject,
      summary: `Campaign top-up ${row.status} - ${row.detail && row.detail.collected !== null ? `${row.detail.collected} collected` : 'no count'}`,
      meta: { jobId: row.jobId, campaignId: row.campaignId, detail: row.detail },
    })).catch((e) => log.error(`lh-topup comms log for ${clientId} failed: ${e.message}`));
    log.info(`LH-TOPUP ${clientId} told about ${row.jobId} (${row.status})`);
    return true;
  } catch (e) {
    log.error(`LH-TOPUP email for ${clientId} failed: ${e.message}`);
    return false;
  }
}

module.exports = { requestTopUp, pickCampaign, describeJob, finishedEmail, afterMachineReport, HOW_TO_URL, PICK_URL };
