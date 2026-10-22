"use client";
// Guy's Monday emails - the weekly client touch planner, on the client board
// (docs/CLIENT-TOUCH-PLANNER.md, "Guy's Monday screen").
//
// The plan for the coming Monday is built a week ahead, so Guy can work through it a bit at a time.
// One row per client, three columns: ALREADY HAD (every touch on record, newest first) | THIS MONDAY
// (the pick, its reason and opening, with approve / edit / swap / skip / pin) | LIKELY NEXT (the next
// five weeks if nothing changes - provisional; any of them can be pinned into this Monday). Only
// what Guy approves goes, by itself, at 8am on the Monday, after a fresh check; anything that
// changed since he approved it is HELD here with what changed, to keep or swap. Also: who was left
// out and why, onboarding clients with no next session, who is due a call, suggested introduction
// pairs. Everything is worked out by the server (services/clientTouchPlanner.js); this file only
// shows it and sends Guy's verdicts back.

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';

const DAY = 86400000;
const agoText = (iso) => {
  if (!iso) return 'never';
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
const mondayLabel = (week) => new Date(`${week}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' });
const addWeeks = (week, n) => { const d = new Date(`${week}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); };
const STATUS = {
  proposed: { label: 'Waiting for you', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved - goes Monday', cls: 'bg-green-100 text-green-800' },
  edited: { label: 'Approved (your words)', cls: 'bg-green-100 text-green-800' },
  skipped: { label: 'Skipped', cls: 'bg-gray-100 text-gray-600' },
  sent: { label: 'Sent', cls: 'bg-blue-100 text-blue-800' },
  failed: { label: 'Send failed', cls: 'bg-red-100 text-red-700' },
  held: { label: 'Held - something changed', cls: 'bg-orange-100 text-orange-800' },
  lapsed: { label: 'Not approved - not sent', cls: 'bg-gray-100 text-gray-500' },
  nothing: { label: 'Nothing this week', cls: 'bg-gray-100 text-gray-500' },
  'left-out': { label: 'Left out', cls: 'bg-gray-100 text-gray-500' },
};
const HOMES = [
  ['body', "the body - that point's wrong (goes to the piece's improvements)"],
  ['choice', 'the choice - too soon, had enough of this (becomes a rule)'],
  ['person', 'the person - how to write to them (goes on their note, now)'],
  ['openings', 'how openings are written - too gushing, do not mention the call (used every week, now)'],
];
const PINNABLE = new Set(['one-pager', 'habit']);
const HISTORY_SHOWN = 4;

const api = () => ({ base: `${getBackendBase()}/api/client-board/touch-plan`, headers: getAuthenticatedHeaders() });

export default function TouchPlannerPanel() {
  const [week, setWeek] = useState(null);             // null = the Monday the server says Guy is working towards
  const [screen, setScreen] = useState(null);
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);           // 'build' | clientId
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState({});             // clientId -> true (row expanded)
  const [allHistory, setAllHistory] = useState({}); // clientId -> true (every touch shown)
  const [edits, setEdits] = useState({});           // clientId -> { opening, subject }
  const [skipBox, setSkipBox] = useState({});       // clientId -> { words, home, until }
  const [swapPick, setSwapPick] = useState({});     // clientId -> slug
  const [pinAll, setPinAll] = useState({ title: '', bodyHtml: '', show: false });
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { base, headers } = api();
      const r = await axios.get(week ? `${base}?week=${week}` : base, { timeout: 60000, headers });
      setScreen(r.data);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }, [week]);
  const loadIntros = useCallback(async (refresh = false) => {
    try {
      const { base, headers } = api();
      const r = await axios.get(`${base}/introductions${refresh ? '?refresh=1' : ''}`, { timeout: 120000, headers });
      setIntros(r.data);
    } catch (_) { setIntros({ pairs: [], error: 'could not load' }); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadIntros(false); }, [loadIntros]);

  const shown = screen ? screen.weekOf : week;
  const post = async (path, body = {}, tag = null) => {
    setBusy(tag || path);
    setNotice(null);
    try {
      const { base, headers } = api();
      const r = await axios.post(`${base}${path}`, { week: shown, ...body }, { timeout: 180000, headers });
      await load();
      return r.data;
    } catch (e) {
      setNotice({ kind: 'err', text: e.response?.data?.error || e.message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  // The build runs in the background on the server (an opening per client takes minutes); the
  // panel re-reads the screen every few seconds while it runs, so rows appear as they are written.
  const build = async () => {
    const r = await post('/build', {}, 'build');
    if (r) setNotice({ kind: 'ok', text: r.started ? `Building the plan for ${mondayLabel(r.weekOf)} - a few minutes. Rows appear here as they are ready; rows you had already approved or skipped are kept.` : `A build for ${mondayLabel(r.weekOf)} is already running - rows appear here as they are ready.` });
  };
  const building = !!(screen && screen.build && screen.build.running);
  const [wasBuilding, setWasBuilding] = useState(false);
  useEffect(() => {
    if (!building) return undefined;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [building, screen, load]);
  useEffect(() => {
    if (building) { setWasBuilding(true); return; }
    if (wasBuilding && screen) {
      setWasBuilding(false);
      const b = screen.build || {};
      setNotice(b.error ? { kind: 'err', text: `The build stopped: ${b.error}` } : { kind: 'ok', text: `Plan for ${mondayLabel(screen.weekOf)} built - ${b.rows ?? screen.rows.length} clients looked at.` });
    }
  }, [building, wasBuilding, screen]);
  const sendPassed = screen ? Date.now() >= new Date(screen.sendAt).getTime() : false;
  const approve = (row) => (sendPassed ? keep(row) : post(`/${row.clientId}/approve`, {}, row.clientId));
  const keep = async (row) => {
    if (!window.confirm(`Send ${row.clientName}'s email now? The never-send checks still run first.`)) return null;
    const r = await post(`/${row.clientId}/keep`, {}, row.clientId);
    if (r) setNotice({ kind: r.sent ? 'ok' : 'err', text: r.sent ? `Sent to ${row.clientName}.` : r.refused || `Not sent - ${(r.results[0] && r.results[0].reason) || 'held'}.` });
    return r;
  };
  const saveEdit = async (row) => {
    const e = edits[row.clientId] || {};
    const body = { opening: e.opening ?? row.opening, subject: e.subject ?? row.subject };
    if (e.congrats !== undefined) body.congrats = e.congrats;
    const r = await post(`/${row.clientId}/edit`, body, row.clientId);
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
  const swapTo = async (row, what) => {
    const r = await post(`/${row.clientId}/swap`, { kind: what.kind, key: what.key, title: what.title }, row.clientId);
    if (r) setNotice({ kind: 'ok', text: `Swapped - ${row.clientName} now gets "${what.title}" on ${mondayLabel(shown)}, with a fresh opening. Approve it when you're happy.` });
  };
  const swap = (row) => {
    const slug = swapPick[row.clientId];
    if (!slug) return null;
    const piece = (screen.shelf || []).find((p) => p.slug === slug);
    return swapTo(row, { kind: piece && piece.kind === 'habit' ? 'habit' : 'one-pager', key: slug, title: piece ? piece.title : slug });
  };
  const pinNext = async (row) => {
    const slug = swapPick[row.clientId];
    if (!slug) return;
    const piece = (screen.shelf || []).find((p) => p.slug === slug);
    const r = await post(`/${row.clientId}/pin`, { kind: piece && piece.kind === 'habit' ? 'habit' : 'one-pager', key: slug, title: piece ? piece.title : slug, week: addWeeks(shown, 1) }, row.clientId);
    if (r) setNotice({ kind: 'ok', text: `Pinned "${piece ? piece.title : slug}" for ${row.clientName}, ${mondayLabel(r.weekOf)}.` });
  };
  const pinEveryone = async () => {
    if (!pinAll.title.trim() || !pinAll.bodyHtml.trim()) return;
    const key = `event:${pinAll.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
    const html = pinAll.bodyHtml.split(/\n{2,}/).map((p) => `<p>${p.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
    const r = await post('/pin-everyone', { kind: 'one-off', key, title: pinAll.title.trim(), bodyHtml: html }, 'pin-all');
    if (r) { setPinAll({ title: '', bodyHtml: '', show: false }); setNotice({ kind: 'ok', text: `Pinned for everyone on ${mondayLabel(r.weekOf)}. Rebuild the plan to see it on every row.` }); }
  };
  const changeThought = async (row, slug) => {
    const r = await post(`/${row.clientId}/thought`, { slug }, row.clientId);
    if (r) setNotice({ kind: 'ok', text: slug ? `${row.clientName}'s thought for the week changed.` : `No thought for the week for ${row.clientName}.` });
  };
  const openPreview = async (row) => {
    try {
      const { base, headers } = api();
      const r = await axios.get(`${base}/${row.clientId}/preview?week=${shown}`, { timeout: 60000, headers, responseType: 'text' });
      const w = window.open('', '_blank');
      if (w) { w.document.open(); w.document.write(r.data); w.document.close(); }
    } catch (e) { setNotice({ kind: 'err', text: e.response?.data?.error || e.message }); }
  };

  if (error) {
    return <section className="bg-white border border-red-200 rounded-lg p-4 text-sm text-red-700">Monday emails: {error}</section>;
  }
  if (!screen) return <section className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">Reading the Monday emails&hellip;</section>;

  const { rows, counts, leftOut, onboardingNotBooked, approvalRates, weekOf, autosend, mondaySend, sendHour, shelf, planningWeek, thoughts } = screen;
  const picks = rows.filter((r) => r.pick && r.pick.what);
  const quiet = rows.filter((r) => r.status === 'nothing');
  const callsDue = rows.filter((r) => r.callDue);
  const lastRate = approvalRates && approvalRates[0];
  const isPlanning = weekOf === planningWeek;

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Monday emails <span className="text-gray-400 font-normal">&middot; {mondayLabel(weekOf)}, {sendHour}am</span>
            <span className="ml-3 inline-flex gap-1 align-middle">
              <button onClick={() => setWeek(addWeeks(weekOf, -1))} className="px-2 py-0.5 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50" title="The Monday before">&larr;</button>
              {!isPlanning && <button onClick={() => setWeek(null)} className="px-2 py-0.5 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50">coming Monday</button>}
              <button onClick={() => setWeek(addWeeks(weekOf, 1))} className="px-2 py-0.5 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50" title="The Monday after">&rarr;</button>
            </span>
          </h2>
          <p className="text-[13px] text-gray-500">
            {picks.length} prepared &middot; {counts.waiting} waiting for you &middot; {counts.approved} approved &middot; {counts.sent} sent{counts.held ? <> &middot; <span className="text-orange-700 font-medium">{counts.held} held</span></> : null} &middot; {counts.nothing} quiet &middot; {counts.leftOut} left out
            {lastRate && lastRate.total ? <> &middot; last week {lastRate.share}% approved unchanged</> : null}
          </p>
          <p className="text-[13px]">
            {autosend
              ? <span className="text-red-700 font-medium">Send-with-veto is ON - anything you have not skipped goes at {sendHour}am Monday.</span>
              : mondaySend
                ? <span className="text-green-700">Only what you approve goes - by itself at {sendHour}am Monday, after a fresh check. Anything not approved by then is not sent.</span>
                : <span className="text-red-700">{screen.sendEnabled ? 'The Monday send is switched off (CLIENT_TOUCH_MONDAY_SEND=off) - nothing goes by itself.' : 'Sending is switched off on this server - nothing here can reach a client.'}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCollapsed((c) => !c)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] text-gray-600 hover:bg-gray-50">{collapsed ? 'Show' : 'Hide'}</button>
          {!sendPassed && <button onClick={build} disabled={busy === 'build' || building} className="px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'build' || building ? `Building… ${rows.length} so far` : (rows.length ? `Rebuild ${mondayLabel(weekOf)}` : `Build ${mondayLabel(weekOf)}`)}</button>}
          {!sendPassed && <button onClick={() => setPinAll((p) => ({ ...p, show: !p.show }))} className="px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50">Pin for everyone</button>}
        </div>
      </div>

      {notice && (
        <div className={`mx-5 mt-3 p-2.5 rounded border text-sm flex justify-between ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{notice.text}</span><button onClick={() => setNotice(null)} className="font-bold px-2">&times;</button>
        </div>
      )}

      {pinAll.show && (
        <div className="mx-5 mt-3 p-3 rounded border border-amber-200 bg-amber-50 flex flex-col gap-2">
          <p className="text-sm font-medium text-amber-900">A one-off for everyone on {mondayLabel(weekOf)} (an event, an open meeting). Your words - it goes above the usual footer with each client&rsquo;s own opening.</p>
          <input value={pinAll.title} onChange={(e) => setPinAll((p) => ({ ...p, title: e.target.value }))} placeholder="Subject / title" className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <textarea value={pinAll.bodyHtml} onChange={(e) => setPinAll((p) => ({ ...p, bodyHtml: e.target.value }))} rows={5} placeholder="The email, in your words. Blank line between paragraphs." className="text-sm border border-gray-300 rounded px-2 py-1.5" />
          <div><button onClick={pinEveryone} disabled={busy === 'pin-all'} className="px-3 py-1.5 rounded bg-amber-600 text-white text-[13px] font-medium disabled:opacity-50">Pin it</button></div>
        </div>
      )}

      {!collapsed && (
        <>
          {building && <p className="px-5 pt-3 text-sm text-amber-800">Building the plan for {mondayLabel(weekOf)} - drafting an opening for each client takes a few minutes. {rows.length} ready so far; this page fills in by itself.</p>}
          {!rows.length && !building && <p className="px-5 py-4 text-sm text-gray-500">No plan for {mondayLabel(weekOf)} yet. Each Monday morning the following Monday&rsquo;s plan builds itself - or press Build.</p>}
          {rows.length > 0 && (
            <div className="grid gap-4 px-5 pt-3 pb-1 text-[11px] uppercase tracking-wide text-gray-400" style={{ gridTemplateColumns: '150px 1fr 1.6fr 1fr 120px' }}>
              <span>Client</span><span>Already had</span><span>{mondayLabel(weekOf)}</span><span>Likely next - if nothing changes</span><span />
            </div>
          )}
          {rows.filter((r) => r.status !== 'left-out').map((row) => {
            const st = STATUS[row.status] || STATUS.proposed;
            const e = edits[row.clientId] || {};
            const sb = skipBox[row.clientId] || {};
            const isOpen = !!open[row.clientId];
            const pick = row.pick || {};
            const hasEmail = !!(pick.what);
            const openingProblem = pick.opening && pick.opening.check && !pick.opening.check.ok ? pick.opening.check.problems.join(', ') : null;
            const bodyProblem = pick.body && (pick.body.error || (pick.body.missing ? 'no text yet - write it or swap' : null));
            const history = row.alreadyHad || [];
            const historyShown = allHistory[row.clientId] ? history : history.slice(0, HISTORY_SHOWN);
            const settled = ['sent', 'skipped'].includes(row.status);
            return (
              <div key={row.clientId} className={`border-b border-gray-100 last:border-b-0 ${row.status === 'held' ? 'bg-orange-50/40' : ''}`}>
                <div className="grid gap-4 px-5 py-3 text-sm items-start" style={{ gridTemplateColumns: '150px 1fr 1.6fr 1fr 120px' }}>
                  <div>
                    <p className="font-semibold text-gray-900">{row.clientName}</p>
                    <p className="text-xs text-gray-500">call {agoText(row.lastCallAt)}{row.nextSessionAt ? ` · next ${String(row.nextSessionAt).slice(0, 10)}` : ''}</p>
                    <p className="text-xs text-gray-500">touch {agoText(row.lastTouchAt)}</p>
                    {row.callDue && <p className="text-xs text-amber-700 font-medium">time for a call</p>}
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                    {row.pinned && <p className="text-xs text-amber-700 mt-1">pinned</p>}
                    {row.skip && <p className="text-xs text-gray-500 mt-1">nothing until {row.skip.until}</p>}
                  </div>

                  <div className="min-w-0 text-xs text-gray-600">
                    {!history.length ? <p className="text-gray-400">nothing on record yet</p> : (
                      <ul className="flex flex-col gap-0.5">
                        {historyShown.map((h, i) => <li key={i}><span className="text-gray-400">{shortDate(h.at)}</span> {h.title} <span className="text-gray-400">({h.kindLabel}{h.form === 'short' ? ', short' : ''})</span></li>)}
                      </ul>
                    )}
                    {history.length > HISTORY_SHOWN && (
                      <button onClick={() => setAllHistory((s) => ({ ...s, [row.clientId]: !s[row.clientId] }))} className="mt-0.5 text-blue-700 underline">{allHistory[row.clientId] ? 'show fewer' : `all ${history.length}`}</button>
                    )}
                  </div>

                  <div className="min-w-0">
                    {row.status === 'held' && row.hold && (
                      <div className="mb-2 p-2 rounded border border-orange-200 bg-orange-50 text-xs text-orange-900">
                        <p className="font-medium">{row.hold.stage === 'build' ? 'Held for you to decide the wording:' : `Held on the sending morning - ${row.hold.hard ? 'it cannot go:' : 'keep or swap?'}`}</p>
                        <ul className="list-disc pl-4">{(row.hold.changed || [row.hold.reason]).map((l, i) => <li key={i}>{l}</li>)}</ul>
                        {row.hold.stage === 'build' && (
                          <div className="flex gap-2 mt-1.5 items-center">
                            <button onClick={() => approve(row)} disabled={busy === row.clientId} className="px-2 py-1 rounded bg-green-600 text-white font-medium disabled:opacity-40">{sendPassed ? 'Approve & send now' : 'Approve as it is'}</button>
                            <span>or <button onClick={() => setOpen((x) => ({ ...x, [row.clientId]: true }))} className="underline">reword it</button></span>
                          </div>
                        )}
                        {!row.hold.hard && row.hold.stage !== 'build' && (
                          <div className="flex gap-2 mt-1.5">
                            <button onClick={() => keep(row)} disabled={busy === row.clientId} className="px-2 py-1 rounded bg-green-600 text-white font-medium disabled:opacity-40">Keep it - send now</button>
                            {row.hold.suggestion && <button onClick={() => swapTo(row, row.hold.suggestion)} disabled={busy === row.clientId} className="px-2 py-1 rounded border border-orange-300 text-orange-900 disabled:opacity-40">Swap to &ldquo;{row.hold.suggestion.title}&rdquo;</button>}
                          </div>
                        )}
                      </div>
                    )}
                    {hasEmail ? (
                      <>
                        <p className="text-gray-900"><span className="font-medium">{pick.what.title}</span> <span className="text-gray-400">· {pick.what.kind}{pick.form === 'short' ? ', short' : ''}</span>{row.waitingImprovements ? <span className="ml-2 text-xs text-amber-700">{row.waitingImprovements} improvement{row.waitingImprovements === 1 ? '' : 's'} waiting on this piece</span> : null}</p>
                        <p className="text-xs text-gray-500 italic">{pick.reason}</p>
                        {settled || ['approved', 'edited', 'lapsed'].includes(row.status) || (row.status === 'held' && !(row.hold && row.hold.stage === 'build')) || !isOpen ? (
                          <p className="mt-1 text-gray-800">{row.opening ? row.opening : <span className="text-red-700">no opening drafted - needs your words</span>}</p>
                        ) : (
                          <textarea value={e.opening ?? row.opening} onChange={(ev) => setEdits((s) => ({ ...s, [row.clientId]: { ...e, opening: ev.target.value } }))} rows={3} className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5" placeholder="The opening - one to three sentences, in your words" />
                        )}
                        {openingProblem && <p className="text-xs text-red-700">The draft breaks the craft ({openingProblem}) - say it your way.</p>}
                        {bodyProblem && <p className="text-xs text-red-700">Body: {bodyProblem}</p>}
                        {/* Always there - Guy reads the whole email before approving (22 Oct: hidden behind "Edit" he never found it) */}
                        {/* The thought for the week, why it was chosen for them, and Guy's way to change it */}
                        {pick.what.kind !== 'one-pager' && (
                          <div className="mt-1 text-xs text-gray-700 border-l-2 border-amber-200 pl-2">
                            {pick.thought ? (
                              <>
                                <p><span className="font-medium">A thought for the week:</span> {pick.thought.text} <span className="text-gray-400">({pick.thought.title})</span></p>
                                {pick.thought.why && <p className="text-gray-500 italic">why this one: {pick.thought.why}</p>}
                              </>
                            ) : <p className="text-gray-500">No thought for the week.</p>}
                            {!settled && (
                              <select value="" onChange={(ev) => ev.target.value && changeThought(row, ev.target.value === '-' ? '' : ev.target.value)} disabled={busy === row.clientId} className="mt-1 text-xs border border-gray-300 rounded px-1 py-0.5">
                                <option value="">Change the thought…</option>
                                {(thoughts || []).filter((t) => t.slug !== (pick.thought && pick.thought.slug)).map((t) => <option key={t.slug} value={t.slug}>{t.title}: {t.text.slice(0, 70)}…</option>)}
                                <option value="-">No thought this week</option>
                              </select>
                            )}
                          </div>
                        )}
                        <p className="mt-1 text-xs"><button onClick={() => openPreview(row)} className="text-blue-700 underline font-medium">Preview the whole email</button></p>
                        {isOpen && (
                          <p className="mt-1 text-xs text-gray-500 border-l-2 border-gray-200 pl-2">{row.bodyPreview}&hellip;</p>
                        )}
                      </>
                    ) : (
                      <p className="text-gray-500">Nothing this week <span className="italic">- {pick.reason}</span></p>
                    )}
                    {row.sendError && row.status !== 'held' && <p className="text-xs text-red-700">{row.sendError}</p>}
                  </div>

                  <div className="min-w-0 text-xs text-gray-600">
                    {!(row.likelyNext || []).length ? <p className="text-gray-400">-</p> : (
                      <ul className="flex flex-col gap-1">
                        {row.likelyNext.map((n) => (
                          <li key={n.weekOf} className="flex items-start gap-1.5">
                            <span className="text-gray-400 shrink-0 w-12">{shortDate(n.weekOf).replace(/ \d+$/, '')}</span>
                            <span className="flex-1 min-w-0" title={n.reason}>{n.what ? n.what.title : <span className="text-gray-400">{n.leftOut ? 'left out' : 'nothing'}</span>}</span>
                            {n.what && PINNABLE.has(n.what.kind) && !settled && !sendPassed && (!pick.what || pick.what.key !== n.what.key) && (
                              <button onClick={() => swapTo(row, n.what)} disabled={busy === row.clientId} className="shrink-0 text-blue-700 underline disabled:opacity-40" title={`Send this on ${mondayLabel(weekOf)} instead`}>use now</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-[11px] text-gray-400">provisional - a first call booked, a campaign running low and the like can jump the queue</p>
                  </div>

                  <div className="flex flex-col gap-1 items-end">
                    {hasEmail && ['proposed', 'failed', 'lapsed'].includes(row.status) && (
                      <button onClick={() => approve(row)} disabled={busy === row.clientId || !!bodyProblem} className="w-full px-2 py-1 rounded bg-green-600 text-white text-xs font-medium disabled:opacity-40">{sendPassed ? 'Approve & send now' : 'Approve'}</button>
                    )}
                    {!settled && <button onClick={() => setOpen((s) => ({ ...s, [row.clientId]: !isOpen }))} className="w-full px-2 py-1 rounded border border-gray-200 text-xs text-gray-700">{isOpen ? 'Close' : (hasEmail ? 'Edit / swap / skip' : 'Swap / pin')}</button>}
                  </div>
                </div>
                {isOpen && !settled && (
                  <div className="px-5 pb-4 grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="flex flex-col gap-2">
                      {pick.body && pick.body.template === 'first-email' && (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-gray-600">The welcome's Congratulations line (empty it to leave it out)</label>
                          <textarea value={e.congrats ?? (typeof pick.body.congrats === 'string' ? pick.body.congrats : (screen.firstEmail && screen.firstEmail.congrats) || '')} onChange={(ev) => setEdits((x) => ({ ...x, [row.clientId]: { ...e, congrats: ev.target.value } }))} rows={3} className="text-sm border border-gray-300 rounded px-2 py-1" />
                        </div>
                      )}
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
                        <button onClick={() => swap(row)} disabled={!swapPick[row.clientId] || busy === row.clientId} className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-700 disabled:opacity-40">Use this Monday</button>
                        <button onClick={() => pinNext(row)} disabled={!swapPick[row.clientId] || busy === row.clientId} className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-700 disabled:opacity-40">Pin for the Monday after</button>
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
                        <button onClick={() => skip(row)} disabled={busy === row.clientId} className="ml-auto px-3 py-1 rounded border border-gray-400 text-xs text-gray-800 disabled:opacity-40">Skip this Monday</button>
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
                <p className="font-medium text-gray-800">Left out ({leftOut.length})</p>
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
