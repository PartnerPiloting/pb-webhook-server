"use client";

/**
 * "Your Wingguy" — the page a client opens from their own private link. Explains how their
 * instructions work, collects the fill-in-the-blanks half, and (stage 3) shows every instruction
 * in plain English with a change-door under each one plus an add-your-own box.
 *
 * STANDALONE ON PURPOSE. No <Layout>, no client-profile bootstrap, no WordPress auth: this has to
 * work for someone who has been sent a link and nothing else. The portal token in ?token= is the
 * whole authentication story. (?client=X&devKey=Y is the admin lane for looking at any tenant's
 * page.)
 *
 * Two writing rules the page never breaks:
 *   - Blanks and voice boxes save per field, on blur (a dropped connection costs one answer).
 *   - Instruction changes NEVER save free text directly: the assist endpoint drafts the new
 *     version, the client reads it, and only the explicit Save click commits — through the same
 *     checked door chat uses (version check, guardrail refusal, history).
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBackendBase } from '../services/api';
import { PageNav } from './WingguyReview';

const KINDS = [
  {
    tag: 'Standard',
    tone: 'emerald',
    headline: "The hard-won ones. You don't set them up and you don't maintain them.",
    body: "These are the difference between a message that gets a reply and one that gets ignored. When we learn something new that makes messages land better, it turns up in your Wingguy on its own - you don't lift a finger.",
    eg: '"Read their profile properly and say something true about them, rather than parroting their headline back at them."',
  },
  {
    tag: 'Fixed',
    tone: 'amber',
    headline: "Two guardrails that can't be switched off - by you or by us.",
    body: 'Nothing is ever sent without you seeing it first, and every email is copied to your own records so the conversation lands on that person\'s file. These are the reason it never goes off and does something daft on your behalf.',
    eg: '',
  },
  {
    tag: 'Yours',
    tone: 'slate',
    headline: 'Your words, your defaults, your links. Change them whenever you like.',
    body: 'How you sign off. What you say when someone asks what you do. The earliest you would ever take a meeting. These start with sensible defaults - and this page is where you make them yours.',
    eg: '',
  },
];

/**
 * The reassurance strip: the moments Guy demonstrates live, in the order he demonstrates them.
 * Deliberately CONCRETE - what you say, what it does - because this page is read minutes after
 * someone watched it happen, so its job is to confirm rather than to persuade from cold. Sourced
 * from Guy's own demo script and knowaguy.com.au/a-day-in-the-life.
 */
const DEMO_MOMENTS = [
  {
    moment: 'You open a lead on LinkedIn and type /wg',
    does: 'It reads the whole conversation and writes the reply - grounded in what they actually said, in your words, not a template.',
  },
  {
    moment: 'They sound open to a meeting',
    does: 'It offers three times you are genuinely free, on their clock, spread across the week rather than stacked on one day.',
  },
  {
    moment: 'They pick one',
    does: 'It books it, sends the invite with your meeting room on it, and writes the warm confirmation that goes with it.',
  },
  {
    say: 'I had a great meeting with John this morning - find the transcript and draft the follow-up',
    does: 'It finds the recording, pulls out what mattered, and writes the email in your voice with the right links in it.',
  },
  {
    say: 'Prep me for today',
    does: 'Who you are meeting, what you last talked about, what you promised them, and anything still outstanding.',
  },
  {
    say: 'Show me my follow-ups',
    does: 'The people due today, in order, with the reason each one is on the list.',
  },
  {
    moment: 'End of the day, a tab open per conversation',
    does: 'Every follow-up drafts at once. You read each one and say "push", and it lands in your inbox ready to send.',
  },
];

const LOOP = [
  ['It writes the draft', 'A connection request, a reply, a follow-up email after a call. It pulls in what it knows about the person first - your past messages, the call, their profile.'],
  ['You read it before it goes anywhere', 'Always. Nothing is ever sent on your behalf without you seeing it. Change what is not right and send it.'],
  ['You tell it what was off', '"Don\'t say reach out." "That\'s too long." "Always mention I\'m Brisbane based." Plain English, in your own words - you never have to phrase it like an instruction.'],
  ['It remembers - for good', 'Not just for the next message. It shows you exactly what it is about to change before it changes anything, then that correction applies to everything it writes from then on.'],
];

const SAY = [
  ['Never say "reach out"', 'Bans the phrase everywhere, in every message it ever writes for you.'],
  ['That was too long - keep them to about four lines', 'Works just as well as a reaction to a draft you are looking at right now.'],
  ['What have I changed?', 'Shows you everything that is yours, next to the standard version.'],
  ['Go back to the standard one', 'Undoes a change of yours and puts ours back. Nothing is ever lost.'],
];

function WingguySetupInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  // Admin/testing lane, already supported by the backend's auth middleware: ?client=X&devKey=Y
  // opens any tenant's page without minting a portal link. A client's own link never carries these.
  const client = searchParams.get('client') || '';
  const devKey = searchParams.get('devKey') || '';
  // Attribution, not authentication: a link can carry &as=<name> when more than one person works
  // this tenant (an owner and a VA, say) so the change history reads "April changed..." rather
  // than just "the setup page".
  const asName = searchParams.get('as') || '';
  const hasAuth = !!token || !!(client && devKey);

  const authHeaders = useCallback((extra = {}) => {
    const h = { ...extra };
    if (token) h['x-portal-token'] = token;
    if (client) h['x-client-id'] = client;
    if (devKey) h['x-dev-key'] = devKey;
    if (asName) h['x-page-name'] = asName;
    return h;
  }, [token, client, devKey, asName]);

  const [state, setState] = useState({ status: 'loading', error: '', data: null });
  const [values, setValues] = useState({});
  const [saveState, setSaveState] = useState({});
  const [instructions, setInstructions] = useState(null); // null while loading | {groups,total} | {error}

  const fieldId = (f) => `${f.scope}:${f.key}`;

  const loadInstructions = useCallback(async () => {
    try {
      const res = await fetch(`${getBackendBase()}/api/wingguy/setup/instructions`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      setInstructions(res.ok && data.ok ? data : { error: data.error || 'Could not load your instructions.' });
    } catch (e) {
      setInstructions({ error: 'Could not load your instructions - check your connection.' });
    }
  }, [authHeaders]);

  useEffect(() => {
    if (!hasAuth) {
      setState({ status: 'no-token', error: '', data: null });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBackendBase()}/api/wingguy/setup`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setState({
            status: 'error',
            error: data.message || data.error || 'We could not open your setup.',
            // 403 = the link is fine, the account just is not switched on yet. Telling that person
            // to ask for a fresh link sends them down the wrong path entirely.
            notYet: res.status === 403,
            data: null,
          });
          return;
        }
        const initial = {};
        data.fields.forEach((f) => { initial[`${f.scope}:${f.key}`] = f.value || ''; });
        setValues(initial);
        setState({ status: 'ready', error: '', data });
        loadInstructions();
      } catch (e) {
        if (!cancelled) setState({ status: 'error', error: 'We could not reach Wingguy. Check your connection and refresh.', data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [hasAuth, authHeaders, loadInstructions]);

  const save = useCallback(async (field, nextValue) => {
    const id = `${field.scope}:${field.key}`;
    setSaveState((s) => ({ ...s, [id]: 'saving' }));
    try {
      const res = await fetch(`${getBackendBase()}/api/wingguy/setup`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: field.scope, key: field.key, value: nextValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setSaveState((s) => ({ ...s, [id]: data.error || 'Not saved - try again.' }));
        return;
      }
      setSaveState((s) => ({ ...s, [id]: 'saved' }));
      window.setTimeout(() => {
        setSaveState((s) => (s[id] === 'saved' ? { ...s, [id]: '' } : s));
      }, 2200);
      // A saved blank flows straight into the instruction bodies below (they render with the
      // client's values woven in), so re-fetch rather than leaving stale text until a reload.
      loadInstructions();
    } catch (e) {
      setSaveState((s) => ({ ...s, [id]: 'Not saved - check your connection.' }));
    }
  }, [authHeaders, loadInstructions]);

  const assist = useCallback(async (payload) => {
    const res = await fetch(`${getBackendBase()}/api/wingguy/setup/assist`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'That did not work - try again in a moment.');
    return data;
  }, [authHeaders]);

  const commitChange = useCallback(async (proposal) => {
    const res = await fetch(`${getBackendBase()}/api/wingguy/setup/change-commit`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        ruleKey: proposal.ruleKey,
        context: proposal.context,
        ruleType: proposal.ruleType,
        body: proposal.proposedBody,
        expectedVersion: proposal.expectedVersion,
        explanation: proposal.explanation,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Not saved - try again.');
    await loadInstructions();
  }, [authHeaders, loadInstructions]);

  if (state.status === 'loading') {
    return <Shell><p className="text-slate-500">Opening your setup…</p></Shell>;
  }

  if (state.status === 'no-token') {
    return (
      <Shell>
        <h1 className="font-serif text-3xl text-slate-900">Your Wingguy</h1>
        <p className="text-slate-600 mt-4">
          This page needs the private link your coach sent you - the one ending in a long code.
          Open that link and you will land straight here.
        </p>
      </Shell>
    );
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <h1 className="font-serif text-3xl text-slate-900">Your Wingguy</h1>
        {state.notYet ? (
          <>
            <p className="text-slate-600 mt-4">
              Your Wingguy is not switched on yet, so there is nothing to set up in here just now.
            </p>
            <p className="text-slate-500 text-sm mt-3">
              Nothing has gone wrong and your link is fine - come back to it once your coach has you
              up and running.
            </p>
          </>
        ) : (
          <>
            <p className="text-slate-600 mt-4">{state.error}</p>
            <p className="text-slate-500 text-sm mt-3">
              If that link has stopped working, ask your coach for a fresh one.
            </p>
          </>
        )}
      </Shell>
    );
  }

  const { data } = state;
  const tiers = data.tierGroups || { essential: [], glance: [], voice: ['In your own words'] };
  const byTier = (t) => data.fields.filter((f) => f.tier === t);
  const essentialFields = byTier('essential');
  const glanceFields = byTier('glance');
  const voiceFields = byTier('voice');
  // Progress tracks the essentials only - nagging someone toward settings we just told them are
  // fine left alone is exactly the pressure this page is trying not to apply.
  const answered = essentialFields.filter((f) => String(values[fieldId(f)] || '').trim()).length;
  const pct = data.total ? Math.round((answered / data.total) * 100) : 0;

  const renderGroups = (groupNames, fieldsInTier) => groupNames.map((group) => {
    const inGroup = fieldsInTier.filter((f) => f.group === group);
    if (!inGroup.length) return null;
    return (
      <div key={group} className="flex flex-col gap-6">
        {groupNames.length > 1 ? <GroupHead label={group} /> : null}
        {inGroup.map((f) => (
          <Field
            key={fieldId(f)}
            field={f}
            value={values[fieldId(f)] || ''}
            status={saveState[fieldId(f)]}
            onChange={(v) => setValues((s) => ({ ...s, [fieldId(f)]: v }))}
            onCommit={(v) => save(f, v)}
          />
        ))}
      </div>
    );
  });

  return (
    <Shell wide>
      <PageNav current="setup" reviewHref={`/my-wingguy/review?${searchParams.toString()}`} devLane={!!(client && devKey)} query={searchParams.toString()} />
      <header className="flex flex-col gap-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-700">
          Getting started with Wingguy
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl leading-[1.1] text-slate-900">
          Now let&apos;s make it sound like you
        </h1>
        <p className="font-serif text-lg leading-relaxed text-slate-600 max-w-2xl">
          You have seen what it does. The reason it does it in someone&apos;s own voice, and not in
          generic AI mush, is that it reads a set of instructions before every single thing it
          writes - and <em>some of those instructions are yours.</em> This page is where you write
          them.
        </p>

        <a
          href="https://knowaguy.com.au/a-day-in-the-life"
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-2 block border-2 border-emerald-600 bg-emerald-50 p-6 hover:bg-emerald-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
        >
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-800">
            Take ten minutes first
          </div>
          <div className="font-serif text-2xl text-slate-900 mt-2 group-hover:text-emerald-900">
            A day in the life <span aria-hidden="true">&rarr;</span>
          </div>
          <p className="text-[15px] text-slate-700 leading-relaxed mt-2 max-w-2xl">
            It is short, and it is the honest picture of what you are setting up here - an ordinary
            working day with all the remembering, chasing and drafting taken off your plate. Guy&apos;s
            advice is to read it now rather than later: people who do come back to this page knowing
            what they want their Wingguy to sound like, which makes everything below quicker and
            better.
          </p>
        </a>
      </header>

      {/* what you just watched - the reassurance, in concrete moments */}
      <section className="flex flex-col gap-6">
        <SectionHead
          title="What you just watched"
          sub="A reminder of the day this gives you back - because in about ten minutes on this page, it starts becoming yours."
        />
        <div className="flex flex-col gap-px bg-slate-200 border border-slate-200">
          {DEMO_MOMENTS.map((m) => (
            <div key={m.does} className="bg-white grid sm:grid-cols-[16rem_1fr] gap-1 sm:gap-6 px-5 py-4">
              <div className="font-serif text-[15px] text-emerald-800 leading-snug">
                {m.say ? <>&ldquo;{m.say}&rdquo;</> : <span className="text-slate-500 not-italic">{m.moment}</span>}
              </div>
              <div className="text-[15px] text-slate-700 leading-relaxed">{m.does}</div>
            </div>
          ))}
        </div>

        <blockquote className="border-l-2 border-emerald-600 pl-5 flex flex-col gap-2">
          <p className="font-serif text-lg text-slate-800 leading-relaxed max-w-2xl">
            &ldquo;I used to finish the day with a pile of emails I still owed people. The
            remembering, the tracking, the drafting, the chasing, the diary work - it is not my job
            any more. I am less drained, and I get through far more.&rdquo;
          </p>
          <cite className="text-sm text-slate-500 not-italic">Guy</cite>
        </blockquote>

        <div className="border-2 border-emerald-600 bg-emerald-50 p-6 flex flex-col gap-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-800">
            The part worth understanding
          </div>
          <p className="font-serif text-lg text-slate-900 leading-relaxed">
            Every one of those moments runs on instructions - and you are the one who shapes them.
          </p>
          <p className="text-[15px] text-slate-700 leading-relaxed">
            That is the whole thing. None of it is generic: it sounds like Guy because Guy taught
            it. The boxes further down this page are where yours start - your name, your sign-off,
            the way you describe what you do.
          </p>
          <p className="text-[15px] text-slate-700 leading-relaxed">
            <strong>But the part that matters most comes after today.</strong> Every time Wingguy
            writes something and you tell it &ldquo;not like that - like this&rdquo;, it changes for
            good. In a Claude chat, or right there in the Wingguy window on LinkedIn, in whatever
            words come out. Do that a handful of times over your first few weeks and the drafts stop
            being good-generic and start being unmistakably yours - across every single thing in
            that day, not just the message in front of you.
          </p>
          <p className="text-[15px] text-slate-700 leading-relaxed">
            If you skipped the read at the top, it is worth going back for -{' '}
            <a
              href="https://knowaguy.com.au/a-day-in-the-life"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-800 font-semibold underline underline-offset-2 hover:text-emerald-900"
            >
              a day in the life
            </a>
            . Every hour of it is shaped by instructions like the ones you are about to write.
          </p>
        </div>
      </section>

      {/* three kinds */}
      <section className="flex flex-col gap-6">
        <SectionHead
          title="There are three kinds of instruction"
          sub="Worth knowing which is which, because you only ever look after one of them."
        />
        <div className="flex flex-col gap-px bg-slate-200 border border-slate-200">
          {KINDS.map((k) => (
            <div key={k.tag} className={`grid sm:grid-cols-[8rem_1fr] gap-2 sm:gap-6 p-6 ${k.tone === 'amber' ? 'bg-amber-50' : 'bg-white'}`}>
              <div className={`text-[11px] font-bold uppercase tracking-[0.1em] pt-1 ${k.tone === 'amber' ? 'text-amber-800' : k.tone === 'emerald' ? 'text-emerald-700' : 'text-slate-800'}`}>
                {k.tag}
              </div>
              <div className="flex flex-col gap-2">
                <p className="font-serif text-lg text-slate-900 leading-snug">{k.headline}</p>
                <p className="text-[15px] text-slate-600 leading-relaxed">{k.body}</p>
                {k.eg ? <p className="font-serif italic text-sm text-slate-400">{k.eg}</p> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* the loop */}
      <section className="flex flex-col gap-6">
        <SectionHead
          title="How it actually works, week to week"
          sub="This is the whole loop. It is less about setting things up and more about correcting it when it gets something wrong."
        />
        <div className="flex flex-col border-t border-slate-200">
          {LOOP.map(([title, body], i) => (
            <div key={title} className="grid grid-cols-[2.5rem_1fr] gap-x-4 py-4 border-b border-slate-200 items-baseline">
              <span className="font-serif text-xl text-emerald-700">{i + 1}</span>
              <div className="flex flex-col gap-1">
                <strong className="text-slate-900 font-semibold">{title}</strong>
                <span className="text-[15px] text-slate-600 leading-relaxed">{body}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* the blanks */}
      <section className="flex flex-col gap-6">
        <SectionHead
          title="The essentials"
          sub="Four or five things only you can tell it. These are the ones worth doing properly - everything after this already works out of the box."
        />

        <div className="flex items-center gap-4 text-sm text-slate-500 py-2">
          <span className="tabular-nums whitespace-nowrap">{answered} of {data.total} done</span>
          <span className="flex-1 h-[3px] bg-slate-200 overflow-hidden">
            <span className="block h-full bg-emerald-600 transition-all duration-300" style={{ width: `${pct}%` }} />
          </span>
        </div>

        {renderGroups(tiers.essential, essentialFields)}
      </section>

      {/* glance - real defaults, safe to skip */}
      {glanceFields.length ? (
        <section className="flex flex-col gap-6">
          <SectionHead
            title="Worth a glance - but the defaults are good"
            sub="These are already set sensibly, and you can skip the lot without anything breaking. Honestly, the best time to change one of these is later - when Wingguy writes something you would have put differently. Tell it then, in chat, and it will remember."
          />
          {renderGroups(tiers.glance, glanceFields)}
        </section>
      ) : null}

      {/* in your own words */}
      {voiceFields.length ? (
        <section className="flex flex-col gap-8">
          <SectionHead
            title="In your own words"
            sub="The pieces that carry your voice. Every box here is optional - blank means Wingguy writes that part fresh each time, in plain wording that gets sharper as your answers above fill in. Nothing here is a test."
          />
          {voiceFields.map((f) => (
            <VoiceField
              key={fieldId(f)}
              field={f}
              value={values[fieldId(f)] || ''}
              status={saveState[fieldId(f)]}
              onChange={(v) => setValues((s) => ({ ...s, [fieldId(f)]: v }))}
              onCommit={(v) => save(f, v)}
              assist={assist}
            />
          ))}
          {/* Learn-from-my-edit surfacing (2026-08-06): the easiest way to teach Wingguy a voice
              is not a form - it is editing a draft. Say so here, where voice is the topic. */}
          <p className="text-slate-500 text-sm">
            There is an easier way to do all of this, too: just change what Wingguy drafts before
            you send it. It quietly keeps a note of every edit, and any time you ask it to{' '}
            <span className="font-medium">&ldquo;review my edits&rdquo;</span> it will show you what
            you changed and ask whether any of it should become an instruction - so future drafts
            come out your way first time.
          </p>
        </section>
      ) : null}

      {/* how your wingguy works */}
      <section className="flex flex-col gap-8">
        <SectionHead
          title="How your Wingguy works"
          sub="Every instruction it follows, in plain English. Open any of them - and if one is not how you would do it, tell it right there."
        />
        {/* The review page (2026-08-06): the owner's small window - what changed, who did it,
            notes in the margin. Linked rather than embedded so this page stays the working
            surface and a glance stays a glance. */}
        <p className="text-sm text-slate-500 -mt-4">
          Curious what has been changed on this page over time?{' '}
          <a className="underline hover:text-slate-700" href={`/my-wingguy/review?${searchParams.toString()}`}>
            See what&apos;s changed lately
          </a>
          {' '}- every change, who made it, before and after.
        </p>

        <div className="bg-white border border-slate-200 p-6 flex flex-col gap-4">
          <p className="text-[15px] text-slate-700 leading-relaxed">
            <strong>You can also add instructions of your own.</strong> Anything you find yourself
            telling Wingguy twice - a word you hate, a way you like things done, a rule of thumb
            from your world - can become a standing instruction. Add it in the box just below, tell
            it under any instruction here, or just say it in chat, in whatever words come out.
          </p>
          <p className="text-[15px] text-slate-700 leading-relaxed">
            <strong>One thing it guards carefully: overlap.</strong> Two instructions covering the
            same ground - one saying &ldquo;keep emails short&rdquo;, another &ldquo;always include
            three examples&rdquo; - quietly fight each other, and you end up with drafts that obey
            neither. So before saving anything new, Wingguy checks what is already there covering
            that ground. If something close exists, it will show you and suggest changing
            <em> that one</em> instead of adding a twin. And you always see exactly what is about to
            be saved before it is - nothing sneaks in.
          </p>
        </div>

        <div className="bg-emerald-50 border-2 border-emerald-600 p-6">
          <AddInstruction assist={assist} commitChange={commitChange} />
        </div>

        {!instructions ? (
          <p className="text-slate-500">Loading your instructions…</p>
        ) : instructions.error ? (
          <p className="text-slate-600">{instructions.error}</p>
        ) : (
          <InstructionBrowser
            groups={instructions.groups}
            assist={assist}
            commitChange={commitChange}
          />
        )}
      </section>

      {/* changing later, in chat */}
      <section className="flex flex-col gap-6">
        <SectionHead
          title="Changing anything, any time"
          sub="You never have to come back to this page. Just say it in a chat, in whatever words come out."
        />
        <div className="flex flex-col gap-px bg-slate-200 border border-slate-200">
          {SAY.map(([quote, what]) => (
            <div key={quote} className="bg-white px-5 py-4 flex flex-col gap-1">
              <div className="font-serif text-lg text-slate-900">
                <span className="text-emerald-700">&ldquo;</span>{quote}<span className="text-emerald-700">&rdquo;</span>
              </div>
              <div className="text-sm text-slate-600 leading-relaxed">{what}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t-2 border-slate-900 pt-8 flex flex-col gap-4">
        <p className="font-serif text-2xl text-slate-900">Have a go, and don&apos;t worry about getting it right.</p>
        <p className="text-slate-600 max-w-2xl">
          There is nothing here you can break and nothing you cannot undo. And if something it writes
          does not sound like you, that is not a fault to put up with. Tell it. That is the whole idea.
        </p>
      </div>
    </Shell>
  );
}

function SectionHead({ title, sub }) {
  return (
    <div className="flex flex-col gap-3 pb-4 border-b border-slate-200">
      <h2 className="font-serif text-2xl text-slate-900">{title}</h2>
      {sub ? <p className="text-slate-600 max-w-2xl">{sub}</p> : null}
    </div>
  );
}

function GroupHead({ label, count }) {
  return (
    <div className="flex items-baseline gap-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">{label}</h3>
      {count != null ? <span className="text-xs text-slate-400 tabular-nums">{count}</span> : null}
      <span className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

const inputClasses =
  'w-full border border-slate-300 bg-white px-3 py-2.5 text-slate-900 text-base leading-relaxed ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent';

function Field({ field, value, status, onChange, onCommit }) {
  const [committed, setCommitted] = useState(value);
  const commit = (v) => {
    if (v === committed) return;
    setCommitted(v);
    onCommit(v);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`f-${field.key}`} className="font-semibold text-slate-900 leading-snug">
        {field.label}
      </label>
      {field.hint ? <p className="text-sm text-slate-600 leading-relaxed">{field.hint}</p> : null}

      {field.type === 'choice' ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {field.options.map((opt) => {
            const on = value === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() => { onChange(on ? '' : opt); commit(on ? '' : opt); }}
                className={`px-3 py-1.5 text-sm border transition-colors ${
                  on
                    ? 'bg-emerald-50 border-emerald-600 text-emerald-800 font-semibold'
                    : 'bg-white border-slate-300 text-slate-600 hover:border-emerald-600 hover:text-slate-900'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : field.type === 'long' ? (
        <textarea
          id={`f-${field.key}`}
          rows={3}
          className={inputClasses}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => commit(e.target.value.trim())}
        />
      ) : (
        <input
          id={`f-${field.key}`}
          type="text"
          className={inputClasses}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => commit(e.target.value.trim())}
        />
      )}

      <div className="flex items-baseline justify-between gap-4 min-h-[1.25rem]">
        {field.example ? (
          <p className="font-serif italic text-[13px] text-slate-400">
            <span className="not-italic font-sans uppercase tracking-wide text-[11px] font-semibold">For example </span>
            {field.example}
          </p>
        ) : <span />}
        <SaveNote status={status} />
      </div>
    </div>
  );
}

