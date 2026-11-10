/**
 * The lines Wingguy writes itself - per-client wording (services/wingguyFixedLines.js).
 *
 * David Gould, 11 Nov 2026: he put four small fixes at the top of his writing instructions and
 * three never landed - "(All times are Brisbane time)", the comma in "which suits, and I'll send",
 * "including the Zoom link". In a LinkedIn draft that offers times, code writes those lines after
 * the model has finished, so no instruction reaches them. The wording is now the client's own
 * value; code still writes the line and fills in the facts.
 *
 * What this pins:
 *   1. the standard wording carries the grammar fixes, for everyone
 *   2. a wording that drops a gap it needs is refused; a bad stored value falls back to standard
 *   3. a client's own wording reaches the real draft, with the real city and email filled in
 *   4. the "times already offered" guards still fire on a REWORDED offer and on old-wording threads
 *   5. an instruction about one of these lines gets the heads-up, and an ordinary one does not
 *   6. the setup page and the variables tool refuse a broken line
 *
 * Run: node tests/wingguy-fixed-lines.test.js
 */
const assert = require('assert');
const { DateTime } = require('luxon');
const fl = require('../services/wingguyFixedLines');
const { runWingguyChatTurn, meetingRaisedInThread, unansweredTimesOffer, withInviteLine } = require('../services/wingguyChat');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failed++; console.log(`  ✗ ${label}: ${e.message}`); }
};

// David's wording, as rows from the variable store.
const DAVID = [
  { var_key: 'times_zone_line', value: '(All times are [city] time)' },
  { var_key: 'invite_line', value: "Let me know which suits, and I'll send a calendar invite including the Zoom link to [email]." },
];
// A client who rewrote every line - none of the standard phrases survive.
const REWORDED = [
  { var_key: 'times_question_line', value: 'Here are a few options that could suit:' },
  { var_key: 'times_zone_line', value: '(Shown on the [city] clock)' },
  { var_key: 'invite_line', value: "Pick one and I'll get a calendar invite across to [email]." },
  { var_key: 'invite_line_no_email', value: "Pick one and I'll get an invite across - which email is best?" },
];

console.log('\nstandard wording');
check('the grammar fixes are in the standard, for every client', () => {
  assert.strictEqual(fl.renderFixedLine('times_zone_line', null, { city: 'Brisbane' }), '(All times are Brisbane time)');
  assert.ok(fl.renderFixedLine('invite_line', null, { email: 'a@b.com' }).startsWith("Let me know which suits, and I'll send a calendar invite with the Zoom link to a@b.com"));
  assert.ok(fl.renderFixedLine('invite_line_no_email', null).startsWith("Let me know which suits, and I'll send"));
  assert.strictEqual(fl.renderFixedLine('times_question_line', null), 'Would any of the following times work for you?');
});
check('every standard line passes its own validation', () => {
  fl.FIXED_LINES.forEach((l) => assert.deepStrictEqual(fl.validateFixedLine(l.key, l.standard), { ok: true, value: l.standard }, l.key));
});
check('withInviteLine with no wording passed still works (older callers)', () => {
  assert.ok(/a@b\.com/.test(withInviteLine('', 'a@b.com')));
  assert.ok(/best email to send it to\?$/.test(withInviteLine('', '')));
});

console.log('\nvalidation - the facts stay');
check('blank is always fine (back to standard)', () => assert.deepStrictEqual(fl.validateFixedLine('invite_line', '   '), { ok: true, value: '' }));
check('the zone line must keep [city]', () => assert.ok(!fl.validateFixedLine('times_zone_line', '(All times are Brisbane time)').ok));
check('the invite line must keep [email]', () => assert.ok(!fl.validateFixedLine('invite_line', "Let me know which suits, and I'll send an invite.").ok));
check('the no-email line must still ask for the email', () => {
  assert.ok(!fl.validateFixedLine('invite_line_no_email', 'Let me know which suits.').ok);
  assert.ok(fl.validateFixedLine('invite_line_no_email', "Let me know which suits - what's your best email?").ok);
});
check('a gap Wingguy cannot fill is refused', () => assert.ok(!fl.validateFixedLine('times_zone_line', '([city] time, [name])').ok));
check('a gap used twice is refused', () => assert.ok(!fl.validateFixedLine('times_zone_line', '([city] time - yes, [city])').ok));
check('two lines, links, long dashes and curly gaps are refused', () => {
  assert.ok(!fl.validateFixedLine('times_question_line', 'Any of these?\nOr others?').ok);
  assert.ok(!fl.validateFixedLine('invite_line', 'Book at https://x.com or tell [email]').ok);
  assert.ok(!fl.validateFixedLine('times_zone_line', '(All times — [city])').ok);
  assert.ok(!fl.validateFixedLine('times_zone_line', '(All times are {{city}} time)').ok);
});
check('refusals read as plain English, not codes', () => {
  const e = fl.validateFixedLine('times_zone_line', 'All times are local').error;
  assert.ok(/\[city\]/.test(e) && e.length > 40 && !/undefined|null/.test(e), e);
});
check('an unknown key is refused', () => assert.ok(!fl.validateFixedLine('signoff', 'x').ok));

