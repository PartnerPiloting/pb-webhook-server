/**
 * Campaign message + working hours - the words and the checks. Pure functions only; the store
 * (lhCampaignSettingsStore.js) and the chat tool (wingguyCampaignSettingsMcp.js) own the I/O.
 *
 * WHY (Guy, 7 Nov 2026, on a call with Alex Solti): every client gets to wanting to see the message
 * their campaign sends and tweak it, and to change the hours it runs. Inside Linked Helper that is
 * open the machine, pause, find each step, copy text across machines, start it again - fiddly, and
 * people forget the last step. Now they ask their Claude. The machine (scripts/linked-helper/
 * lh-settings.py) reports what is set and makes the change it is handed.
 *
 * THE TEMPLATE. Linked Helper keeps a message as a node tree:
 *   { type:'variants', variants:[ { type:'variant', child:{ type:'group', children:[
 *       {type:'text', value:'Hi '}, {type:'var', name:'firstName'}, {type:'text', value:', ...'} ] } } ] }
 * (read off Guy's campaign 32, scripts/linked-helper/campaigns/02-top-scorers.json). People see it
 * as "Hi {firstName}, ..." - the conversion both ways lives here and nowhere else.
 *
 * WHAT IS REFUSED rather than guessed: a step that rotates several versions of its message (A/B -
 * changing one would be a guess at which), a {placeholder} the message did not already use (a
 * typo like {firstname} would send the braces to a real person), an invitation note past
 * LinkedIn's 300 characters, and a banned word.
 */

const INVITE_NOTE_MAX = 300;   // LinkedIn cuts an invitation note here (paid accounts)
const INVITE_NOTE_FREE = 200;  // free accounts: notes are limited to 200 characters
const MESSAGE_MAX = 8000;      // LinkedIn's message limit
const NAME_ALLOWANCE = 12;     // what {firstName} etc. adds when counting, roughly

/** Steps that carry a message the client would recognise as "my message", in the words they use. */
const STEP_WORDS = {
  InvitePerson: 'invitation note',
  MessageToPerson: 'message after they accept',
  SendInMail: 'InMail',
  SendGroupMessage: 'group message',
};

function stepWords(type) {
  return STEP_WORDS[type] || String(type || 'step').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** The node tree -> { variants: ["Hi {firstName}, ..."], vars: ['firstName'] }. null when not a message. */
function templateToText(t) {
  if (!t || typeof t !== 'object') return null;
  const vars = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return '';
    if (n.type === 'text') return String(n.value || '');
    if (n.type === 'var') { vars.add(String(n.name || '')); return `{${n.name}}`; }
    if (n.type === 'group') return (n.children || []).map(walk).join('');
    if (n.type === 'variant') return walk(n.child);
    if (Array.isArray(n.children)) return n.children.map(walk).join('');
    if (n.child) return walk(n.child);
    return '';
  };
  const variants = t.type === 'variants' ? (t.variants || []).map(walk) : [walk(t)];
  return { variants, vars: [...vars].filter(Boolean) };
}

/** "Hi {firstName}, ..." -> the node tree, one variant. Every {name} becomes a var node. */
function textToTemplate(text) {
  const children = [];
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let last = 0;
  let m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) children.push({ type: 'text', value: s.slice(last, m.index) });
    children.push({ type: 'var', name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) children.push({ type: 'text', value: s.slice(last) });
  return { type: 'variants', variants: [{ type: 'variant', child: { type: 'group', children } }] };
}

/** Roughly how long it is once the names are filled in. */
function sentLength(text) {
  return String(text || '').replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, 'x'.repeat(NAME_ALLOWANCE)).length;
}