/** A voice box: the shape, the live example, the read-back button, and the optional box itself. */
function VoiceField({ field, value, status, onChange, onCommit, assist }) {
  const [committed, setCommitted] = useState(value);
  const [example, setExample] = useState(null);   // null | 'loading' | {leadIntro?, text} | {error}
  const [readback, setReadback] = useState(null); // null | 'loading' | {note, suggestion} | {error}

  const commit = (v) => {
    if (v === committed) return;
    setCommitted(v);
    onCommit(v);
  };

  const runExample = async () => {
    setExample('loading');
    try { setExample(await assist({ mode: 'example', kind: field.exampleKind })); }
    catch (e) { setExample({ error: e.message }); }
  };

  const runReadback = async () => {
    setReadback('loading');
    try { setReadback(await assist({ mode: 'readback', text: value, label: field.label })); }
    catch (e) { setReadback({ error: e.message }); }
  };

  return (
    <div className="flex flex-col gap-2.5 border-l-2 border-emerald-600 pl-5">
      <div className="font-serif text-xl text-slate-900">{field.label}</div>
      {field.hint ? <p className="text-[15px] text-slate-600 leading-relaxed max-w-2xl">{field.hint}</p> : null}
      {field.bullets ? (
        <ul className="list-disc pl-5 text-[15px] text-slate-600 leading-relaxed flex flex-col gap-1">
          {field.bullets.map((b) => <li key={b}>{b}</li>)}
        </ul>
      ) : null}

      {field.exampleKind ? (
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={runExample}
            disabled={example === 'loading'}
            className="self-start px-4 py-2 text-sm font-semibold text-emerald-900 bg-emerald-50 border border-emerald-600 hover:bg-emerald-100 disabled:opacity-60"
          >
            {example === 'loading' ? 'Writing…' : 'Show me what Wingguy would write'}
          </button>
          {example && example !== 'loading' ? (
            example.error ? (
              <p className="text-sm text-red-700">{example.error}</p>
            ) : (
              <div className="bg-white border border-slate-200 flex flex-col">
                {example.leadIntro ? (
                  <div className="px-4 py-2.5 border-b border-slate-200 text-[13px] text-slate-500">
                    Written for {example.leadIntro} - so you can hear how it reads:
                  </div>
                ) : null}
                <div className="px-4 py-3 font-serif text-slate-900 leading-relaxed whitespace-pre-wrap">{example.text}</div>
                <div className="px-4 py-2.5 border-t border-slate-200 text-[13px] text-slate-600">
                  Every real one is written fresh for the actual person - this is one throw of the
                  dice, not a template. <span className="text-emerald-800 font-semibold">Want to play
                  with it? Ask Wingguy in chat, and say &ldquo;use that&rdquo; when you&apos;re happy.</span>
                </div>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <textarea
        rows={field.exampleKind === 'advocacy' ? 5 : 3}
        maxLength={field.cap || 600}
        placeholder="Your version, if you have one - otherwise leave this empty"
        className={inputClasses}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => commit(e.target.value.trim())}
      />

      <div className="flex items-center justify-between gap-4 min-h-[1.5rem]">
        <div className="flex items-center gap-3">
          {String(value).trim() ? (
            <button
              type="button"
              onClick={runReadback}
              disabled={readback === 'loading'}
              className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-60"
            >
              {readback === 'loading' ? 'Reading…' : 'Read it back to me'}
            </button>
          ) : (
            <span className="font-serif italic text-[13px] text-slate-400">
              {field.example ? <>e.g. {field.example}</> : 'Leaving it empty is a fine answer'}
            </span>
          )}
        </div>
        <SaveNote status={status} />
      </div>

      {readback && readback !== 'loading' ? (
        readback.error ? (
          <p className="text-sm text-red-700">{readback.error}</p>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-3 flex flex-col gap-2">
            <p className="text-[15px] text-slate-800 leading-relaxed">{readback.note}</p>
            {readback.suggestion ? (
              <div className="flex flex-col gap-2">
                <p className="font-serif text-slate-900 leading-relaxed whitespace-pre-wrap">{readback.suggestion}</p>
                <button
                  type="button"
                  onClick={() => { onChange(readback.suggestion); commit(readback.suggestion); setReadback(null); }}
                  className="self-start px-3 py-1.5 text-sm font-semibold text-emerald-900 bg-white border border-emerald-600 hover:bg-emerald-100"
                >
                  Use this
                </button>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

/** The proposal card: what Wingguy wants to save, and the two buttons. Shared by change and add. */
function ProposalCard({ proposal, onSave, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const doSave = async () => {
    setBusy(true); setErr('');
    try { await onSave(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="bg-white border border-emerald-600 flex flex-col">
      <div className="px-4 py-2.5 border-b border-slate-200 text-[13px] font-semibold uppercase tracking-wide text-emerald-800">
        {proposal.action === 'add' ? `New instruction: ${proposal.title}` : `Your version of: ${proposal.title}`}
      </div>
      {proposal.explanation ? (
        <p className="px-4 pt-3 text-[15px] text-slate-700 leading-relaxed">{proposal.explanation}</p>
      ) : null}
      <div className="px-4 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 border-y border-slate-100 mt-2">{proposal.proposedBody}</div>
      {proposal.replacesShared ? (
        <p className="px-4 pt-2.5 text-[13px] text-amber-800 leading-relaxed">
          This becomes your own version, replacing the shared one for you alone. One trade to know:
          later improvements to the shared version stop flowing to you for this instruction - and
          you can say &ldquo;go back to the standard one&rdquo; in chat any time.
        </p>
      ) : null}
      {err ? <p className="px-4 pt-2 text-sm text-red-700">{err}</p> : null}
      <div className="px-4 py-3 flex gap-3">
        <button
          type="button"
          onClick={doSave}
          disabled={busy}
          className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 border border-emerald-700 hover:bg-emerald-800 disabled:opacity-60"
        >
          {busy ? 'Saving…' : (proposal.action === 'add' ? 'Add it' : 'Save my version')}
        </button>
        <button type="button" onClick={onDismiss} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 hover:text-slate-900">
          Leave it
        </button>
      </div>
    </div>
  );
}

function AddInstruction({ assist, commitChange }) {
  const [text, setText] = useState('');
  const [state, setState] = useState(null); // null | 'loading' | 'done' | {proposal} | {overlap} | {error}

  const run = async () => {
    setState('loading');
    try {
      const r = await assist({ mode: 'change', request: text });
      setState(r.action === 'overlap' ? { overlap: r } : { proposal: r });
    } catch (e) { setState({ error: e.message }); }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-serif text-xl text-slate-900">Add an instruction of your own</div>
      <p className="text-sm text-slate-600 leading-relaxed">
        Say it the way you&apos;d say it out loud - Wingguy turns it into a proper instruction and
        shows you before anything is saved.
      </p>
      <textarea
        rows={2}
        maxLength={1500}
        placeholder={'e.g. "never message anyone on a Friday"'}
        className={inputClasses}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        onClick={run}
        disabled={!text.trim() || state === 'loading'}
        className="self-start px-4 py-2 text-sm font-semibold text-emerald-900 bg-emerald-50 border border-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
      >
        {state === 'loading' ? 'Checking…' : 'Suggest it'}
      </button>

      {state && state !== 'loading' ? (
        state === 'done' ? (
          <p className="text-sm font-semibold text-emerald-800">Added - it is now in your list below, under its group.</p>
        ) : state.error ? (
          <p className="text-sm text-red-700">{state.error}</p>
        ) : state.overlap ? (
          <div className="bg-amber-50 border border-amber-300 px-4 py-3 flex flex-col gap-1.5">
            <p className="text-[15px] text-slate-800 leading-relaxed">
              There is already an instruction covering this ground: <strong>{state.overlap.title}</strong>.
            </p>
            {state.overlap.why ? <p className="text-sm text-slate-700 leading-relaxed">{state.overlap.why}</p> : null}
            <p className="text-sm text-slate-700 leading-relaxed">
              Rather than adding a twin that would fight it, find it in the list below, open it, and
              tell it your change there.
            </p>
          </div>
        ) : (
          <ProposalCard
            proposal={state.proposal}
            onSave={async () => { await commitChange(state.proposal); setText(''); setState('done'); }}
            onDismiss={() => setState(null)}
          />
        )
      ) : null}
    </div>
  );
}

/**
 * The browse layer over the instruction list: an ask-anything box, a filter-as-you-type search,
 * and groups FOLDED by default - the page opens showing six lines, not seventy. Searching
 * auto-unfolds whatever matches; clearing it folds everything back up.
 */
function InstructionBrowser({ groups, assist, commitChange }) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState({});
  const [asking, setAsking] = useState(null); // null | 'loading' | {answer, ruleKey, title} | {error}
  const [question, setQuestion] = useState('');

  const q = query.trim().toLowerCase();
  const matches = (item) =>
    !q ||
    item.title.toLowerCase().includes(q) ||
    (item.gist || '').toLowerCase().includes(q) ||
    (item.body || '').toLowerCase().includes(q);

  const groupFor = (ruleKey) => {
    const g = groups.find((gr) => gr.items.some((i) => i.ruleKey === ruleKey));
    return g ? g.label : null;
  };

  const runAsk = async () => {
    setAsking('loading');
    try { setAsking(await assist({ mode: 'ask', question })); }
    catch (e) { setAsking({ error: e.message }); }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ask anything */}
      <div className="bg-white border border-slate-200 p-6 flex flex-col gap-2.5">
        <div className="font-serif text-xl text-slate-900">Not sure what&apos;s covered? Just ask</div>
        <p className="text-sm text-slate-600 leading-relaxed">
          e.g. &ldquo;Is there something that spreads my bookings across quiet days?&rdquo; or
          &ldquo;What happens when someone says maybe later?&rdquo;
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            maxLength={500}
            className={inputClasses}
            placeholder="Ask about your instructions…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && question.trim()) runAsk(); }}
          />
          <button
            type="button"
            onClick={runAsk}
            disabled={!question.trim() || asking === 'loading'}
            className="px-4 py-2 text-sm font-semibold text-emerald-900 bg-emerald-50 border border-emerald-600 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
          >
            {asking === 'loading' ? 'Looking…' : 'Ask'}
          </button>
        </div>
        {asking && asking !== 'loading' ? (
          asking.error ? (
            <p className="text-sm text-red-700">{asking.error}</p>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 px-4 py-3 flex flex-col gap-1.5">
              <p className="text-[15px] text-slate-800 leading-relaxed">{asking.answer}</p>
              {asking.ruleKey ? (
                <p className="text-sm text-slate-600">
                  The instruction behind that: <strong>{asking.title}</strong>
                  {groupFor(asking.ruleKey) ? <> - open the <strong>{groupFor(asking.ruleKey)}</strong> group below to read or change it.</> : null}
                </p>
              ) : null}
            </div>
          )
        ) : null}
      </div>

      {/* search */}
      <input
        type="text"
        className={inputClasses}
        placeholder="Or filter the list - type a word like links, Friday, booking…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* folded groups */}
      {groups.map((g) => {
        const visible = g.items.filter(matches);
        if (q && !visible.length) return null;
        const open = q ? true : !!openGroups[g.key];
        return (
          <div key={g.key} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setOpenGroups((s) => ({ ...s, [g.key]: !s[g.key] }))}
              aria-expanded={open}
              className="w-full flex items-baseline gap-3 text-left group"
            >
              <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-emerald-700 group-hover:text-emerald-900">{g.label}</h3>
              <span className="text-xs text-slate-400 tabular-nums">{q ? `${visible.length} of ${g.items.length}` : g.items.length}</span>
              <span className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400">{open ? 'fold' : 'unfold'}</span>
            </button>
            {open ? (
              <div className="flex flex-col">
                {visible.map((item) => (
                  <InstructionItem key={item.ruleKey} item={item} assist={assist} commitChange={commitChange} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const KIND_PILL = {
  fixed: ['Guardrail', 'text-amber-800 bg-amber-50 border-amber-300'],
  standard: ['Standard - shared', 'text-emerald-800 bg-emerald-50 border-emerald-300'],
  yours: ['Yours', 'text-slate-700 bg-slate-100 border-slate-300'],
  // A kit prompt nobody has filled in yet - a space, not a half-written instruction.
  unwritten: ['Not written yet', 'text-sky-800 bg-sky-50 border-sky-300'],
};

function InstructionItem({ item, assist, commitChange }) {
  const [open, setOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [state, setState] = useState(null); // null | 'loading' | 'done' | {proposal} | {answer} | {error}
  const [explain, setExplain] = useState(null); // null | 'loading' | {text} | {error}
  const [pillLabel, pillClasses] = item.unwritten
    ? KIND_PILL.unwritten
    : (KIND_PILL[item.kind] || KIND_PILL.standard);

  // The box takes anything - a question gets an answer, a change request gets a proposal.
  const run = async () => {
    setState('loading');
    try {
      const r = await assist({ mode: 'change', ruleKey: item.ruleKey, request });
      setState(r.action === 'answer' ? { answer: r.text } : { proposal: r });
    } catch (e) { setState({ error: e.message }); }
  };

  const runExplain = async (angle) => {
    setExplain('loading');
    try { setExplain(await assist({ mode: 'explain', ruleKey: item.ruleKey, angle })); }
    catch (e) { setExplain({ error: e.message }); }
  };

  return (
    <div className="border-b border-slate-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-left py-3 flex items-baseline gap-3 group"
      >
        <span className="font-semibold text-slate-900 group-hover:text-emerald-800">{item.title}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 border whitespace-nowrap ${pillClasses}`}>{pillLabel}</span>
        <span className="flex-1" />
        <span className="text-xs text-slate-400 whitespace-nowrap">{open ? 'close' : 'open'}</span>
      </button>
      {!open && (item.blurb || item.gist) ? (
        <p className="pb-3 -mt-1 text-sm text-slate-500 leading-relaxed">{item.blurb || item.gist}</p>
      ) : null}

      {open ? (
        <div className="pb-4 flex flex-col gap-3">
          {item.unwritten ? (
            <div className="bg-sky-50 border border-sky-200 px-4 py-3 flex flex-col gap-2">
              <p className="text-[15px] text-slate-800 leading-relaxed">{item.blurb}</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                <strong>This one is a space, not a gap.</strong> Nothing is broken and nothing is
                missing - it is simply yours to write when you are ready, and most people are better
                off leaving it until they have had a few real conversations. Wingguy works fine
                without it. When you want to fill it in, say so in the box below or in a chat.
              </p>
            </div>
          ) : null}
          <div className="bg-white border-l-2 border-emerald-600 px-4 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{item.body}</div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runExplain('plain')}
              disabled={explain === 'loading'}
              className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-300 hover:border-emerald-600 hover:text-emerald-900 disabled:opacity-60"
            >
              {explain === 'loading' ? 'Explaining…' : 'Explain this in plain English'}
            </button>
            <button
              type="button"
              onClick={() => runExplain('impact')}
              disabled={explain === 'loading'}
              className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-300 hover:border-emerald-600 hover:text-emerald-900 disabled:opacity-60"
            >
              What does this mean for my messages?
            </button>
          </div>
          {explain && explain !== 'loading' ? (
            explain.error ? (
              <p className="text-sm text-red-700">{explain.error}</p>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 px-4 py-3 text-[15px] text-slate-800 leading-relaxed">{explain.text}</div>
            )
          ) : null}

          {item.kind === 'fixed' ? (
            <p className="text-[13px] text-amber-800">
              This one is a guardrail - it applies to everyone and cannot be changed, by you or by us.
              It is part of why Wingguy never does anything daft on your behalf.
            </p>
          ) : state === 'done' ? (
            <p className="text-sm font-semibold text-emerald-800">Saved - this is now your version.</p>
          ) : !changeOpen ? (
            <button
              type="button"
              onClick={() => setChangeOpen(true)}
              className="self-start text-sm text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
            >
              Question, or not how you&apos;d do it? Tell it here
            </button>
          ) : (
            <div className="flex flex-col gap-2.5">
              <textarea
                rows={2}
                maxLength={1500}
                placeholder={'Ask or change, in your own words - e.g. "why does this matter?" or "I only want one link"'}
                className={inputClasses}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={run}
                  disabled={!request.trim() || state === 'loading'}
                  className="px-4 py-2 text-sm font-semibold text-emerald-900 bg-emerald-50 border border-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {state === 'loading' ? 'Working…' : 'Send'}
                </button>
                <button
                  type="button"
                  onClick={() => { setChangeOpen(false); setState(null); setRequest(''); }}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-300 hover:text-slate-900"
                >
                  Never mind
                </button>
              </div>
              {state && state !== 'loading' ? (
                state.error ? (
                  <p className="text-sm text-red-700">{state.error}</p>
                ) : state.answer ? (
                  <div className="bg-emerald-50 border border-emerald-200 px-4 py-3 flex flex-col gap-1.5">
                    <p className="text-[15px] text-slate-800 leading-relaxed">{state.answer}</p>
                    <p className="text-[13px] text-slate-500">Want it different? Say so in the same box and it will draft the change.</p>
                  </div>
                ) : state.proposal ? (
                  <ProposalCard
                    proposal={state.proposal}
                    onSave={async () => { await commitChange(state.proposal); setState('done'); setChangeOpen(false); }}
                    onDismiss={() => setState(null)}
                  />
                ) : null
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SaveNote({ status }) {
  if (!status) return null;
  if (status === 'saving') return <span className="text-xs text-slate-400 whitespace-nowrap">Saving…</span>;
  if (status === 'saved') return <span className="text-xs text-emerald-700 font-semibold whitespace-nowrap">Saved</span>;
  return <span className="text-xs text-red-600 whitespace-nowrap">{status}</span>;
}

function Shell({ children, wide }) {
  return (
    <div className="min-h-screen bg-[#F4F6F4]">
      <div className={`mx-auto px-6 py-14 flex flex-col ${wide ? 'max-w-3xl gap-16' : 'max-w-2xl gap-4'}`}>
        {children}
      </div>
    </div>
  );
}

export default function WingguySetup() {
  return (
    <Suspense fallback={<Shell><p className="text-slate-500">Opening your setup…</p></Shell>}>
      <WingguySetupInner />
    </Suspense>
  );
}
