"use client";
// The Reconnect section of the Follow-Ups screen (docs/RECONNECT-BUILD-PLAN.md, brick 4).
//
// A day's portion of people whose old LinkedIn conversation is worth picking up again. The list
// arrives on the same /api/followups/queue payload as the live queue (services/reconnectQueue.js
// decides who is on it) - this file renders and sends clicks, it never decides.
//
// No message is pre-written for LinkedIn people (Guy, 1 Aug 2026): the row gives the reason and
// the thing to pick up on; the name opens their profile, and /wg in the thread does the writing.
//
// Two ways in (28 Nov 2026, docs/CONNECTIONS-SEARCH-BUILD-PLAN.md step 3): old conversations, and a
// SEARCH of the client's own connections (rows with kind 'search', the client's reason as the why).
// The section explains both, right where they are used, with the box for pasting a search and a link
// to the full Wingguy Learning topic (Guy: explain it on the screen, link to the detail).

import React, { useEffect, useState } from 'react';

const CHIP_CLS = {
  open_question_or_offer: 'bg-emerald-100 text-emerald-800',
  not_now: 'bg-sky-100 text-sky-800',
  stalled_after_interest: 'bg-amber-100 text-amber-800',
  answered_then_dropped: 'bg-teal-100 text-teal-800',
  moved_to_call_or_email: 'bg-indigo-100 text-indigo-800',
};

const BTN = 'px-3 py-1.5 rounded text-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50';
const INPUT = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm';

