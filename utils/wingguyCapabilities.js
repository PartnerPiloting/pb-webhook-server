/**
 * Wingguy capabilities - turns content/wingguy-capabilities.json into the answer a client gets when
 * they ask "what can I do with Wingguy?" (wingguy_vision).
 *
 * Why generated: until 9 Nov 2026 that answer was hand-written prose inside the tool. It never
 * mentioned the Linked Helper machine, still said leads arrive by copy and paste, and was missing
 * most of what had been built since July - and nothing made it keep up. Now the words live in ONE
 * list, tests/wingguy-capabilities.test.js fails when a tool exists that the list does not know
 * about, and this module is the only thing that renders it.
 *
 *   load()                    - the parsed list (cached).
 *   renderVision(state, now)  - the full answer for one client. state is resolveState()'s shape
 *                               ({ name, hasMachine, hasMailbox, hasCalendar, hasFathom, rulesSeeded })
 *                               or null when the client record could not be read.
 *   allListedTools()          - { shown: Set, notShown: Set } - what the test compares to reality.
 *
 * Pure: no database, no network. Everything client-specific comes in through state.
 */

const fs = require('fs');
const path = require('path');

const LIST_PATH = path.join(__dirname, '..', 'content', 'wingguy-capabilities.json');

let cache = null;
function load() {
  if (!cache) cache = JSON.parse(fs.readFileSync(LIST_PATH, 'utf8'));
  return cache;
}

// What each "needs" means for one client, and the words used when they do not have it yet.
const NEEDS = {
  machine: { has: (s) => !!(s && s.hasMachine), waiting: 'once your machine is switched on' },
  mailbox: { has: (s) => !!(s && s.hasMailbox), waiting: 'once your mailbox is connected' },
  calendar: { has: (s) => !!(s && s.hasCalendar), waiting: 'once your calendar is connected' },
  notes: { has: (s) => !!(s && s.hasFathom), waiting: 'once your call note-taker is connected' },
};

function isNew(item, now, days) {
  if (!item.added) return false;
  const t = Date.parse(`${item.added}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const age = (now.getTime() - t) / 86400000;
  return age >= 0 && age <= days;
}

function allListedTools() {
  const list = load();
  const shown = new Set();
  for (const sec of list.sections) for (const it of sec.items) for (const t of it.tools || []) shown.add(t);
  return { shown, notShown: new Set(Object.keys(list.not_shown || {})) };
}

function renderVision(s, now = new Date()) {
  const list = load();
  const days = Number(list.new_for_days) || 30;
  const name = s && s.name ? s.name : '';
  const parts = [];

  parts.push(`**Welcome${name ? ', ' + name : ''} - here's what you've just switched on.**`);
  parts.push('');
  parts.push('Two things are working for you now: a machine that goes out on LinkedIn and finds the right people, and me, looking after every conversation that comes back. You run all of it from right here, just by saying what you want.');

  let newCount = 0;
  list.sections.forEach((sec, i) => {
    const secNeed = sec.needs && NEEDS[sec.needs];
    const secWaiting = secNeed && !secNeed.has(s);
    parts.push('');
    parts.push(`**${i + 1}. ${sec.title}**${secWaiting ? ` *(${secNeed.waiting})*` : ''}`);
    if (sec.lead) parts.push(sec.lead);
    for (const it of sec.items) {
      const need = it.needs && NEEDS[it.needs];
      const waiting = !secWaiting && need && !need.has(s);
      const fresh = isNew(it, now, days);
      if (fresh) newCount++;
      parts.push(`- ${fresh ? '**New** - ' : ''}**"${it.say}"** - ${it.does}${waiting ? ` *(${need.waiting})*` : ''}`);
    }
  });

  parts.push('');
  parts.push('**And inside LinkedIn itself:** the Wingguy Chrome extension does the drafting right on the profile you\'re looking at, and notices what you actually send so your follow-up list stays true. Say **"help me set up my extension"**.');
  parts.push('');
  parts.push('Guy runs his whole pipeline this way, and he reckons the more outreach you do, the more it hands back - at real volume, hours a day.');
  if (newCount) {
    parts.push('');
    parts.push(`*${newCount === 1 ? 'The line marked New has' : `The ${newCount} lines marked New have`} arrived in the last ${days} days. This list keeps itself up to date - ask again any time to see what's been added.*`);
  }

  // Where this client is up to - only what is true for them.
  const todo = [];
  if (!s || !s.hasMachine) todo.push('your **machine** - Guy sets it up with you, and from then on it runs by itself');
  if (!s || !s.hasMailbox) todo.push('your **mailbox** - so drafts land in your own Drafts folder');
  if (!s || !s.hasCalendar) todo.push('your **calendar** - so I can offer real times and book them');
  if (!s || !s.hasFathom) todo.push('a call **note-taker** - so follow-ups come from what was actually said');
  if (!s || !s.rulesSeeded) todo.push('your **instructions** - the good part: a short chat and everything I write starts sounding like you');
  parts.push('');
  if (!todo.length) {
    parts.push('**Where you\'re up to:** everything is connected - all of the above is live for you today.');
    parts.push('');
    parts.push('**Want to see it?** Say **"show me my follow-ups"** or **"show me my campaign numbers"**.');
  } else {
    parts.push('**Where you\'re up to:** you\'re connected, so we can start today. Still to switch on:');
    parts.push(todo.map((t) => `- ${t}`).join('\n'));
    parts.push('');
    parts.push('**Want to see it?** Say **"where are we up to?"** and I\'ll take you through the next step, or **"let\'s set up my instructions"** to start with the good part.');
  }

  return parts.join('\n');
}

module.exports = { load, renderVision, allListedTools, LIST_PATH, NEEDS };