console.log('\nresolving - fail safe');
check("a client's valid wording wins, line by line", () => {
  const lines = fl.resolveFixedLines(DAVID);
  assert.strictEqual(lines.invite_line, DAVID[1].value);
  assert.strictEqual(lines.times_question_line, fl.STANDARD_LINES.times_question_line);
});
check('a broken stored value falls back to the standard, never into a draft', () => {
  const lines = fl.resolveFixedLines([{ var_key: 'times_zone_line', value: 'all times local' }, { var_key: 'invite_line', value: 'x\ny' }]);
  assert.deepStrictEqual(lines, fl.STANDARD_LINES);
});
check('nothing, null and a plain object all resolve', () => {
  assert.deepStrictEqual(fl.resolveFixedLines(null), fl.STANDARD_LINES);
  assert.deepStrictEqual(fl.resolveFixedLines([]), fl.STANDARD_LINES);
  assert.strictEqual(fl.resolveFixedLines({ times_zone_line: '([city] time)' }).times_zone_line, '([city] time)');
});

console.log('\nrecognising an offer - whatever the wording');
const own = fl.resolveFixedLines(REWORDED);
const rewordedOffer = { sender: 'Sam Coach', day: 'Nov 3', text: "Hi Jo -\n\nHere are a few options that could suit:\n\n- Tue 17 November, 10:00 am\n- Wed 18 November, 2:00 pm\n\n(Shown on the Perth clock)\n\nPick one and I'll get a calendar invite across to jo@x.com.\n\nSam" };
const flattened = { sender: 'Sam Coach', day: 'Nov 3', text: rewordedOffer.text.replace(/\n+/g, ' ') };
const oldStandard = { sender: 'Sam Coach', day: 'Sep 15', text: 'Perfect, Jo.\n\nWould any of the following times work for you?\n\n- Tue 22 September, 11:30 am\n\n(all times are Sydney time)' };
const leadYes = { sender: 'Jo Lead', text: 'Sounds interesting, tell me more.' };
check('a reworded offer counts as "a call was raised" - with the client wording', () => assert.ok(meetingRaisedInThread([leadYes, rewordedOffer], own)));
check('...and even without it, from the time list alone', () => assert.ok(meetingRaisedInThread([leadYes, rewordedOffer], null)));
check('...and when LinkedIn has flattened the line breaks', () => assert.ok(meetingRaisedInThread([leadYes, flattened], own)));
check('an old lowercase standard offer still counts', () => assert.ok(meetingRaisedInThread([leadYes, oldStandard], own)));
check('a thread with no call and no times does not', () => assert.ok(!meetingRaisedInThread([leadYes, { sender: 'Sam Coach', text: 'Thanks for connecting, Jo.' }], own)));
check('an unanswered REWORDED offer is seen as unanswered', () => {
  const r = unansweredTimesOffer({ conversation: [leadYes, rewordedOffer], coachName: 'Sam Coach', lines: own });
  assert.deepStrictEqual(r, { day: 'Nov 3' });
});
check('...flattened too', () => assert.ok(unansweredTimesOffer({ conversation: [leadYes, flattened], coachName: 'Sam Coach', lines: own })));
check('a one-slot reworded offer is caught by the client wording', () => {
  const one = { sender: 'Sam Coach', day: 'Nov 4', text: 'Here are a few options that could suit: - Tue 17 November, 10:00 am (Shown on the Perth clock)' };
  assert.ok(unansweredTimesOffer({ conversation: [leadYes, one], coachName: 'Sam Coach', lines: own }));
});
check('a booking confirmation is NOT read as an unanswered offer', () => {
  const confirm = { sender: 'Sam Coach', day: 'Nov 5', text: 'Great - confirmed for Tue 17 November, 10:00 am. Invite on its way.' };
  assert.strictEqual(unansweredTimesOffer({ conversation: [leadYes, confirm], coachName: 'Sam Coach', lines: own }), null);
});
check('once the lead has answered, nothing is unanswered', () => {
  assert.strictEqual(unansweredTimesOffer({ conversation: [rewordedOffer, leadYes], coachName: 'Sam Coach', lines: own }), null);
});
check('a very short custom line is too weak to be a marker by itself', () => {
  const weak = fl.resolveFixedLines([{ var_key: 'times_question_line', value: 'Any good?' }]);
  assert.ok(!fl.looksLikeTimesOffer('Any good? Let me know.', weak));
});

