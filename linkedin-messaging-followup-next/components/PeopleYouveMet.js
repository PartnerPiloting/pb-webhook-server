"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getPendingPeople, skipPendingPerson, createLead, updateLead, lookupLead, mergePossibleMatch } from '../services/api';

// Icons via require, matching NewLeadForm's pattern
let UserGroupIcon, UserPlusIcon, XMarkIcon, CheckIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  UserGroupIcon = icons.UserGroupIcon;
  UserPlusIcon = icons.UserPlusIcon;
  XMarkIcon = icons.XMarkIcon;
  CheckIcon = icons.CheckIcon;
} catch (error) {
  console.error('Failed to import icons:', error);
}

// "Cynthia Lai" -> { firstName: 'Cynthia', lastName: 'Lai' }; a single word is a first name.
// No name at all (some recorders only give the address) -> read it off the address:
// cynthia.lai@ -> "Cynthia Lai". The record can be corrected later; the transcript can't wait.
function splitName(name, email) {
  let src = String(name || '').trim();
  if (!src && email) {
    src = String(email).split('@')[0].replace(/[._\-+]+/g, ' ').replace(/\d+/g, ' ').trim()
      .split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  const parts = src.split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || '');
  return { firstName, lastName };
}

/**
 * "People you've met who aren't in Wingguy yet" - meeting participants Wingguy saved a
 * transcript for but couldn't match to any lead. Renders NOTHING when the list is empty, so
 * the New Leads page looks exactly as before until there's someone to process.
 *
 * Add  -> ONE click (Guy, 2026-09-04). The record is created right here from what the recorder
 *         already knows (name + address), the waiting transcripts attach server-side, and the
 *         row turns into "Added" with a small box for their LinkedIn address - optional, and it
 *         can wait. No form. You stay on the list.
 *         If the pasted address is already on another record, Wingguy never merges on its own:
 *         it asks "same person?" and only combines when you say so.
 * Skip -> final: the person drops off the list and Wingguy never asks about them again.
 *         Their transcripts stay saved, and adding them later by any route still attaches.
 */
