"use client";

/**
 * "Your Wingguy" — the page a client opens from their own private link to see how their
 * instructions work and fill in the half that is theirs.
 *
 * STANDALONE ON PURPOSE. No <Layout>, no client-profile bootstrap, no WordPress auth: this has to
 * work for someone who has been sent a link and nothing else. The portal token in ?token= is the
 * whole authentication story (the backend's authenticateUserWithTestMode takes it on its own), and
 * it is the same link the coach already sends.
 *
 * Saving is per field, on blur — so a dropped connection loses one answer, not the lot, and there
 * is no Save button to forget to press. Every write is history-logged at the store.
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBackendBase } from '../services/api';

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
    body: 'How you sign off. What you say when someone asks what you do. The earliest you would ever take a meeting. These start with sensible defaults - and further down this page is where you make them yours.',
    eg: '',
  },
];

const LOOP = [
  ['It writes the draft', 'A connection request, a reply, a follow-up email after a call. It pulls in what it knows about the person first.'],
  ['You read it before it goes anywhere', 'Always. Nothing is ever sent on your behalf without you seeing it. Change what is not right and send it.'],
  ['You tell it what was off', '"Don\'t say reach out." "That\'s too long." Plain English, in your own words - you never have to phrase it like an instruction.'],
  ['It remembers - for good', 'Not just for the next message. It shows you what it is about to change, then that correction applies to everything it writes from then on.'],
];

const SAY = [
  ['Never say "reach out"', 'Bans the phrase everywhere, in every message it ever writes for you.'],
  ['That was too long - keep them to about four lines', 'Works just as well as a reaction to a draft you are looking at right now.'],
  ['What have I changed?', 'Shows you everything that is yours, next to the standard version.'],
  ['Go back to the standard one', 'Undoes a change of yours and puts ours back. Nothing is ever lost.'],
];

const TONES = {
  emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  amber: 'text-amber-800 bg-amber-50 border-amber-300',
  slate: 'text-slate-700 bg-white border-slate-200',
};

function WingguySetupInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  // Admin/testing lane, already supported by the backend's auth middleware: ?client=X&devKey=Y
  // opens any tenant's page without minting a portal link. Lets the coach look at exactly what a
  // given client sees. A client's own link never carries these.
  const client = searchParams.get('client') || '';
  const devKey = searchParams.get('devKey') || '';
  const hasAuth = !!token || !!(client && devKey);

  const authHeaders = useCallback((extra = {}) => {
    const h = { ...extra };
    if (token) h['x-portal-token'] = token;
    if (client) h['x-client-id'] = client;
    if (devKey) h['x-dev-key'] = devKey;
    return h;
  }, [token, client, devKey]);

  const [state, setState] = useState({ status: 'loading', error: '', data: null });
  const [values, setValues] = useState({});
  const [saveState, setSaveState] = useState({}); // key -> 'saving' | 'saved' | error string

  const fieldId = (f) => `${f.scope}:${f.key}`;

  useEffect(() => {
    if (!hasAuth) {
      setState({ status: 'no-token', error: '', data: null });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getBackendBase()}/api/wingguy/setup`, {
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setState({ status: 'error', error: data.message || data.error || 'We could not open your setup.', data: null });
          return;
        }
        const initial = {};
        data.fields.forEach((f) => { initial[`${f.scope}:${f.key}`] = f.value || ''; });
        setValues(initial);
        setState({ status: 'ready', error: '', data });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', error: 'We could not reach Wingguy. Check your connection and refresh.', data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [hasAuth, authHeaders]);

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
    } catch (e) {
      setSaveState((s) => ({ ...s, [id]: 'Not saved - check your connection.' }));
    }
  }, [authHeaders]);

  // --- states before the form ---------------------------------------------------------------

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
        <p className="text-slate-600 mt-4">{state.error}</p>
        <p className="text-slate-500 text-sm mt-3">
          If that link has stopped working, ask your coach for a fresh one.
        </p>
      </Shell>
    );
  }

  const { data } = state;
  const answered = data.fields.filter((f) => String(values[fieldId(f)] || '').trim()).length;
  const pct = Math.round((answered / data.total) * 100);

  return (
    <Shell wide>
      {/* masthead */}
      <header className="flex flex-col gap-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-700">
          Getting started with Wingguy
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl leading-[1.1] text-slate-900">
          Teaching it to write like you
        </h1>
        <p className="font-serif text-lg leading-relaxed text-slate-600 max-w-2xl">
          Wingguy drafts your messages and emails. It sounds like you because it reads a set of
          instructions before every single thing it writes - and <em>some of those instructions are
          yours to write.</em> This page explains how that works, and gets your half of it set up.
        </p>
      </header>

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
        <p className="text-slate-600 max-w-2xl">
          That fourth step is the one most people underuse. The Wingguy you are working with in three
          months should sound noticeably more like you than today&apos;s - and that is almost entirely
          down to how often you bother to tell it when it is off.
        </p>
      </section>

      {/* the form */}
      <section className="flex flex-col gap-6">
        <SectionHead
          title="Now let's set yours up"
          sub="Everything saves by itself as you go, so you can stop whenever you like and come back to this same link. Anything you skip keeps its sensible default."
        />

        <div className="flex items-center gap-4 text-sm text-slate-500 py-2">
          <span className="tabular-nums whitespace-nowrap">{answered} of {data.total} filled in</span>
          <span className="flex-1 h-[3px] bg-slate-200 overflow-hidden">
            <span className="block h-full bg-emerald-600 transition-all duration-300" style={{ width: `${pct}%` }} />
          </span>
        </div>

        {data.groups.map((group) => {
          const inGroup = data.fields.filter((f) => f.group === group);
          if (!inGroup.length) return null;
          return (
            <div key={group} className="flex flex-col gap-6">
              <div className="flex items-baseline gap-3">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">{group}</h3>
                <span className="flex-1 h-px bg-slate-200" />
              </div>
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
        })}
      </section>

      {/* changing it later */}
      <section className="flex flex-col gap-6">
        <SectionHead
          title="Changing anything else"
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
        <p className="text-slate-600 max-w-2xl text-[15px]">
          Rewording an instruction is a conversation rather than a form, because Wingguy needs to
          check it against everything already set up and tell you if two of them would fight. It
          always shows you what it is about to change before it changes anything.
        </p>
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

function Field({ field, value, status, onChange, onCommit }) {
  const [committed, setCommitted] = useState(value);

  const commit = (v) => {
    if (v === committed) return;
    setCommitted(v);
    onCommit(v);
  };

  const inputClasses =
    'w-full border border-slate-300 bg-white px-3 py-2.5 text-slate-900 text-base leading-relaxed ' +
    'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent';

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
