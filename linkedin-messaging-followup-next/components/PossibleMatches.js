"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { getPossibleMatches, mergePossibleMatch, dismissPossibleMatch } from '../services/api';

// Icons via require, matching NewLeadForm's pattern
let ArrowsRightLeftIcon, XMarkIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  ArrowsRightLeftIcon = icons.ArrowsRightLeftIcon;
  XMarkIcon = icons.XMarkIcon;
} catch (error) {
  console.error('Failed to import icons:', error);
}

/**
 * "Possible match" - a record with no LinkedIn URL (someone you met on a call and added without
 * one) beside a full record that shares its exact name (usually just arrived from Linked Helper).
 * Wingguy never merges on a name alone: two people can share one. You say.
 *
 * Same person -> the two records are combined into the full one (email, phone, location, notes and
 *                meeting transcripts carried across), and the URL-less record is removed.
 * Different   -> both stay, and this pair is never suggested again.
 *
 * Renders NOTHING when there are no pairs, so the page looks as before until one appears.
 */
const PossibleMatches = ({ refreshKey }) => {
  const [pairs, setPairs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await getPossibleMatches();
      setPairs(Array.isArray(list) ? list : []);
      setError('');
    } catch (e) {
      // Quiet failure: this section is a bonus, not the page's job.
      console.error('PossibleMatches: load failed', e);
      setPairs([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const keyOf = (p) => `${p.skeleton.id}|${p.candidate.id}`;

  const handleMerge = async (p) => {
    setBusyKey(keyOf(p));
    setError('');
    setDone('');
    try {
      const r = await mergePossibleMatch(p.skeleton.id, p.candidate.id);
      setPairs((prev) => prev.filter((x) => x.skeleton.id !== p.skeleton.id));
      const moved = r && r.meetingsMoved ? ` ${r.meetingsMoved} meeting transcript${r.meetingsMoved === 1 ? '' : 's'} moved across.` : '';
      setDone(`Combined into ${p.candidate.name}.${moved}`);
    } catch (e) {
      console.error('PossibleMatches: merge failed', e);
      setError(e?.response?.data?.error || 'Could not combine those two just now - please try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDismiss = async (p) => {
    setBusyKey(keyOf(p));
    setError('');
    setDone('');
    try {
      await dismissPossibleMatch(p.skeleton.id, p.candidate.id);
      setPairs((prev) => prev.filter((x) => keyOf(x) !== keyOf(p)));
    } catch (e) {
      console.error('PossibleMatches: dismiss failed', e);
      setError('Could not save that just now - please try again.');
    } finally {
      setBusyKey(null);
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

  if (!loaded) return null;
  if (pairs.length === 0 && !done) return null;

  return (
    <div className="mb-8 bg-white border border-amber-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-amber-100 bg-amber-50 rounded-t-lg">
        <div className="flex items-center">
          {ArrowsRightLeftIcon && <ArrowsRightLeftIcon className="h-6 w-6 text-amber-600 mr-2" />}
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Possible matches - same person twice?
            </h3>
            <p className="text-sm text-gray-600">
              Someone you added without a LinkedIn address shares a name with a record that has one
              (usually one that just arrived from Linked Helper). Wingguy won&apos;t guess - if it&apos;s the
              same person, combine them and everything you had (email, notes, meeting transcripts) moves
              onto the full record.
            </p>
          </div>
        </div>
      </div>
      {error && <div className="px-6 py-2 text-sm text-red-600">{error}</div>}
      {done && <div className="px-6 py-2 text-sm text-green-700">{done}</div>}
      <ul className="divide-y divide-gray-100">
        {pairs.map((p) => (
          <li key={keyOf(p)} className="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0 text-sm">
              <div className="font-medium text-gray-900">
                {p.skeleton.name}
                <span className="text-gray-500 font-normal">
                  {' '}- added {p.skeleton.createdTime ? fmtDate(p.skeleton.createdTime) : 'earlier'} without a LinkedIn address
                  {p.skeleton.email ? ` (${p.skeleton.email})` : ''}
                </span>
              </div>
              <div className="text-gray-700 mt-0.5">
                looks like{' '}
                {p.candidate.linkedinUrl ? (
                  <a href={p.candidate.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                    {p.candidate.name}
                  </a>
                ) : (
                  <span className="font-medium">{p.candidate.name}</span>
                )}
                {p.candidate.headline ? ` - ${p.candidate.headline}` : ''}
                {p.candidate.company && !(p.candidate.headline || '').includes(p.candidate.company) ? `, ${p.candidate.company}` : ''}
                {p.candidate.location ? ` (${p.candidate.location})` : ''}
                {p.candidate.email ? ` - ${p.candidate.email}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleMerge(p)}
                disabled={busyKey === keyOf(p)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                title="Same person - combine the two records into the one with the LinkedIn address"
              >
                {ArrowsRightLeftIcon && <ArrowsRightLeftIcon className="h-4 w-4 mr-1" />}
                {busyKey === keyOf(p) ? 'Working…' : 'Same person - combine'}
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(p)}
                disabled={busyKey === keyOf(p)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                title="Different people - keep both and don't ask again"
              >
                {XMarkIcon && <XMarkIcon className="h-4 w-4 mr-1" />}
                Different people
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PossibleMatches;
