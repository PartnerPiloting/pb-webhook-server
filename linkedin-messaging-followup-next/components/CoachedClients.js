"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';
import { getClientBoard, getClientBoardDetail } from '../services/clientBoardApi';
import { buildAuthUrl, getCurrentClientId } from '../utils/clientUtils';
import {
  UsersIcon, ExclamationTriangleIcon, KeyIcon, ClipboardDocumentIcon, CheckIcon,
  ArrowRightIcon, ChevronDownIcon, ChevronUpIcon, ArrowPathIcon, EyeIcon, PlusCircleIcon,
} from '@heroicons/react/24/outline';

/**
 * My Clients - the coach's board (replaced My Coached Clients, 2026-09-09).
 *
 * One card per client, three groups (onboarding / running / paused), every value derived live
 * by the backend (services/clientBoardService.js) at read time - nothing here is a stored stage.
 * Groups are A to Z; the coloured edge on an onboarding card carries the attention signal
 * (red = stalled, amber = no session booked, green = on track). The "Onboard" button is a
 * claude-cli:// deep link that opens a fresh Claude Code session with "onboard <name>" typed
 * and waiting - the prompt is inert until Enter is pressed.
 */

const PORTAL_BASE_URL = 'https://pb-webhook-server.vercel.app';
// The repo Claude Code opens for "onboard <name>". `repo` resolves to whichever local clone the
// coach last ran `claude` in, so the same link works on every machine they use.
const ONBOARD_REPO = 'PartnerPiloting/pb-webhook-server';
const REFRESH_MS = 45000;

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

function agoText(iso, fallback = 'never') {
  const d = daysAgo(iso);
  if (d === null) return fallback;
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

function whenText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(' ', ' ');
  return `${day}, ${time}`;
}

function monthText(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

function onboardLink(clientName) {
  return `claude-cli://open?repo=${ONBOARD_REPO}&q=${encodeURIComponent(`onboard ${clientName}`)}`;
}

// ---- small pieces ----------------------------------------------------------------------------

const PILL_STYLE = {
  done: 'bg-green-100 text-green-800',
  next: 'bg-amber-100 text-amber-800 border border-amber-300',
  owed: 'bg-gray-100 text-gray-400',
  manual: 'bg-gray-100 text-gray-500 border border-dashed border-gray-300',
  off: 'bg-gray-100 text-gray-400',
};

const Pill = ({ pill }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${PILL_STYLE[pill.state] || PILL_STYLE.owed}`}
    title={pill.note || ''}
  >
    {pill.state === 'done' && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
    {pill.label}
    {pill.state === 'next' && <span className="text-amber-700">&middot; next</span>}
  </span>
);

const EDGE = { red: 'border-l-red-500', amber: 'border-l-amber-400', green: 'border-l-green-500', none: 'border-l-gray-200' };

function attentionBadge(card) {
  if (card.group !== 'onboarding') return null;
  if (card.attention === 'red') return { text: 'Stalled', cls: 'bg-red-100 text-red-800' };
  if (card.attention === 'amber') return { text: card.plumbingComplete ? 'Plumbing done' : 'No session booked', cls: 'bg-amber-100 text-amber-800' };
  return { text: 'On track', cls: 'bg-green-100 text-green-800' };
}

const CopyField = ({ label, value, onCopy, copied, extra }) => (
  <div className="flex flex-col gap-1">
    <p className="text-xs font-medium text-slate-600">{label}</p>
    <div className="flex gap-2 items-center flex-wrap">
      <code className="flex-1 min-w-0 text-xs bg-white px-2 py-1.5 rounded border border-slate-200 text-slate-700 break-all">{value || '(none)'}</code>
      {value && (
        <button
          onClick={onCopy}
          className={`px-2 py-1.5 rounded text-xs font-medium transition-colors shrink-0 ${copied ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
        >
          {copied ? <span className="flex items-center gap-1"><CheckIcon className="h-3 w-3" /> Copied</span> : <span className="flex items-center gap-1"><ClipboardDocumentIcon className="h-3 w-3" /> Copy</span>}
        </button>
      )}
      {extra}
    </div>
  </div>
);

// ---- the component ---------------------------------------------------------------------------

