"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { getPendingPeople, skipPendingPerson } from '../services/api';

// Icons via require, matching NewLeadForm's pattern
let UserGroupIcon, UserPlusIcon, XMarkIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  UserGroupIcon = icons.UserGroupIcon;
  UserPlusIcon = icons.UserPlusIcon;
  XMarkIcon = icons.XMarkIcon;
} catch (error) {
  console.error('Failed to import icons:', error);
}

/**
 * "People you've met who aren't in Wingguy yet" — meeting participants Wingguy saved a
 * transcript for but couldn't match to any lead. Renders NOTHING when the list is empty, so
 * the New Leads page looks exactly as before until there's someone to process.
 *
 * Add  -> hands the person up to the page, which pre-fills the New Lead form (the client only
 *         needs to paste the LinkedIn URL). On create, the waiting transcripts attach
 *         automatically server-side.
 * Skip -> final: the person drops off the list and Wingguy never asks about them again.
 *         Their transcripts stay saved, and adding them later by any route still attaches.
 */
const PeopleYouveMet = ({ onAddPerson, refreshKey }) => {
  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busyEmail, setBusyEmail] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await getPendingPeople();
      setPeople(Array.isArray(list) ? list : []);
      setError('');
    } catch (e) {
      // Quiet failure: this section is a bonus, not the page's job.
      console.error('PeopleYouveMet: load failed', e);
      setPeople([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

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
              Add the ones you want to track - skip the rest and they won&apos;t be suggested again.
            </p>
          </div>
        </div>
      </div>
      {error && (
        <div className="px-6 py-2 text-sm text-red-600">{error}</div>
      )}
      <ul className="divide-y divide-gray-100">
        {people.map((p) => (
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
                onClick={() => onAddPerson && onAddPerson(p)}
                disabled={busyEmail === p.email}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {UserPlusIcon && <UserPlusIcon className="h-4 w-4 mr-1" />}
                Add
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
        ))}
      </ul>
    </div>
  );
};

export default PeopleYouveMet;
