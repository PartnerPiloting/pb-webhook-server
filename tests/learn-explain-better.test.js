/**
 * "Can you ask Guy to explain this better in future?" (services/wingguyGetStartedMcp.js,
 * services/wingguyLearningStore.js, services/wingguyMonitor.js).
 *
 * 10 Nov 2026 (Guy): Wingguy Learning told him about a question it had NO answer for, and nothing
 * about an answer that was given and wasn't good enough. Three catches for those:
 *   1. the client says the sentence -> their Claude writes Guy the detail (kind "unclear");
 *   2. their Claude sees an answer not land and reports it unasked (kind "pushback"), and tells them;
 *   3. the same client goes back to the same topic within the week (nobody reports anything).
 * All three land in the Monday Wingguy Learning email.
 *
 * Run: node tests/learn-explain-better.test.js
 */
const assert = require('assert');

process.env.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'test';
process.env.MASTER_CLIENTS_BASE_ID = process.env.MASTER_CLIENTS_BASE_ID || 'appTest';

const learning = require('../services/wingguyLearningStore');
const realStamp = learning.stamp;
const realRepeatServes = learning.repeatServes;
const stamps = [];
let saveOk = true;
learning.stamp = async (tenant, kind, key, detail) => { stamps.push({ tenant, kind, key, detail }); return saveOk; };
learning.markNudgeDoneIfTopicMatches = async () => {};
const learn = require('../services/wingguyGetStartedMcp');
const { learningEmailHtml } = require('../services/wingguyMonitor');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
};
const call = async (args, tenant = 'Dean-Hobin') => {
  const out = await learn.legacyToolCall('wingguy_learn', args, tenant);
  return { text: out.content[0].text, isError: !!out.isError };
};

const WRITE_UP = 'Dean asked how to clone his campaign. He was trying to start a second campaign for accountants. The topic said to tick both boxes, but his Linked Helper shows three boxes, so he did not know which two.';