const CoachedClients = () => {
  const router = useRouter();
  const [board, setBoard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});     // clientId -> true
  const [details, setDetails] = useState({});       // clientId -> { loading, data, error }
  const [generatedTokens, setGeneratedTokens] = useState({}); // clientId -> { token, url }
  const [copied, setCopied] = useState(null);       // `${clientId}:${what}`
  const [busy, setBusy] = useState({});             // clientId -> 'token' | 'tasks'
  const [notice, setNotice] = useState(null);
  const timer = useRef(null);

  const backendBase = getBackendBase();

  const load = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setIsLoading(true);
      setError(null);
      const data = await getClientBoard();
      if (data && data.success) setBoard(data);
      else setError((data && data.error) || 'Failed to load the board');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load the board');
    } finally {
      if (!quiet) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    timer.current = setInterval(() => load(true), REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  const flashCopied = (key) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2500);
  };

  const copyText = (key, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    flashCopied(key);
  };

  const portalUrlFor = (card) => {
    const t = generatedTokens[card.clientId];
    if (t?.url) return t.url;
    return card.portalToken ? `${PORTAL_BASE_URL}/?token=${card.portalToken}` : null;
  };

  const connectorUrlFor = (card) => {
    const token = generatedTokens[card.clientId]?.token || card.portalToken;
    return token ? `https://pb-webhook-server.onrender.com/mcp2/${token}` : null;
  };

  const toggleDetails = async (card) => {
    const open = !expanded[card.clientId];
    setExpanded((s) => ({ ...s, [card.clientId]: open }));
    if (!open) return;
    // The drawer opens instantly on what the board already knows; the live checks arrive
    // a few seconds later (they hit the calendar seam and the rules store per client).
    setDetails((d) => ({ ...d, [card.clientId]: { loading: true, data: null, error: null } }));
    try {
      const data = await getClientBoardDetail(card.clientId);
      setDetails((d) => ({ ...d, [card.clientId]: { loading: false, data, error: null } }));
    } catch (e) {
      setDetails((d) => ({ ...d, [card.clientId]: { loading: false, data: null, error: e.response?.data?.error || e.message } }));
    }
  };

  const regenerateToken = async (card) => {
    setBusy((b) => ({ ...b, [card.clientId]: 'token' }));
    setNotice(null);
    try {
      const coachClientId = getCurrentClientId();
      const response = await fetch(`${backendBase}/api/coached-clients/${coachClientId}/regenerate-token/${card.clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthenticatedHeaders() },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.token) throw new Error(data.error || `Server returned ${response.status}`);
      setGeneratedTokens((g) => ({ ...g, [card.clientId]: { token: data.token, url: data.portalUrl || `${PORTAL_BASE_URL}/?token=${data.token}` } }));
      setNotice({ kind: 'ok', text: `New portal link minted for ${card.clientName} - the old one stops working now.` });
    } catch (e) {
      setNotice({ kind: 'err', text: e.message === 'Failed to fetch' ? 'Cannot reach the server - it may be waking up, try again in 30 seconds.' : e.message });
    } finally {
      setBusy((b) => ({ ...b, [card.clientId]: null }));
    }
  };

  const syncTasks = async (card) => {
    setBusy((b) => ({ ...b, [card.clientId]: 'tasks' }));
    setNotice(null);
    try {
      const response = await fetch(`${backendBase}/api/client/${card.clientId}/create-tasks`, { method: 'POST', headers: getAuthenticatedHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!data.success) throw new Error(data.error || 'Failed to sync tasks');
      setNotice({ kind: 'ok', text: data.tasksCreated > 0 ? `Added ${data.tasksCreated} new tasks for ${card.clientName}` : `${card.clientName} already has every task` });
      load(true);
    } catch (e) {
      setNotice({ kind: 'err', text: e.message });
    } finally {
      setBusy((b) => ({ ...b, [card.clientId]: null }));
    }
  };

  // ---- render pieces ----

  const OwedRow = ({ card }) => {
    const mine = card.owed.filter((o) => o.who === 'coach');
    const theirs = card.owed.filter((o) => o.who === 'client');
    if (!mine.length && !theirs.length) return null;
    return (
      <div className="flex gap-6 text-sm border-t border-gray-100 pt-3">
        <div className="flex-1 flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">You owe</p>
          {mine.length ? mine.map((o) => <p key={o.id} className="text-gray-700">{o.task}</p>) : <p className="text-gray-400">Nothing</p>}
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">They owe</p>
          {theirs.length ? theirs.map((o) => <p key={o.id} className="text-gray-700">{o.task}</p>) : <p className="text-gray-400">Nothing</p>}
        </div>
      </div>
    );
  };

  const Drawer = ({ card }) => {
    const d = details[card.clientId] || {};
    const portalUrl = portalUrlFor(card);
    const connectorUrl = connectorUrlFor(card);
    const tasks = d.data?.tasks || [];
    const steps = d.data?.preflight?.steps || [];
    const warnings = d.data?.preflight?.warnings || [];
    const MARK = { done: 'text-green-700', owed: 'text-amber-700', manual: 'text-gray-500' };
    const WORD = { done: 'DONE', owed: 'OWED', manual: 'MANUAL' };
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Links and keys</p>
          <CopyField
            label="Client portal URL"
            value={portalUrl}
            copied={copied === `${card.clientId}:portal`}
            onCopy={() => copyText(`${card.clientId}:portal`, portalUrl)}
            extra={(
              <button
                onClick={() => regenerateToken(card)}
                disabled={busy[card.clientId] === 'token'}
                className={`px-2 py-1.5 rounded text-xs font-medium border transition-colors shrink-0 ${busy[card.clientId] === 'token' ? 'bg-gray-200 text-gray-500 border-gray-200 cursor-wait' : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'}`}
                title="Mint a new secure portal link (the old one stops working)"
              >
                <span className="flex items-center gap-1"><KeyIcon className="h-3 w-3" /> {busy[card.clientId] === 'token' ? 'Minting…' : 'New token'}</span>
              </button>
            )}
          />
          <CopyField
            label="Connector URL for their Claude"
            value={connectorUrl}
            copied={copied === `${card.clientId}:connector`}
            onCopy={() => copyText(`${card.clientId}:connector`, connectorUrl)}
          />
          <div className="grid grid-cols-2 gap-3 text-sm text-slate-700">
            <div><p className="text-xs text-slate-500">Login email</p><p className="break-all">{card.loginEmail || '-'}</p></div>
            <div><p className="text-xs text-slate-500">Leads base</p><p>{card.leadsBaseId || '-'}</p></div>
            <div><p className="text-xs text-slate-500">Calendar &amp; mail</p><p>{card.calendarProvider || 'not connected'}</p></div>
            <div><p className="text-xs text-slate-500">Launch date</p><p>{card.launchDate || '-'}</p></div>
            {card.seriesStart && <div><p className="text-xs text-slate-500">Series started</p><p>{card.seriesStart}</p></div>}
            {card.reconnectOn && <div><p className="text-xs text-slate-500">Check in</p><p>{card.reconnectOn}</p></div>}
          </div>
          {card.coachNotes && <p className="text-sm text-gray-500 italic">&ldquo;{card.coachNotes}&rdquo;</p>}
          <div className="flex gap-2 pt-1 flex-wrap">
            <button onClick={() => router.push(buildAuthUrl(`/client-tasks/${card.clientId}`))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50">
              <EyeIcon className="h-4 w-4" /> View all tasks{tasks.length ? ` (${tasks.length})` : ''}
            </button>
            <button onClick={() => syncTasks(card)} disabled={busy[card.clientId] === 'tasks'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:cursor-wait">
              <PlusCircleIcon className="h-4 w-4" /> {busy[card.clientId] === 'tasks' ? 'Syncing…' : 'Sync tasks'}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Check live - the journey, probed now</p>
          {d.loading && (
            <p className="text-sm text-gray-500 flex items-center gap-2"><ArrowPathIcon className="h-4 w-4 animate-spin" /> Probing the record, the calendar and the stores…</p>
          )}
          {d.error && <p className="text-sm text-red-600">{d.error}</p>}
          {!d.loading && steps.length > 0 && (
            <div className="flex flex-col gap-1 text-xs font-mono">
              {steps.map((s) => (
                <div key={s.n} className="flex gap-2 items-start">
                  <span className="text-gray-400 w-6 shrink-0 text-right">{s.n}</span>
                  <span className="w-36 shrink-0 text-gray-700">{s.name}</span>
                  <span className={`w-14 shrink-0 font-semibold ${MARK[s.verdict] || ''}`}>{WORD[s.verdict] || s.verdict}</span>
                  <span className="text-gray-500 break-words min-w-0">{s.evidence}</span>
                </div>
              ))}
            </div>
          )}
          {!d.loading && warnings.length > 0 && (
            <div className="flex flex-col gap-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const Card = ({ card }) => {
    const badge = attentionBadge(card);
    const open = !!expanded[card.clientId];
    return (
      <div className={`bg-white border border-gray-200 border-l-4 ${EDGE[card.attention] || EDGE.none} rounded-lg shadow-sm p-5 flex flex-col gap-3.5`}>
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-lg font-semibold text-gray-900">{card.clientName}</h3>
              {badge && <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>{badge.text}</span>}
              {card.coachingStatus && card.coachingStatus !== 'Active' && card.coachingStatus !== 'Graduated' && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Coaching {card.coachingStatus.toLowerCase()}</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-[13px] text-gray-600 flex-wrap">
              {card.nextSession
                ? <span className="text-gray-900 font-medium">Next session: {whenText(card.nextSession.at)}{card.nextSession.title ? ` · ${card.nextSession.title}` : ''}</span>
                : <span className="text-red-600 font-medium">Next session: not booked</span>}
              <span>Last session: {agoText(card.lastSessionAt, 'none yet')}</span>
              <span>Last used Wingguy: {agoText(card.lastUsedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href={onboardLink(card.clientName)} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700" title={`Open Claude Code with "onboard ${card.clientName}" ready to send`}>
              <ArrowRightIcon className="h-4 w-4" /> Onboard
            </a>
            <button onClick={() => toggleDetails(card)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] font-medium ${open ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {open ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />} Details
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {card.pills.map((p) => <Pill key={p.key} pill={p} />)}
        </div>
        <OwedRow card={card} />
        {open && <Drawer card={card} />}
      </div>
    );
  };

  const Row = ({ card, cols }) => {
    const open = !!expanded[card.clientId];
    return (
      <div className="border-b border-gray-100 last:border-b-0">
        <div className="grid items-center gap-4 px-5 py-3 text-sm text-gray-900" style={{ gridTemplateColumns: cols }}>
          <div className="font-semibold">{card.clientName}</div>
          {card.group === 'running' ? (
            <>
              <div className="text-gray-600">
                {card.launchDate ? `Since ${monthText(card.launchDate)}` : 'Long-standing'}
                {card.coachingStatus === 'Graduated' ? ' · graduated' : ''}
              </div>
              <div className={daysAgo(card.lastUsedAt) !== null && daysAgo(card.lastUsedAt) > 30 ? 'text-amber-700' : 'text-gray-600'}>{agoText(card.lastUsedAt)}</div>
              <div className="text-gray-600">{card.introducedBy ? `Introduced by ${card.introducedBy}` : '-'}</div>
            </>
          ) : (
            <>
              <div className="text-gray-600">
                {card.coachNotes ? card.coachNotes : 'Paused'}
              </div>
              <div className={card.reconnectOn ? 'text-blue-700 font-medium' : 'text-gray-400'}>{card.reconnectOn || 'none set'}</div>
            </>
          )}
          <button onClick={() => toggleDetails(card)} className={`justify-self-end inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[13px] font-medium ${open ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {open ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />} Details
          </button>
        </div>
        {open && (
          <div className="px-5 pb-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">{card.pills.map((p) => <Pill key={p.key} pill={p} />)}</div>
            <OwedRow card={card} />
            <Drawer card={card} />
          </div>
        )}
      </div>
    );
  };

  const Tile = ({ label, value, sub, subCls }) => (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-5 py-4 flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-[28px] leading-8 font-bold text-gray-900">{value}</p>
      <p className={`text-[13px] ${subCls || 'text-gray-500'}`}>{sub}</p>
    </div>
  );

  // ---- states ----

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Reading every client record, your calendar and the stores…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-red-800 mb-2">The board could not load</h2>
          <p className="text-red-600">{error}</p>
          <button onClick={() => load(false)} className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors">Try again</button>
        </div>
      </div>
    );
  }

  if (!board || board.count === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <UsersIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No clients yet</h2>
          <p className="text-gray-500">Nobody has you as their coach yet.</p>
        </div>
      </div>
    );
  }

  const { strip, groups } = board;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-7">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <UsersIcon className="h-7 w-7 text-green-600" />
            My Clients
          </h1>
          <p className="text-gray-600 mt-1">{board.count} clients &middot; {board.coachName} &middot; refreshed {agoText(board.generatedAt) === 'today' ? 'just now' : agoText(board.generatedAt)}</p>
        </div>
        <p className="text-[13px] text-gray-500">A to Z in every group</p>
      </div>

      {notice && (
        <div className={`p-3 rounded-lg border flex items-center justify-between text-sm ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-lg font-bold leading-none px-2">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Onboarding" value={strip.onboarding} sub={strip.onboardingNotBooked ? `${strip.onboardingNotBooked} with no session booked` : 'every one has a session booked'} subCls={strip.onboardingNotBooked ? 'text-red-600' : 'text-green-700'} />
        <Tile label="Plumbing complete" value={strip.plumbingComplete} sub={strip.plumbingCompleteEver === strip.plumbingComplete ? `all ${strip.plumbingComplete} still active` : `${strip.plumbingCompleteEver - strip.plumbingComplete} paused`} subCls="text-green-700" />
        <Tile label="Paused" value={strip.paused} sub={strip.pausedWithCheckIn ? `${strip.pausedWithCheckIn} with a check-in date` : 'no check-in dates set'} />
        <Tile label="Referrals this quarter" value={strip.referralsThisQuarter} sub={`of ${strip.newThisQuarter} new client${strip.newThisQuarter === 1 ? '' : 's'} this quarter`} />
      </div>

      {!strip.calendarRead && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">Your calendar did not read, so &ldquo;next session&rdquo; is blank everywhere. Last sessions still come from the transcript store.</p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3 pt-2">
          <h2 className="text-lg font-semibold text-gray-900">Onboarding</h2>
          <p className="text-[13px] text-gray-500">{groups.onboarding.length} client{groups.onboarding.length === 1 ? '' : 's'}</p>
        </div>
        {groups.onboarding.length ? groups.onboarding.map((c) => <Card key={c.clientId} card={c} />) : <p className="text-sm text-gray-500">Nobody is mid-journey. Set a Launch Date on a record to bring them here.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3 pt-2">
          <h2 className="text-lg font-semibold text-gray-900">Running</h2>
          <p className="text-[13px] text-gray-500">{groups.running.length} client{groups.running.length === 1 ? '' : 's'} &middot; sessions finished</p>
        </div>
        {groups.running.length ? (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="grid gap-4 px-5 py-2.5 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500" style={{ gridTemplateColumns: '220px 1fr 160px 200px 110px' }}>
              <div>Client</div><div>Running since</div><div>Last used Wingguy</div><div>Referral</div><div></div>
            </div>
            {groups.running.map((c) => <Row key={c.clientId} card={c} cols="220px 1fr 160px 200px 110px" />)}
          </div>
        ) : <p className="text-sm text-gray-500">Nobody yet. Set Coaching Status to Graduated when a client&rsquo;s sessions are finished.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3 pt-2">
          <h2 className="text-lg font-semibold text-gray-900">Paused</h2>
          <p className="text-[13px] text-gray-500">{groups.paused.length} client{groups.paused.length === 1 ? '' : 's'} &middot; nobody forgotten here</p>
        </div>
        {groups.paused.length ? (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="grid gap-4 px-5 py-2.5 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500" style={{ gridTemplateColumns: '220px 1fr 200px 110px' }}>
              <div>Client</div><div>Notes</div><div>Check in</div><div></div>
            </div>
            {groups.paused.map((c) => <Row key={c.clientId} card={c} cols="220px 1fr 200px 110px" />)}
          </div>
        ) : <p className="text-sm text-gray-500">Nobody is paused.</p>}
      </section>

      <p className="text-xs text-gray-400 pt-2">
        Groups are derived, not stored: a Launch Date or Wingguy switched on puts a client in Onboarding; Coaching Status &ldquo;Graduated&rdquo; moves them to Running; Status Paused is Paused.
        Owed items are Client Tasks with the phase &ldquo;You owe&rdquo; or &ldquo;They owe&rdquo;.
      </p>
    </div>
  );
};

export default CoachedClients;