console.log('\ninstructions that talk about these lines');
const davidCheck = 'FINAL CHECK on every draft: a comma before "and" in "Let me know which suits, and I\'ll send..."; a capital A in "(All times are Brisbane time)"; a comma after an opening time phrase, as in "Back in July 2019, you..."; "including the Zoom link".';
check("David's final check is spotted, with the lines named", () => {
  assert.deepStrictEqual(fl.fixedLinesMentioned(davidCheck, null), ['times_zone_line', 'invite_line', 'invite_line_no_email']);
  const note = fl.fixedLineNote(davidCheck, fl.STANDARD_LINES);
  assert.ok(/wingguy_variables/.test(note) && /times_zone_line/.test(note) && /invite_line/.test(note), note);
});
check('an ordinary instruction gets no note', () => {
  assert.strictEqual(fl.fixedLineNote('Keep messages lean. Open with their first name. Never pitch in the first message.', fl.STANDARD_LINES), '');
});
check("an instruction quoting the client's OWN reworded line is spotted too", () => {
  assert.ok(fl.fixedLinesMentioned('Change "(Shown on the Perth clock)" to say local time.', own).includes('times_zone_line'));
});

console.log('\nthe write doors');
const setupFields = require('../config/wingguySetupFields');
const { DEFAULTED_KEYS, defaultFor } = require('../config/wingguyVariableDefaults');
check('every fixed line is on the setup page, skippable, with its standard as the default', () => {
  fl.FIXED_LINES.forEach((l) => {
    const f = setupFields.VARIABLE_FIELDS.find((x) => x.key === l.key);
    assert.ok(f && f.tier === 'glance' && f.fixedLine, `${l.key} missing from the page`);
    assert.ok(setupFields.VARIABLE_KEYS.has(l.key), `${l.key} not writable`);
    assert.ok(DEFAULTED_KEYS.has(l.key) && defaultFor(l.key) === l.standard, `${l.key} has no default`);
    assert.ok(f.hint.includes(l.standard), `${l.key}: the hint should show the standard line`);
  });
});

