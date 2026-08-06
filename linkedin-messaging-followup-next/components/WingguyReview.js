"use client";

/**
 * "What's changed lately" — the review page. The small, self-contained window onto a client's own
 * instruction changes: who changed what, when, before and after, with notes in the margin.
 *
 * Two people share one tenant here: the business owner glances at this page, whoever operates
 * Wingguy day to day (a VA, a sales assistant) acts on what they read. Links carry &as=<name> for
 * attribution - the token is still the whole authentication story, the name just signs notes and
 * stamps changes so the history reads "April, Tuesday" instead of "someone, sometime".
 *
 * Sits inside the portal shell (so the menu is there and "My Wingguy" stays highlighted) but
 * needs no portal login: the token in the link IS portal auth. Deliberately short - this page is
 * one list and nothing else, so a glance stays a glance. The change door under each entry runs
 * the same assist propose → explicit Save → commit lane the setup page uses; notes never change
 * anything themselves.
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBackendBase } from '../services/api';


/**
 * The auth on these pages is the link, not a session - but the portal shell logs the visitor in
 * and then cleans ?token= off the address bar, so by the time a page reads the query its only
 * credential can already be gone. It is still there in the storage the portal parked it in.
 *
 * Read in an effect rather than during render on purpose: the server render has no storage, so
 * resolving it inline produced markup that said "this link is missing its key" and hydration kept
 * it - a client with a perfectly good link locked out of their own page. `ready` stays false until
 * the check has actually happened, so nothing decides there is no key before looking.
 */
function usePageAuth(searchParams) {
  const [stored, setStored] = useState(null); // null = not looked yet
  useEffect(() => {
    const get = (k) => {
      try { return window.localStorage.getItem(k) || window.sessionStorage.getItem(k) || ''; }
      catch (e) { return ''; }
    };
    setStored({
      token: get('portalToken'),
      client: get('clientCode') || get('clientId'),
      devKey: get('devKey'),
    });
  }, []);

  const qToken = searchParams.get('token') || '';
  const qClient = searchParams.get('client') || searchParams.get('clientId') || '';
  const qDevKey = searchParams.get('devKey') || '';
  const token = qToken || (stored ? stored.token : '');
  const client = qClient || (stored ? stored.client : '');
  const devKey = qDevKey || (stored ? stored.devKey : '');
  const hasQueryAuth = !!qToken || !!(qClient && qDevKey);
  return {
    token, client, devKey,
    hasAuth: !!token || !!(client && devKey),
    // Safe to say "no key" only once the query had none AND storage has been checked.
    ready: hasQueryAuth || stored !== null,
    // What to hang on links between these pages, so moving around never sheds the credential.
    query: (() => {
      const q = searchParams.toString();
      if (q) return q;
      const p = new URLSearchParams();
      if (token) p.set('token', token);
      else if (client && devKey) { p.set('client', client); p.set('devKey', devKey); }
      return p.toString();
    })(),
  };
}

const VERB = { commit: 'changed', add: 'added', retire: 'retired', revert: 'put back' };

function verbFor(c) {
  if (c.kind === 'blank') {
    if (c.toValue == null || c.blankStatus === 'retired') return 'cleared';
    return c.fromValue == null ? 'filled in' : 'changed';
  }
  // No before-body means nothing was there: a brand-new instruction, not a change to one.
  if (c.action === 'commit' && c.beforeBody == null) return VERB.add;
  return VERB[c.action] || 'changed';
}

function friendlyWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    + ', ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function WingguyReviewInner() {
  const searchParams = useSearchParams();
  const { token, client, devKey, hasAuth, ready, query } = usePageAuth(searchParams);
  const asParam = searchParams.get('as') || '';

  // The signature on notes and changes. The link usually carries it (&as=April); if not, the
  // first note asks once and the browser remembers.
  const [name, setName] = useState(asParam);
  useEffect(() => {
    if (asParam) { try { window.localStorage.setItem('wg-page-name', asParam); } catch (e) { /* private mode */ } }
    else { try { setName(window.localStorage.getItem('wg-page-name') || ''); } catch (e) { /* private mode */ } }
  }, [asParam]);

  const authHeaders = useCallback((extra = {}) => {
    const h = { ...extra };
    if (token) h['x-portal-token'] = token;
    if (client) h['x-client-id'] = client;
    if (devKey) h['x-dev-key'] = devKey;
    if (name) h['x-page-name'] = name;
    return h;
  }, [token, client, devKey, name]);

  const [state, setState] = useState({ status: 'loading', error: '', changes: [], openNotes: 0 });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getBackendBase()}/api/wingguy/setup/changes`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setState({ status: 'error', error: data.message || data.error || 'We could not open the change history.', notYet: res.status === 403, changes: [], openNotes: 0 });
        return;
      }
      setState({ status: 'ready', error: '', changes: data.changes || [], openNotes: data.openNotes || 0 });
    } catch (e) {
      setState({ status: 'error', error: 'We could not reach Wingguy. Check your connection and refresh.', changes: [], openNotes: 0 });
    }
  }, [authHeaders]);

  useEffect(() => {
    if (!ready) return;
    if (!hasAuth) { setState((s) => ({ ...s, status: 'no-token' })); return; }
    load();
  }, [ready, hasAuth, load]);

  const api = useCallback(async (path, payload) => {
    const res = await fetch(`${getBackendBase()}/api/wingguy/${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'That did not work - try again in a moment.');
    return data;
  }, [authHeaders]);

  if (ready && !hasAuth) {
    return (
      <Shell>
        <h1 className="font-serif text-3xl text-slate-900">This link is missing its key</h1>
        <p className="text-slate-600">The address you followed does not carry an access token. Use the exact link you were sent - or ask for a fresh one.</p>
      </Shell>
    );
  }
  if (state.status === 'loading') return <Shell><p className="text-slate-500">Opening the change history…</p></Shell>;
  if (state.status === 'error') {
    return (
      <Shell>
        <h1 className="font-serif text-3xl text-slate-900">{state.notYet ? 'Not switched on yet' : 'Something went wrong'}</h1>
        <p className="text-slate-600">{state.error}</p>
      </Shell>
    );
  }

  const mainChanges = state.changes.filter((c) => !c.housekeeping);
  const housekeeping = state.changes.filter((c) => c.housekeeping);

  return (
    <Shell>
      <PageNav current="review" query={query} />
      <div className="flex flex-col gap-3 pb-6 border-b border-slate-200">
        <h1 className="font-serif text-3xl text-slate-900">What&apos;s changed lately</h1>
        <p className="text-slate-600">
          Every change made to this Wingguy&apos;s own instructions, newest first - who made it, what
          it said before, what it says now. Read one and want to react? Leave a note on it; whoever
          runs the page day to day sees it right here and can act on it on the spot. Nothing on this
          page changes anything by itself.
        </p>
        {state.openNotes ? (
          <p className="text-[15px] text-amber-800 bg-amber-50 border border-amber-200 px-4 py-2.5">
            {state.openNotes} note{state.openNotes === 1 ? '' : 's'} waiting below - look for the amber marks.
          </p>
        ) : null}
      </div>

      <AddInstructionCard api={api} name={name} reload={load} />

      {mainChanges.length === 0 ? (
        <p className="text-slate-600">
          No changes yet. Everything this Wingguy runs on is still the shared standard set - the
          first change anyone makes (here, on the setup page, or in a chat) will appear in this list.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {mainChanges.map((c) => (
            <ChangeCard key={c.id} change={c} name={name} setName={setName} api={api} reload={load} />
          ))}
        </div>
      )}

      {housekeeping.length ? <HousekeepingFold changes={housekeeping} name={name} setName={setName} api={api} reload={load} /> : null}
    </Shell>
  );
}

/** The sub-nav across the three Wingguy pages, under the portal's own menu. Every link carries
 *  whatever auth the visitor arrived with, so a client following a plain link moves around the
 *  section exactly as someone signed in to the portal does. */
function PageNav({ current, query }) {
  const q = query || '';
  const href = (path) => (q ? `${path}?${q}` : path);
  const tab = (label, path, key) => (current === key
    ? <span key={key} className="text-sm font-semibold text-slate-900 border-b-2 border-emerald-600 pb-1">{label}</span>
    : <a key={key} className="text-sm text-slate-500 hover:text-slate-800 pb-1" href={href(path)}>{label}</a>);
  return (
    <div className="flex flex-wrap items-baseline gap-6 pb-2">
      <a className="text-sm text-slate-500 hover:text-slate-800 pb-1" href={href('/my-wingguy')}>&larr; My Wingguy</a>
      {tab('What it does', '/my-wingguy/about', 'about')}
      {tab('Your instructions', '/my-wingguy/setup', 'setup')}
      {tab("What's changed", '/my-wingguy/review', 'review')}
    </div>
  );
}

