"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getClientBoardDetail, mintUnipileLink } from '../services/clientBoardApi';
import { buildAuthUrl } from '../utils/clientUtils';
import {
  ArrowLeftIcon, ArrowPathIcon, CheckIcon, ClipboardDocumentIcon, LinkIcon, PlayIcon, StopIcon,
} from '@heroicons/react/24/outline';

/**
 * Concierge run sheet - one client, one remote sitting, the coach driving.
 *
 * Born 2026-09-16 for the Alex-type client (not technical, easily distracted): instead of
 * week-after-week sessions where the client does their own clicking, the coach logs into their
 * machine over Splashtop and does all of it in ~40 minutes. The client is there for the first
 * five minutes and the last five. Everything the coach pastes during that sitting is minted
 * HERE from the record - connector link, calendar-and-mail approval link, the extension
 * installer line, the portal link - so the session is pasting, not looking things up.
 *
 * Live state comes from the same detail call the board drawer uses (preflight DONE/OWED per
 * step). Ticks and the clock live in this browser only (localStorage) - they are the coach's
 * working notes for one sitting, not a record of anything.
 */

const BUDGET_MIN = 40;

// Which preflight steps (docs/wingguy-onboarding-checklist.md numbering) prove each beat.
const BEATS = [
  {
    id: 'p1', phase: 'prep', label: 'Prep', title: 'The record exists and is right', steps: [0],
    dos: [
      'They paid on the join page, so the record, token, leads base and welcome draft already exist. Send the welcome email.',
      'Timezone on the record is theirs. Provisioning writes Brisbane flat, and every offered meeting time comes from this field.',
      'Own key or managed plan decided. Managed Claude Key = Yes means no console step at all.',
    ],
  },
  {
    id: 'p2', phase: 'prep', label: 'Prep', title: 'Pre-session answers in', steps: [],
    dos: [
      'Which email address Wingguy works from (it decides the account on the approval screen).',
      'Any call recorder already in use, own machine, Windows or Mac.',
    ],
    watch: 'Mac: the installer script is unproven on a real Mac. Plan a slower beat 6 and expect to do it by hand.',
  },
  {
    id: '1', n: 1, phase: 'session', title: 'Remote access on', minutes: 3, client: 'runs one file, reads you a code', steps: [],
    say: "I'll drive your screen for about half an hour. You watch, and say yes to a couple of things.",
    dos: [
      'Send the Splashtop link in the Zoom chat. They run the file and read you the code.',
      'Install the unattended streamer so you can get in later without them.',
      "Ask them to confirm they're signed in to Claude, their email and LinkedIn in this browser.",
    ],
    check: 'You can move their mouse. This is the only technical thing they do all day.',
  },
  {
    id: '2', n: 2, phase: 'session', title: 'Wingguy into their Claude', minutes: 2, client: 'watches', steps: [1], link: 'connector',
    dos: [
      'In their Claude: Customize, then Connectors, then Add custom connector. Name it Wingguy, paste the connector link.',
      'New chat. Type: what can I do with Wingguy?',
    ],
    say: "That's Wingguy living inside your own Claude now. From here you just talk to it in any chat.",
    check: 'Wingguy introduces itself and lists what it can do.',
  },
  {
    id: '3', n: 3, phase: 'session', title: 'Calendar and mailbox, one click', minutes: 2, client: 'glances at the email address, says "that\'s the one"', steps: [2], link: 'unipile',
    dos: [
      'Mint the approval link here, paste it into their browser. The permission screen comes up.',
      "Before you click approve, ask them to read out the email address at the top. Wrong account? Redo it in a private window.",
      'Click approve. A Google or Microsoft password prompt is theirs to type, never yours.',
      'The record sets itself the moment they approve - account id, providers, all calendars read. Hit Re-check and watch the line below turn DONE.',
    ],
    check: 'The live check below shows DONE with provider=unipile. Nothing to type onto the row.',
  },
  {
    id: '4', n: 4, phase: 'session', title: 'Prove calendar and mail', minutes: 4, client: 'says "yes, that\'s my week"', steps: [3, 5],
    dos: [
      "In their chat type: what's on my calendar this week? They check it against reality, including something personal.",
      'Then: find a recent email from [someone they name], and: read me the whole thing.',
    ],
    say: "That's Wingguy reading your diary and your mail. Now you know what it can see.",
    check: "Don't move on until they've confirmed both. They're the only one who can.",
  },
  {
    id: '5', n: 5, phase: 'session', title: 'Their meeting link', minutes: 3, client: 'watches', steps: [4],
    dos: [
      'If they have a personal Zoom link, paste it into their settings page.',
      'If not, create one with them now and turn on the waiting room.',
    ],
    check: 'The link is on their record. Every invite Wingguy books carries it.',
  },
  {
    id: '6', n: 6, phase: 'session', title: 'Extension installed and proven', minutes: 8, client: 'watches, then reads the draft', steps: [9, 10], link: 'installer',
    dos: [
      'Open PowerShell on their machine (not as administrator). Paste the installer line. It reports the daily task, the login run and the version on disk.',
      'Chrome or Edge extensions page, Developer mode on, Load unpacked, pick C:\\Wingguy.',
      "Open the portal link once in this browser. That's how the extension knows who they are. Skip it and a good install looks broken.",
      "Open a LinkedIn profile of someone they'd genuinely reach out to. Type /wg. The panel appears and drafts.",
    ],
    say: "That's a starting point, not an oracle. Your edit is what teaches it.",
    check: 'The panel appears on a real profile, on their machine, and the version on the card matches what shipped.',
    watch: "Fiddliest beat in the journey - that's why you drive it. A draft only appears if their key is on the record or they're on the managed plan.",
  },
  {
    id: '7', n: 7, phase: 'session', title: 'Dress rehearsal', minutes: 8, client: 'watches', steps: [8],
    dos: [
      'In their chat: offer [a real lead] some times next week.',
      'Book a test meeting with you as the guest. The invite lands in your inbox with their join link on it.',
      'Cancel it together.',
    ],
    check: "The invite arrived with their link. They're now live in chat.",
  },
  {
    id: '8', n: 8, phase: 'session', title: 'Meeting recorder', minutes: 5, client: 'watches', steps: [7],
    say: 'Two moments sell this. "Draft the follow-up from the call I just had." And before the next one, "prep me for my meetings."',
    dos: [
      'Granola: needs their Business plan for the key. Create the key in their Granola settings, paste it on the record, Claude registers the webhook.',
      'Already on Fireflies? That lane is proven. Straight swap, secret on the record before they save their side.',
    ],
    watch: 'Calendar before recorder, always. Wingguy works out who a meeting was with from the calendar. This beat sits after 3 on purpose.',
  },
  {
    id: '9', n: 9, phase: 'session', title: 'Book the instructions call', minutes: 2, client: 'agrees a time', steps: [6],
    dos: [
      'Twenty minutes, a few days out. Together, not homework. They talk, Wingguy types.',
      'Mention Linked Helper comes last, on a rented computer you mind. Their side is topping up campaigns.',
    ],
    check: "It's in both diaries before you hang up.",
  },
];

