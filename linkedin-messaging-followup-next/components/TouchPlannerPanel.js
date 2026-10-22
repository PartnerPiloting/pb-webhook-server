"use client";
// Guy's Monday screen - the weekly client touch planner, on the client board
// (docs/CLIENT-TOUCH-PLANNER.md, "Guy's Monday screen").
//
// One row per client: the pick (or "nothing this week") with its one-line reason, last call and
// last touch, the drafted opening above a preview of the approved body, and the buttons - approve,
// edit, swap, skip (with the "why not" box, filed to its home), pin for next week. "Pin for
// everyone this week" for a one-off. One "Send approved" button. Also: who was left out and why,
// onboarding clients with no next session, who is due a call, suggested introduction pairs, and
// the waiting-improvements count on each pick. Everything is worked out by the server
// (services/clientTouchPlanner.js); this file only shows it and sends Guy's verdicts back.

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';

const DAY = 86400000;
const agoText = (iso) => {
  if (!iso) return 'never';
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};
const STATUS = {
  proposed: { label: 'Waiting for you', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', cls: 'bg-green-100 text-green-800' },
  edited: { label: 'Approved (your words)', cls: 'bg-green-100 text-green-800' },
  skipped: { label: 'Skipped', cls: 'bg-gray-100 text-gray-600' },
  sent: { label: 'Sent', cls: 'bg-blue-100 text-blue-800' },
  failed: { label: 'Send failed', cls: 'bg-red-100 text-red-700' },
  nothing: { label: 'Nothing this week', cls: 'bg-gray-100 text-gray-500' },
  'left-out': { label: 'Left out', cls: 'bg-gray-100 text-gray-500' },
};
const HOMES = [
  ['body', "the body - that point's wrong (goes to the piece's improvements)"],
  ['choice', 'the choice - too soon, had enough of this (becomes a rule)'],
  ['person', 'the person - how to write to them (goes on their note, now)'],
  ['openings', 'how openings are written - too gushing, do not mention the call (used every week, now)'],
];

const api = () => ({ base: `${getBackendBase()}/api/client-board/touch-plan`, headers: getAuthenticatedHeaders() });

export default function TouchPlannerPanel() {
  const [screen, setScreen] = useState(null);
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);           // 'build' | 'send' | clientId
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState({});             // clientId -> true (row expanded)
  const [edits, setEdits] = useState({});           // clientId -> { opening, subject }
  const [skipBox, setSkipBox] = useState({});       // clientId -> { words, home, until }
  const [swapPick, setSwapPick] = useState({});     // clientId -> slug
  const [pinAll, setPinAll] = useState({ title: '', bodyHtml: '', show: false });
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { base, headers } = api();
      const r = await axios.get(base, { timeout: 60000, headers });
      setScreen(r.data);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }, []);
  const loadIntros = useCallback(async (refresh = false) => {
    try {
      const { base, headers } = api();
      const r = await axios.get(`${base}/introductions${refresh ? '?refresh=1' : ''}`, { timeout: 120000, headers });
      setIntros(r.data);
    } catch (_) { setIntros({ pairs: [], error: 'could not load' }); }
  }, []);

  useEffect(() => { load(); loadIntros(false); }, [load, loadIntros]);

  const post = async (path, body = {}, tag = null) => {
    setBusy(tag || path);
    setNotice(null);
    try {
      const { base, headers } = api();
      const r = await axios.post(`${base}${path}`, body, { timeout: 180000, headers });
      await load();
      return r.data;
    } catch (e) {
      setNotice({ kind: 'err', text: e.response?.data?.error || e.message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const build = async () => {
    const r = await post('/build', {}, 'build');
    if (r) setNotice({ kind: 'ok', text: `Plan rebuilt - ${r.rows} clients looked at. Rows you had already approved or skipped were kept.` });
  };
  const sendApproved = async () => {
    const n = screen ? screen.counts.approved : 0;
    if (!n) return;
    if (!window.confirm(`Send ${n} approved email${n === 1 ? '' : 's'} now? Each one is re-checked against the client's record first.`)) return;
    const r = await post('/send-approved', {}, 'send');
    if (r) setNotice({ kind: r.failed ? 'err' : 'ok', text: `${r.sent} sent, ${r.held} held (re-check said no), ${r.failed} failed.` });
  };
  const approve = (row) => post(`/${row.clientId}/approve`, {}, row.clientId);
  const saveEdit = async (row) => {
    const e = edits[row.clientId] || {};
    const r = await post(`/${row.clientId}/edit`, { opening: e.opening ?? row.opening, subject: e.subject ?? row.subject }, row.clientId);
    if (r) setEdits((s) => ({ ...s, [row.clientId]: undefined }));
  };
  const skip = async (row) => {
    const b = skipBox[row.clientId] || {};
    const r = await post(`/${row.clientId}/skip`, { whyNot: b.words || '', home: b.home || null, until: b.until || null }, row.clientId);
    if (r) {
      setSkipBox((s) => ({ ...s, [row.clientId]: undefined }));
      if (r.filed) setNotice({ kind: 'ok', text: r.filed.applied ? `Filed to ${r.filed.where}.` : `Noted - it goes to ${r.filed.where} the next time the laptop files feedback.` });
    }
  };
  const swap = async (row) => {
    const slug = swapPick[row.clientId];
    if (!slug) return;
    const piece = (screen.shelf || []).find((p) => p.slug === slug);
    const r = await post(`/${row.clientId}/swap`, { kind: piece && piece.kind === 'habit' ? 'habit' : 'one-pager', key: slug, title: piece ? piece.title : slug }, row.clientId);
    if (r) setNotice({ kind: 'ok', text: `Swapped - ${row.clientName} now gets "${piece ? piece.title : slug}" this week, with a fresh opening.` });
  };
  const pinNext = async (row) => {
    const slug = swapPick[row.clientId];
    if (!slug) return;
    const piece = (screen.shelf || []).find((p) => p.slug === slug);
    const r = await post(`/${row.clientId}/pin`, { kind: piece && piece.kind === 'habit' ? 'habit' : 'one-pager', key: slug, title: piece ? piece.title : slug }, row.clientId);
    if (r) setNotice({ kind: 'ok', text: `Pinned "${piece ? piece.title : slug}" for ${row.clientName}, week of ${r.weekOf}.` });
  };
  const pinEveryone = async () => {
    if (!pinAll.title.trim() || !pinAll.bodyHtml.trim()) return;
    const key = `event:${pinAll.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
    const html = pinAll.bodyHtml.split(/\n{2,}/).map((p) => `<p>${p.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
    const r = await post('/pin-everyone', { kind: 'one-off', key, title: pinAll.title.trim(), bodyHtml: html }, 'pin-all');
    if (r) { setPinAll({ title: '', bodyHtml: '', show: false }); setNotice({ kind: 'ok', text: 'Pinned for everyone this week. Rebuild the plan to see it on every row.' }); }
  };
  const openPreview = async (row) => {
    try {
      const { base, headers } = api();
      const r = await axios.get(`${base}/${row.clientId}/preview`, { timeout: 60000, headers, responseType: 'text' });
      const w = window.open('', '_blank');
      if (w) { w.document.open(); w.document.write(r.data); w.document.close(); }
    } catch (e) { setNotice({ kind: 'err', text: e.response?.data?.error || e.message }); }
  };

  if (error) {
    return <section className="bg-white border border-red-200 rounded-lg p-4 text-sm text-red-700">Monday emails: {error}</section>;
  }
  if (!screen) return <section className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">Reading this week&rsquo;s emails&hellip;</section>;

  const { rows, counts, leftOut, onboardingNotBooked, approvalRates, weekOf, autosend, shelf } = screen;
  const picks = rows.filter((r) => r.pick && r.pick.what);
  const quiet = rows.filter((r) => r.status === 'nothing');
  const callsDue = rows.filter((r) => r.callDue);
  const lastRate = approvalRates && approvalRates[0];

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Monday emails <span className="text-gray-400 font-normal">&middot; week of {weekOf}</span></h2>
          <p className="text-[13px] text-gray-500">
            {picks.length} prepared &middot; {counts.approved} approved &middot; {counts.sent} sent &middot; {counts.nothing} quiet &middot; {counts.leftOut} left out
            {lastRate && lastRate.total ? <> &middot; last week {lastRate.share}% approved unchanged</> : null}
            {autosend ? <span className="ml-2 text-red-700 font-medium">send-with-veto is ON (Tuesday 9am)</span> : <span className="ml-2 text-green-700">nothing sends until you approve it</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCollapsed((c) => !c)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] text-gray-600 hover:bg-gray-50">{collapsed ? 'Show' : 'Hide'}</button>
          <button onClick={build} disabled={busy === 'build'} className="px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'build' ? 'Building…' : (rows.length ? 'Rebuild this week' : 'Build this week')}</button>
          <button onClick={() => setPinAll((p) => ({ ...p, show: !p.show }))} className="px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50">Pin for everyone</button>
          <button onClick={sendApproved} disabled={!counts.approved || busy === 'send'} className="px-4 py-1.5 rounded-lg bg-green-600 text-white text-[13px] font-semibold hover:bg-green-700 disabled:opacity-40">{busy === 'send' ? 'Sending…' : `Send approved (${counts.approved})`}</button>
        </div>
      </div>

      {notice && (
        <div className={`mx-5 mt-3 p-2.5 rounded border text-sm flex justify-between ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{notice.text}</span><button onClick={() => setNotice(null)} className="font-bold px-2">&times;</button>
        </div>
      )}

      {pinAll.show && (
        <div className="mx-5 mt-3 p-3 rounded border border-amber-200 bg-amber-50 flex flex-col gap-2">
          <p className="text-sm font-medium text-amber-900">A one-off for everyone this week (an event, an open meeting). Your words - it goes above the usual footer with each client&rsquo;s own opening.</p>
          <input value={pinAll.title} onChange={(e) => setPinAll((p) => ({ ...p, title: e.target.value }))} placeholder="Subject / title" className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <textarea value={pinAll.bodyHtml} onChange={(e) => setPinAll((p) => ({ ...p, bodyHtml: e.target.value }))} rows={5} placeholder="The email, in your words. Blank line between paragraphs." className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <div><button onClick={pinEveryone} disabled={busy === 'pin-all'} className="px-3 py-1.5 rounded bg-amber-600 text-white text-[13px] font-medium disabled:opacity-50">Pin it</button></div>
        </div>
      )}

      {!collapsed && (
        <>
          {!rows.length && <p className="px-5 py-4 text-sm text-gray-500">No plan for this week yet. It builds itself on Monday morning - or press Build this week.</p>}
          {rows.filter((r) => r.status !== 'left-out').map((row) => {
            const st = STATUS[row.status] || STATUS.proposed;
            const e = edits[row.clientId] || {};
            const sb = skipBox[row.clientId] || {};
            const isOpen = !!open[row.clientId];
            const pick = row.pick || {};
            const hasEmail = !!(pick.what);
            const openingProblem = pick.opening && pick.opening.check && !pick.opening.check.ok ? pick.opening.check.problems.join(', ') : null;
            const bodyProblem = pick.body && (pick.body.error || (pick.body.missing ? 'no text yet - write it or swap' : null));
            return (
              <div key={row.clientId} className="border-b border-gray-100 last:border-b-0">
                <div className="grid gap-4 px-5 py-3 text-sm items-start" style={{ gridTemplateColumns: '180px 1fr 150px 130px' }}>
                  <div>
                    <p className="font-semibold text-gray-900">{row.clientName}</p>
                    <p className="text-xs text-gray-500">call {agoText(row.lastCallAt)}{row.nextSessionAt ? ` · next ${String(row.nextSessionAt).slice(0, 10)}` : ''}</p>
                    <p className="text-xs text-gray-500">touch {agoText(row.lastTouchAt)}</p>
                    {row.callDue && <p className="text-xs text-amber-700 font-medium">time for a call</p>}
                  </div>
                  <div className="min-w-0">
                    {hasEmail ? (
                      <>
                        <p className="text-gray-900"><span className="font-medium">{pick.what.title}</span> <span className="text-gray-400">· {pick.what.kind}{pick.form === 'short' ? ', short' : ''}</span>{row.waitingImprovements ? <span className="ml-2 text-xs text-amber-700">{row.waitingImprovements} improvement{row.waitingImprovements === 1 ? '' : 's'} waiting on this piece</span> : null}</p>
                        <p className="text-xs text-gray-500 italic">{pick.reason}</p>
                        {['approved', 'edited', 'sent'].includes(row.status) || !isOpen ? (
                          <p className="mt-1 text-gray-800">{row.opening ? row.opening : <span className="text-red-700">no opening drafted - needs your words</span>}</p>
                        ) : (
                          <textarea value={e.opening ?? row.opening} onChange={(ev) => setEdits((s) => ({ ...s, [row.clientId]: { ...e, opening: ev.target.value } }))} rows={3} className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5" placeholder="The opening - one to three sentences, in your words" />
                        )}
                        {openingProblem && <p className="text-xs text-red-700">The draft breaks the craft ({openingProblem}) - say it your way.</p>}
                        {bodyProblem && <p className="text-xs text-red-700">Body: {bodyProblem}</p>}
                        {isOpen && (
                          <p className="mt-1 text-xs text-gray-500 border-l-2 border-gray-200 pl-2">{row.bodyPreview}&hellip; <button onClick={() => openPreview(row)} className="text-blue-700 underline">preview the whole email</button></p>
                        )}
                      </>
                    ) : (
                      <p className="text-gray-500">Nothing this week <span className="italic">- {pick.reason}</span></p>
                    )}
                    {row.sendError && <p className="text-xs text-red-700">{row.sendError}</p>}
                  </div>
                  <div><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>{row.pinned && <p className="text-xs text-amber-700 mt-1">pinned</p>}{row.skip && <p className="text-xs text-gray-500 mt-1">nothing until {row.skip.until}</p>}</div>
                  <div className="flex flex-col gap-1 items-end">
                    {hasEmail && ['proposed', 'failed'].includes(row.status) && <button onClick={() => approve(row)} disabled={busy === row.clientId || !!bodyProblem} className="w-full px-2 py-1 rounded bg-green-600 text-white text-xs font-medium disabled:opacity-40">Approve</button>}
                    <button onClick={() => setOpen((s) => ({ ...s, [row.clientId]: !isOpen }))} className="w-full px-2 py-1 rounded border border-gray-200 text-xs text-gray-700">{isOpen ? 'Close' : (hasEmail ? 'Edit / swap / skip' : 'Swap / pin')}</button>
                  </div>
                </div>
                {isOpen && row.status !== 'sent' && (
                  <div className="px-5 pb-4 grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="flex flex-col gap-2">
                      {hasEmail && (
                        <div className="flex gap-2 items-center">
                          <input value={e.subject ?? row.subject} onChange={(ev) => setEdits((s) => ({ ...s, [row.clientId]: { ...e, subject: ev.target.value } }))} className="flex-1 text-sm border border-gray-300 rounded px-2 py-1" placeholder="Subject" />
                          <button onClick={() => saveEdit(row)} disabled={busy === row.clientId} className="px-3 py-1 rounded bg-green-600 text-white text-xs font-medium disabled:opacity-40">Save my words &amp; approve</button>
                        </div>
                      )}
                      <div className="flex gap-2 items-center">
                        <select value={swapPick[row.clientId] || ''} onChange={(ev) => setSwapPick((s) => ({ ...s, [row.clientId]: ev.target.value }))} className="flex-1 text-sm border border-gray-300 rounded px-2 py-1">
                          <option value="">Pick a piece…</option>
                          {(shelf || []).map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
                        </select>
                        <button onClick={() => swap(row)} disabled={!swapPick[row.clientId] || busy === row.clientId} className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-700 disabled:opacity-40">Swap this week</button>
                        <button onClick={() => pinNext(row)} disabled={!swapPick[row.clientId] || busy === row.clientId} className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-700 disabled:opacity-40">Pin for next week</button>
                      </div>
                      {row.touchNote && <p className="text-xs text-gray-500 whitespace-pre-line border-l-2 border-gray-200 pl-2">Note: {row.touchNote}</p>}
                    </div>
                    <div className="flex flex-col gap-2 bg-gray-50 border border-gray-200 rounded p-3">
                      <p className="text-xs font-medium text-gray-700">Not this one - why not? (a few words; it gets filed where it fixes the cause)</p>
                      <textarea value={sb.words || ''} onChange={(ev) => setSkipBox((s) => ({ ...s, [row.clientId]: { ...sb, words: ev.target.value } }))} rows={2} className="text-sm border border-gray-300 rounded px-2 py-1" placeholder="e.g. too soon for this one / that point's wrong / he hates long emails" />
                      <select value={sb.home || ''} onChange={(ev) => setSkipBox((s) => ({ ...s, [row.clientId]: { ...sb, home: ev.target.value } }))} className="text-sm border border-gray-300 rounded px-2 py-1">
                        <option value="">It&rsquo;s about…</option>
                        {HOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <div className="flex gap-2 items-center">
                        <label className="text-xs text-gray-600">Nothing until</label>
                        <input type="date" value={sb.until || ''} onChange={(ev) => setSkipBox((s) => ({ ...s, [row.clientId]: { ...sb, until: ev.target.value } }))} className="text-sm border border-gray-300 rounded px-2 py-1" />
                        <button onClick={() => skip(row)} disabled={busy === row.clientId} className="ml-auto px-3 py-1 rounded border border-gray-400 text-xs text-gray-800 disabled:opacity-40">Skip this week</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="px-5 py-4 grid gap-4 border-t border-gray-200 text-[13px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="flex flex-col gap-3">
              <div>
                <p className="font-medium text-gray-800">Left out this week ({leftOut.length})</p>
                {leftOut.length ? <ul className="text-gray-600 list-disc pl-5">{leftOut.map((l) => <li key={l.clientId}>{l.clientName} - {l.reason}</li>)}</ul> : <p className="text-gray-500">nobody</p>}
              </div>
              <div>
                <p className="font-medium text-gray-800">Onboarding with no next session ({onboardingNotBooked.length})</p>
                {onboardingNotBooked.length ? <p className="text-gray-600">{onboardingNotBooked.map((c) => c.clientName).join(', ')}</p> : <p className="text-gray-500">everyone has one booked</p>}
              </div>
              <div>
                <p className="font-medium text-gray-800">Time for a call ({callsDue.length})</p>
                {callsDue.length ? <p className="text-gray-600">{callsDue.map((c) => `${c.clientName} (${agoText(c.lastCallAt)})`).join(', ')}</p> : <p className="text-gray-500">nobody is six weeks out</p>}
                {quiet.length ? <p className="text-gray-500 mt-1">Quiet weeks: {quiet.map((c) => c.clientName).join(', ')}</p> : null}
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <p className="font-medium text-gray-800">Introductions to make</p>
                <button onClick={() => loadIntros(true)} className="text-xs text-blue-700 underline">think again</button>
              </div>
              {!intros ? <p className="text-gray-500">thinking&hellip;</p> : intros.error ? <p className="text-gray-500">{intros.error}</p> : !intros.pairs.length ? <p className="text-gray-500">no clear pair this week ({intros.allowed || 0} not yet introduced)</p> : (
                <ul className="text-gray-700 flex flex-col gap-1">
                  {intros.pairs.map((p, i) => <li key={i}><span className="font-medium">{p.a.clientName} + {p.b.clientName}</span> - {p.why} <span className="text-gray-400">(say &ldquo;introduce {p.a.clientName.split(' ')[0]} to {p.b.clientName.split(' ')[0]}&rdquo; in Claude - it drafts it)</span></li>)}
                </ul>
              )}
              <p className="text-xs text-gray-400 mt-2">Pairs already introduced (the Referrals table) and anyone introduced in the last week are never suggested.</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