(async () => {
  console.log('learn-explain-better');

  await check('the sentence with a write-up is saved for Guy as "unclear", detail intact', async () => {
    stamps.length = 0;
    const out = await call({ explain_better: WRITE_UP, about_topic: 'A SECOND LINKED HELPER CAMPAIGN' });
    assert.ok(!out.isError, out.text);
    assert.strictEqual(stamps.length, 1);
    assert.deepStrictEqual(stamps[0], { tenant: 'Dean-Hobin', kind: 'unclear', key: 'A SECOND LINKED HELPER CAMPAIGN', detail: WRITE_UP });
    assert.ok(/Guy will see/i.test(out.text), 'the client is not told Guy will see it');
    assert.ok(/not promise when/i.test(out.text), 'the Claude may promise a date Guy never agreed to');
  });

  await check('noticed=true is saved as "pushback" and the client is TOLD it went to Guy', async () => {
    stamps.length = 0;
    const out = await call({ explain_better: WRITE_UP, about_topic: 'A SECOND LINKED HELPER CAMPAIGN', noticed: true });
    assert.strictEqual(stamps[0].kind, 'pushback');
    assert.ok(/Tell the user/i.test(out.text) && /let Guy know/i.test(out.text), 'a silent report - the store promises nothing leaves quietly');
  });

  await check('no topic named: the start of the write-up stands in, so the row is never dropped', async () => {
    stamps.length = 0;
    await call({ explain_better: WRITE_UP });
    assert.strictEqual(stamps[0].key, WRITE_UP.slice(0, 120));
  });

  await check('a thin write-up is refused and nothing is saved - Guy can only fix what he can see', async () => {
    stamps.length = 0;
    const out = await call({ explain_better: 'not clear' });
    assert.ok(out.isError);
    assert.strictEqual(stamps.length, 0);
    assert.ok(/explain_better=/.test(out.text), 'the refusal does not say what to send');
  });

  await check('a save that fails says so - never "passed to Guy" when it was not', async () => {
    stamps.length = 0; saveOk = false;
    const out = await call({ explain_better: WRITE_UP });
    saveOk = true;
    assert.ok(out.isError);
    assert.ok(!/Passed to Guy/i.test(out.text));
    assert.ok(/email Guy/i.test(out.text));
  });

  await check('the sentence passed in as a TOPIC is not served a topic and not logged as a gap', async () => {
    stamps.length = 0;
    const out = await call({ topic: learn.EXPLAIN_BETTER_SAY });
    assert.strictEqual(stamps.length, 0, `logged ${JSON.stringify(stamps)}`);
    assert.ok(/Nothing has been sent to Guy yet/.test(out.text));
    assert.ok(/explain_better=/.test(out.text));
  });

  await check('ordinary questions with "explain" or "better" in them still reach the topics', () => {
    for (const q of ['explain the big picture', 'how do I explain what I do', 'a better way to follow up', 'what makes a better message', 'how do I explain it to a prospect']) {
      assert.ok(!learn.wantsExplainBetter(q), `"${q}" would be caught by the explain-better door`);
    }
    for (const q of ["that didn't help", 'that did not help', 'ask Guy to explain that better', 'I need a better explanation']) {
      assert.ok(learn.wantsExplainBetter(q), `"${q}" is not caught`);
    }
  });

  await check('every topic answer offers the sentence, word for word', async () => {
    stamps.length = 0;
    const out = await call({ topic: 'big picture' });
    assert.ok(out.text.includes(`Say "${learn.EXPLAIN_BETTER_SAY}"`), 'the topic answer does not offer the sentence');
    assert.ok(/noticed=true/.test(out.text), 'the Claude is not told to report an answer it sees not land');
    assert.strictEqual(stamps[0].kind, 'topic');
  });

  await check('the tool description tells the Claude what detail to send', () => {
    const def = learn.TOOL_DEFS.find((d) => d.name === 'wingguy_learn');
    assert.ok(/EXPLAIN THIS BETTER/.test(def.description));
    for (const k of ['explain_better', 'about_topic', 'noticed']) {
      assert.ok(def.zodSchema[k], `zod schema is missing ${k}`);
      assert.ok(def.jsonSchema.properties[k], `json schema is missing ${k}`);
    }
    assert.ok(def.description.includes(learn.EXPLAIN_BETTER_SAY), 'the sentence is not stamped into the description - check content/client-phrases.json');
  });

  await check('the store keeps the write-up and reads it back (unclear + pushback only)', async () => {
    const seen = [];
    learning.__setTestPool({
      connect: async () => ({
        query: async (sql, params) => { seen.push({ sql: String(sql), params }); return { rows: [], rowCount: 1 }; },
        release: () => {},
      }),
    });
    assert.strictEqual(await realStamp('Dean-Hobin', 'unclear', 'TOPIC', WRITE_UP), true);
    const ins = seen.find((q) => /INSERT INTO wingguy_learning_events/.test(q.sql));
    assert.deepStrictEqual(ins.params, ['Dean-Hobin', 'unclear', 'TOPIC', WRITE_UP]);
    assert.strictEqual(await realStamp('Dean-Hobin', 'nonsense', 'TOPIC'), false, 'an unknown kind was accepted');
    seen.length = 0;
    await learning.reports(null, 7);
    assert.deepStrictEqual(seen[0].params[0], ['unclear', 'pushback']);
    learning.__setTestPool(null);
  });

  await check('asked twice: opening the machine is not a repeat, and Guy is left out', async () => {
    learning.__setTestPool({
      connect: async () => ({
        query: async () => ({ rows: [
          { tenant_id: 'Dean-Hobin', key: 'A SECOND LINKED HELPER CAMPAIGN', times: 3 },
          { tenant_id: 'Dean-Hobin', key: 'OPEN YOUR LINKED HELPER MACHINE (web link)', times: 9 },
          { tenant_id: 'Guy-Wilson', key: 'THE BIG PICTURE', times: 4 },
        ] }),
        release: () => {},
      }),
    });
    const rows = await realRepeatServes(7, 'Guy-Wilson');
    learning.__setTestPool(null);
    assert.deepStrictEqual(rows.map((r) => `${r.tenant_id}|${r.key}`), ['Dean-Hobin|A SECOND LINKED HELPER CAMPAIGN']);
  });

  await check('the Monday email leads with the answer to fix, shows the write-up, and mentions the repeat', () => {
    const html = learningEmailHtml({
      beatCount: 13,
      gapList: [],
      unclear: [{ who: 'Dean-Hobin', asked: true, about: 'A SECOND LINKED HELPER CAMPAIGN - when and how', detail: WRITE_UP }],
      repeats: [{ who: 'Roland-Illyes', topic: 'KEEPING YOUR CAMPAIGN FED - top-ups', times: 3 }],
      progress: [],
    });
    assert.ok(/What you need to do/.test(html));
    assert.ok(!/Nothing to do this week/.test(html), 'an answer to fix is something to do');
    assert.ok(html.includes('Make "a second linked helper campaign" clearer'));
    assert.ok(html.includes('three boxes'), 'the write-up is not in the email');
    assert.ok(html.includes('Roland-Illyes went back to "keeping your campaign fed" 3 times'));
  });

  await check('a quiet week still reads as quiet', () => {
    const html = learningEmailHtml({ beatCount: 13, gapList: [], progress: [{ client: 'A', beats: 2 }] });
    assert.ok(/Nothing to do this week/.test(html));
    assert.ok(!/didn't land/.test(html));
  });

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