/** Tidy what came from chat: Windows line ends, trailing spaces, smart braces left alone. */
function cleanMessage(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Check a new message for one step. Returns { ok:true, text, template, warnings[] } or
 * { ok:false, problem }. `step` is the snapshot's step ({type, template}); `banned` is the
 * client's enforced list (utils/bannedWords).
 */
function checkMessage(newText, step, banned = []) {
  const text = cleanMessage(newText);
  if (!text) return { ok: false, problem: 'the new message is empty' };
  const now = templateToText(step && step.template);
  if (!now) return { ok: false, problem: 'that step has no message to change' };
  if (now.variants.length > 1) {
    return { ok: false, problem: `that step rotates ${now.variants.length} different versions of its message, so changing it from here would be a guess at which one - change it in Linked Helper, or ask Guy` };
  }
  const allowed = new Set([...now.vars, 'firstName']);
  const used = [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const unknown = used.filter((v) => !allowed.has(v));
  if (unknown.length) {
    const known = [...allowed].map((v) => `{${v}}`).join(', ');
    return { ok: false, problem: `{${unknown[0]}} isn't a name Linked Helper fills in for this message - it would go out with the braces showing. Use ${known} (exactly like that, capitals included)` };
  }
  if (/[{}]/.test(text.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''))) {
    return { ok: false, problem: 'there is a stray { or } in the message - it would go out as typed' };
  }
  const len = sentLength(text);
  const warnings = [];
  if (step.type === 'InvitePerson') {
    if (len > INVITE_NOTE_MAX) return { ok: false, problem: `an invitation note can be at most ${INVITE_NOTE_MAX} characters and this comes to about ${len} with the name filled in - LinkedIn would refuse it. Cut ${len - INVITE_NOTE_MAX + 5} or so` };
    if (len > INVITE_NOTE_FREE) warnings.push(`It is about ${len} characters with the name filled in. That's fine on a paid LinkedIn account, but a free account only allows ${INVITE_NOTE_FREE}.`);
  } else if (len > MESSAGE_MAX) {
    return { ok: false, problem: `that is longer than LinkedIn allows in a message (${MESSAGE_MAX} characters)` };
  }
  const { findBannedWord } = require('../utils/bannedWords');
  const hit = banned.length ? findBannedWord(text, banned) : null;
  if (hit) return { ok: false, problem: `it uses "${hit.found}", which is on the list of words you never use - say it another way`, banned: hit };
  if (text === cleanMessage(now.variants[0])) return { ok: false, problem: 'that is the same as the message already there', same: true };
  return { ok: true, text, template: textToTemplate(text), warnings, length: len };
}

// ------------------------------------------------------------------------------------- hours

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_WORD = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 && Number(m[2]) < 60 ? v : null;
}

function clock(hhmm) {
  const v = toMin(hhmm);
  if (v === null) return hhmm;
  if (v >= 1439) return 'midnight';
  const h = Math.floor(v / 60);
  const m = v % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${ap}`;
}

function daysList(days) {
  if (days === 'all' || days === undefined || days === null) return [0, 1, 2, 3, 4, 5, 6];
  if (days === 'weekdays') return [1, 2, 3, 4, 5];
  if (days === 'weekends') return [0, 6];
  return (Array.isArray(days) ? days : [days]).map((d) => DAY.indexOf(String(d).slice(0, 3).toLowerCase())).filter((i) => i >= 0);
}

function daysWords(idx) {
  const s = [...new Set(idx)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
  const key = s.join(',');
  if (key === '1,2,3,4,5,6,0') return 'every day';
  if (key === '1,2,3,4,5') return 'Mon-Fri';
  if (key === '6,0') return 'weekends';
  // runs like Mon-Wed
  const order = s.map((d) => (d + 6) % 7);
  const runs = [];
  for (const o of order) {
    const r = runs[runs.length - 1];
    if (r && o === r[1] + 1) r[1] = o; else runs.push([o, o]);
  }
  const name = (o) => DAY_WORD[DAY[(o + 1) % 7]];
  return runs.map(([a, b]) => (a === b ? name(a) : b === a + 1 ? `${name(a)}, ${name(b)}` : `${name(a)}-${name(b)}`)).join(', ');
}

/** The machine's local-time hours ("always" | {days,windows} | [..]) -> one line of words. */
function hoursWords(spec) {
  if (spec === 'always') return 'every day, all day';
  if (!spec) return 'no hours set';
  const list = Array.isArray(spec) ? spec : [spec];
  const parts = list.map((one) => {
    const wins = (one.windows || []).map(([s, e]) => (toMin(s) === 0 && toMin(e) >= 1439 ? 'all day' : `${clock(s)}-${clock(e)}`));
    return `${daysWords(daysList(one.days))} ${wins.length ? wins.join(' and ') : 'never'}`;
  });
  const off = parts.length ? null : 'never';
  return off || parts.join('; ');
}

/**
 * Hours from chat -> the machine's spec, checked. Input: [{ days: 'weekdays'|'all'|'weekends'|
 * ['mon',...], from: '09:00', to: '17:00' }] in the client's own local time.
 */
function checkHours(input) {
  const list = Array.isArray(input) ? input : (input ? [input] : []);
  if (!list.length) return { ok: false, problem: 'no hours given - say which days and from what time to what time' };
  const out = [];
  for (const one of list) {
    const days = daysList(one.days);
    if (!days.length) return { ok: false, problem: `"${one.days}" isn't a day I recognise - use Mon, Tue... or weekdays / weekends / all` };
    const s = toMin(one.from);
    let e = toMin(one.to);
    if (s === null || e === null) return { ok: false, problem: 'times need to look like 09:00 or 17:30 (24-hour clock)' };
    if (e === 1440) e = 1439;
    if (e <= s) return { ok: false, problem: `${clock(one.from)} to ${clock(one.to)} ends before it starts - a window can't run past midnight; split it into two days` };
    const fmt = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
    out.push({ days: days.length === 7 ? 'all' : days.map((d) => DAY[d]), windows: [[fmt(s), fmt(e)]] });
  }
  return { ok: true, spec: out.length === 1 ? out[0] : out, words: hoursWords(out.length === 1 ? out[0] : out) };
}