// The box for a search of your own connections. Posts to /connection-search (same door as the chat
// tool, services/connectionSearches.js), which checks the link and says what is wrong in words.
function SearchBox({ post, startOpen }) {
  const [open, setOpen] = useState(!!startOpen);
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState(null);   // { ok, text }

  const send = async () => {
    setSending(true);
    setAnswer(null);
    try {
      const r = await post('/connection-search', { url, reason, shareLink });
      setAnswer({ ok: true, text: (r && r.text) || 'Saved.' });
      setUrl(''); setReason(''); setShareLink('');
    } catch (e) {
      let text = 'Could not save that search. Nothing was changed.';
      try { const j = JSON.parse(e.message); text = j.text || j.details || text; } catch (_) { /* keep the plain words */ }
      setAnswer({ ok: false, text });
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return <button className={BTN} onClick={() => setOpen(true)}>Bring in connections from a search</button>;
  }
  return (
    <div className="border rounded p-3 bg-gray-50 space-y-2">
      <div className="text-sm text-gray-700">
        On LinkedIn, search for the people you want, click <span className="font-medium">People</span>, set
        <span className="font-medium"> Connections</span> to <span className="font-medium">1st</span> only and add one more filter
        (a job title, a city). Copy the address from the top of the browser and paste it here.
      </div>
      <label className="block text-xs text-gray-600">Your search link
        <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/search/results/people/?..." />
      </label>
      <label className="block text-xs text-gray-600">Why are you reaching out to these people? One sentence.
        <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Accountants I'd like to swap referrals with" />
      </label>
      <label className="block text-xs text-gray-600">A link to share with the ones who say yes (optional - it never goes in a first message)
        <input className={INPUT} value={shareLink} onChange={(e) => setShareLink(e.target.value)} placeholder="https://..." />
      </label>
      <div className="flex items-center gap-2">
        <button className={BTN} disabled={sending || !url.trim()} onClick={send}>{sending ? 'Saving…' : 'Bring them in'}</button>
        <button className={BTN} disabled={sending} onClick={() => setOpen(false)}>Close</button>
      </div>
      {answer && <div className={`text-sm whitespace-pre-line ${answer.ok ? 'text-emerald-700' : 'text-red-600'}`}>{answer.text}</div>}
    </div>
  );
}

// The two ways the list fills, in the words Guy agreed (28 Nov 2026). Shown in full while the list
// is empty; once it has people, only the search box stays, folded.
function TwoWays({ data, post }) {
  return (
    <div className="space-y-3 text-sm text-gray-700">
      <div className="font-medium text-gray-900">Your Reconnect list - people you're already connected with. Two ways to fill it - use either, or both.</div>
      <div>
        <div className="font-medium">From your old conversations</div>
        <div>Wingguy reads your past LinkedIn chats and brings back the ones worth picking up.
          {data.conversations ? (data.unread ? ' Yours have not been read yet - once your description is saved and the read has run, people appear here.' : ' This is on for you.') : ' Ask Guy to set this up.'}</div>
      </div>
      {data.searches && (
        <div>
          <div className="font-medium">From a search</div>
          <div className="mb-2">Search your connections on LinkedIn - for example, accountants in Brisbane - and paste the link here. Your Linked Helper machine visits them a few each morning (it never messages anyone), and they appear here with your reason.</div>
          <SearchBox post={post} startOpen />
        </div>
      )}
    </div>
  );
}


const DONE_NOTE = {
  done: 'done',
  skip: 'skipped for 90 days',
  never: 'dropped - no timer will chase them again',
  disconnect: 'will be disconnected tonight - Undo is in the list below until then',
  weekly: 'added to your weekly email (Network building, rethought)',
};

export default function ReconnectSection({ data, post, onReplace, onFlagged, onRemaining, weekly = false }) {
  const [gone, setGone] = useState(() => new Set());   // keys actioned this session
  const [busy, setBusy] = useState(() => new Set());
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const items = (data?.items || []).filter((it) => !gone.has(it.key));

  // How many are still on the list, so Today's folded Reconnect box counts down as rows are actioned.
  useEffect(() => { if (onRemaining) onRemaining(items.length); }, [onRemaining, items.length]);

  if (!data) return null;

  const act = async (it, action) => {
    setError(null);
    setBusy((prev) => new Set(prev).add(it.key));
    try {
      const r = await post('/reconnect-action', { key: it.key, action });
      setGone((prev) => new Set(prev).add(it.key));
      setNotice(action === 'weekly' && r && r.detail ? r.detail : `${it.name}: ${DONE_NOTE[action]}.`);
      if (action === 'disconnect' && onFlagged) onFlagged();
    } catch (e) {
      let why = '';
      try { const j = JSON.parse(e.message); why = j.details || j.text || ''; } catch (_) { why = ''; }
      setError(`Could not save that for ${it.name}. Nothing was changed.${why ? ` ${why}` : ''}`);
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(it.key); return n; });
    }
  };

  const more = async () => {
    setError(null);
    setLoadingMore(true);
    try {
      const r = await post('/reconnect-more', {});
      if (r && r.reconnect) onReplace(r.reconnect);
    } catch (e) {
      setError('Could not load more people.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="bg-white border rounded p-4">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h2 className="font-semibold text-lg">Reconnect</h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-300">
          {items.length} today
        </span>
        {data.waiting > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-300">
            {data.waiting} more waiting
          </span>
        )}
      </div>
      {items.length > 0 && <p className="text-sm text-gray-600 mb-3">
        People you already know{data.searches ? ' - from old conversations worth picking up, and from searches of your connections' : ' whose old conversation is worth picking up'}. Click a name to open their profile,
        open the message thread and type <span className="font-medium">/wg</span>. Then <span className="font-medium">Done</span>,
        <span className="font-medium"> Skip 90 days</span> or <span className="font-medium">Never</span>
        {data.disconnects ? <>, or <span className="font-medium">Disconnect</span> to remove them from your connections tonight</> : null}.
        Anyone you do not get to stays at the top tomorrow.
      </p>}
      {notice && <div className="text-sm text-emerald-700 mb-2">{notice}</div>}
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      {items.length === 0 ? (
        // Searches not switched on for this client: the list reads exactly as it always has.
        ((data.items || []).length > 0 || !data.searches)
          ? <div className="text-sm text-gray-500">{(data.items || []).length === 0 && data.unread ? 'Your old conversations have not been read yet - once your description is saved and the read has run, people appear here.' : "Nobody left on today's list."}</div>
          : <TwoWays data={data} post={post} />
      ) : (
        <ul className="divide-y">
          {items.map((it) => {
            const isBusy = busy.has(it.key);
            return (
              <li key={it.key} className="py-3">
                <div className="flex items-start gap-3 flex-wrap lg:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${CHIP_CLS[it.ending] || 'bg-gray-100 text-gray-600'}`}>
                        {it.chip}
                      </span>
                      {it.linkedin ? (
                        <a href={it.linkedin} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 hover:underline">{it.name}</a>
                      ) : (
                        <span className="font-semibold">{it.name}</span>
                      )}
                      {it.kind !== 'search' && <span className="text-xs text-gray-500">conversation {it.warmth}/5</span>}
                      {/* The profile score as a badge, not grey small print (Guy, 5 Oct 2026: he looked for it and did not see it). */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${it.profileScore == null ? 'bg-gray-50 text-gray-500 border-gray-200' : it.profileScore >= 70 ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-amber-50 text-amber-800 border-amber-300'}`}
                        title="Their LinkedIn profile score - separate from the conversation score"
                      >
                        {it.profileScore == null ? 'Profile: not scored' : `Profile score ${it.profileScore}`}
                      </span>
                      {it.kind !== 'search' && <span className="text-xs text-gray-500">quiet {it.quietDays} days</span>}
                      {it.carried && <span className="text-xs text-amber-700">carried over</span>}
                    </div>
                    {it.headline && <div className="text-xs text-gray-500 truncate">{it.headline}</div>}
                    <div className="text-sm text-gray-800 mt-1">{it.kind === 'search' ? <><span className="font-medium">Why you picked them:</span> {it.why}</> : it.why}</div>
                    {it.pickUpOn && <div className="text-sm text-gray-700"><span className="font-medium">Pick up on:</span> {it.pickUpOn}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <button className={BTN} disabled={isBusy} onClick={() => act(it, 'done')} title="You have written to them, or dealt with it">Done</button>
                    <button className={BTN} disabled={isBusy} onClick={() => act(it, 'skip')} title="Not now - back on the list in 90 days">Skip 90 days</button>
                    {weekly && <button className={`${BTN} text-sky-800 border-sky-200 hover:bg-sky-50`} disabled={isBusy} onClick={() => act(it, 'weekly')} title="Add them to Network building, rethought - your weekly email - instead of writing to them now">Weekly</button>}
                    <button className={BTN} disabled={isBusy} onClick={() => act(it, 'never')} title="Same as Drop: never chase them again. A new message from them still shows up.">Never</button>
                    {/* Only for a client with the disconnects extra switched on. One click, no confirm box:
                        nothing reaches Linked Helper until tonight, and Undo sits in the list below until then. */}
                    {data.disconnects && it.kind !== 'search' && (
                      <button className={`${BTN} text-red-700 border-red-200 hover:bg-red-50`} disabled={isBusy} onClick={() => act(it, 'disconnect')} title="Remove them from your LinkedIn connections tonight. You can undo it in the list below until then.">Disconnect</button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data.waiting > 0 && (
        <div className="mt-3">
          <button className={BTN} disabled={loadingMore} onClick={more}>
            {loadingMore ? 'Loading…' : `Show ${Math.min(data.moreStep || 10, data.waiting)} more`}
          </button>
        </div>
      )}
      {data.searches && (data.items || []).length > 0 && <div className="mt-3"><SearchBox post={post} /></div>}
      {data.learnLink && (
        <div className="mt-3 text-sm">
          <a href={data.learnLink} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">How your Reconnect list works</a>
        </div>
      )}
    </div>
  );
}
