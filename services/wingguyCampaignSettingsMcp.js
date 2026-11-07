/**
 * wingguy_campaign_settings - see and change the message a Linked Helper campaign sends and the
 * hours it runs, from Claude, without opening the machine.
 *
 * WHY (Guy, 7 Nov 2026, on a call with Alex Solti tweaking his campaign message): "most of my
 * clients are going to get to a point where they want to look at that message and tweak it... it
 * prevents the clumsiness of copy and paste from one machine to another... and it stops the
 * campaign and starts it again at the end. It's very fiddly at the moment and difficult for people
 * to remember." Working hours came up straight after, same job.
 *
 * FLOW, always preview first:
 *   show            -> the machine's latest snapshot (lhCampaignSettingsStore), dated
 *   message / hours -> checked (lhCampaignSettings.js) and read back WITHOUT confirm: old vs new
 *   ... confirm:true -> queued; the machine pauses the campaign, changes it, reads it back, and
 *                       starts it again only if it was running (scripts/linked-helper/lh-settings.py)
 *   status          -> what happened to the latest change
 *
 * ONE DEFINITION, BOTH TRANSPORTS (same as wingguyTopUpMcp). Coach gate the same: no client named =
 * the caller's own machine; a coach may name one of their coached clients.
 */
const { z } = require('zod');
const rulesStore = require('./wingguyRulesStore');
const settings = require('./lhCampaignSettings');

const TENANT = (process.env.RECALL_COACH_CLIENT_ID || rulesStore.DEFAULT_TENANT).trim();

const STALE_HOURS = 48;