// ---------------------------------------------------------------------------------- snapshot

/** Does the snapshot say this step's hours differ from the campaign's other steps? */
function sameHours(steps) {
  const keys = new Set(steps.map((s) => JSON.stringify(s.hours || null)));
  return keys.size <= 1;
}

/**
 * The snapshot -> what the client is shown. `campaigns` = [{id,name,paused,steps:[{id,type,template,hours}]}].
 * Returns text. `when` is the snapshot date.
 */
function describeCampaigns(snapshot, { campaign = null } = {}) {
  const camps = (snapshot.campaigns || []).filter((c) => !campaign || c.id === campaign.id);
  if (!camps.length) return 'No campaigns on the machine.';
  const blocks = camps.map((c) => {
    const lines = [`"${c.name}"${c.paused ? ' - PAUSED' : ' - running'}`];
    const msgSteps = (c.steps || []).filter((s) => s.template);
    if (!msgSteps.length) lines.push('  Message: this campaign sends no message (it only visits or collects).');
    for (const s of msgSteps) {
      const t = templateToText(s.template);
      if (t.variants.length > 1) {
        lines.push(`  ${cap(stepWords(s.type))} (rotates ${t.variants.length} versions):`);
        t.variants.forEach((v, i) => lines.push(`    Version ${i + 1}:\n${indent(v || '(no note)', 6)}`));
      } else {
        lines.push(`  ${cap(stepWords(s.type))}:\n${indent(t.variants[0] || '(blank - invitations go out with no note)', 4)}`);
      }
    }
    const steps = c.steps || [];
    if (steps.length && sameHours(steps)) {
      lines.push(`  Working hours: ${hoursWords(steps[0].hours)}`);
    } else {
      lines.push('  Working hours (each step has its own):');
      for (const s of steps) lines.push(`    ${cap(stepWords(s.type))}: ${hoursWords(s.hours)}`);
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function indent(s, n) { return String(s).split('\n').map((l) => ' '.repeat(n) + l).join('\n'); }

/** Pick a campaign from the snapshot by name/id; one running one is the default. */
function pickCampaign(snapshot, named) {
  const camps = snapshot.campaigns || [];
  const q = String(named || '').trim().toLowerCase();
  if (q) {
    const exact = camps.filter((c) => String(c.id) === q || String(c.name || '').toLowerCase() === q);
    const hits = exact.length ? exact : camps.filter((c) => String(c.name || '').toLowerCase().includes(q));
    if (hits.length === 1) return { campaign: hits[0] };
    if (hits.length > 1) return { choose: hits };
    return { error: `No campaign called "${named}". The campaigns are: ${camps.map((c) => `"${c.name}"`).join(', ')}.` };
  }
  if (camps.length === 1) return { campaign: camps[0] };
  const withMsg = camps.filter((c) => !c.paused && (c.steps || []).some((s) => s.template));
  if (withMsg.length === 1) return { campaign: withMsg[0] };
  return { choose: camps };
}

/** Pick the message step: named type words, or the only one. */
function pickMessageStep(campaign, which) {
  const steps = (campaign.steps || []).filter((s) => s.template);
  if (!steps.length) return { error: `"${campaign.name}" sends no message - it only visits or collects.` };
  const q = String(which || '').trim().toLowerCase();
  if (q) {
    const hit = steps.filter((s) => String(s.id) === q || stepWords(s.type).includes(q)
      || (/invit|note|connect/.test(q) && s.type === 'InvitePerson') || (/accept|follow|after/.test(q) && s.type === 'MessageToPerson'));
    if (hit.length === 1) return { step: hit[0] };
  }
  if (steps.length === 1) return { step: steps[0] };
  return { choose: steps };
}

module.exports = {
  templateToText, textToTemplate, checkMessage, cleanMessage, sentLength,
  checkHours, hoursWords, describeCampaigns, pickCampaign, pickMessageStep, stepWords, sameHours,
  INVITE_NOTE_MAX, INVITE_NOTE_FREE,
};