const VERDICT = {
  done: { text: 'DONE', cls: 'bg-green-100 text-green-800' },
  owed: { text: 'OWED', cls: 'bg-amber-100 text-amber-800' },
  manual: { text: 'MANUAL', cls: 'bg-gray-100 text-gray-600' },
};

const EMPTY = { ticks: {}, done: {}, clockStart: null, unipile: null };

function storageKey(clientId) { return `concierge:${clientId}`; }
function loadState(clientId) {
  try { const s = localStorage.getItem(storageKey(clientId)); return s ? { ...EMPTY, ...JSON.parse(s) } : { ...EMPTY }; } catch (_) { return { ...EMPTY }; }
}
function saveState(clientId, state) {
  try { localStorage.setItem(storageKey(clientId), JSON.stringify(state)); } catch (_) { /* per-browser convenience only */ }
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function timeText(iso) {
  try { return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; }
}

// ---- pieces (module level, so a state change never remounts them) ----

function CopyLine({ k, label, value, hint, copied, onCopy, emptyText }) {
  return (
    <div className="flex flex-col gap-1">
      {(label || hint) && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-gray-700">{label}</span>
          {hint && <span className="text-[11px] text-gray-500">{hint}</span>}
        </div>
      )}
      <div className="flex gap-2 items-stretch">
        <div className={`flex-1 min-w-0 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-[12px] leading-relaxed break-all font-mono ${value ? 'text-gray-800' : 'text-gray-400 italic'}`}>
          {value || emptyText || 'not available - no portal token on the record'}
        </div>
        <button
          onClick={() => onCopy(k, value)}
          disabled={!value}
          className={`shrink-0 inline-flex items-center gap-1 px-3 rounded-md text-xs font-semibold border ${copied === k ? 'bg-green-600 text-white border-green-600' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'} disabled:bg-gray-200 disabled:text-gray-400 disabled:border-gray-200`}
        >
          {copied === k ? <><CheckIcon className="h-3.5 w-3.5" /> Copied</> : <><ClipboardDocumentIcon className="h-3.5 w-3.5" /> Copy</>}
        </button>
      </div>
    </div>
  );
}

