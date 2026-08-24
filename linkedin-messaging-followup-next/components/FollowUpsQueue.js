"use client";
// The Follow-Ups screen — the Wingguy queue in the Thanks for Connecting mould.
// Brick 3 of docs/FOLLOWUPS-SCREEN-PLAN.md (Guy approved the mockup 2026-08-15).
//
// One row per person, the story so far (their dossier) on expand, four labelled actions:
// Draft (opens the signed draft page), Done, Park (concrete date, resolved here — no chat
// round-trip), Drop (cease, both stores). All data comes from /api/followups, which reads the
// SAME buildQueue()/dossier store chat does — this file renders, it never decides.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HelpButton from './HelpButton';
import { getCurrentClientId, getCurrentPortalToken, getCurrentDevKey } from "../utils/clientUtils";

const RAW_API = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server.onrender.com/api/linkedin';
let API_ORIGIN = 'https://pb-webhook-server.onrender.com';
try { API_ORIGIN = new URL(RAW_API).origin; } catch (_) {}

function buildClientId() {
  const cached = typeof getCurrentClientId === 'function' ? getCurrentClientId() : null;
  if (cached) return cached;
  try {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    return sp?.get('testClient') || sp?.get('clientId') || null;
  } catch (_) { return null; }
}

function buildUrl(path, cid) {
  let url = `${API_ORIGIN.replace(/\/$/, '')}/api/followups${path}`;
  if (!cid) {
    try {
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const t = sp?.get('testClient') || sp?.get('clientId');
      if (t) url += (path.includes('?') ? '&' : '?') + `testClient=${encodeURIComponent(t)}`;
    } catch (_) {}
  }
  return url;
}

function buildHeaders(cid) {
  const headers = { 'Content-Type': 'application/json', ...(cid ? { 'x-client-id': cid } : {}) };
  const portalToken = getCurrentPortalToken();
  const devKey = getCurrentDevKey();
  if (portalToken) headers['x-portal-token'] = portalToken;
  if (devKey) headers['x-dev-key'] = devKey;
  return headers;
}

