"use client";
// The Reconnect section of the Follow-Ups screen (docs/RECONNECT-BUILD-PLAN.md, brick 4).
//
// A day's portion of people whose old LinkedIn conversation is worth picking up again. The list
// arrives on the same /api/followups/queue payload as the live queue (services/reconnectQueue.js
// decides who is on it) - this file renders and sends clicks, it never decides.
//
// No message is pre-written for LinkedIn people (Guy, 1 Aug 2026): the row gives the reason and
// the thing to pick up on; the name opens their profile, and /wg in the thread does the writing.

import React, { useEffect, useState } from 'react';

const CHIP_CLS = {
  open_question_or_offer: 'bg-emerald-100 text-emerald-800',
  not_now: 'bg-sky-100 text-sky-800',
  stalled_after_interest: 'bg-amber-100 text-amber-800',
  answered_then_dropped: 'bg-teal-100 text-teal-800',
  moved_to_call_or_email: 'bg-indigo-100 text-indigo-800',
};

const BTN = 'px-3 py-1.5 rounded text-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50';

const DONE_NOTE = {
  done: 'done',
  skip: 'skipped for 90 days',
  never: 'dropped - no timer will chase them again',
  disconnect: 'will be disconnected tonight - Undo is in the list below until then',
};

export default function ReconnectSection({ data, post, onReplace, onFlagged, onRemaining }) {
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
      await post('/reconnect-action', { key: it.key, action });
      setGone((prev) => new Set(prev).add(it.key));
      setNotice(`${it.name}: ${DONE_NOTE[action]}.`);
      if (action === 'disconnect' && onFlagged) onFlagged();
    } catch (e) {
      setError(`Could not save that for ${it.name}. Nothing was changed.`);
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
      <p className="text-sm text-gray-600 mb-3">
        People you already know whose old conversation is worth picking up. Click a name to open their profile,
        open the message thread and type <span className="font-medium">/wg</span>. Then <span className="font-medium">Done</span>,
        <span className="font-medium"> Skip 90 days</span> or <span className="font-medium">Never</span>
        {data.disconnects ? <>, or <span className="font-medium">Disconnect</span> to remove them from your connections tonight</> : null}.
        Anyone you do not get to stays at the top tomorrow.
      </p>
      {notice && <div className="text-sm text-emerald-700 mb-2">{notice}</div>}
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      {items.length === 0 ? (
        <div className="text-sm text-gray-500">Nobody left on today's list.</div>
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
                      <span className="text-xs text-gray-500">conversation {it.warmth}/5</span>
                      {/* The profile score as a badge, not grey small print (Guy, 5 Oct 2026: he looked for it and did not see it). */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${it.profileScore == null ? 'bg-gray-50 text-gray-500 border-gray-200' : it.profileScore >= 70 ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-amber-50 text-amber-800 border-amber-300'}`}
                        title="Their LinkedIn profile score - separate from the conversation score"
                      >
                        {it.profileScore == null ? 'Profile: not scored' : `Profile score ${it.profileScore}`}
                      </span>
                      <span className="text-xs text-gray-500">quiet {it.quietDays} days</span>
                      {it.carried && <span className="text-xs text-amber-700">carried over</span>}
                    </div>
                    {it.headline && <div className="text-xs text-gray-500 truncate">{it.headline}</div>}
                    <div className="text-sm text-gray-800 mt-1">{it.why}</div>
                    {it.pickUpOn && <div className="text-sm text-gray-700"><span className="font-medium">Pick up on:</span> {it.pickUpOn}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <button className={BTN} disabled={isBusy} onClick={() => act(it, 'done')} title="You have written to them, or dealt with it">Done</button>
                    <button className={BTN} disabled={isBusy} onClick={() => act(it, 'skip')} title="Not now - back on the list in 90 days">Skip 90 days</button>
                    <button className={BTN} disabled={isBusy} onClick={() => act(it, 'never')} title="Same as Drop: never chase them again. A new message from them still shows up.">Never</button>
                    {/* Only for a client with the disconnects extra switched on. One click, no confirm box:
                        nothing reaches Linked Helper until tonight, and Undo sits in the list below until then. */}
                    {data.disconnects && (
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
    </div>
  );
}