/** Propose a new instruction, chat-style, through the same guarded door as everywhere else:
 *  Wingguy drafts it, checks for an existing instruction covering the same ground (offering to
 *  change that one instead of adding a twin), and nothing saves without an explicit click. Lives
 *  HERE because adding is a returning-visitor act - nobody knows on day one what they want to
 *  tell Wingguy; they find out in week three, on this page, reading what it has been doing. */
function AddInstructionCard({ api, name, reload }) {
  const [text, setText] = useState('');
  const [state, setState] = useState(null); // null | 'loading' | 'done' | {proposal} | {overlap, followText, followState}
  const run = async () => {
    if (!text.trim()) return;
    setState('loading');
    try {
      const r = await api('setup/assist', { mode: 'change', request: text.trim() });
      setState(r.action === 'overlap' ? { overlap: r, followText: '', followState: null } : { proposal: r });
    } catch (e) { setState({ error: e.message }); }
  };
  // The overlap path: rather than sending them elsewhere, take their change to THAT instruction
  // right here - same per-rule lane the cards below use.
  const runFollow = async () => {
    setState((s) => ({ ...s, followState: 'loading' }));
    try {
      const r = await api('setup/assist', { mode: 'change', ruleKey: state.overlap.ruleKey, request: state.followText.trim() });
      setState((s) => ({ ...s, followState: r.action === 'answer' ? { answer: r.text } : { proposal: r } }));
    } catch (e) { setState((s) => ({ ...s, followState: { error: e.message } })); }
  };
  const save = async (p) => {
    await api('setup/change-commit', {
      ruleKey: p.ruleKey, context: p.context, ruleType: p.ruleType,
      body: p.proposedBody, expectedVersion: p.expectedVersion, explanation: p.explanation,
      as: name || undefined,
    });
    setText('');
    setState('done');
    await reload();
  };
  return (
    <div className="bg-white border border-emerald-600 px-5 py-4 flex flex-col gap-2.5">
      <p className="font-serif text-xl text-slate-900">Want Wingguy to start doing something differently?</p>
      <p className="text-sm text-slate-600 leading-relaxed">
        Say it the way you&apos;d say it out loud - &ldquo;never message anyone on a Friday&rdquo;,
        &ldquo;always mention I&apos;m Brisbane based&rdquo;. Wingguy turns it into a proper
        instruction, checks nothing existing already covers it, and shows you before anything saves.
      </p>
      <div className="flex gap-2">
        <input
          type="text" value={text} maxLength={1500}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder={'e.g. never message anyone on a Friday'}
          className="flex-1 border border-slate-300 px-3 py-2 text-[15px]"
        />
        <button type="button" onClick={run} disabled={state === 'loading' || !text.trim()}
          className="px-4 py-2 text-sm font-semibold text-emerald-900 bg-emerald-50 border border-emerald-600 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap">
          {state === 'loading' ? 'Checking…' : 'Suggest it'}
        </button>
      </div>
      {state && state !== 'loading' ? (
        state === 'done' ? (
          <p className="text-sm font-semibold text-emerald-800">Saved - it applies from the next thing Wingguy writes, and it is at the top of the list below.</p>
        ) : state.error ? (
          <p className="text-sm text-red-700">{state.error}</p>
        ) : state.proposal ? (
          <div className="bg-slate-50 border border-slate-200 px-4 py-3 flex flex-col gap-2">
            <p className="text-sm text-slate-600">{state.proposal.explanation}</p>
            <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap">{state.proposal.proposedBody}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => save(state.proposal)} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium">Save this instruction</button>
              <button type="button" onClick={() => setState(null)} className="text-sm text-slate-500 underline">Never mind</button>
            </div>
          </div>
        ) : state.overlap ? (
          <div className="bg-amber-50 border border-amber-300 px-4 py-3 flex flex-col gap-2">
            <p className="text-[15px] text-slate-800 leading-relaxed">
              There is already an instruction covering this ground: <span className="font-semibold">&ldquo;{state.overlap.title}&rdquo;</span>.
            </p>
            {state.overlap.why ? <p className="text-sm text-slate-700 leading-relaxed">{state.overlap.why}</p> : null}
            <p className="text-sm text-slate-700 leading-relaxed">
              Two instructions on the same ground quietly fight each other - better to change that
              one. Describe how it should be different:
            </p>
            <div className="flex gap-2">
              <input
                type="text" value={state.followText}
                onChange={(e) => { const v = e.target.value; setState((s) => ({ ...s, followText: v })); }}
                onKeyDown={(e) => { if (e.key === 'Enter') runFollow(); }}
                placeholder={'e.g. it should also cover Fridays'}
                className="flex-1 border border-slate-300 px-3 py-2 text-[15px] bg-white"
              />
              <button type="button" onClick={runFollow} disabled={state.followState === 'loading' || !state.followText.trim()}
                className="px-4 py-2 border border-slate-400 text-slate-800 text-sm font-medium disabled:opacity-40 whitespace-nowrap">
                {state.followState === 'loading' ? 'Working…' : 'Draft the change'}
              </button>
            </div>
            {state.followState && state.followState !== 'loading' ? (
              state.followState.error ? (
                <p className="text-sm text-red-700">{state.followState.error}</p>
              ) : state.followState.answer ? (
                <p className="text-[15px] text-slate-700 bg-white border border-slate-200 px-4 py-3">{state.followState.answer}</p>
              ) : state.followState.proposal ? (
                <div className="bg-white border border-slate-200 px-4 py-3 flex flex-col gap-2">
                  <p className="text-sm text-slate-600">{state.followState.proposal.explanation}</p>
                  <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap">{state.followState.proposal.proposedBody}</p>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => save(state.followState.proposal)} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium">Save this version</button>
                    <button type="button" onClick={() => setState(null)} className="text-sm text-slate-500 underline">Never mind</button>
                  </div>
                </div>
              ) : null
            ) : null}
          </div>
        ) : null
      ) : null}
    </div>
  );
}

