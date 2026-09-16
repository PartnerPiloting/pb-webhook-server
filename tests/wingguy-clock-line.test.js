/**
 * Tests for LEAD LOCATION FOR THE CLOCK — the per-turn context line (Guy, 2026-09-17, Helia Bidad).
 *
 * The bug: the current-role location read (leadJobLocation, shipped 2026-09-16) worked, but was only
 * reachable from inside two booking-tool errors — propose_times' hard stop and check_time's
 * unknown-timezone warning. A turn that never called a booking tool never learned the city. So with
 * nothing usable on the record, Wingguy asked the LEAD "which city are you based in?" while
 * "Greater Perth Area" sat in the Experience section of the page it had already scraped.
 *
 * The fix puts the answer in the context the model reads BEFORE it decides anything.
 *
 * Run: node tests/wingguy-clock-line.test.js
 */
const assert = require('assert');
const { leadClockLine, buildContext } = require('../services/wingguyChat');

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// Helia's profile as the extension captures it — the exact shape from Guy's screenshot, where the
// company and employment type share a line and the work mode is chipped onto the location.
const HELIA_PAGE = [
  'Experience',
  'Business Development Specialist',
  'Keystart · Full-time',
  'Sep 2026 - Present · 1 mo',
  'Greater Perth Area · Hybrid',
  'As a Business Development Specialist, I see myself as a broker whisperer.',
  'Fractional CFO / Wealth & Business Mentor',
  'Self-employed',
  'Jan 2020 - Aug 2026 · 6 yrs 8 mos',
  'Melbourne, Victoria, Australia',
].join('\n');

(async () => {
  // ── 1. THE HELIA CASE: nothing on the record, the city is on the page ───────────────────────────
  console.log('no location on the record, current role has one:');
  {
    const line = leadClockLine({ name: 'Helia', location: '', pageText: HELIA_PAGE });
    check('names the city from the current role', () => assert.ok(/Greater Perth Area/.test(line), line));
    check('resolves it to the right zone', () => assert.ok(/Australia\/Perth/.test(line), line));
    check('tells the model to USE it, not just offer it', () => assert.ok(/leadTimezoneOverride="Australia\/Perth"/.test(line), line));
    check('forbids asking the LEAD which city', () => assert.ok(/Do NOT ask the lead which city/i.test(line), line));
    check('forbids asking Guy cold', () => assert.ok(/do NOT ask Guy cold/i.test(line), line));
    check('still requires telling Guy where the city came from', () => assert.ok(/CHAT REPLY to Guy/.test(line) && /job history/.test(line), line));
    check('still refuses to write it to the record itself', () => assert.ok(/do NOT write it there yourself/i.test(line), line));
    check('takes the CURRENT role, not the older Melbourne one', () => assert.ok(!/Melbourne/.test(line), line));
  }

  // ── 2. A vague country on the record is superseded by the role ──────────────────────────────────
  console.log('\nvague record location ("Australia"), current role has a city:');
  {
    const line = leadClockLine({ name: 'Helia', location: 'Australia', pageText: HELIA_PAGE });
    // "Australia" resolves as AMBIGUOUS with candidates rather than unmappable — either way the
    // point is that the record cannot pick one clock and the role can.
    check('says why the record is not enough', () => assert.ok(/AMBIGUOUS|pins no timezone/.test(line), line));
    check('quotes the record value back', () => assert.ok(/"Australia"/.test(line), line));
    check('still lands on Perth', () => assert.ok(/Australia\/Perth/.test(line), line));
  }

  // ── 3. A good record location needs no fuss at all ──────────────────────────────────────────────
  console.log('\nrecord location already resolves:');
  {
    const line = leadClockLine({ name: 'Tammie', location: 'Sydney, New South Wales', pageText: HELIA_PAGE });
    check('marked ON FILE', () => assert.ok(/ON FILE/.test(line), line));
    check('names the record zone, not the page one', () => assert.ok(/Australia\/Sydney/.test(line) && !/Australia\/Perth/.test(line), line));
    check('asks nobody anything', () => assert.ok(!/Ask GUY/i.test(line) && !/ask the lead/i.test(line), line));
  }

  // ── 4. Nothing anywhere → the old ask stands, and it goes to GUY not the lead ───────────────────
  console.log('\nnothing on the record and nothing on the page:');
  {
    const line = leadClockLine({ name: 'Nobody', location: '', pageText: 'Experience\nSome Title\nA Company\n' });
    check('says the record has nothing', () => assert.ok(/NO location on the record/.test(line), line));
    check('says the page has nothing either', () => assert.ok(/nothing usable/.test(line), line));
    check('sends the question to GUY', () => assert.ok(/Ask GUY/.test(line), line));
    check('forbids guessing a clock', () => assert.ok(/never guess a clock/i.test(line), line));
  }

  // ── 5. Connector turns have no pageText — must not crash, must fall back to the ask ─────────────
  console.log('\nno pageText at all (connector turn):');
  {
    const line = leadClockLine({ name: 'Nobody', location: '' });
    check('does not crash', () => assert.ok(typeof line === 'string' && line.length > 0));
    check('falls back to asking Guy', () => assert.ok(/Ask GUY/.test(line), line));
    check('handles a missing profile object entirely', () => assert.ok(typeof leadClockLine(undefined) === 'string'));
  }

  // ── 6. It actually reaches the model — the line is in the rendered context ──────────────────────
  console.log('\nthe line is rendered into the turn context:');
  {
    const ctx = buildContext({
      profileBlock: 'Helia', convoBlock: '', leadEmail: '', coachName: 'Guy Wilson', prefs: {},
      clockLine: leadClockLine({ name: 'Helia', location: '', pageText: HELIA_PAGE }),
    });
    check('context carries the clock line', () => assert.ok(/LEAD LOCATION FOR THE CLOCK/.test(ctx), ctx.slice(0, 200)));
    check('context carries the resolved zone', () => assert.ok(/Australia\/Perth/.test(ctx)));
    check('omitting it leaves the context clean', () => assert.ok(!/LEAD LOCATION FOR THE CLOCK/.test(buildContext({ profileBlock: 'x', convoBlock: '', leadEmail: '', coachName: 'Guy', prefs: {} }))));
  }

  console.log(failures ? `\n❌ ${failures} test(s) failed` : '\n✅ all clock-line tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