async function apiGet(path, cid) {
  const res = await fetch(buildUrl(path, cid), { headers: buildHeaders(cid), cache: 'no-store' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body, cid) {
  const res = await fetch(buildUrl(path, cid), { method: 'POST', headers: buildHeaders(cid), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const keyOf = (it) => (it.name || it.email || '').toLowerCase();

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function addMonthsIso(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function newYearIso() {
  return `${new Date().getFullYear() + 1}-01-05`; // first working-ish week of January
}

// Row grouping label from the item's shape. Kind is the engine's verdict, not a guess.
function tierChip(it) {
  if (it.kind === 'park') return { label: 'PARK PROPOSED', cls: 'bg-sky-100 text-sky-800' };
  if (it.kind === 'attention') return { label: 'NEEDS JUDGEMENT', cls: 'bg-amber-100 text-amber-800' };
  if (it.kind === 'reopen') return { label: 'WENT QUIET', cls: 'bg-gray-100 text-gray-600' };
  return { label: 'REPLY OWED', cls: 'bg-emerald-100 text-emerald-800' };
}

function draftBadge(it) {
  if (it.draftState === 'ready') return { label: 'draft ready', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  if (it.draftState === 'wg-angle') return { label: 'open thread, use /wg', cls: 'bg-amber-100 text-amber-800 border-amber-300' };
  if (it.draftState === 'pending') return { label: 'draft coming overnight', cls: 'bg-gray-100 text-gray-600 border-gray-300' };
  if (it.draftState === 'error') return { label: 'no draft — ask in chat', cls: 'bg-red-50 text-red-700 border-red-200' };
  return { label: 'no draft — story below', cls: 'bg-gray-100 text-gray-600 border-gray-300' };
}

const CHANNEL_CHIP = {
  linkedin: 'bg-blue-100 text-blue-800',
  email: 'bg-pink-100 text-pink-800',
  calendar: 'bg-violet-100 text-violet-800',
  meeting: 'bg-violet-100 text-violet-800',
};

// The expanded row — the person's dossier, served verbatim by /story.
function StoryPanel({ story, builtAt, stale, source, onRefresh, refreshing }) {
  const remember = Array.isArray(story?.remember) ? story.remember : [];
  const timeline = Array.isArray(story?.timeline) ? story.timeline : [];
  const meetings = Array.isArray(story?.meetings) ? story.meetings : [];
  return (
    <div className="bg-slate-50 border-t px-4 py-4 text-sm">
      <div className="flex items-center gap-3 text-xs text-gray-400 mb-3 flex-wrap">
        <span>Story built {formatDate(builtAt) || 'just now'}{source === 'live-mini' ? ' (live from the CRM — no prepared dossier yet)' : ''}</span>
        {stale
          ? <span className="text-amber-700 font-semibold">⚠ The conversation has moved since this was written</span>
          : <span className="text-emerald-700 font-medium">✓ Up to date</span>}
        <button
          className="px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          onClick={onRefresh}
          disabled={refreshing}
        >{refreshing ? 'Refreshing…' : 'Refresh story'}</button>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          {story?.standing && (
            <div>
              <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">Where it stands</div>
              <p className="text-gray-800 leading-relaxed">{story.standing}</p>
            </div>
          )}
          {(story?.commitmentsYou || story?.commitmentsThem) && (
            <div>
              <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">Promises</div>
              {story.commitmentsYou && <p className="text-gray-800"><span className="font-semibold">You:</span> {story.commitmentsYou}</p>}
              {story.commitmentsThem && <p className="text-gray-800"><span className="font-semibold">Them:</span> {story.commitmentsThem}</p>}
            </div>
          )}
          {remember.length > 0 && (
            <div>
              <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">Worth remembering</div>
              <ul className="list-disc ml-5 text-gray-800 space-y-0.5">
                {remember.map((r, i) => <li key={i}>{String(r)}</li>)}
              </ul>
            </div>
          )}
          {story?.nextMove && (
            <div>
              <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">Suggested next move</div>
              <p className="text-gray-800">{story.nextMove}</p>
            </div>
          )}
          {meetings.length > 0 && (
            <div>
              <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">Meetings</div>
              <ul className="text-gray-800 space-y-1">
                {meetings.map((m, i) => (
                  <li key={i}>
                    <span className="text-gray-500 text-xs mr-2">{formatDate(m?.date || m?.startedAt)}</span>
                    {String(m?.title || m?.summary || 'Meeting on record').slice(0, 160)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-wide text-gray-500 uppercase mb-1">
            Timeline <span className="normal-case font-normal">— the channel label tells you where to reply</span>
          </div>
          <div className="border-l-2 border-gray-200 pl-3 space-y-2 max-h-96 overflow-y-auto">
            {timeline.length === 0 && <p className="text-gray-500">No dated history on record.</p>}
            {timeline.map((t, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{t?.date || ''}</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] tracking-wide uppercase ${CHANNEL_CHIP[t?.kind] || 'bg-gray-100 text-gray-600'}`}>{t?.kind || '?'}</span>
                  <span className="font-semibold text-gray-600">{t?.dir === 'them' ? 'Them' : 'You'}</span>
                  {t?.subject ? <span className="truncate text-gray-400">“{t.subject}”</span> : null}
                </div>
                {t?.text && <div className="text-gray-800 leading-snug">{String(t.text)}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ParkPopover({ onPick, onClose }) {
  const [customDate, setCustomDate] = useState('');
  return (
    <div className="absolute right-0 top-full mt-1 z-20 bg-white border rounded-lg shadow-lg p-3 w-64">
      <div className="text-xs font-bold text-gray-600 mb-2">Park until…</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <button className="px-2.5 py-1 rounded border text-sm bg-white text-gray-700 border-gray-300 hover:bg-gray-50" onClick={() => onPick(addMonthsIso(1))}>1 month</button>
        <button className="px-2.5 py-1 rounded border text-sm bg-white text-gray-700 border-gray-300 hover:bg-gray-50" onClick={() => onPick(addMonthsIso(3))}>3 months</button>
        <button className="px-2.5 py-1 rounded border text-sm bg-white text-gray-700 border-gray-300 hover:bg-gray-50" onClick={() => onPick(newYearIso())}>New year</button>
      </div>
      <div className="flex items-center gap-1.5">
        <input type="date" className="border rounded px-2 py-1 text-sm text-gray-700 flex-1" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
        <button
          className="px-2.5 py-1 rounded text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          disabled={!customDate}
          onClick={() => customDate && onPick(customDate)}
        >Park</button>
      </div>
      <button className="mt-2 text-xs text-gray-400 hover:text-gray-600" onClick={onClose}>Cancel</button>
    </div>
  );
}

export default function FollowUpsQueue() {
  const clientId = useMemo(() => buildClientId(), []);
  const [items, setItems] = useState([]);
  const [hidden, setHidden] = useState({ counts: {}, items: [] });
  const [briefPreparedAt, setBriefPreparedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadSecs, setLoadSecs] = useState(0);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);        // transient action feedback
  const [cleared, setCleared] = useState(0);          // this session
  const [tierFilter, setTierFilter] = useState('all');
  const [sortMode, setSortMode] = useState('priority'); // 'priority' | 'quiet' | 'recent'
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(null);     // person key
  const [stories, setStories] = useState({});         // key -> {loading, data, error, refreshing}
  const [parkFor, setParkFor] = useState(null);       // person key with the popover open
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(() => new Set());  // keys with an action in flight

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Elapsed counter (Guy's ask, first morning 2026-08-15): the load is a LIVE check of
    // Airtable + calendar + mailbox, so it takes real seconds — show them passing rather
    // than an anonymous spinner.
    setLoadSecs(0);
    const tick = setInterval(() => setLoadSecs((s) => s + 1), 1000);
    try {
      const data = await apiGet('/queue', clientId);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setHidden(data?.hidden || { counts: {}, items: [] });
      setBriefPreparedAt(data?.briefPreparedAt || null);
    } catch (e) {
      setError(e?.message || 'Failed to load the queue');
      setItems([]);
    } finally {
      clearInterval(tick);
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    let list = items;
    if (tierFilter !== 'all') list = list.filter((it) => it.kind === tierFilter);
    if (sortMode === 'quiet') list = [...list].sort((a, b) => (b.quietDays ?? -1) - (a.quietDays ?? -1));
    else if (sortMode === 'recent') list = [...list].sort((a, b) => (a.quietDays ?? 1e9) - (b.quietDays ?? 1e9));
    return list;
  }, [items, tierFilter, sortMode]);

  const hiddenTotal = useMemo(() => Object.values(hidden?.counts || {}).reduce((a, b) => a + (Number(b) || 0), 0), [hidden]);

  const removeRow = useCallback((key) => {
    setItems((prev) => prev.filter((it) => keyOf(it) !== key));
    setSelected((prev) => { const n = new Set(prev); n.delete(key); return n; });
    if (expanded === key) setExpanded(null);
    setCleared((c) => c + 1);
  }, [expanded]);

  const doAction = useCallback(async (it, action, parkDate) => {
    const key = keyOf(it);
    setBusy((prev) => new Set(prev).add(key));
    setError(null);
    try {
      await apiPost('/action', { name: it.name, email: it.email || undefined, src: it.src, action, ...(parkDate ? { parkDate } : {}) }, clientId);
      removeRow(key);
      setNotice(action === 'park' ? `${it.name} parked until ${formatDate(parkDate)}` : (action === 'drop' ? `${it.name} dropped — nothing sent, a new message from them still surfaces` : `${it.name} marked done`));
      setTimeout(() => setNotice(null), 5000);
    } catch (e) {
      setError(`${action} failed for ${it.name}: ${e?.message || e}`);
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(key); return n; });
      setParkFor(null);
    }
  }, [clientId, removeRow]);

  const dropSelected = useCallback(async () => {
    const picked = items.filter((it) => selected.has(keyOf(it)));
    if (!picked.length) return;
    const ok = window.confirm(`Drop ${picked.length} ${picked.length === 1 ? 'person' : 'people'} permanently? Nothing is sent; a new message from any of them still surfaces.`);
    if (!ok) return;
    for (const it of picked) {
      // Sequential on purpose — each drop is two writes; a stampede invites Airtable rate limits.
      // eslint-disable-next-line no-await-in-loop
      await doAction(it, 'drop');
    }
  }, [items, selected, doAction]);

  const toggleStory = useCallback(async (it) => {
    const key = keyOf(it);
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (stories[key]?.data) return;
    setStories((prev) => ({ ...prev, [key]: { loading: true } }));
    try {
      const qs = `?name=${encodeURIComponent(it.name || '')}${it.email ? `&email=${encodeURIComponent(it.email)}` : ''}`;
      const data = await apiGet(`/story${qs}`, clientId);
      setStories((prev) => ({ ...prev, [key]: { data } }));
    } catch (e) {
      setStories((prev) => ({ ...prev, [key]: { error: e?.message || 'Failed to load the story' } }));
    }
  }, [clientId, expanded, stories]);

  const refreshStory = useCallback(async (it) => {
    const key = keyOf(it);
    setStories((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), refreshing: true } }));
    try {
      const qs = `?name=${encodeURIComponent(it.name || '')}${it.email ? `&email=${encodeURIComponent(it.email)}` : ''}&refresh=1`;
      await apiGet(`/story${qs}`, clientId);
      // The rebuild runs in the background on the server; re-read after a beat to pick it up.
      setTimeout(async () => {
        try {
          const qs2 = `?name=${encodeURIComponent(it.name || '')}${it.email ? `&email=${encodeURIComponent(it.email)}` : ''}`;
          const data = await apiGet(`/story${qs2}`, clientId);
          setStories((prev) => ({ ...prev, [key]: { data } }));
        } catch (_) {
          setStories((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), refreshing: false } }));
        }
      }, 20000);
    } catch (e) {
      setStories((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), refreshing: false, error: e?.message } }));
    }
  }, [clientId]);

  const toggleSelect = useCallback((key) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border rounded p-4">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h2 className="font-semibold text-lg">Follow-Ups</h2>
          <HelpButton area="followups" className="ml-1" title="Help: Follow-Ups" />
          {items.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300">
              {items.length} to action
            </span>
          )}
          {cleared > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-300">
              {cleared} cleared this session
            </span>
          )}
          {hiddenTotal > 0 && (
            <button
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100"
              onClick={() => setShowHidden((s) => !s)}
              title="People removed automatically because the live check found them already handled"
            >
              {hiddenTotal} already handled — hidden {showHidden ? '▴' : '▾'}
            </button>
          )}
        </div>
        <p className="text-sm text-gray-600">
          Everyone you owe a reply or a nudge, with the story so far. Click a name to open LinkedIn,
          expand the story, then <span className="font-medium">Draft</span>, <span className="font-medium">Done</span>,
          <span className="font-medium"> Park</span> or <span className="font-medium">Drop</span>. Ceased, booked and
          already-messaged people are removed automatically.
          {briefPreparedAt ? <span className="text-gray-400"> Overnight brief prepared {formatDate(briefPreparedAt)}.</span> : null}
        </p>

        {showHidden && hidden?.items?.length > 0 && (
          <div className="mt-3 text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <div className="font-semibold text-amber-800 mb-1">Removed by the live check:</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {hidden.items.map((h, i) => (
                <span key={i}>{h.name} <span className="text-gray-400">({h.reason === 'messaged' ? 'you already messaged them' : h.reason})</span></span>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            className="px-3 py-1.5 rounded text-sm border bg-white text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={dropSelected}
          >Drop selected{selected.size ? ` (${selected.size})` : ''}</button>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Sort
              <select className="border rounded px-2 py-1 text-sm text-gray-700" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="priority">Priority order</option>
                <option value="quiet">Longest quiet first</option>
                <option value="recent">Most recent first</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              Show
              <select className="border rounded px-2 py-1 text-sm text-gray-700" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                <option value="all">Everything</option>
                <option value="draft">Replies owed</option>
                <option value="reopen">Went quiet</option>
                <option value="park">Park proposals</option>
                <option value="attention">Needs judgement</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border rounded">
        <div className="p-4">
          {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2" role="alert">{error}</div>}
          {notice && <div className="mb-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{notice}</div>}

          {loading && (
            <div className="text-gray-500 py-8 text-center">
              <div>Checking the live world — your CRM, calendar and mailbox — so nothing already handled is shown…</div>
              <div className="text-xs text-gray-400 mt-1">{loadSecs}s{loadSecs >= 15 ? ' — nearly there' : ''}</div>
            </div>
          )}

          {!loading && visible.length === 0 && (
            <div className="py-12 text-center">
              <div className="text-4xl mb-2">🎉</div>
              <div className="text-gray-800 font-medium">
                {items.length === 0 ? 'Queue clear — nothing actionable right now.' : 'Nothing in this view — change the filter to see the rest.'}
              </div>
              {items.length === 0 && <div className="text-gray-500 text-sm mt-1">Parked people surface on their dates; new replies appear as they land.</div>}
            </div>
          )}

          {!loading && visible.length > 0 && (
            <>
              <div className="flex items-center gap-4 pb-2 mb-1 border-b text-xs font-medium text-gray-400 uppercase tracking-wide">
                <div className="w-5 shrink-0"></div>
                <div className="w-20 sm:w-28 shrink-0">Quiet</div>
                <div className="flex-1">Lead</div>
                <div className="shrink-0 pr-1">Action</div>
              </div>
              <ul className="divide-y">
                {visible.map((it) => {
                  const key = keyOf(it);
                  const chip = tierChip(it);
                  const badge = draftBadge(it);
                  const story = stories[key];
                  const isBusy = busy.has(key);
                  return (
                    <li key={key} className={isBusy ? 'opacity-40 pointer-events-none' : ''}>
                      <div className="py-3 flex items-start gap-4">
                        <div className="w-5 shrink-0 pt-1">
                          <input type="checkbox" className="accent-blue-600 h-4 w-4" checked={selected.has(key)} onChange={() => toggleSelect(key)} />
                        </div>
                        <div className="w-20 sm:w-28 shrink-0">
                          <div className="text-sm font-semibold text-gray-900">{it.quietDays != null ? `${it.quietDays} days` : '—'}</div>
                          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${chip.cls}`}>{chip.label}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {it.linkedin ? (
                              <a className="font-medium text-blue-700 hover:underline" href={it.linkedin} target="_blank" rel="noreferrer">{it.name}</a>
                            ) : (
                              <span className="font-medium text-gray-900">{it.name}</span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>{badge.label}</span>
                          </div>
                          {it.whyLine && <div className="text-sm text-gray-800 mt-0.5">{it.whyLine}{it.kind === 'park' && it.parkDate && !it.parkPassed ? ` — proposed park to ${formatDate(it.parkDate)}` : ''}{it.parkPassed ? ` — their own window (${formatDate(it.parkDate)}) has passed; reach out now` : ''}</div>}
                          {it.jog && <div className="text-sm text-gray-500 mt-0.5">{it.jog}</div>}
                          {it.wgAngle && <div className="text-xs text-amber-800 mt-0.5"><span className="font-semibold">/wg angle:</span> {it.wgAngle}</div>}
                          <button className="text-xs text-blue-600 hover:underline mt-1" onClick={() => toggleStory(it)}>
                            {expanded === key ? '▴ Hide story' : '▾ Show story'}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 relative">
                          {it.draftUrl ? (
                            <a
                              className="px-3 py-1.5 rounded text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-600"
                              href={it.draftUrl} target="_blank" rel="noreferrer"
                              title={it.draftState === 'ready' ? 'Open the ready-made message (copy button + LinkedIn link)' : 'Open the context card — write the reply in the thread with /wg'}
                            >{it.draftState === 'ready' ? 'Draft' : 'Card'}</a>
                          ) : (
                            <button className="px-3 py-1.5 rounded text-sm border bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed" title="No pre-written draft — the story below has the context; ask in chat for wording" disabled>Draft</button>
                          )}
                          <button className="px-3 py-1.5 rounded text-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50" onClick={() => doAction(it, 'done')} title="Handled — no change to the relationship">Done</button>
                          <button className="px-3 py-1.5 rounded text-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50" onClick={() => setParkFor(parkFor === key ? null : key)} title="Not now, definitely later — pick a date">Park</button>
                          <button
                            className="px-3 py-1.5 rounded text-sm border bg-white text-red-700 border-red-200 hover:bg-red-50"
                            onClick={() => { if (window.confirm(`Drop ${it.name} permanently? Nothing is sent; a new message from them still surfaces.`)) doAction(it, 'drop'); }}
                            title="Relationship over — timers silenced permanently; nothing sent"
                          >Drop</button>
                          {parkFor === key && <ParkPopover onPick={(d) => doAction(it, 'park', d)} onClose={() => setParkFor(null)} />}
                        </div>
                      </div>
                      {expanded === key && (
                        <div className="mb-3 -mt-1 rounded border bg-slate-50">
                          {story?.loading && <div className="px-4 py-6 text-gray-500 text-sm">Loading the story…</div>}
                          {story?.error && <div className="px-4 py-4 text-sm text-red-600">{story.error}</div>}
                          {story?.data && (
                            <StoryPanel
                              story={story.data.story}
                              builtAt={story.data.builtAt}
                              stale={!!story.data.stale}
                              source={story.data.source}
                              refreshing={!!story.refreshing}
                              onRefresh={() => refreshStory(it)}
                            />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