/** Engineering reshuffles, folded shut. Kept on the page because the record must be whole; kept
 *  out of the main list because none of them are decisions anyone made about this business. */
function HousekeepingFold({ changes, name, setName, api, reload }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 pt-2">
      <button type="button" onClick={() => setOpen(!open)} className="self-start text-sm text-slate-500 underline hover:text-slate-700">
        {open ? 'Hide housekeeping' : `Housekeeping (${changes.length}) - behind-the-scenes reshuffles of the shared instruction set, kept for the record`}
      </button>
      {open ? changes.map((c) => (
        <ChangeCard key={c.id} change={c} name={name} setName={setName} api={api} reload={reload} />
      )) : null}
    </div>
  );
}

function ChangeCard({ change: c, name, setName, api, reload }) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'note' | 'sorted-<id>' | 'undo' | error text
  const [door, setDoor] = useState({ text: '', state: null }); // change door: null | 'loading' | {proposal} | {answer} | {error}
  const [summary, setSummary] = useState(c.summary || null);
  const [deeper, setDeeper] = useState(null); // null | 'loading' | {text} | {example} | {error}
  const [confirmUndo, setConfirmUndo] = useState(false);
  const openNotes = (c.notes || []).filter((n) => !n.resolvedAt).length;

  // Changes made before summaries existed have none stored. Written on first open - one call
  // ever, then it is cached for good, so opening an old entry is the only time anyone waits.
  useEffect(() => {
    if (!open || summary || c.kind === 'blank') return;
    let cancelled = false;
    (async () => {
      try {
        const d = await api('setup/change-explain', { historyId: c.id, depth: 'summary' });
        if (!cancelled) setSummary(d.text || '');
      } catch (e) { if (!cancelled) setSummary(''); }
    })();
    return () => { cancelled = true; };
  }, [open, summary, api, c.id]);

  const explain = async (depth) => {
    setDeeper('loading');
    try {
      const d = await api('setup/change-explain', { historyId: c.id, depth });
      setDeeper(depth === 'example' ? { example: d } : { text: d.text });
    } catch (e) { setDeeper({ error: e.message }); }
  };

  const undo = async () => {
    setBusy('undo');
    try {
      await api('setup/change-undo', { historyId: c.id, as: name || undefined });
      setBusy('');
      setConfirmUndo(false);
      await reload();
    } catch (e) { setBusy(e.message); }
  };

  const leaveNote = async () => {
    if (!noteText.trim()) return;
    setBusy('note');
    try {
      await api('setup/change-note', { historyId: c.id, note: noteText.trim(), as: name || undefined });
      setNoteText('');
      setBusy('');
      await reload();
    } catch (e) { setBusy(e.message); }
  };

  const sorted = async (noteId) => {
    setBusy(`sorted-${noteId}`);
    try {
      await api('setup/change-note-resolve', { noteId, as: name || undefined });
      setBusy('');
      await reload();
    } catch (e) { setBusy(e.message); }
  };

  const runDoor = async () => {
    if (!door.text.trim()) return;
    setDoor((d) => ({ ...d, state: 'loading' }));
    try {
      const data = await api('setup/assist', { mode: 'change', ruleKey: c.ruleKey, request: door.text.trim() });
      // Same shape the setup page handles: a question comes back as {action:'answer', text},
      // anything else IS the proposal object.
      setDoor((d) => ({ ...d, state: data.action === 'answer' ? { answer: data.text } : { proposal: data } }));
    } catch (e) { setDoor((d) => ({ ...d, state: { error: e.message } })); }
  };

  const saveDoor = async () => {
    const p = door.state && door.state.proposal;
    if (!p) return;
    setDoor((d) => ({ ...d, state: 'loading' }));
    try {
      await api('setup/change-commit', {
        ruleKey: p.ruleKey, context: p.context, ruleType: p.ruleType,
        body: p.proposedBody, expectedVersion: p.expectedVersion, explanation: p.explanation,
        as: name || undefined,
      });
      setDoor({ text: '', state: 'done' });
      await reload();
    } catch (e) { setDoor((d) => ({ ...d, state: { error: e.message } })); }
  };

  return (
    <div className="bg-white border border-slate-200">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-5 py-4 flex items-baseline gap-3">
        <span className="text-sm text-slate-500 whitespace-nowrap">{friendlyWhen(c.when)}</span>
        <span className="text-[15px] text-slate-900">
          <span className="font-medium">{c.who}</span> {verbFor(c)} <span className="font-medium">&ldquo;{c.title}&rdquo;</span>
        </span>
        <span className="flex-1" />
        {openNotes ? <span className="text-xs text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 whitespace-nowrap">{openNotes} note{openNotes === 1 ? '' : 's'}</span> : null}
        <span className="text-xs text-slate-400 whitespace-nowrap">{open ? 'close' : 'open'}</span>
      </button>

      {open ? (
        <div className="px-5 pb-5 flex flex-col gap-4 border-t border-slate-100 pt-4">
          {/* The first thing anyone reads: this already happened and wants nothing from them.
              Without it, a log entry reads like something awaiting approval. */}
          <p className="text-sm text-emerald-800 bg-emerald-50 px-4 py-2.5 leading-relaxed">
            {c.kind === 'blank'
              ? 'This is live now - drafts already use it. Nothing here is waiting on you.'
              : c.afterBody
                ? 'This is live now - it is already how Wingguy writes. Nothing here is waiting on you.'
                : 'This instruction was removed - Wingguy no longer follows it. Nothing here is waiting on you.'}
          </p>

          {/* A blank is a fill-in-the-blank answer from the setup page, not an instruction - it
              shows as a plain before/after and takes notes, nothing more. Changing it back is a
              single field on the setup page, so there is no undo door here. */}
          {c.kind === 'blank' ? (
            <div className="flex flex-col gap-2">
              {c.fromValue != null ? (
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Was</p>
                  <p className="text-[15px] text-slate-600 leading-relaxed whitespace-pre-wrap line-through decoration-slate-300">{c.fromValue}</p>
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Now</p>
                {c.toValue != null && c.blankStatus !== 'retired' ? (
                  <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap">{c.toValue}</p>
                ) : (
                  <p className="text-[15px] text-slate-500">Left empty - Wingguy falls back to its sensible default for this one.</p>
                )}
              </div>
              <p className="text-[13px] text-slate-500">Changed on the setup page. To change it again, that is where it lives.</p>
            </div>
          ) : null}

          {/* Plain English leads. The instruction text itself is written for the model and reads
              as jargon, so it goes behind a link for whoever actually wants it. */}
          {c.kind !== 'blank' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">What this does</p>
                {summary === null ? (
                  <p className="text-[15px] text-slate-400">Putting this in plain English…</p>
                ) : summary ? (
                  <p className="text-[15px] text-slate-800 leading-relaxed">{summary}</p>
                ) : (
                  <p className="text-[15px] text-slate-500">Could not write a plain-English summary just now - the exact wording is below.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => explain('detail')} disabled={deeper === 'loading'}
                  className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-300 hover:border-emerald-600 hover:text-emerald-900 disabled:opacity-60">
                  {deeper === 'loading' ? 'Working…' : 'Explain this properly'}
                </button>
                <button type="button" onClick={() => explain('impact')} disabled={deeper === 'loading'}
                  className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-300 hover:border-emerald-600 hover:text-emerald-900 disabled:opacity-60">
                  What does this mean for my messages?
                </button>
                <button type="button" onClick={() => explain('example')} disabled={deeper === 'loading'}
                  className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-300 hover:border-emerald-600 hover:text-emerald-900 disabled:opacity-60">
                  Show me an example
                </button>
              </div>
              {deeper && deeper !== 'loading' ? (
                deeper.error ? <p className="text-sm text-red-700">{deeper.error}</p> : (
                  <div className="bg-emerald-50 border border-emerald-200 px-4 py-3 flex flex-col gap-2">
                    {deeper.text ? <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap">{deeper.text}</p> : null}
                    {deeper.example ? <ExampleBlock ex={deeper.example} /> : null}
                  </div>
                )
              ) : null}
            </>
          ) : null}

          {c.changeNote ? (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Why it was made</p>
              <p className="text-sm text-slate-600 leading-relaxed">{c.changeNote}</p>
            </div>
          ) : null}

          {c.afterBody ? (
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setShowRaw(!showRaw)} className="self-start text-sm text-slate-500 underline hover:text-slate-700">
                {showRaw ? 'Hide the exact wording' : 'Show the exact wording it follows'}
              </button>
              {showRaw ? (
                <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 border border-slate-200 px-4 py-3">{c.afterBody}</p>
              ) : null}
              {showRaw && c.beforeBody ? (
                showBefore ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">What it said before</p>
                    <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 border border-slate-200 px-4 py-3">{c.beforeBody}</p>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowBefore(true)} className="self-start text-sm text-slate-500 underline hover:text-slate-700">
                    Show what it said before
                  </button>
                )
              ) : null}
            </div>
          ) : null}

          {c.undo ? (
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
              {!confirmUndo ? (
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setConfirmUndo(true)}
                    className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-300 hover:border-slate-500">
                    {c.undo === 'restore' ? 'Undo - put the previous version back' : 'Undo - remove this instruction'}
                  </button>
                  <span className="text-xs text-slate-400">You will see it before anything happens</span>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 px-4 py-3 flex flex-col gap-2">
                  <p className="text-[15px] text-slate-800 leading-relaxed">
                    {c.undo === 'restore'
                      ? 'This puts the wording back to how it read before this change. It counts as a new change, so it appears at the top of this page and can itself be undone.'
                      : 'This removes the instruction that was added. Wingguy stops following it. It counts as a change, so it appears at the top of this page.'}
                  </p>
                  <div className="flex gap-3">
                    <button type="button" onClick={undo} disabled={busy === 'undo'}
                      className="px-4 py-2 bg-slate-900 text-white text-sm font-medium disabled:opacity-40">
                      {busy === 'undo' ? 'Undoing…' : (c.undo === 'restore' ? 'Yes, put it back' : 'Yes, remove it')}
                    </button>
                    <button type="button" onClick={() => setConfirmUndo(false)} className="text-sm text-slate-500 underline">Never mind</button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {(c.notes || []).length ? (
            <div className="flex flex-col gap-2">
              {c.notes.map((n) => (
                <div key={n.id} className={`px-4 py-3 border flex flex-col gap-1 ${n.resolvedAt ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
                  <p className="text-[15px] text-slate-800 leading-relaxed">{n.note}</p>
                  <div className="flex items-baseline gap-3">
                    <p className="text-xs text-slate-500">{n.author}, {friendlyWhen(n.when)}</p>
                    <span className="flex-1" />
                    {n.resolvedAt ? (
                      <p className="text-xs text-slate-500">sorted{n.resolvedBy ? ` by ${n.resolvedBy}` : ''}</p>
                    ) : (
                      <button type="button" onClick={() => sorted(n.id)} disabled={busy === `sorted-${n.id}`}
                        className="text-xs font-medium text-amber-800 underline hover:text-amber-900">
                        {busy === `sorted-${n.id}` ? 'ticking…' : 'Sorted'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Two boxes, opposite fates for your typing - so each one says which. A placeholder
              cannot carry that (it truncates, and vanishes at the first keystroke). */}
          <div className="flex flex-col gap-2">
            {!name ? (
              <input
                type="text" placeholder="Your first name (signs your notes)"
                className="border border-slate-300 px-3 py-2 text-[15px] max-w-xs"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) { setName(v); try { window.localStorage.setItem('wg-page-name', v); } catch (err) { /* private mode */ } }
                }}
              />
            ) : null}
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-slate-700">Leave a note{name ? ` (as ${name})` : ''}</p>
              <p className="text-[13px] text-slate-500">Saved word for word, for whoever works on this page. Changes nothing by itself.</p>
            </div>
            <div className="flex gap-2">
              <input
                type="text" value={noteText} onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') leaveNote(); }}
                placeholder={'e.g. prefer we don’t promise timeframes'}
                className="flex-1 border border-slate-300 px-3 py-2 text-[15px]"
              />
              <button type="button" onClick={leaveNote} disabled={busy === 'note' || !noteText.trim()}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium disabled:opacity-40">
                {busy === 'note' ? 'Leaving…' : 'Leave note'}
              </button>
            </div>
            {busy && busy !== 'note' && !busy.startsWith('sorted-') ? <p className="text-sm text-red-700">{busy}</p> : null}
          </div>

          {c.kind !== 'blank' ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-slate-700">Not how you&apos;d do it?</p>
              <p className="text-[13px] text-slate-500">Describe the change and Wingguy rewrites the instruction - you see the new version before anything is saved.</p>
            </div>
            <div className="flex gap-2">
              <input
                type="text" value={door.text} onChange={(e) => setDoor((d) => ({ ...d, text: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') runDoor(); }}
                placeholder={'e.g. only ever send one link'}
                className="flex-1 border border-slate-300 px-3 py-2 text-[15px]"
              />
              <button type="button" onClick={runDoor} disabled={door.state === 'loading' || !door.text.trim()}
                className="px-4 py-2 border border-slate-400 text-slate-800 text-sm font-medium disabled:opacity-40 whitespace-nowrap">
                {door.state === 'loading' ? 'Working…' : 'Draft the change'}
              </button>
            </div>
            {door.state && door.state.proposal ? (
              <div className="bg-slate-50 border border-slate-200 px-4 py-3 flex flex-col gap-2">
                <p className="text-sm text-slate-600">{door.state.proposal.explanation}</p>
                <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap">{door.state.proposal.proposedBody}</p>
                <div className="flex gap-3">
                  <button type="button" onClick={saveDoor} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium">Save this version</button>
                  <button type="button" onClick={() => setDoor({ text: '', state: null })} className="text-sm text-slate-500 underline">Never mind</button>
                </div>
              </div>
            ) : null}
            {door.state && door.state.answer ? <p className="text-[15px] text-slate-700 bg-slate-50 border border-slate-200 px-4 py-3">{door.state.answer}</p> : null}
            {door.state === 'done' ? <p className="text-sm text-emerald-700">Saved - it now applies to everything Wingguy writes here, and it is at the top of this page.</p> : null}
            {door.state && door.state.error ? <p className="text-sm text-red-700">{door.state.error}</p> : null}
          </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** An example takes the form that suits the change: a whole message, or the one line that reads
 *  differently now. A constraint ("never say delighted") is not taught by an invented email. */
function ExampleBlock({ ex }) {
  if (ex.form === 'fragment') {
    return (
      <div className="flex flex-col gap-2">
        {ex.intro ? <p className="text-[13px] text-slate-500">{ex.intro}</p> : null}
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Before</p>
          <p className="text-[15px] text-slate-600 leading-relaxed line-through decoration-slate-300">{ex.before}</p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Now</p>
          <p className="text-[15px] text-slate-800 leading-relaxed">{ex.after}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {ex.intro ? <p className="text-[13px] text-slate-500">{ex.intro}</p> : null}
      <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap bg-white border border-slate-200 px-4 py-3">{ex.text}</p>
      <p className="text-[13px] text-slate-500">Written fresh just now from your own setup - not a saved sample.</p>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#F4F6F4]">
      <div className="mx-auto px-6 py-14 flex flex-col max-w-2xl gap-6">
        {children}
      </div>
    </div>
  );
}

export default function WingguyReview() {
  return (
    <Suspense fallback={<Shell><p className="text-slate-500">Opening the change history…</p></Shell>}>
      <WingguyReviewInner />
    </Suspense>
  );
}

export { PageNav, usePageAuth };
