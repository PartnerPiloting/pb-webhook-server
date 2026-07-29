"use client";
// Rescore panel (Settings → Re-score Leads). Gated per client by master "Rescore Enabled".
//
// Two actions (docs/RESCORE-FEATURE-PLAN.md):
//   Test (preview)      — stratified sample, computes scores, SAVES NOTHING. Repeating a test on
//                         the same sample shows "since your last test" deltas — pure attribute
//                         signal (batching is deterministic server-side).
//   Re-score & apply    — commits new scores for everyone scored in the last N months; these
//                         flow into Top Scoring Leads → Linked Helper.
// Both spend credits (1 credit = 1 lead). Backend: /api/rescore (async job + progress polling).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getBackendBase, getAuthenticatedHeaders } from '../services/api';

const POLL_MS = 5000;

export default function RescorePanel() {
  const [credits, setCredits] = useState(null);
  const [enabled, setEnabled] = useState(null); // null = loading
  const [scope, setScope] = useState('sample'); // sample | months
  const [size, setSize] = useState(50);
  const [months, setMonths] = useState(3);
  const [estimate, setEstimate] = useState(null);
  const [job, setJob] = useState(null); // { jobId, total, done, mode }
  const [starting, setStarting] = useState(false); // between click and jobId (scope-build)
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${getBackendBase()}/api/rescore${path}`, {
      headers: getAuthenticatedHeaders(), ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, []);

  // Initial status (enabled + credits)
  useEffect(() => {
    (async () => {
      try {
        const s = await api('/status');
        setEnabled(!!s.enabled);
        setCredits(s.credits || null);
      } catch (e) {
        setEnabled(false);
      }
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [api]);

  // Estimate whenever the scope changes (and once enabled)
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        setEstimate(null);
        const q = scope === 'months' ? `scope=months&months=${months}` : `scope=sample&size=${size}`;
        const e = await api(`/estimate?${q}`);
        if (alive) setEstimate(e);
      } catch (_) { /* estimate is advisory */ }
    })();
    return () => { alive = false; };
  }, [enabled, scope, size, months, api]);

  const startRun = async (mode) => {
    setError(null);
    setResult(null);
    if (mode === 'commit') {
      const n = estimate?.count ?? '?';
      const okGo = window.confirm(
        `Re-score & apply will overwrite the saved scores of ${n} leads (everyone scored in the last ${months} month${months > 1 ? 's' : ''}) using your current attributes, and spend ${n} credits.\n\nNew scores flow straight into Top Scoring Leads. Continue?`
      );
      if (!okGo) return;
    }
    // Immediate feedback: /run does a scope-build (several seconds on a big base) before it
    // returns a jobId — without this the button looks dead after the click.
    setStarting(true);
    try {
      const q = scope === 'months' ? `scope=months&months=${months}` : `scope=sample&size=${size}`;
      const r = await api(`/run?mode=${mode}&${q}`, { method: 'POST' });
      setStarting(false);
      if (r.done && r.result) { setResult(r.result); return; } // empty scope short-circuit
      setJob({ jobId: r.jobId, total: r.total, done: 0, mode });
      pollRef.current = setInterval(async () => {
        try {
          const s = await api(`/run/status?jobId=${encodeURIComponent(r.jobId)}`);
          setJob(j => (j ? { ...j, done: s.done, total: s.total } : j));
          if (s.status === 'done') {
            clearInterval(pollRef.current); pollRef.current = null;
            setJob(null);
            setResult(s.result);
            if (s.result?.credits) setCredits(s.result.credits);
          } else if (s.status === 'error') {
            clearInterval(pollRef.current); pollRef.current = null;
            setJob(null);
            setError(s.error || 'Rescore failed');
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

  const fmt = (v) => (typeof v === 'number' ? v.toFixed(2).replace(/\.00$/, '') : '—');
  const deltaCell = (d) => {
    if (typeof d !== 'number') return <span className="text-gray-400">—</span>;
    if (d > 0) return <span className="text-emerald-700 font-medium">+{fmt(d)}</span>;
    if (d < 0) return <span className="text-red-600 font-medium">{fmt(d)}</span>;
    return <span className="text-gray-500">0</span>;
  };

  if (enabled === null) return <div className="text-gray-500">Loading…</div>;
  if (!enabled) return <div className="text-gray-500">Re-scoring isn&apos;t enabled for your account yet.</div>;

  const busy = !!job || starting;
  const showVsPrev = !!result?.comparedToPreviousTest;

  return (
    <div className="space-y-6">
      {/* Credits meter */}
      <div className="bg-white border rounded p-4 flex items-center gap-4 flex-wrap">
        <span className="text-2xl font-bold text-gray-900">{credits ? credits.available.toLocaleString() : '—'}</span>
        <span className="text-sm text-gray-600">credits available (1 credit = 1 lead re-scored, +{credits?.monthlyAccrual ?? 200}/month)</span>
      </div>

      {/* Scope + actions */}
      <div className="bg-white border rounded p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={scope === 'sample'} onChange={() => setScope('sample')} disabled={busy} />
            <span><span className="font-medium">Test on a sample</span> — nothing is saved</span>
          </label>
          {scope === 'sample' && (
            <span className="inline-flex items-center gap-2 text-sm">
              <input type="number" min="1" max="100" value={size}
                onChange={(e) => setSize(Math.max(1, Math.min(100, Number(e.target.value) || 50)))}
                className="border rounded px-2 py-1 w-20" disabled={busy} />
              leads, spread across your low / mid / high scorers
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={scope === 'months'} onChange={() => setScope('months')} disabled={busy} />
            <span><span className="font-medium">Re-score &amp; apply</span> — overwrites saved scores</span>
          </label>
          {scope === 'months' && (
            <span className="inline-flex items-center gap-2 text-sm">
              everyone scored in the last
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="border rounded px-2 py-1" disabled={busy}>
                <option value={1}>1 month</option>
                <option value={2}>2 months</option>
                <option value={3}>3 months</option>
              </select>
            </span>
          )}
        </div>

        {!estimate && <div className="text-sm text-gray-400">Sizing up your leads…</div>}
        {estimate && (
          <div className="text-sm text-gray-600">
            {estimate.count} lead{estimate.count === 1 ? '' : 's'} in scope · uses {estimate.count} credits
            {!estimate.fits && <span className="text-red-600 font-medium"> — not enough credits ({estimate.creditsAvailable} available)</span>}
          </div>
        )}

        <div className="flex items-center gap-3">
          {scope === 'sample' ? (
            <button
              className={`px-3 py-2 rounded text-white ${busy || (estimate && !estimate.fits) ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-700 hover:bg-blue-600'}`}
              disabled={busy || (estimate && !estimate.fits)}
              onClick={() => startRun('preview')}
              title="Recomputes scores with your current attributes and shows what changed. Saves nothing."
            >{starting ? "Starting…" : "Run test"}</button>
          ) : (
            <button
              className={`px-3 py-2 rounded text-white ${busy || (estimate && !estimate.fits) ? 'bg-gray-300 cursor-not-allowed' : 'bg-emerald-700 hover:bg-emerald-600'}`}
              disabled={busy || (estimate && !estimate.fits)}
              onClick={() => startRun('commit')}
              title="Re-scores and SAVES. New scores flow into Top Scoring Leads."
            >{starting ? "Starting…" : "Re-score & apply"}</button>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>

        <p className="text-xs text-gray-500">
          Tip: run a test, adjust your attributes, then run another test — the report shows exactly what your change did.
          Your first &quot;Re-score &amp; apply&quot; may shift some scores slightly as everyone settles onto a consistent baseline.
        </p>
      </div>

      {/* Progress */}
      {job && (
        <div className="bg-white border rounded p-4">
          <div className="flex items-center gap-3 text-sm text-gray-700 mb-2">
            <span>{job.mode === 'commit' ? 'Re-scoring & saving' : 'Testing'}… {job.done}/{job.total}</span>
            <span className="text-xs text-gray-400">(takes a few minutes — you can leave this open)</span>
          </div>
          <div className="h-2 bg-blue-100 rounded overflow-hidden">
            <div className="h-2 bg-blue-600 transition-all" style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` }} />
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-white border rounded">
          <div className="p-4 border-b">
            <div className="font-medium text-gray-900 mb-1">
              {result.mode === 'commit' ? 'Re-scored & saved' : 'Test results (nothing saved)'}
            </div>
            <div className="text-sm text-gray-600">
              {result.summary?.rescored ?? 0} re-scored · {result.summary?.movedUp ?? 0} up · {result.summary?.movedDown ?? 0} down
              {typeof result.summary?.crossedIntoTopTier === 'number' && ` · ${result.summary.crossedIntoTopTier} crossed into your top tier (${result.summary.tierLine}+)`}
              {typeof result.summary?.droppedBelowTier === 'number' && ` · ${result.summary.droppedBelowTier} dropped out`}
            </div>
            {showVsPrev && result.summary?.vsPreviousTest && (
              <div className="mt-1 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-1 inline-block">
                Since your last test: {result.summary.vsPreviousTest.movedUp} up · {result.summary.vsPreviousTest.movedDown} down · {result.summary.vsPreviousTest.unchanged} unchanged
              </div>
            )}
            {result.mode === 'commit' && (
              <div className="mt-1 text-xs text-gray-500">New scores are live — Top Scoring Leads now uses them.</div>
            )}
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-600">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Previous</th>
                  <th className="py-2 pr-4">New</th>
                  <th className="py-2 pr-4">Change</th>
                  {showVsPrev && <th className="py-2 pr-4">Since last test</th>}
                </tr>
              </thead>
              <tbody>
                {(result.rows || []).map((row) => (
                  <tr key={row.recordId || row.name} className="border-t">
                    <td className="py-2 pr-4">{row.name}</td>
                    <td className="py-2 pr-4">{fmt(row.old)}</td>
                    <td className="py-2 pr-4">{fmt(row.new)}</td>
                    <td className="py-2 pr-4">{deltaCell(row.delta)}</td>
                    {showVsPrev && <td className="py-2 pr-4">{deltaCell(row.deltaVsPrevTest)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
