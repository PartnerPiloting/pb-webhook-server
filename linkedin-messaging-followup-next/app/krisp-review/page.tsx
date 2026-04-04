'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Layout from '../../components/Layout';
import {
  getKrispReviewQueue,
  getKrispReviewEvent,
  saveKrispSpeakers,
  updateKrispStatus,
  splitKrispTranscript,
  analyzeKrispTranscript,
} from '../../services/api';
import { getCurrentClientId } from '../../utils/clientUtils';

const STATUS_META: Record<string, { label: string; colour: string }> = {
  to_verify:         { label: 'To verify',            colour: 'bg-amber-100 text-amber-800 border-amber-200' },
  verified:          { label: 'Verified',              colour: 'bg-green-100 text-green-800 border-green-200' },
  skipped:           { label: 'Skipped',               colour: 'bg-gray-100 text-gray-500 border-gray-200' },
  new:               { label: 'Legacy: new',           colour: 'bg-slate-100 text-slate-600 border-slate-200' },
  speakers_verified: { label: 'Legacy: verified',      colour: 'bg-slate-100 text-slate-600 border-slate-200' },
  ready:             { label: 'Legacy: ready',         colour: 'bg-slate-100 text-slate-600 border-slate-200' },
  linked:            { label: 'Legacy: linked',        colour: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const EDITABLE_STATUSES = ['to_verify', 'verified', 'skipped'] as const;

const QUEUE_FILTERS: { value: string; label: string }[] = [
  { value: 'to_verify', label: 'To verify' },
  { value: 'verified', label: 'Verified' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'legacy', label: 'Legacy (old statuses)' },
  { value: 'all', label: 'Everything' },
];

function Badge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.to_verify;
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wide border rounded px-2 py-0.5 ${m.colour}`}>
      {m.label}
    </span>
  );
}

function formatBrisbane(iso: string) {
  try { return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

function formatDur(sec: number | null) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Queue view
// ---------------------------------------------------------------------------
function QueueView({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('to_verify');

  useEffect(() => {
    setLoading(true);
    getKrispReviewQueue(filter).then(r => {
      setRows(r.rows || []);
      setError(r.error || null);
    }).finally(() => setLoading(false));
  }, [filter]);

  const emptyMsg =
    filter === 'to_verify'
      ? 'Nothing to verify — you\'re caught up, or switch the filter above.'
      : filter === 'all'
        ? 'No transcripts stored yet.'
        : 'No rows match this filter.';

  if (loading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error) return <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-4">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <label htmlFor="krisp-queue-filter" className="text-sm font-medium text-gray-700 shrink-0">
          Show
        </label>
        <select
          id="krisp-queue-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm max-w-md focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
        >
          {QUEUE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="text-gray-500 italic text-sm py-8 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/80 px-4">{emptyMsg}</p>
      ) : (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
            <th className="px-4 py-3 text-left font-semibold">#</th>
            <th className="px-4 py-3 text-left font-semibold">When</th>
            <th className="px-4 py-3 text-left font-semibold">Meeting</th>
            <th className="px-4 py-3 text-left font-semibold">Status</th>
            <th className="px-4 py-3 text-left font-semibold">Flags</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r: any) => {
            const title = r.meeting_title || r.event || '—';
            const dur = formatDur(r.duration_seconds ? Number(r.duration_seconds) : null);
            return (
              <tr key={r.id} className="hover:bg-violet-50/40 transition-colors">
                <td className="px-4 py-3 font-mono text-gray-500">{r.id}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatBrisbane(r.received_at)}</td>
                <td className="px-4 py-3">
                  <span className="text-gray-900">{title}</span>
                  {dur && <span className="text-gray-400 ml-1 text-xs">({dur})</span>}
                </td>
                <td className="px-4 py-3"><Badge status={r.status || 'to_verify'} /></td>
                <td className="px-4 py-3 space-x-1">
                  {r.needs_split && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-800 bg-orange-100 border border-orange-200 rounded px-1.5 py-0.5">
                      Split needed
                    </span>
                  )}
                  {r.verified_speakers && (
                    <span className="text-[10px] font-semibold text-green-700">✓ speakers</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onSelect(String(r.id))} className="text-sm font-medium text-violet-700 hover:text-violet-900 hover:underline">
                    Review
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single event review
// ---------------------------------------------------------------------------
function EventReview({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const [ev, setEv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<Record<string, { name: string; email: string }>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [splitLine, setSplitLine] = useState<number | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  const load = useCallback(() => {
    setLoading(true);
    getKrispReviewEvent(eventId).then(r => {
      if (r.event) {
        setEv(r.event);
        const vs = r.event.verified_speakers || {};
        const init: Record<string, { name: string; email: string }> = {};
        for (const label of (r.event.speaker_labels || [])) {
          init[label] = { name: vs[label]?.name || '', email: vs[label]?.email || '' };
        }
        setSpeakers(init);
      }
      setError(r.error || null);
    }).finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleSaveSpeakers = async () => {
    setSaving(true);
    const r = await saveKrispSpeakers(eventId, speakers);
    setSaving(false);
    if (r.ok) {
      const extra = r.linked_emails?.length ? ` (linked ${r.linked_emails.join(', ')})` : '';
      flash('Speakers saved' + extra);
      load();
    } else {
      flash('Error: ' + (r.error || 'unknown'));
    }
  };

  const handleStatus = async (st: string) => {
    if (!st || !EDITABLE_STATUSES.includes(st as (typeof EDITABLE_STATUSES)[number])) {
      flash('Choose a status');
      return;
    }
    const r = await updateKrispStatus(eventId, st);
    if (r.ok) { flash('Status updated'); load(); } else flash('Error: ' + (r.error || 'unknown'));
  };

  const handleSplit = async () => {
    if (splitLine == null || splitLine < 1) { flash('Click a line in the transcript to set the split point'); return; }
    if (!confirm(`Split transcript at line ${splitLine}? This creates a new event from line ${splitLine} onwards.`)) return;
    setSplitting(true);
    const r = await splitKrispTranscript(eventId, splitLine);
    setSplitting(false);
    if (r.ok) {
      flash(`Split done — child event #${r.child_id} created`);
      setSplitMode(false);
      setSplitLine(null);
      load();
    } else {
      flash('Split failed: ' + (r.error || 'unknown'));
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    const r = await analyzeKrispTranscript(eventId);
    setAnalyzing(false);
    setAiResult(r);
    if (r.error) flash('AI analysis: ' + r.error);
    else if (r.needsSplit) flash('AI detected possible back-to-back calls');
    else flash('AI analysis complete — looks like a single conversation');
  };

  if (loading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error || !ev) return <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-4">{error || 'Not found'}</p>;

  const labels: string[] = ev.speaker_labels || [];
  const calAttendees: { email: string; name: string }[] = ev.calendar_attendees || [];
  const st = ev.status || 'to_verify';
  const fullText: string = ev.full_text || '';
  const verified = ev.verified_speakers || {};
  const lines = fullText.split('\n');

  const transcriptContent = lines.map((line: string, i: number) => {
    const m = line.match(/^(Speaker\s*\d+|[^:]{1,40}):\s/);
    const lineNum = i + 1;
    const isSplitPoint = splitMode && splitLine === lineNum;
    const isAboveSplit = splitMode && splitLine != null && lineNum < splitLine;

    const aiGuess = aiResult?.speakerGuesses;
    let displayLabel = '';
    let rest = line;

    if (m) {
      const label = m[1].trim();
      const vName = verified[label]?.name;
      const aiName = aiGuess?.[label]?.likelyName;
      displayLabel = vName || aiName || label;
      rest = line.slice(m[0].length);
    }

    return (
      <div
        key={i}
        className={`group flex items-start gap-2 py-0.5 rounded transition-colors ${
          splitMode ? 'cursor-pointer hover:bg-orange-50' : ''
        } ${isSplitPoint ? 'bg-orange-100 border-t-2 border-orange-500' : ''} ${
          isAboveSplit ? 'opacity-50' : ''
        }`}
        onClick={splitMode ? () => setSplitLine(lineNum) : undefined}
      >
        {splitMode && (
          <span className="text-[10px] text-gray-400 font-mono w-6 text-right shrink-0 pt-0.5 select-none">
            {lineNum}
          </span>
        )}
        <div className="flex-1 min-w-0">
          {m ? (
            <>
              <span className="font-semibold text-violet-800" title={m[1].trim()}>{displayLabel}:</span>{' '}
              <span>{rest}</span>
            </>
          ) : (
            <span>{line}</span>
          )}
        </div>
      </div>
    );
  });

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-violet-700 hover:underline">&larr; Back to queue</button>

      <div>
        <h2 className="text-xl font-bold text-gray-900">{ev.title}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {formatBrisbane(ev.received_at)}
          {ev.duration ? ` · ${formatDur(ev.duration)}` : ''}
          {' · #'}{ev.id}{' · '}
          <Badge status={st} />
          {ev.parent_event_id && (
            <span className="ml-2 text-xs text-gray-400">(split from #{ev.parent_event_id})</span>
          )}
        </p>
        {ev.status_reason && (
          <p className="text-xs text-gray-500 mt-1 bg-gray-50 border border-gray-200 rounded px-3 py-1.5">
            {ev.status_reason}
          </p>
        )}
      </div>

      {/* Needs-split alert */}
      {ev.needs_split && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 flex items-start gap-3">
          <span className="text-orange-600 text-lg">⚠️</span>
          <div>
            <p className="font-semibold text-orange-900 text-sm">This transcript may contain back-to-back calls</p>
            <p className="text-xs text-orange-700 mt-1">
              Multiple calendar events overlap, or AI detected separate conversations. Use the split tool below to separate them.
            </p>
          </div>
        </div>
      )}

      {/* AI analysis card */}
      {aiResult && !aiResult.error && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="font-semibold text-blue-900 text-sm mb-2">AI Analysis</h3>
          <div className="text-xs text-blue-800 space-y-1">
            <p><strong>Split needed:</strong> {aiResult.needsSplit ? 'Yes' : 'No'}{aiResult.splitReason ? ` — ${aiResult.splitReason}` : ''}</p>
            {aiResult.suggestedSplitLine && (
              <p><strong>Suggested split line:</strong> {aiResult.suggestedSplitLine}</p>
            )}
            {aiResult.speakerGuesses && Object.keys(aiResult.speakerGuesses).length > 0 && (
              <div className="mt-2">
                <strong>Speaker guesses:</strong>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(aiResult.speakerGuesses).map(([label, info]: [string, any]) => (
                    <li key={label}>
                      {label} → {info.likelyName || '?'} ({info.role}, {info.confidence} confidence)
                      {info.likelyName && (
                        <button
                          type="button"
                          className="ml-2 text-[10px] bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-200"
                          onClick={() => setSpeakers(s => ({ ...s, [label]: { ...s[label], name: info.likelyName } }))}
                        >
                          Use name
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Speakers */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Verify speakers</h3>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
          >
            {analyzing ? 'Analyzing…' : '🤖 AI identify speakers'}
          </button>
        </div>
        {labels.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No speaker labels detected in transcript.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-x-3 gap-y-2 items-center text-sm">
              <div className="text-xs text-gray-500 uppercase font-semibold">Label</div>
              <div className="text-xs text-gray-500 uppercase font-semibold">Name</div>
              <div className="text-xs text-gray-500 uppercase font-semibold">Email</div>
              <div className="text-xs text-gray-500 uppercase font-semibold">Suggest</div>
              {labels.map(label => (
                <React.Fragment key={label}>
                  <div className="font-medium text-gray-700">{label}</div>
                  <input
                    type="text"
                    value={speakers[label]?.name || ''}
                    onChange={e => setSpeakers(s => ({ ...s, [label]: { ...s[label], name: e.target.value } }))}
                    placeholder="Real name"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                  />
                  <input
                    type="email"
                    value={speakers[label]?.email || ''}
                    onChange={e => setSpeakers(s => ({ ...s, [label]: { ...s[label], email: e.target.value } }))}
                    placeholder="Email (optional — links to CRM lead)"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                  />
                  <div className="flex gap-1 flex-wrap">
                    {calAttendees.length > 0 ? calAttendees.map(a => (
                      <button
                        key={a.email}
                        type="button"
                        onClick={() => setSpeakers(s => ({ ...s, [label]: { name: a.name || a.email, email: a.email } }))}
                        className="text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded px-2 py-0.5 hover:bg-violet-100"
                      >
                        {a.name || a.email}
                      </button>
                    )) : <span className="text-xs text-gray-400">—</span>}
                  </div>
                </React.Fragment>
              ))}
            </div>
            <button
              onClick={handleSaveSpeakers}
              disabled={saving}
              className="mt-2 px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save speakers'}
            </button>
          </div>
        )}
      </div>

      {/* Transcript */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Transcript</h3>
          <div className="flex items-center gap-2">
            {splitMode ? (
              <>
                <span className="text-xs text-orange-700">Click a line to set split point</span>
                {splitLine != null && (
                  <button
                    onClick={handleSplit}
                    disabled={splitting}
                    className="text-xs px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-semibold disabled:opacity-50"
                  >
                    {splitting ? 'Splitting…' : `Split at line ${splitLine}`}
                  </button>
                )}
                <button
                  onClick={() => { setSplitMode(false); setSplitLine(null); }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setSplitMode(true)}
                className="text-xs px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-100"
              >
                ✂️ Split transcript
              </button>
            )}
          </div>
        </div>
        <div className={`max-h-[500px] overflow-y-auto text-sm text-gray-700 leading-relaxed font-sans ${splitMode ? 'border-2 border-orange-200 rounded-lg p-2' : ''}`}>
          {transcriptContent}
        </div>
      </div>

      {/* Status */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Status</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={EDITABLE_STATUSES.includes(st as any) ? st : ''}
            onChange={e => handleStatus(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            {!EDITABLE_STATUSES.includes(st as any) && (
              <option value="" disabled>
                {(STATUS_META[st]?.label || st)} — choose a status below
              </option>
            )}
            {EDITABLE_STATUSES.map((k) => (
              <option key={k} value={k}>{STATUS_META[k].label}</option>
            ))}
          </select>
          <button
            onClick={() => { if (confirm('Skip this transcript?')) handleStatus('skipped'); }}
            className="text-sm text-red-600 hover:text-red-800 hover:underline"
          >
            Skip
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
function KrispReviewContent() {
  const searchParams = useSearchParams();
  const reviewIdFromUrl = searchParams.get('reviewId');
  const [selectedId, setSelectedId] = useState<string | null>(reviewIdFromUrl || null);
  const clientId = getCurrentClientId();
  const isGuy = clientId === 'Guy-Wilson';

  if (!isGuy) {
    return (
      <Layout>
        <div className="py-12 text-center text-gray-500">
          <p>This page is only available for Guy Wilson.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto py-6 px-4 sm:px-6">
        {!selectedId ? (
          <>
            <div className="mb-5">
              <h1 className="text-2xl font-bold text-gray-900">Transcript Review Queue</h1>
              <p className="text-sm text-gray-500 mt-1">
                Defaults to <strong>To verify</strong> — transcripts the system couldn&apos;t fully auto-resolve. Use the filter to see verified or skipped ones.
              </p>
            </div>
            <QueueView onSelect={setSelectedId} />
          </>
        ) : (
          <EventReview eventId={selectedId} onBack={() => setSelectedId(null)} />
        )}
      </div>
    </Layout>
  );
}

export default function KrispReviewPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-gray-500">Loading…</div>}>
      <KrispReviewContent />
    </Suspense>
  );
}