function UnipileBlock({ k, setup, minted, minting, mintError, onMint, copied, onCopy }) {
  const connected = !!setup.unipileConnected;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700">Calendar and mail approval link</span>
        <span className="text-[11px] text-gray-500">beat 3</span>
      </div>
      {connected ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[13px] text-green-800">
          Connected - the record already has a Unipile account ({setup.calendarProvider || 'unipile'}). Nothing to mint.
        </div>
      ) : minted?.url ? (
        <CopyLine k={k} value={minted.url} hint={`minted ${timeText(minted.mintedAt)} - lasts a day`} copied={copied} onCopy={onCopy} />
      ) : (
        <div className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-500 italic">Not minted yet. Mint it when you reach beat 3.</div>
      )}
      {!connected && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onMint} disabled={minting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-purple-300 bg-white text-purple-700 hover:bg-purple-50 disabled:cursor-wait">
            <LinkIcon className="h-3.5 w-3.5" /> {minting ? 'Minting…' : minted?.url ? 'Mint a fresh link' : 'Mint the approval link'}
          </button>
          <span className="text-[11px] text-gray-500">Google or Microsoft, one approval covers both. The record sets itself when they approve.</span>
        </div>
      )}
      {mintError && <p className="text-xs text-red-600">{mintError}</p>}
    </div>
  );
}