function whenWords(iso, tz = 'Australia/Brisbane') {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'an unknown time';
  return t.toLocaleString('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

async function bannedFor(clientId) {
  if (!(process.env.DATABASE_URL || '').trim()) return [];
  try {
    const rows = await rulesStore.getVariables({ tenantId: clientId });
    const row = (rows || []).find((r) => r && r.var_key === 'never_say_words');
    return require('../utils/bannedWords').parseBannedList(row ? row.value : '');
  } catch (_e) {
    return [];
  }
}

function changeWords(ch, own) {
  if (!ch) return own ? 'No change has been asked for yet.' : 'No change on record for them.';
  const r = ch.result || {};
  const head = `${ch.summary || `A ${ch.kind} change`} to "${ch.campaignName}" (asked ${whenWords(ch.createdAt)} Brisbane time):`;
  switch (ch.status) {
    case 'queued': return `${head} waiting for the Linked Helper machine to pick it up - it checks every few minutes, straight away if someone has the machine open. If it is still waiting after an hour, the machine may be off.`;
    case 'applying': return `${head} the machine is making the change now.`;
    case 'done': return `${head} done.${r.was_running ? ' The campaign was paused for the change and is running again.' : ' The campaign was already paused, so it has been left paused.'}`;
    case 'failed': return `${head} did NOT go through - ${r.error || 'no reason came back'}.${r.restarted === false ? ' ⚠ The campaign is paused - it needs starting again in Linked Helper.' : ''}`;
    case 'replaced': return `${head} replaced by a later change before the machine picked it up.`;
    default: return `${head} ${ch.status}.`;
  }
}

async function loadSnapshot(c) {
  const store = require('./lhCampaignSettingsStore');
  const got = await store.getSnapshot(c.clientId);
  if (!got) {
    return { error: c.machineLink
      ? "Your Linked Helper machine hasn't sent its campaign settings yet - it needs a small update first. Ask Guy."
      : "This only works for a Linked Helper machine Wingguy looks after. If Linked Helper runs on your own computer, change the message and hours there (open the campaign, click the step, edit, save) - nothing can reach it from here." };
  }
  const ageH = (Date.now() - new Date(got.reportedAt).getTime()) / 3600000;
  return { snap: got.snapshot, reportedAt: got.reportedAt, stale: ageH > STALE_HOURS };
}

async function runSettings(args = {}, tenant = TENANT) {
  const { resolveTarget } = require('./wingguyTopUpMcp');
  let target;
  try {
    target = await resolveTarget(args.client, tenant, 'change');
  } catch (e) {
    return { text: `Couldn't read the client directory: ${e.message}`, isError: true };
  }
  if (target.error) return { text: target.error, isError: true };
  const c = target.client;
  const who = target.own ? '' : `${c.clientName}: `;
  const store = require('./lhCampaignSettingsStore');
  const action = String(args.action || 'show').toLowerCase();

  if (action === 'status') {
    return { text: who + changeWords(await store.latestFor(c.clientId), target.own) };
  }

  const loaded = await loadSnapshot(c);
  if (loaded.error) return { text: who + loaded.error, isError: true };
  const { snap, reportedAt, stale } = loaded;
  const tzName = snap.tz || c.timezone || 'the machine\'s own time zone';
  const asOf = `As of ${whenWords(reportedAt)} Brisbane time. Times are ${tzName} time.`;
  const staleNote = stale ? `\n\n⚠ The machine hasn't reported in over ${STALE_HOURS} hours - it may be off, so this may be out of date and a change would wait until it is back.` : '';

  if (action === 'show') {
    const pick = args.campaign ? settings.pickCampaign(snap, args.campaign) : {};
    if (pick.error) return { text: who + pick.error, isError: true };
    const latest = await store.latestFor(c.clientId);
    const pending = latest && ['queued', 'applying'].includes(latest.status) ? `\n\nWaiting to go through: ${changeWords(latest, target.own)}` : '';
    return { text: `${who}${asOf}\n\n${settings.describeCampaigns(snap, { campaign: pick.campaign || null })}${pending}${staleNote}` };
  }

  if (!['message', 'hours', 'pace'].includes(action)) {
    return { text: 'action must be show, message, hours, pace or status.', isError: true };
  }
  const pick = settings.pickCampaign(snap, args.campaign);
  if (pick.error) return { text: who + pick.error, isError: true };
  if (pick.choose) {
    return { text: `${who}Which campaign? ${pick.choose.map((x) => `"${x.name}"${x.paused ? ' (paused)' : ''}`).join(', ')}. Say the name.` };
  }
  const camp = pick.campaign;
  const restartWords = camp.paused
    ? 'The campaign is paused right now, so it stays paused afterwards - say if you want it started.'
    : 'The machine pauses the campaign for the change and starts it again straight after.';

  let kind;
  let payload;
  let summary;
  let preview;
  if (action === 'message') {
    const sp = settings.pickMessageStep(camp, args.step);
    if (sp.error) return { text: who + sp.error, isError: true };
    if (sp.choose) {
      return { text: `${who}"${camp.name}" sends more than one message: ${sp.choose.map((s) => `the ${settings.stepWords(s.type)}`).join(' and ')}. Which one?` };
    }
    const step = sp.step;
    const checked = settings.checkMessage(args.message, step, await bannedFor(c.clientId));
    if (!checked.ok) return { text: `${who}Not changed - ${checked.problem}.`, isError: !checked.same };
    const before = settings.templateToText(step.template).variants[0] || '(blank)';
    kind = 'message';
    payload = { step_id: step.id, template: checked.template, expect_hash: step.template_hash };
    summary = `New ${settings.stepWords(step.type)}`;
    preview = [
      `${who}Here's the change to the ${settings.stepWords(step.type)} in "${camp.name}":`,
      `NOW:\n${before}`,
      `NEW:\n${checked.text}`,
      ...checked.warnings,
      step.type === 'InvitePerson' ? 'Only people invited from now on get the new note - invitations already sent keep the old one.' : 'People who already got this message keep the old one; it applies to whoever the campaign reaches next.',
      restartWords,
    ];
  } else if (action === 'pace') {
    const p = settings.paceOf(camp);
    if (!p) return { text: `${who}"${camp.name}" doesn't send invitations, so there's no pace to set.`, isError: true };
    const othersWeek = (snap.campaigns || []).filter((x) => x.id !== camp.id && !x.paused)
      .map(settings.paceOf).filter((x) => x && x.week !== null).reduce((a, x) => a + x.week, 0);
    const plan = settings.planPace(args.per_week, p.step.hours, othersWeek);
    if (!plan.ok) return { text: `${who}Not changed - ${plan.problem}.`, isError: true };
    if (plan.batch === p.batch && plan.waitMin === p.waitMin) return { text: `${who}That's what it's set to already.` };
    kind = 'pace';
    payload = { step_id: p.step.id, batch: plan.batch, wait_ms: plan.waitMin * 60000 };
    summary = `About ${plan.week} invitations a week`;
    const nowLine = p.week === null ? 'no limit set - as many as LinkedIn allows' : `about ${settings.aDay(p)} a day, about ${p.week} a week`;
    preview = [
      `${who}Here's the change to how many "${camp.name}" sends:`,
      `NOW: ${nowLine}`,
      `NEW: about ${settings.aDay(plan)} a day, about ${plan.week} a week (${settings.hoursWords(p.step.hours)})`,
      othersWeek ? `With your other running campaigns that makes about ${othersWeek + plan.week} a week in total - LinkedIn allows about ${settings.WEEKLY_LIMIT}.` : null,
      `Behind the scenes that's ${plan.batch} at a time with ${settings.waitWords(plan.waitMin)} between - you don't need to remember that.`,
      restartWords,
    ].filter(Boolean);
  } else {
    const h = settings.checkHours(args.hours);
    if (!h.ok) return { text: `${who}Not changed - ${h.problem}.`, isError: true };
    const steps = camp.steps || [];
    const nowWords = !steps.length ? 'none' : settings.sameHours(steps)
      ? settings.hoursWords(steps[0].hours)
      : steps.map((s) => `${settings.stepWords(s.type)} ${settings.hoursWords(s.hours)}`).join('; ');
    kind = 'hours';
    payload = { hours: h.spec, step_ids: steps.map((s) => s.id) };
    summary = `Working hours to ${h.words}`;
    preview = [
      `${who}Here's the change to the working hours of "${camp.name}" (${tzName} time):`,
      `NOW: ${nowWords}`,
      `NEW: ${h.words}`,
      `It applies to every step in the campaign (${steps.length}), so they all keep in step.`,
      /Sydney|Melbourne|Hobart|Canberra|Adelaide|Currie|Broken_Hill|Auckland/i.test(String(snap.tz || c.timezone || ''))
        ? 'One thing to know: Linked Helper keeps hours on a fixed clock, so when daylight saving starts or ends they shift by an hour - ask me to set them again then.' : null,
      restartWords,
    ].filter(Boolean);
  }

  if (args.confirm !== true) {
    preview.push('Nothing has changed yet. Say yes and I\'ll send it to the machine.');
    return { text: [...preview, staleNote.trim()].filter(Boolean).join('\n\n') };
  }
  try {
    await store.request({ clientId: c.clientId, kind, campaignId: camp.id, campaignName: camp.name, payload, summary, requestedBy: tenant });
  } catch (e) {
    return { text: `Couldn't queue the change: ${e.message}`, isError: true };
  }
  return { text: `${who}Sent. ${summary} for "${camp.name}" is with the Linked Helper machine - it picks it up within about five minutes, then pauses the campaign, makes the change, checks it took, and ${camp.paused ? 'leaves the campaign paused as it was' : 'starts the campaign again'}. Ask me "did my change go through?" in a few minutes to check. If it doesn't go through, you'll get an email saying why.${staleNote}` };
}

/** Email the client (cc the coach) when a change did not go through. Called by the machine route. */
async function emailFailure(clientId, row, deps = {}) {
  const clientService = deps.clientService || require('./clientService');
  const client = await clientService.getClientById(clientId).catch(() => null);
  if (!client) return false;
  const coach = client.coach ? await Promise.resolve(clientService.getClientById(client.coach)).catch(() => null) : null;
  const coachName = (coach && coach.clientName) || 'Guy Wilson';
  const coachEmail = String((coach && coach.clientEmailAddress) || process.env.ALERT_EMAIL || 'guyralphwilson@gmail.com').trim();
  const to = String(client.clientEmailAddress || '').trim() || coachEmail;
  const first = String(client.clientFirstName || String(client.clientName || '').split(/\s+/)[0] || 'there');
  const r = row.result || {};
  const { signoffName } = require('./lhSignoutWatch');
  const lines = [
    `Hi ${first},`,
    `The change you asked for in Claude - ${String(row.summary || 'a campaign change').toLowerCase()} for "${row.campaignName}" - did not go through: ${r.error || 'no reason came back from the machine'}.`,
    r.restarted === false ? 'Important: the campaign is paused at the moment and needs starting again - reply to this email and I\'ll sort it.' : 'Nothing else on the campaign was touched.',
    r.stale ? 'Ask your Claude to "show me my campaign message" again, then make the change.' : 'Reply to this email and I\'ll take a look.',
    `Cheers,\n${signoffName(coachName)}`,
  ];
  const addr = require('./mailgunCreds').fromEmail();
  const send = deps.sendMailgunEmail || require('./emailNotificationService').sendMailgunEmail;
  await send({
    from: addr.includes('<') ? addr : `${coachName} <${addr}>`,
    to, ...(to !== coachEmail ? { cc: coachEmail } : {}), 'h:Reply-To': coachEmail,
    subject: 'Your campaign change didn\'t go through', text: lines.join('\n\n'),
    html: lines.map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('\n'),
  });
  return true;
}

const DESCRIPTION =
  "See and change what a Linked Helper campaign does - the MESSAGE it sends (the invitation note, or the message after someone accepts), the DAYS AND TIMES it runs, and HOW MANY invitations a week it sends - without opening the Linked Helper machine. The door for \"show me my campaign settings\", \"show me my campaign message\", \"what does my invite say?\", \"change my message\", \"tweak my connection note\", \"what are my working hours?\", \"change my hours to 8 till 6\", \"run on Saturdays too\", \"how many am I sending?\", \"slow it down\", \"send 50 a week\", \"did my change go through?\". " +
  "action: 'show' (default) = every campaign's days, times, how many a day and a week, and its message, from the machine's latest report, with a one-line total against LinkedIn's limit of about 100 a week - show it as it reads, then ask if they'd like to change any of it; 'message' = a new message for one step (pass the WHOLE new message as message, with names written {firstName} exactly as shown); 'hours' = new days and times (hours = a list of {days, from, to} in the person's own local time, 24-hour clock: days is 'weekdays', 'weekends', 'all' or a list like ['mon','tue']); 'pace' = how many a week (per_week, a number up to 100 - Wingguy works out the bunch size and wait itself, never ask them for those); 'status' = what happened to the latest change. " +
  "ALWAYS PREVIEW FIRST: call 'message' or 'hours' WITHOUT confirm, show the person the NOW / NEW it returns, and only after they say yes call again with exactly the same arguments plus confirm:true. Never pass confirm:true on the first call or on your own judgement. " +
  "Help them write the message if they ask - keep their voice, keep {firstName}. The tool refuses a message that is too long for LinkedIn, uses a name placeholder Linked Helper won't fill, or uses one of their banned words - pass the reason on and offer a fix. The machine pauses the campaign, changes it, checks it took, and starts it again only if it was running. " +
  "Only works for a machine Wingguy looks after; someone running Linked Helper on their own computer is told so. No client named = the caller's own campaigns; a coach can name one of their own clients. Never tell anyone to open the machine to do this, never go to Airtable.";

const TOOL_DEFS = [
  {
    name: 'wingguy_campaign_settings',
    description: DESCRIPTION,
    zodSchema: {
      action: z.enum(['show', 'message', 'hours', 'pace', 'status']).optional().describe("show (default), message, hours, pace or status."),
      per_week: z.number().optional().describe('pace only: how many invitations a week they want, up to 100.'),
      campaign: z.string().optional().describe('The campaign name, when they have more than one.'),
      step: z.string().optional().describe("message only, when the campaign sends two: 'invitation' or 'after they accept'."),
      message: z.string().optional().describe('message only: the WHOLE new message, names as {firstName}.'),
      hours: z.array(z.object({
        days: z.union([z.string(), z.array(z.string())]).describe("'weekdays', 'weekends', 'all', or a list like ['mon','sat']"),
        from: z.string().describe('start, 24-hour HH:MM local time'),
        to: z.string().describe('end, 24-hour HH:MM local time'),
      })).optional().describe('hours only: the new working hours, one entry per set of days.'),
      confirm: z.boolean().optional().describe('true ONLY after the person has seen the preview and said yes.'),
      client: z.string().optional().describe("Coaches only: which of your clients. Leave out for your own."),
    },
    jsonSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'message', 'hours', 'pace', 'status'], description: 'show (default), message, hours, pace or status.' },
        per_week: { type: 'number', description: 'pace only: how many invitations a week they want, up to 100.' },
        campaign: { type: 'string', description: 'The campaign name, when they have more than one.' },
        step: { type: 'string', description: "message only, when the campaign sends two: 'invitation' or 'after they accept'." },
        message: { type: 'string', description: 'message only: the WHOLE new message, names as {firstName}.' },
        hours: {
          type: 'array',
          description: 'hours only: the new working hours, one entry per set of days.',
          items: {
            type: 'object',
            properties: {
              days: { description: "'weekdays', 'weekends', 'all', or a list like ['mon','sat']", anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              from: { type: 'string', description: 'start, 24-hour HH:MM local time' },
              to: { type: 'string', description: 'end, 24-hour HH:MM local time' },
            },
            required: ['days', 'from', 'to'],
          },
        },
        confirm: { type: 'boolean', description: 'true ONLY after the person has seen the preview and said yes.' },
        client: { type: 'string', description: "Coaches only: which of your clients. Leave out for your own." },
      },
    },
    run: runSettings,
  },
];

function registerWingguyCampaignSettingsTools(server, tenant = TENANT) {
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { title: def.name.replace(/_/g, ' '), description: def.description, inputSchema: def.zodSchema },
      async (args) => {
        try {
          const out = await def.run(args || {}, tenant);
          return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
        }
      },
    );
  }
}

function legacyToolList() {
  return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.jsonSchema }));
}

async function legacyToolCall(toolName, args, tenant = TENANT) {
  const def = TOOL_DEFS.find((d) => d.name === toolName);
  if (!def) return null;
  try {
    const out = await def.run(args || {}, tenant);
    return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

require('../utils/clientPhrases').applyClientPhrases(TOOL_DEFS);

module.exports = { registerWingguyCampaignSettingsTools, legacyToolList, legacyToolCall, TOOL_DEFS, runSettings, emailFailure, changeWords };
