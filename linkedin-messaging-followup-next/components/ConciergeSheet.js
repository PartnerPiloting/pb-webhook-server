"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getClientBoardDetail, mintUnipileLink } from '../services/clientBoardApi';
import { buildAuthUrl } from '../utils/clientUtils';
import {
  ArrowLeftIcon, ArrowRightIcon, ArrowPathIcon, CheckIcon, ClipboardDocumentIcon, LinkIcon, PlayIcon, StopIcon,
} from '@heroicons/react/24/outline';

/**
 * Concierge run sheet - one client, one remote sitting, the coach driving, ONE STEP AT A TIME.
 *
 * Born 2026-09-16 for the Alex-type client (not technical, easily distracted): instead of
 * week-after-week sessions where the client does their own clicking, the coach logs into their
 * machine over Splashtop and does all of it in ~40 minutes. The client is there for the first
 * five minutes and the last five.
 *
 * The page shows one step, with only what that step needs: what to say, what to do (ticks),
 * the ONE link to paste (minted from the record, Copy button), how you know it worked, and the
 * live DONE/OWED verdict for that step. Back / Next move through it. Guy asked for exactly this
 * after the first version put everything on one busy screen (2026-09-16).
 *
 * Only clients with "Concierge Onboarding" ticked on the master record get the button on My
 * Clients. The page itself works for any client the coach owns (the URL is not a secret - the
 * portal token in the headers is the auth).
 *
 * Ticks, the current step and the clock live in this browser only (localStorage) - the coach's
 * working notes for one sitting, not a record of anything.
 */

const BUDGET_MIN = 40;