function StepChips({ beat, stepByN }) {
  const found = beat.steps.map((n) => stepByN[n]).filter(Boolean);
  if (!found.length) return null;
  return (
    <div className="flex flex-col gap-1 mt-1">
      {found.map((s) => {
        const v = VERDICT[s.verdict] || VERDICT.manual;
        return (
          <div key={s.n} className="flex gap-2 items-start text-[12px]">
            <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${v.cls}`}>{v.text}</span>
            <span className="text-gray-500 shrink-0">{s.n} {s.name}</span>
            <span className="text-gray-600 break-words min-w-0">{s.evidence}</span>
          </div>
        );
      })}
    </div>
  );
}

function SessionClock({ start, onToggle }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!start) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [start]);
  const elapsed = start ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
  const over = elapsed > BUDGET_MIN * 60;
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-2.5 shadow-sm">
      <div>
        <div className={`text-2xl font-semibold font-mono tabular-nums ${over ? 'text-amber-700' : 'text-gray-900'}`}>{pad(Math.floor(elapsed / 60))}:{pad(elapsed % 60)}</div>
        <div className="text-[11px] text-gray-500">of a {BUDGET_MIN} minute budget</div>
      </div>
      <button onClick={onToggle} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800">
        {start ? <><StopIcon className="h-3.5 w-3.5" /> Stop</> : <><PlayIcon className="h-3.5 w-3.5" /> Start session</>}
      </button>
    </div>
  );
}

function Beat({ beat, clientId, firstName, ticks, done, onTick, onToggleDone, stepByN, links, copied, onCopy, unipile }) {
  const prep = beat.phase === 'prep';
  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 flex gap-4 ${done ? 'opacity-60' : ''}`}>
      <div className={`shrink-0 w-11 h-11 rounded-lg grid place-items-center font-semibold ${done ? 'bg-green-600 text-white' : prep ? 'bg-gray-100 text-gray-600 text-sm' : 'bg-blue-50 text-blue-700 text-xl'}`}>
        {prep ? beat.label : beat.n}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-[17px] font-semibold text-gray-900 ${done ? 'line-through decoration-gray-400' : ''}`}>{beat.title}</h3>
          {beat.minutes && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold">{beat.minutes} min</span>}
          {beat.client && <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold">{firstName}: {beat.client}</span>}
        </div>
        {beat.say && <p className="border-l-2 border-blue-500 pl-3 text-[13.5px] text-gray-700 italic"><span className="not-italic font-semibold text-gray-900">Say: </span>{beat.say}</p>}
        <ul className="flex flex-col gap-1.5">
          {beat.dos.map((d, i) => {
            const id = `${beat.id}:${i}`;
            const dom = `tick-${clientId}-${beat.id}-${i}`;
            return (
              <li key={id} className="flex gap-2.5 items-start text-[13.5px] text-gray-800">
                <input type="checkbox" id={dom} checked={!!ticks[id]} onChange={(e) => onTick(beat, id, e.target.checked)} className="mt-1 h-4 w-4 accent-blue-600 shrink-0" />
                <label htmlFor={dom} className="cursor-pointer">{d}</label>
              </li>
            );
          })}
        </ul>
        {beat.link === 'connector' && <CopyLine k="connector-inline" label="Connector link" value={links.connectorUrl} copied={copied} onCopy={onCopy} />}
        {beat.link === 'unipile' && <UnipileBlock k="unipile-inline" {...unipile} copied={copied} onCopy={onCopy} />}
        {beat.link === 'installer' && (
          <div className="flex flex-col gap-2">
            <CopyLine k="installer-inline" label="Installer line - paste into PowerShell" value={links.installerWindows} copied={copied} onCopy={onCopy} />
            <CopyLine k="portal-inline" label="Portal link - open once in their browser" value={links.portalUrl} copied={copied} onCopy={onCopy} />
          </div>
        )}
        {beat.check && <p className="rounded-md bg-green-50 text-green-800 px-3 py-1.5 text-[13px]"><span className="font-semibold">Worked when: </span>{beat.check}</p>}
        {beat.watch && <p className="rounded-md bg-amber-50 text-amber-800 px-3 py-1.5 text-[13px]"><span className="font-semibold">Watch: </span>{beat.watch}</p>}
        <StepChips beat={beat} stepByN={stepByN} />
        <div className="flex justify-end">
          <button onClick={() => onToggleDone(beat)} className={`px-3 py-1 rounded-md text-xs font-semibold border ${done ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
            {done ? 'Done' : 'Mark done'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- the page ----

export default function ConciergeSheet() {
  const params = useParams();
  const router = useRouter();
  const clientId = Array.isArray(params.clientId) ? params.clientId[0] : params.clientId;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [state, setState] = useState({ ...EMPTY });
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState(null);

  // Per-client working state, this browser only. `hydrated` gates the save so the first render's
  // empty defaults never overwrite what was stored.
  useEffect(() => {
    if (!clientId) return;
    setHydrated(false);
    setState(loadState(clientId));
    setHydrated(true);
  }, [clientId]);
  useEffect(() => {
    if (hydrated && clientId) saveState(clientId, state);
  }, [hydrated, clientId, state]);

  const load = useCallback(async (quiet = false) => {
    if (!clientId) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const data = await getClientBoardDetail(clientId);
      setDetail(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // The live checks are the only thing on this page that changes underneath you (the record
  // sets itself when the client approves the calendar link). Re-probe when the tab comes back.
  useEffect(() => {
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const onCopy = (key, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };

  const onMint = async () => {
    setMinting(true);
    setMintError(null);
    try {
      const r = await mintUnipileLink(clientId);
      setState((s) => ({ ...s, unipile: { url: r.url, expiresAt: r.expiresAt, mintedAt: new Date().toISOString() } }));
    } catch (e) {
      setMintError(e.response?.data?.error || e.message);
    } finally {
      setMinting(false);
    }
  };

  const onTick = (beat, id, checked) => setState((s) => {
    const ticks = { ...s.ticks, [id]: checked };
    const done = { ...s.done };
    const all = beat.dos.every((_, i) => ticks[`${beat.id}:${i}`]);
    if (all) done[beat.id] = true;
    if (!checked) done[beat.id] = false;
    return { ...s, ticks, done };
  });
  const onToggleDone = (beat) => setState((s) => {
    const next = !s.done[beat.id];
    const ticks = { ...s.ticks };
    if (next) beat.dos.forEach((_, i) => { ticks[`${beat.id}:${i}`] = true; });
    return { ...s, done: { ...s.done, [beat.id]: next }, ticks };
  });
  const toggleClock = () => setState((s) => ({ ...s, clockStart: s.clockStart ? null : Date.now() }));
  const resetSheet = () => {
    if (!window.confirm('Clear the ticks, the clock and the minted link for this client?')) return;
    setState({ ...EMPTY });
  };

  const links = detail?.links || {};
  const setup = detail?.setup || {};
  const steps = detail?.preflight?.steps || [];
  const stepByN = Object.fromEntries(steps.map((s) => [s.n, s]));
  const clientName = detail?.clientName || clientId;
  const firstName = (clientName || '').split(' ')[0] || 'the client';
  const sessionBeats = BEATS.filter((b) => b.phase === 'session');
  const doneCount = sessionBeats.filter((b) => state.done[b.id]).length;
  const unipile = { setup, minted: state.unipile, minting, mintError, onMint };

  const beatProps = (b) => ({
    beat: b, clientId, firstName, ticks: state.ticks, done: !!state.done[b.id],
    onTick, onToggleDone, stepByN, links, copied, onCopy, unipile,
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="flex flex-col gap-1">
          <button onClick={() => router.push(buildAuthUrl('/coached-clients'))} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 w-fit">
            <ArrowLeftIcon className="h-4 w-4" /> My Clients
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Concierge run sheet</p>
          <h1 className="text-2xl font-semibold text-gray-900">{clientName}</h1>
          <p className="text-sm text-gray-600 max-w-2xl">One remote sitting, you driving. {firstName} is there for the first five minutes and the last five. Every line below is minted from the record - nothing to look up.</p>
        </div>
        <SessionClock start={state.clockStart} onToggle={toggleClock} />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
        <aside className="lg:sticky lg:top-4 bg-white border border-gray-200 rounded-lg p-4 shadow-sm flex flex-col gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">Everything you paste</h2>
            <p className="text-xs text-gray-500 mt-0.5">Minted from {firstName}&rsquo;s record. Copy from here or from the beat.</p>
          </div>
          {loading && !detail ? (
            <p className="text-sm text-gray-500 flex items-center gap-2"><ArrowPathIcon className="h-4 w-4 animate-spin" /> Reading the record and probing the live checks…</p>
          ) : (
            <>
              <CopyLine k="connector" label="Wingguy connector link" value={links.connectorUrl} hint="beat 2" copied={copied} onCopy={onCopy} />
              <UnipileBlock k="unipile" {...unipile} copied={copied} onCopy={onCopy} />
              <CopyLine k="installer" label="Extension installer line" value={links.installerWindows} hint="beat 6, PowerShell" copied={copied} onCopy={onCopy} />
              <CopyLine k="portal" label="Portal link, with their token" value={links.portalUrl} hint="beat 6" copied={copied} onCopy={onCopy} />
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] text-gray-700 border-t border-gray-100 pt-3">
                <div><p className="text-gray-500">Timezone</p><p className={setup.timezone ? '' : 'text-amber-700 font-semibold'}>{setup.timezone || 'BLANK - fix first'}</p></div>
                <div><p className="text-gray-500">Drafting key</p><p>{setup.managedClaudeKey ? 'Managed plan' : setup.hasAnthropicKey ? 'Own key on record' : 'Own key - not yet on record'}</p></div>
                <div><p className="text-gray-500">Login email</p><p className="break-all">{setup.loginEmail || '-'}</p></div>
                <div><p className="text-gray-500">Calendar and mail</p><p>{setup.unipileConnected ? `connected (${setup.calendarProvider})` : 'not connected'}</p></div>
              </div>
            </>
          )}
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-xs text-gray-500 tabular-nums">{doneCount} of {sessionBeats.length} beats done</span>
            <div className="flex gap-2">
              <button onClick={() => load(true)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50" title="Re-run the live checks">
                <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Re-check
              </button>
              <button onClick={resetSheet} className="px-2.5 py-1 rounded-md text-xs font-semibold text-gray-500 hover:text-gray-800">Reset</button>
            </div>
          </div>
        </aside>

        <main className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold text-gray-900">Before the call</h2>
              <span className="text-[13px] text-gray-500">You alone, about 15 minutes. Nothing for {firstName}.</span>
            </div>
            {BEATS.filter((b) => b.phase === 'prep').map((b) => <Beat key={b.id} {...beatProps(b)} />)}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold text-gray-900">The session</h2>
              <span className="text-[13px] text-gray-500">About {BUDGET_MIN} minutes. You drive throughout.</span>
            </div>
            {sessionBeats.map((b) => <Beat key={b.id} {...beatProps(b)} />)}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold text-gray-900">After the call</h2>
              <span className="text-[13px] text-gray-500">Two more beats, weeks apart.</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="text-[15px] font-semibold text-gray-900 mb-1">Instructions call</h3>
                <p className="text-[13.5px] text-gray-700">They open a chat and type &ldquo;let&rsquo;s set up my rules&rdquo;. You sit with them through the interview. From here everything Wingguy writes sounds like them.</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="text-[15px] font-semibold text-gray-900 mb-1">Linked Helper, last, on a VPS</h3>
                <p className="text-[13.5px] text-gray-700">Once the rest is proven and their targeting has settled. Binary Lane, about $20 a month, their own card. You build and mind it. Their side: top up campaigns and look at how they&rsquo;re going.</p>
              </div>
            </div>
            <p className="text-[13.5px] text-gray-600 border-t border-gray-200 pt-4 max-w-3xl">
              <span className="font-semibold text-gray-800">What {firstName} never has to do:</span> create an Anthropic key alone, connect a cloud folder, download or unzip anything, remember a setting, or come back to a page. What they do: run one Splashtop file, confirm an email address, say &ldquo;that&rsquo;s my week&rdquo;, and talk.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
