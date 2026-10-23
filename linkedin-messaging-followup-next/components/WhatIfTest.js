"use client";
// "Test this change" inside the Edit Attribute form (23 Oct 2026, Sam Noble's ask).
//
// Scores a sample of the client's own leads with the form's UNSAVED values applied over the saved
// attributes - nothing is saved, not the attribute and not a score - and shows how the order would
// move compared with the saved attributes on the same leads. Backend: POST /api/rescore/whatif,
// polled through /api/rescore/run/status like the Re-score panel.
import React, { useState, useEffect, useRef } from 'react';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';

const POLL_MS = 5000;
const SIZE = 50;

const fmt = (v) => (typeof v === 'number' ? String(Math.round(v)) : '-');

export default function WhatIfTest({ recordId, buildData, disabled }) {
  const [job, setJob] = useState(null); // { jobId, total, done }
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const call = async (path, opts = {}) => {
    const res = await fetch(`${getBackendBase()}/api/rescore${path}`, {
      ...opts,
      headers: { ...getAuthenticatedHeaders(), 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 402) throw new Error(`Not enough re-score credits for this test (needs ${data.needed}, ${data.available} left).`);
      if (res.status === 403) throw new Error("Testing isn't switched on for your account yet - ask Guy.");
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  };

  const start = async () => {
    setError(null);
    setResult(null);
    const data = buildData();
    if (!data) return; // the form showed its own error
    setStarting(true);
    try {
      const r = await call('/whatif', { method: 'POST', body: JSON.stringify({ recordId, data, size: SIZE }) });
      setStarting(false);
      if (r.done && r.result) { setResult(r.result); return; }
      setJob({ jobId: r.jobId, total: r.creditsNeeded || r.total, done: 0 });
      pollRef.current = setInterval(async () => {
        try {
          const s = await call(`/run/status?jobId=${encodeURIComponent(r.jobId)}`);
          setJob((j) => (j ? { ...j, done: s.done, total: s.total } : j));
          if (s.status === 'done' || s.status === 'error') {
            clearInterval(pollRef.current); pollRef.current = null;
            setJob(null);
            if (s.status === 'done') setResult(s.result); else setError(s.error || 'The test failed');
          }
        } catch (e) {
          clearInterval(pollRef.current); pollRef.current = null;
          setJob(null);
          setError(e.message);
        }
      }, POLL_MS);
    } catch (e) {
      setStarting(false);
      setError(e.message);
    }
  };

  const busy = starting || !!job;
  const rows = (result?.rows || []).filter((x) => typeof x.new === 'number');
  const byNew = [...rows].sort((a, b) => b.new - a.new);
  const vs = result?.summary?.vsPreviousTest;
  const before = (x) => (typeof x.prevTest === 'number' ? x.prevTest : x.old);

  return (
    <div className="border rounded-lg p-4 bg-amber-50 border-amber-200 space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          <div className="text-sm font-medium text-gray-900">Test this change before saving</div>
          <p className="text-xs text-gray-600">
            Scores {SIZE} of your leads with the change above and shows how the order would move. Nothing is saved - not this
            attribute, not any score. Uses re-score credits ({SIZE}, or {SIZE * 2} the first time, as it also scores the same
            leads with what is saved now, so you see only what this change does).
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={busy || disabled}
          className="px-3 py-2 text-sm rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:bg-gray-300"
        >
          {starting ? 'Starting...' : job ? `Testing... ${job.done}/${job.total}` : result ? 'Test again' : 'Test this change'}
        </button>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

      {result && (
        <div className="space-y-2">
          <div className="text-sm text-gray-800">
            {vs
              ? <>Compared with what is saved now, on the same {result.count} leads: <b>{vs.movedUp} up</b>, <b>{vs.movedDown} down</b>, {vs.unchanged} unchanged.</>
              : <>{result.count} leads scored with the change (compared with their stored scores).</>}
            {' '}Nothing was saved.
          </div>
          <table className="min-w-full text-sm bg-white border rounded">
            <thead className="text-left text-gray-600">
              <tr>
                <th className="py-1 px-2">Top of the order with this change</th>
                <th className="py-1 px-2">Now</th>
                <th className="py-1 px-2">With the change</th>
              </tr>
            </thead>
            <tbody>
              {byNew.slice(0, 10).map((x) => (
                <tr key={x.recordId} className="border-t">
                  <td className="py-1 px-2">{x.name}</td>
                  <td className="py-1 px-2 text-gray-600">{fmt(before(x))}</td>
                  <td className="py-1 px-2 font-medium">{fmt(x.new)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-600">
            Happy with it? Press Save Changes. Not quite? Adjust and test again - each test is compared with what is saved.
          </p>
        </div>
      )}
    </div>
  );
}