const PeopleYouveMet = ({ onAdded, refreshKey }) => {
  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busyEmail, setBusyEmail] = useState(null);
  const [error, setError] = useState('');
  // email -> { id, name, url, phase, match, err }. phase: ask | saving | saved | collision | combined
  const [added, setAdded] = useState({});
  const addedRef = useRef({});
  useEffect(() => { addedRef.current = added; }, [added]);

  const load = useCallback(async () => {
    try {
      const list = await getPendingPeople();
      const fresh = Array.isArray(list) ? list : [];
      // Someone added a moment ago is resolved on the server and gone from its list - keep their
      // row on screen (it carries the LinkedIn box) until they press Done.
      setPeople((prev) => {
        const keep = prev.filter((p) => addedRef.current[p.email] && !fresh.some((x) => x.email === p.email));
        return [...fresh, ...keep];
      });
      setError('');
    } catch (e) {
      // Quiet failure: this section is a bonus, not the page's job.
      console.error('PeopleYouveMet: load failed', e);
      setPeople((prev) => prev.filter((p) => addedRef.current[p.email]));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const setRow = (email, patch) => setAdded((prev) => ({ ...prev, [email]: { ...(prev[email] || {}), ...patch } }));

  const handleAdd = async (p) => {
    setBusyEmail(p.email);
    setError('');
    try {
      const { firstName, lastName } = splitName(p.name, p.email);
      const lead = await createLead({
        firstName,
        lastName,
        email: p.email,
        // The recorder's address is the identity the transcripts attach by (server-side, on create).
        pendingEmail: p.email,
        // Someone off a call is not a follow-up target until you decide they are.
        noFollowUpNeeded: true,
        source: 'Follow-Up Personally',
      });
      const name = [firstName, lastName].filter(Boolean).join(' ') || p.email;
      setRow(p.email, { id: lead.id, name, url: '', phase: 'ask', match: null, err: '', attached: lead.attachedMeetings || 0 });
      if (onAdded) onAdded(lead);
    } catch (e) {
      console.error('PeopleYouveMet: add failed', e);
      setError(e?.message || 'Could not add that person just now - please try again.');
    } finally {
      setBusyEmail(null);
    }
  };

  const handleSaveUrl = async (email) => {
    const row = added[email];
    if (!row) return;
    const url = String(row.url || '').trim();
    if (!/linkedin\.com\/in\//i.test(url)) {
      setRow(email, { err: "That doesn't look like a LinkedIn profile address (linkedin.com/in/...)." });
      return;
    }
    setRow(email, { phase: 'saving', err: '' });
    try {
      // Is this address already on someone's record? A URL names ONE person, so a hit means
      // either the same person twice (combine) or a wrong paste (leave it) - never decide alone.
      let existing = null;
      try {
        const r = await lookupLead(url);
        existing = (r?.leads || []).find((l) => l.id !== row.id) || null;
      } catch (e) {
        console.warn('PeopleYouveMet: lookup before save failed, saving anyway', e);
      }
      if (existing) {
        const mname = [existing.firstName, existing.lastName].filter(Boolean).join(' ') || existing.email || 'another record';
        setRow(email, { phase: 'collision', match: { id: existing.id, name: mname } });
        return;
      }
      await updateLead(row.id, { linkedinProfileUrl: url });
      setRow(email, { phase: 'saved', url });
    } catch (e) {
      console.error('PeopleYouveMet: save URL failed', e);
      setRow(email, { phase: 'ask', err: e?.message || 'Could not save that address just now - please try again.' });
    }
  };

  const handleCombine = async (email) => {
    const row = added[email];
    if (!row || !row.match) return;
    setRow(email, { phase: 'saving', err: '' });
    try {
      // Our new record has no URL (it's the skeleton); the existing one keeps everything.
      await mergePossibleMatch(row.id, row.match.id);
      setRow(email, { phase: 'combined' });
    } catch (e) {
      console.error('PeopleYouveMet: combine failed', e);
      setRow(email, { phase: 'collision', err: e?.response?.data?.error || 'Could not combine those two just now - please try again.' });
    }
  };

  const handleNotSame = (email) => {
    const row = added[email];
    setRow(email, {
      phase: 'ask',
      match: null,
      url: '',
      err: `That address is already on ${row?.match?.name || 'another record'}, so it hasn't been added here - check the address.`,
    });
  };

  const handleDone = (email) => {
    setPeople((prev) => prev.filter((p) => p.email !== email));
    setAdded((prev) => { const n = { ...prev }; delete n[email]; return n; });
  };

  const handleSkip = async (email) => {
    setBusyEmail(email);
    setError('');
    try {
      await skipPendingPerson(email);
      setPeople((prev) => prev.filter((p) => p.email !== email));
    } catch (e) {
      console.error('PeopleYouveMet: skip failed', e);
      setError('Could not skip that one just now - please try again.');
    } finally {
      setBusyEmail(null);
    }
  };

  const fmtDate = (d) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return String(d).slice(0, 10);
    }
  };

  if (!loaded || people.length === 0) return null;

  const renderAddedRow = (p, row) => (
    <li key={p.email} className="px-6 py-3 bg-green-50">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 truncate flex items-center">
            {CheckIcon && <CheckIcon className="h-4 w-4 text-green-600 mr-1" />}
            {row.name} - added
            {row.attached > 0 && (
              <span className="ml-2 text-xs font-normal text-green-700">
                {row.attached === 1 ? '1 meeting transcript attached' : `${row.attached} meeting transcripts attached`}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-500 truncate">{p.email}</div>
        </div>
        <button
          type="button"
          onClick={() => handleDone(p.email)}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 shrink-0"
        >
          Done
        </button>
      </div>

      {row.phase === 'saved' && (
        <div className="mt-2 text-sm text-green-700">LinkedIn address saved.</div>
      )}
      {row.phase === 'combined' && (
        <div className="mt-2 text-sm text-green-700">
          Combined into {row.match?.name}&apos;s record - the meeting transcripts moved across with it.
        </div>
      )}
      {row.phase === 'collision' && (
        <div className="mt-2 text-sm text-gray-800">
          <div className="mb-2">
            That LinkedIn address is already on <span className="font-medium">{row.match?.name}</span>&apos;s record.
            Same person?
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleCombine(p.email)}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              title="Same person - combine the two records into the one with the LinkedIn address"
            >
              Same person - combine
            </button>
            <button
              type="button"
              onClick={() => handleNotSame(p.email)}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200"
              title="Different people - leave both records as they are"
            >
              Different person
            </button>
          </div>
          {row.err && <div className="mt-1 text-red-600">{row.err}</div>}
        </div>
      )}
      {(row.phase === 'ask' || row.phase === 'saving') && (
        <div className="mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="url"
              value={row.url}
              onChange={(e) => setRow(p.email, { url: e.target.value, err: '' })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveUrl(p.email); } }}
              placeholder="Paste their LinkedIn address (optional - can wait)"
              disabled={row.phase === 'saving'}
              className="flex-1 min-w-[16rem] px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => handleSaveUrl(p.email)}
              disabled={row.phase === 'saving' || !String(row.url || '').trim()}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {row.phase === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
          {row.err && <div className="mt-1 text-sm text-red-600">{row.err}</div>}
        </div>
      )}
    </li>
  );

  return (
    <div className="mb-8 bg-white border border-blue-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-blue-100 bg-blue-50 rounded-t-lg">
        <div className="flex items-center">
          {UserGroupIcon && <UserGroupIcon className="h-6 w-6 text-blue-600 mr-2" />}
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              People you&apos;ve met who aren&apos;t in Wingguy yet
            </h3>
            <p className="text-sm text-gray-600">
              Wingguy saved the meeting transcripts but can&apos;t use them until these people are in your database.
              Add is one click - their transcripts attach straight away, and you can paste their LinkedIn address
              then or later. Skip the rest and they won&apos;t be suggested again.
            </p>
          </div>
        </div>
      </div>
      {error && (
        <div className="px-6 py-2 text-sm text-red-600">{error}</div>
      )}
      <ul className="divide-y divide-gray-100">
        {people.map((p) => {
          const row = added[p.email];
          if (row) return renderAddedRow(p, row);
          return (
            <li key={p.email} className="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">
                  {p.name || p.email}
                </div>
                <div className="text-sm text-gray-500 truncate">
                  {p.name ? `${p.email} - ` : ''}
                  {p.meetings > 1 ? `${p.meetings} meetings` : 'met'}
                  {p.latest ? ` ${fmtDate(p.latest)}` : ''}
                  {p.latestTitle ? ` - "${p.latestTitle}"` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleAdd(p)}
                  disabled={busyEmail === p.email}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  title="Add to Wingguy now - their meeting transcripts attach straight away"
                >
                  {UserPlusIcon && <UserPlusIcon className="h-4 w-4 mr-1" />}
                  {busyEmail === p.email ? 'Adding…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSkip(p.email)}
                  disabled={busyEmail === p.email}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                  title="Skip - Wingguy won't suggest this person again"
                >
                  {XMarkIcon && <XMarkIcon className="h-4 w-4 mr-1" />}
                  {busyEmail === p.email ? 'Skipping…' : 'Skip'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PeopleYouveMet;