(async () => {
  // wingguy_variables: refuses a broken line, saves a good one and shows it as it will read.
  try {
    const mcp = require('../services/wingguyRulesMcp');
    const store = require('../services/wingguyRulesStore');
    const tool = (mcp.TOOL_DEFS || []).find((t) => t.name === 'wingguy_variables');
    if (!tool) {
      check('wingguy_variables is reachable for the door test', () => assert.fail('tool list not exported - door test could not run'));
    } else {
      const saved = [];
      const realSet = store.setVariable; const realGet = store.getVariables;
      store.setVariable = async (a) => { saved.push(a); };
      store.getVariables = async () => saved.map((s) => ({ var_key: s.varKey, value: s.value }));
      try {
        const bad = await tool.run({ set_key: 'times_zone_line', set_value: '(All times are Brisbane time)' }, 'Test-Tenant');
        check('the variables tool refuses a zone line with the city typed in', () => { assert.ok(bad.isError && /NOT SAVED/.test(bad.text) && /\[city\]/.test(bad.text), bad.text); assert.strictEqual(saved.length, 0); });
        const good = await tool.run({ set_key: 'invite_line', set_value: DAVID[1].value }, 'Test-Tenant');
        check('it saves a good line and shows it as it will read', () => { assert.ok(!good.isError && /including the Zoom link to jane@company\.com/.test(good.text), good.text); assert.strictEqual(saved.length, 1); });
        const list = await tool.run({}, 'Test-Tenant');
        check('listing shows the lines Wingguy writes, own wording marked', () => assert.ok(/LINES WINGGUY WRITES ITSELF/.test(list.text) && /THEIR OWN WORDING/.test(list.text) && /standard wording/.test(list.text), list.text));
      } finally { store.setVariable = realSet; store.getVariables = realGet; }
    }
  } catch (e) { failed++; console.log(`  ✗ variables door test threw: ${e.message}`); }

  // End to end: a real panel turn, with each client's wording coming from the store.
  console.log('\nthe real draft');
  let day = DateTime.now().setZone('Australia/Brisbane').plus({ days: 3 }).startOf('day');
  while (day.weekday > 5) day = day.plus({ days: 1 });
  const slot = day.set({ hour: 11, minute: 30 }).toUTC().toISO();
  const fakeAvail = async () => ({
    yourTimezone: 'Australia/Brisbane', leadTimezone: 'Australia/Brisbane', leadLocation: 'Brisbane', leadTzDetected: true,
    days: [{ date: day.toFormat('yyyy-MM-dd'), day: day.toFormat('ccc'), freeSlots: [{ time: slot, display: '', leadDisplay: '' }] }],
  });
  const run = async (rows, leadEmail) => {
    let call = 0;
    const client = { messages: { create: async () => {
      call++;
      if (call === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_times', input: { intro: 'Hi Jo,\n\nGreat - looking forward to it.', slotTimes: [slot], outro: 'Let me know which suits and I will send a calendar invite.' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    } } };
    return runWingguyChatTurn({
      coach: { clientId: 'Test-Coach', clientName: 'Sam Coach', timezone: 'Australia/Brisbane' },
      profile: { name: 'Jo Lead', location: 'Brisbane' },
      conversation: [{ sender: 'Sam Coach', text: 'Would you be up for a quick Zoom next week?' }, { sender: 'Jo Lead', text: 'Yes keen' }],
      leadEmail, messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client, getVariables: async () => rows, getAvailabilityForCoach: fakeAvail, clashingSlots: async () => new Map() },
    });
  };
  try {
    const std = await run([], 'jo@x.com');
    check('no wording saved -> the standard lines, grammar fixed', () => {
      assert.ok(/Would any of the following times work for you\?\n\n- /.test(std.draft), std.draft);
      assert.ok(/\(All times are Brisbane time\)\n\nLet me know which suits, and I'll send a calendar invite with the Zoom link to jo@x\.com - just say if there's a better address\./.test(std.draft), std.draft);
    });
    const dg = await run(DAVID, 'jo@x.com');
    check("David's wording reaches the draft, email filled in", () => {
      assert.ok(/\(All times are Brisbane time\)\n\nLet me know which suits, and I'll send a calendar invite including the Zoom link to jo@x\.com\./.test(dg.draft), dg.draft);
      assert.strictEqual((dg.draft.match(/calendar invite/g) || []).length, 1, dg.draft);
    });
    const rw = await run(REWORDED, 'jo@x.com');
    check('a fully reworded client gets all three of their lines, facts filled in', () => {
      assert.ok(/Here are a few options that could suit:\n\n- /.test(rw.draft), rw.draft);
      assert.ok(/\(Shown on the Brisbane clock\)\n\nPick one and I'll get a calendar invite across to jo@x\.com\./.test(rw.draft), rw.draft);
      assert.ok(!/\[city\]|\[email\]/.test(rw.draft), rw.draft);
      assert.ok(!/following times|All times are|which suits/.test(rw.draft), rw.draft);
    });
    const noEmail = await run(REWORDED, '');
    check('no email on file -> their own asking line', () => assert.ok(/Pick one and I'll get an invite across - which email is best\?/.test(noEmail.draft), noEmail.draft));
    const broken = await run([{ var_key: 'times_zone_line', value: 'times are local' }, { var_key: 'invite_line', value: 'I will send it' }], 'jo@x.com');
    check('broken stored wording never reaches a draft - standard lines instead', () => {
      assert.ok(/\(All times are Brisbane time\)/.test(broken.draft) && /to jo@x\.com/.test(broken.draft), broken.draft);
    });
    let threw = 0;
    const down = await runWingguyChatTurn({
      coach: { clientId: 'Test-Coach', clientName: 'Sam Coach', timezone: 'Australia/Brisbane' }, profile: { name: 'Jo Lead', location: 'Brisbane' },
      conversation: [{ sender: 'Sam Coach', text: 'Would you be up for a quick Zoom next week?' }, { sender: 'Jo Lead', text: 'Yes keen' }],
      leadEmail: 'jo@x.com', messages: [{ role: 'user', content: '(kickoff)' }],
      deps: { client: { messages: { create: (() => { let c = 0; return async () => (++c === 1
        ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propose_times', input: { intro: 'Hi Jo,', slotTimes: [slot] } }] }
        : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }); })() } },
      getVariables: async () => { threw++; throw new Error('store down'); }, getAvailabilityForCoach: fakeAvail, clashingSlots: async () => new Map() },
    });
    check('the store being unreachable still gives a draft, on standard wording', () => {
      assert.ok(threw > 0 && down.draft && /\(All times are Brisbane time\)/.test(down.draft), String(down.draft));
    });
  } catch (e) { failed++; console.log(`  ✗ end-to-end test threw: ${e.stack}`); }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