// Which preflight steps (docs/wingguy-onboarding-checklist.md numbering) prove each step.
const STEPS = [
  {
    id: 'p1', phase: 'Before the call', title: 'Check the record', who: 'You alone', steps: [0], facts: true,
    dos: [
      'They paid on the join page, so the record, token, leads base and welcome draft exist. Send the welcome email.',
      'Timezone on the record is theirs. Provisioning writes Brisbane flat, and every offered meeting time comes from this field.',
      'Own key or managed plan decided. Managed Claude Key = Yes means no console step at all.',
    ],
  },
  {
    id: 'p2', phase: 'Before the call', title: 'Pre-session answers in', who: 'You alone', steps: [],
    dos: [
      'Which email address Wingguy works from. It decides the account on the approval screen.',
      'Any call recorder already in use. Own machine. Windows or Mac.',
    ],
    watch: 'Mac: the installer script is unproven on a real Mac. Plan a slower extension step and expect to do it by hand.',
  },
  {
    id: '1', phase: 'The session', title: 'Remote access on', minutes: 3, who: 'runs one file, reads you a code', steps: [],
    say: "I'll drive your screen for about half an hour. You watch, and say yes to a couple of things.",
    dos: [
      'Send the Splashtop link in the Zoom chat. They run the file and read you the code.',
      'Install the unattended streamer so you can get in later without them.',
      "Ask them to confirm they're signed in to Claude, their email and LinkedIn in this browser.",
    ],
    check: 'You can move their mouse. This is the only technical thing they do all day.',
  },
  {
    id: '2', phase: 'The session', title: 'Wingguy into their Claude', minutes: 2, who: 'watches', steps: [1], link: 'connector',
    dos: [
      'In their Claude: Customize, then Connectors, then Add custom connector. Name it Wingguy, paste the connector link.',
      'New chat. Type: what can I do with Wingguy?',
    ],
    say: "That's Wingguy living inside your own Claude now. From here you just talk to it in any chat.",
    check: 'Wingguy introduces itself and lists what it can do.',
  },
  {
    id: '3', phase: 'The session', title: 'Calendar and mailbox, one click', minutes: 2, who: 'glances at the email address, says "that\'s the one"', steps: [2], link: 'unipile',
    dos: [
      'Mint the approval link below and paste it into their browser. The permission screen comes up.',
      'Before you click approve, ask them to read out the email address at the top. Wrong account? Redo it in a private window.',
      'Click approve. A Google or Microsoft password prompt is theirs to type, never yours.',
    ],
    check: 'The record sets itself when they approve. Press Re-check and the line below turns DONE. Nothing to type onto the row.',
  },
  {
    id: '4', phase: 'The session', title: 'Prove calendar and mail', minutes: 4, who: 'says "yes, that\'s my week"', steps: [3, 5],
    dos: [
      "In their chat type: what's on my calendar this week? They check it against reality, including something personal.",
      'Then: find a recent email from [someone they name]. Then: read me the whole thing.',
    ],
    say: "That's Wingguy reading your diary and your mail. Now you know what it can see.",
    check: "Don't move on until they've confirmed both. They're the only one who can.",
  },
  {
    id: '5', phase: 'The session', title: 'Their meeting link', minutes: 3, who: 'watches', steps: [4],
    dos: [
      'If they have a personal Zoom link, paste it into their settings page.',
      'If not, create one with them now and turn on the waiting room.',
    ],
    check: 'The link is on their record. Every invite Wingguy books carries it.',
  },
  {
    id: '6', phase: 'The session', title: 'Extension installed and proven', minutes: 8, who: 'watches, then reads the draft', steps: [9, 10], link: 'installer',
    dos: [
      'Open PowerShell on their machine, not as administrator. Paste the installer line. It reports the daily task, the login run and the version on disk.',
      'Chrome or Edge extensions page. Developer mode on. Load unpacked. Pick C:\\Wingguy.',
      "Open the portal link once in this browser. That's how the extension knows who they are.",
      "Open a LinkedIn profile of someone they'd genuinely reach out to. Type /wg. The panel appears and drafts.",
    ],
    say: "That's a starting point, not an oracle. Your edit is what teaches it.",
    check: 'The panel appears on a real profile, on their machine, and the version on the card matches what shipped.',
    watch: "Fiddliest step in the journey - that's why you drive it. A draft only appears if their key is on the record or they're on the managed plan.",
  },
  {
    id: '7', phase: 'The session', title: 'Dress rehearsal', minutes: 8, who: 'watches', steps: [8],
    dos: [
      'In their chat: offer [a real lead] some times next week.',
      'Book a test meeting with you as the guest. The invite lands in your inbox with their join link on it.',
      'Cancel it together.',
    ],
    check: "The invite arrived with their link. They're now live in chat.",
  },
  {
    id: '8', phase: 'The session', title: 'Meeting recorder', minutes: 5, who: 'watches', steps: [7],
    say: 'Two moments sell this. "Draft the follow-up from the call I just had." And before the next one, "prep me for my meetings."',
    dos: [
      'Granola: needs their Business plan for the key. Create the key in their Granola settings, paste it on the record, Claude registers the webhook.',
      'Already on Fireflies? That lane is proven. Straight swap, secret on the record before they save their side.',
    ],
    watch: 'Calendar before recorder, always. Wingguy works out who a meeting was with from the calendar.',
  },
  {
    id: '9', phase: 'The session', title: 'Book the instructions call', minutes: 2, who: 'agrees a time', steps: [6],
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

const EMPTY = { at: 0, ticks: {}, clockStart: null, unipile: null };

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

// ---- pieces ----

function CopyLine({ k, label, value, copied, onCopy, emptyText }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-sm font-semibold text-gray-800">{label}</span>}
      <div className="flex gap-2 items-stretch">
        <div className={`flex-1 min-w-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed break-all font-mono ${value ? 'text-gray-800' : 'text-gray-400 italic'}`}>
          {value || emptyText || 'not available - no portal token on the record'}
        </div>
        <button
          onClick={() => onCopy(k, value)}
          disabled={!value}
          className={`shrink-0 inline-flex items-center gap-1.5 px-4 rounded-md text-sm font-semibold border ${copied === k ? 'bg-green-600 text-white border-green-600' : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'} disabled:bg-gray-200 disabled:text-gray-400 disabled:border-gray-200`}
        >
          {copied === k ? <><CheckIcon className="h-4 w-4" /> Copied</> : <><ClipboardDocumentIcon className="h-4 w-4" /> Copy</>}
        </button>
      </div>
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
    <div className="flex items-center gap-3">
      <span className={`text-xl font-semibold font-mono tabular-nums ${over ? 'text-amber-700' : 'text-gray-900'}`}>{pad(Math.floor(elapsed / 60))}:{pad(elapsed % 60)}</span>
      <button onClick={onToggle} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 text-gray-800">
        {start ? <><StopIcon className="h-3.5 w-3.5" /> Stop</> : <><PlayIcon className="h-3.5 w-3.5" /> Start the clock</>}
      </button>
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
      setDetail(await getClientBoardDetail(clientId));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);
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

  const total = STEPS.length;
  const at = Math.min(Math.max(state.at || 0, 0), total); // `total` = the finished screen
  const step = STEPS[at];
  const go = (n) => setState((s) => ({ ...s, at: Math.min(Math.max(n, 0), total) }));
  const tick = (id, checked) => setState((s) => ({ ...s, ticks: { ...s.ticks, [id]: checked } }));
  const tickAllAndNext = () => setState((s) => {
    const ticks = { ...s.ticks };
    if (step) step.dos.forEach((_, i) => { ticks[`${step.id}:${i}`] = true; });
    return { ...s, ticks, at: Math.min(at + 1, total) };
  });
  const toggleClock = () => setState((s) => ({ ...s, clockStart: s.clockStart ? null : Date.now() }));
  const resetSheet = () => {
    if (!window.confirm('Start this client\'s sheet again from step 1? Ticks, the clock and the minted link are cleared.')) return;
    setState({ ...EMPTY });
  };

  const links = detail?.links || {};
  const setup = detail?.setup || {};
  const stepByN = Object.fromEntries((detail?.preflight?.steps || []).map((s) => [s.n, s]));
  const clientName = detail?.clientName || clientId;
  const firstName = (clientName || '').split(' ')[0] || 'the client';
  const stepDone = (s) => s.dos.every((_, i) => state.ticks[`${s.id}:${i}`]);
  const verdicts = step ? step.steps.map((n) => stepByN[n]).filter(Boolean) : [];
  const unipileConnected = !!setup.unipileConnected;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <button onClick={() => router.push(buildAuthUrl('/coached-clients'))} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 w-fit">
            <ArrowLeftIcon className="h-4 w-4" /> My Clients
          </button>
          <h1 className="text-xl font-semibold text-gray-900 mt-1">{clientName} <span className="font-normal text-gray-500">- concierge run sheet</span></h1>
        </div>
        <SessionClock start={state.clockStart} onToggle={toggleClock} />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round((at / total) * 100)}%` }} />
        </div>
        <span className="text-xs text-gray-500 tabular-nums shrink-0">{at < total ? `Step ${at + 1} of ${total}` : 'Finished'}</span>
      </div>

      {step ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{step.phase}{step.minutes ? ` · about ${step.minutes} min` : ''}</p>
            <h2 className="text-2xl font-semibold text-gray-900">{step.title}</h2>
            <p className="text-sm text-gray-600">{step.who === 'You alone' ? 'You alone. Nothing for ' + firstName + '.' : `${firstName}: ${step.who}`}</p>
          </div>

          {step.facts && !loading && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border border-gray-100 rounded-lg p-3 bg-gray-50">
              <div><p className="text-xs text-gray-500">Timezone</p><p className={setup.timezone ? 'text-gray-800' : 'text-amber-700 font-semibold'}>{setup.timezone || 'BLANK - fix first'}</p></div>
              <div><p className="text-xs text-gray-500">Drafting key</p><p className="text-gray-800">{setup.managedClaudeKey ? 'Managed plan' : setup.hasAnthropicKey ? 'Own key on record' : 'Own key, not yet on record'}</p></div>
              <div><p className="text-xs text-gray-500">Login email</p><p className="text-gray-800 break-all">{setup.loginEmail || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Calendar and mail</p><p className="text-gray-800">{unipileConnected ? `connected (${setup.calendarProvider})` : 'not connected yet'}</p></div>
            </div>
          )}

          {step.say && (
            <p className="border-l-4 border-blue-500 pl-4 py-1 text-[15px] text-gray-800 italic">
              <span className="not-italic font-semibold">Say: </span>{step.say}
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {step.dos.map((d, i) => {
              const id = `${step.id}:${i}`;
              const dom = `tick-${clientId}-${step.id}-${i}`;
              return (
                <li key={id} className="flex gap-3 items-start text-[15px] text-gray-900">
                  <input type="checkbox" id={dom} checked={!!state.ticks[id]} onChange={(e) => tick(id, e.target.checked)} className="mt-1 h-5 w-5 accent-blue-600 shrink-0" />
                  <label htmlFor={dom} className="cursor-pointer leading-snug">{d}</label>
                </li>
              );
            })}
          </ul>

          {step.link === 'connector' && (
            <CopyLine k="connector" label="Paste this into their Claude" value={links.connectorUrl} copied={copied} onCopy={onCopy} />
          )}

          {step.link === 'unipile' && (
            <div className="flex flex-col gap-2">
              {unipileConnected ? (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
                  Connected already - the record has a Unipile account ({setup.calendarProvider || 'unipile'}). Nothing to mint, move on.
                </div>
              ) : (
                <>
                  {state.unipile?.url
                    ? <CopyLine k="unipile" label={`Paste this into their browser (minted ${timeText(state.unipile.mintedAt)}, lasts a day)`} value={state.unipile.url} copied={copied} onCopy={onCopy} />
                    : <span className="text-sm font-semibold text-gray-800">The approval link</span>}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={onMint} disabled={minting} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold border border-purple-300 bg-white text-purple-700 hover:bg-purple-50 disabled:cursor-wait">
                      <LinkIcon className="h-4 w-4" /> {minting ? 'Minting…' : state.unipile?.url ? 'Mint a fresh link' : 'Mint the approval link'}
                    </button>
                    <span className="text-xs text-gray-500">Google or Microsoft. One approval covers calendar and mail.</span>
                  </div>
                  {mintError && <p className="text-sm text-red-600">{mintError}</p>}
                </>
              )}
            </div>
          )}

          {step.link === 'installer' && (
            <div className="flex flex-col gap-4">
              <CopyLine k="installer" label="Paste this into PowerShell on their machine" value={links.installerWindows} copied={copied} onCopy={onCopy} />
              <CopyLine k="portal" label="Then open this once in their browser" value={links.portalUrl} copied={copied} onCopy={onCopy} />
            </div>
          )}

          {step.check && (
            <p className="rounded-md bg-green-50 text-green-800 px-4 py-2.5 text-sm"><span className="font-semibold">You'll know it worked when: </span>{step.check}</p>
          )}
          {step.watch && (
            <p className="rounded-md bg-amber-50 text-amber-800 px-4 py-2.5 text-sm"><span className="font-semibold">Watch: </span>{step.watch}</p>
          )}

          {(verdicts.length > 0 || loading) && (
            <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">What the record says right now</span>
                <button onClick={() => load(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900" title="Re-run the live checks">
                  <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Re-check
                </button>
              </div>
              {loading && !detail && <p className="text-xs text-gray-500">Probing the record…</p>}
              {verdicts.map((s) => {
                const v = VERDICT[s.verdict] || VERDICT.manual;
                return (
                  <div key={s.n} className="flex gap-2 items-start text-xs">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${v.cls}`}>{v.text}</span>
                    <span className="text-gray-600 break-words min-w-0">{s.evidence}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <button onClick={() => go(at - 1)} disabled={at === 0} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </button>
            <button onClick={tickAllAndNext} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
              {stepDone(step) ? 'Next' : 'Done, next'} <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col gap-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">After the call</p>
            <h2 className="text-2xl font-semibold text-gray-900">That's the sitting done</h2>
          </div>
          <div className="flex flex-col gap-3 text-[15px] text-gray-800">
            <p><span className="font-semibold">Instructions call, a few days out.</span> {firstName} opens a chat and types &ldquo;let&rsquo;s set up my rules&rdquo;. You sit with them through the interview. From then on everything Wingguy writes sounds like them.</p>
            <p><span className="font-semibold">Linked Helper, last, on a rented computer.</span> Once the rest is proven and their targeting has settled. Binary Lane, about $20 a month, their own card. You build and mind it. Their side is topping up campaigns and looking at how they&rsquo;re going.</p>
          </div>
          <p className="text-sm text-gray-600 border-t border-gray-100 pt-4">
            What {firstName} never had to do: create an Anthropic key alone, connect a cloud folder, download or unzip anything, remember a setting, or come back to a page.
          </p>
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <button onClick={() => go(at - 1)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
              <ArrowLeftIcon className="h-4 w-4" /> Back
            </button>
            <button onClick={() => router.push(buildAuthUrl('/coached-clients'))} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-md text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
              Back to My Clients
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => go(i)}
              title={s.title}
              className={`h-7 min-w-7 px-2 rounded-md text-xs font-semibold border ${i === at ? 'bg-blue-600 text-white border-blue-600' : stepDone(s) ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <button onClick={resetSheet} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Start again</button>
      </div>
    </div>
  );
}
