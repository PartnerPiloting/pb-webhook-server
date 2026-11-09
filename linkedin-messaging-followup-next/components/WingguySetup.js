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
import { PageNav, usePageAuth } from './WingguyReview';
import { wingguyHubPath } from '../utils/clientUtils';

function WingguySetupInner() {
  const searchParams = useSearchParams();
  // Auth comes from the link, with a fallback to wherever the portal shell parked it (see
  // usePageAuth). The admin lane - ?client=X&devKey=Y - opens any tenant's page without minting
  // a portal link; a client's own link never carries those.
  const { token, client, devKey, hasAuth, ready, query } = usePageAuth(searchParams);

  const authHeaders = useCallback((extra = {}) => {
    const h = { ...extra };
    if (token) h['x-portal-token'] = token;
    if (client) h['x-client-id'] = client;
    if (devKey) h['x-dev-key'] = devKey;
    return h;
  }, [token, client, devKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#claude-key') return;
    window.location.replace(`${wingguyHubPath()}${window.location.search}#claude-key`);
  }, []);

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
    if (!ready) return;
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
  }, [ready, hasAuth, authHeaders, loadInstructions]);

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
        {group === 'Meetings' && data.bookingHours ? (
          <BookingHoursEditor initial={data.bookingHours} authHeaders={authHeaders} onSaved={loadInstructions} />
        ) : null}
      </div>
    );
  });

  return (
    <Shell wide>
      <PageNav current="setup" query={query} />
      <header className="flex flex-col gap-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-700">
          Your instructions
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl leading-[1.1] text-slate-900">
          Tell Wingguy about you
        </h1>
        <p className="font-serif text-lg leading-relaxed text-slate-600 max-w-2xl">
          Wingguy reads a set of instructions before every single thing it writes - and some of
          those instructions are yours. This page is where you write them. It takes about ten
          minutes, and nothing here can be broken or lost.
        </p>
        <p className="text-[15px] text-slate-600 max-w-2xl">
          Not sure what any of this is for?{' '}
          <a className="text-emerald-800 font-semibold underline underline-offset-2 hover:text-emerald-900"
            href={`/my-wingguy/about?${query}`}>
            See what Wingguy does
          </a>{' '}
          first - it is a ten-minute read and it makes this page quicker.
        </p>
      </header>

      {/* The Claude connection and the key live on the hub with the rest of the kit (17 Oct 2026).
          This page is "about you". One line here when the key is missing or dead, because the voice
          boxes' live examples need it and nobody should fill in ten minutes of form and wonder. */}
      <KeyWarning authHeaders={authHeaders} query={query} />

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
          Once this is done, it keeps learning from every draft you fix.{' '}
          <a className="underline hover:text-slate-700" href={`/my-wingguy/review?${searchParams.toString()}`}>
            How that works
          </a>.
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
          ref={(el) => growToFit(el)}
          className={`${inputClasses} resize-y`}
          value={value}
          onChange={(e) => { growToFit(e.target); onChange(e.target.value); }}
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

      {field.pointer ? (
        <p className="mt-1 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-slate-700 leading-relaxed">
          {field.pointer.text}{' '}
          <a href={field.pointer.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline whitespace-nowrap">
            {field.pointer.linkText} &rarr;
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** Grow a textarea to show everything typed in it, so a long answer is never hidden behind a scroll. */
function growToFit(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
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

  // forceNew = the client has read the overlap note and says it is a separate point. Their call wins
  // (Matthew Bulat, 2026-09-28 - a wet-season rule was blocked as a "twin" of the timezone one).
  const run = async (forceNew = false) => {
    setState('loading');
    try {
      const r = await assist({ mode: 'change', request: text, ...(forceNew ? { forceNew: true } : {}) });
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
        onClick={() => run(false)}
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
              If yours really belongs in that one, find it in the list below, open it, and tell it your
              change there. If it&apos;s a separate point, add it as your own - it won&apos;t change the
              other one.
            </p>
            <button
              type="button"
              onClick={() => run(true)}
              className="self-start mt-1 px-4 py-2 text-sm font-semibold text-emerald-900 bg-emerald-50 border border-emerald-600 hover:bg-emerald-100"
            >
              Add it as my own anyway
            </button>
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

/**
 * "Your booking hours" (10 Nov 2026) - which days Wingguy offers people, the earliest and latest a
 * meeting may START each day, the gap between meetings and how many in a day. Replaces the old
 * earliest-time / normal-start / meetings-a-day boxes, which the code that picks times never read.
 * Saves through PUT /setup/booking-hours - the same save as "set my booking hours" in Claude.
 */
const HOURS_DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];
const HOURS_TIMES = (() => {
  const out = [];
  for (let m = 6 * 60; m <= 21 * 60; m += 30) {
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    out.push({ value: `${String(h).padStart(2, '0')}:${mm}`, label: `${(h % 12) || 12}:${mm}${h < 12 ? 'am' : 'pm'}` });
  }
  return out;
})();
const HOURS_GAPS = [0, 15, 30, 45, 60, 90, 120];

function BookingHoursEditor({ initial, authHeaders, onSaved }) {
  const [hours, setHours] = useState(initial);
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  // A time that is off the half-hour grid (typed in chat as 8:45) still shows as itself.
  const timeOptions = (current) => (HOURS_TIMES.some((t) => t.value === current) || !current
    ? HOURS_TIMES
    : [...HOURS_TIMES, { value: current, label: current }].sort((a, b) => a.value.localeCompare(b.value)));

  const change = (next) => { setHours(next); setDirty(true); setStatus(''); };
  const setDay = (key, value) => change({ ...hours, week: { ...hours.week, [key]: value } });

  const save = async () => {
    setStatus('saving');
    try {
      const res = await fetch(`${getBackendBase()}/api/wingguy/setup/booking-hours`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          week: hours.week,
          bufferMins: hours.bufferMins,
          maxMeetingsPerDay: hours.maxMeetingsPerDay,
          dailyLimitHard: hours.dailyLimitHard,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setStatus(data.error || 'Not saved - try again.'); return; }
      setHours(data.bookingHours);
      setDirty(false);
      setStatus('saved');
      if (onSaved) onSaved();
    } catch (e) {
      setStatus('Not saved - check your connection.');
    }
  };

  const selectClasses = 'border border-slate-300 bg-white px-2 py-1.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-semibold text-slate-900 leading-snug">Your booking hours</span>
        <p className="text-sm text-slate-600 leading-relaxed">
          The days and times Wingguy offers people - in Claude and in your LinkedIn drafts. These are
          START times: the earliest and the latest a meeting can begin. You can also just tell
          Wingguy in Claude - <span className="font-medium">&ldquo;set my booking hours&rdquo;</span> - and it
          will show up here.
        </p>
        {hours.source === 'setup' ? (
          <p className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-slate-700 leading-relaxed">
            Worked out from what you told us when you set up. Check it looks right, change anything
            that is not you, and press Save.
          </p>
        ) : hours.source === 'standard' ? (
          <p className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-slate-700 leading-relaxed">
            These are the standard hours. Change anything that is not you, and press Save.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col divide-y divide-slate-100 border border-slate-200 bg-white">
        {HOURS_DAYS.map(([key, name]) => {
          const day = hours.week[key];
          return (
            <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
              <label className="flex items-center gap-2 w-32 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={!!day}
                  onChange={(e) => setDay(key, e.target.checked ? { first: '09:00', last: '16:30' } : null)}
                />
                {name}
              </label>
              {day ? (
                <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  from
                  <select className={selectClasses} value={day.first}
                    onChange={(e) => setDay(key, { first: e.target.value, last: day.last < e.target.value ? e.target.value : day.last })}>
                    {timeOptions(day.first).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  to
                  <select className={selectClasses} value={day.last}
                    onChange={(e) => setDay(key, { first: day.first > e.target.value ? e.target.value : day.first, last: e.target.value })}>
                    {timeOptions(day.last).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {day.first === day.last ? <span className="text-slate-400">(that start time only)</span> : null}
                </span>
              ) : (
                <span className="text-sm text-slate-400">No meetings</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          Gap between meetings
          <select className={selectClasses} value={hours.bufferMins}
            onChange={(e) => change({ ...hours, bufferMins: Number(e.target.value) })}>
            {HOURS_GAPS.map((g) => <option key={g} value={g}>{g ? `${g} minutes` : 'none'}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Meetings in a day
          <select className={selectClasses} value={hours.maxMeetingsPerDay}
            onChange={(e) => change({ ...hours, maxMeetingsPerDay: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!hours.dailyLimitHard}
            onChange={(e) => change({ ...hours, dailyLimitHard: e.target.checked })} />
          A firm limit - never offer a day that is already full
        </label>
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        Without the firm limit, Wingguy offers lighter days first and only uses a full day when nothing else fits.
      </p>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={status === 'saving' || (!dirty && hours.source === 'saved')}
          className="px-4 py-2 text-sm font-semibold bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-slate-300"
        >
          Save my booking hours
        </button>
        <SaveNote status={status} />
      </div>
    </div>
  );
}

function SaveNote({ status }) {
  if (!status) return null;
  if (status === 'saving') return <span className="text-xs text-slate-400 whitespace-nowrap">Saving…</span>;
  if (status === 'saved') return <span className="text-xs text-emerald-700 font-semibold whitespace-nowrap">Saved</span>;
  return <span className="text-xs text-red-600 whitespace-nowrap">{status}</span>;
}

/** One line, only when it matters: no key, or a key that has stopped working. Managed-plan
 *  clients and assistants never see it. The key itself is pasted on the hub. */
function KeyWarning({ authHeaders, query }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBackendBase()}/api/wingguy/setup/claude-key`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.ok && !data.managed) setSt(data);
      } catch (e) { /* no warning rather than a wrong one */ }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);
  if (!st || (st.hasKey && !st.failingSince)) return null;
  const hub = `${wingguyHubPath()}${query ? `?${query}` : ''}#claude-key`;
  return (
    <p className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
      <strong>{st.hasKey ? 'Your Claude key has stopped working.' : 'Wingguy can\u2019t write anything until your Claude key is in.'}</strong>{' '}
      <a className="font-semibold underline underline-offset-2 hover:text-amber-950" href={hub}>
        {st.hasKey ? 'Check it on Setup and help' : 'Add it on Setup and help'} &rarr;
      </a>
      {' '}- the examples on this page come alive once it is.
    </p>
  );
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
