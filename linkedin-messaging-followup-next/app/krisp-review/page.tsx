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
  searchKrispLeadByEmail,
  addKrispMeetingLead,
  removeKrispMeetingLead,
} from '../../services/api';
import { getCurrentClientId } from '../../utils/clientUtils';

const STATUS_META: Record<string, { label: string; colour: string }> = {
  incomplete: { label: 'Incomplete', colour: 'bg-amber-100 text-amber-800 border-amber-200' },
  complete:   { label: 'Complete',   colour: 'bg-green-100 text-green-800 border-green-200' },
  skipped:    { label: 'Skipped',    colour: 'bg-gray-100 text-gray-500 border-gray-200' },
  to_verify:  { label: 'Incomplete', colour: 'bg-amber-100 text-amber-800 border-amber-200' },
  verified:   { label: 'Complete',   colour: 'bg-green-100 text-green-800 border-green-200' },
};

const EDITABLE_STATUSES = ['incomplete', 'complete', 'skipped'] as const;

const QUEUE_FILTERS: { value: string; label: string }[] = [
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'complete', label: 'Complete' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'all', label: 'Everything' },
];

function Badge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.incomplete;
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

function normalizeReviewStatus(st: string) {
  const s = String(st || '').toLowerCase();
  if (s === 'to_verify' || s === 'incomplete') return 'incomplete';
  if (s === 'verified' || s === 'complete') return 'complete';
  if (s === 'skipped') return 'skipped';
  return 'incomplete';
}

function shortLeadId(id: string) {
  const t = String(id || '').trim();
  return t.length > 10 ? `${t.slice(0, 8)}…` : t || '?';
}

/** Display names for meeting Airtable lead ids (from participants / verified speakers / placeholders). */
function buildLeadDisplay(ev: any): Record<string, { name: string; email: string }> {
  const map: Record<string, { name: string; email: string }> = {};
  for (const ml of ev.meeting_leads || []) {
    const id = String(ml.airtable_lead_id || '').trim();
    if (!id) continue;
    map[id] = { name: `Lead ${shortLeadId(id)}`, email: '' };
  }
  for (const p of ev.participants || []) {
    const id = String(p.airtable_lead_id || '').trim();
    if (!id) continue;
    const name = String(p.verified_name || '').trim();
    const email = String(p.verified_email || '').trim();
    if (name || email) {
      map[id] = {
        name: name || map[id]?.name || `Lead ${shortLeadId(id)}`,
        email: email || map[id]?.email || '',
      };
    }
  }
  for (const v of Object.values(ev.verified_speakers || {}) as any[]) {
    if (!v || typeof v !== 'object') continue;
    const id = String(v.airtable_lead_id || '').trim();
    if (!id) continue;
    const name = String(v.name || '').trim();
    const email = String(v.email || '').trim();
    if (name || email) {
      map[id] = {
        name: name || map[id]?.name || `Lead ${shortLeadId(id)}`,
        email: email || map[id]?.email || '',
      };
    }
  }
  return map;
}

type SpeakerForm = { name: string; email: string; role: string; airtable_lead_id: string };

function parseTranscriptSpeakerLine(line: string): { label: string; rest: string } | null {
  const mPipe = line.match(/^(Speaker\s*\d+)\s*\|\s*/i);
  if (mPipe) {
    return { label: mPipe[1].replace(/\s+/g, ' ').trim(), rest: line.slice(mPipe[0].length) };
  }
  const mColon = line.match(/^(Speaker\s*\d+)\s*:\s/i);
  if (mColon) {
    return { label: mColon[1].replace(/\s+/g, ' ').trim(), rest: line.slice(mColon[0].length) };
  }
  const mName = line.match(/^([^:]{1,40}):\s/);
  if (mName) {
    const label = mName[1].trim();
    if (!label || label.startsWith('{') || label.startsWith('[')) return null;
    if (/^Speaker\s*\d+$/i.test(label)) return null;
    return { label, rest: line.slice(mName[0].length) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Queue view
// ---------------------------------------------------------------------------
function QueueView({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('incomplete');

  useEffect(() => {
    setLoading(true);
    getKrispReviewQueue(filter).then(r => {
      setRows(r.rows || []);
      setError(r.error || null);
    }).finally(() => setLoading(false));
  }, [filter]);

  const emptyMsg =
    filter === 'incomplete'
      ? 'Nothing incomplete — you\'re caught up, or switch the filter above.'
      : filter === 'all'
        ? 'No meetings stored yet.'
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
            const title = r.title || r.meeting_title || '—';
            const dur = formatDur(r.duration_seconds ? Number(r.duration_seconds) : null);
            return (
              <tr key={r.id} className="hover:bg-violet-50/40 transition-colors">
                <td className="px-4 py-3 font-mono text-gray-500">{r.id}</td>
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatBrisbane(r.webhook_received_at || r.created_at)}</td>
                <td className="px-4 py-3">
                  <span className="text-gray-900">{title}</span>
                  {dur && <span className="text-gray-400 ml-1 text-xs">({dur})</span>}
                </td>
                <td className="px-4 py-3"><Badge status={r.status || 'incomplete'} /></td>
                <td className="px-4 py-3 space-x-1">
                  {r.needs_split && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-800 bg-orange-100 border border-orange-200 rounded px-1.5 py-0.5">
                      Split needed
                    </span>
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
  const [speakers, setSpeakers] = useState<Record<string, SpeakerForm>>({});
  const [leadDisplay, setLeadDisplay] = useState<Record<string, { name: string; email: string }>>({});
  const [leadSearchEmail, setLeadSearchEmail] = useState('');
  const [leadSearchBusy, setLeadSearchBusy] = useState(false);
  const [leadSearchHit, setLeadSearchHit] = useState<{ id: string; name: string; email: string } | null>(null);
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
        const init: Record<string, SpeakerForm> = {};
        for (const label of (r.event.speaker_labels || [])) {
          const v = vs[label] || {};
          const roleRaw = String(v.role || 'unknown').toLowerCase();
          const role = ['coach', 'client', 'other', 'unknown'].includes(roleRaw) ? roleRaw : 'unknown';
          init[label] = {
            name: v.name || '',
            email: v.email || '',
            role,
            airtable_lead_id: v.airtable_lead_id || '',
          };
        }
        setSpeakers(init);
        setLeadDisplay(buildLeadDisplay(r.event));
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

  const handleSearchLead = async () => {
    const email = leadSearchEmail.trim().toLowerCase();
    if (!email.includes('@')) {
      flash('Enter a valid email');
      return;
    }
    setLeadSearchBusy(true);
    setLeadSearchHit(null);
    const r = await searchKrispLeadByEmail(email);
    setLeadSearchBusy(false);
    if (r.error) {
      flash(r.error || 'Search failed');
      return;
    }
    if (!r.lead?.id) {
      flash('No lead found for that email');
      return;
    }
    setLeadSearchHit({ id: r.lead.id, name: r.lead.name || email, email: r.lead.email || email });
  };

  const handleAddMeetingLead = async () => {
    if (!leadSearchHit) return;
    const r = await addKrispMeetingLead(eventId, leadSearchHit.id);
    if (r.ok) {
      setLeadDisplay((d) => ({
        ...d,
        [leadSearchHit.id]: { name: leadSearchHit.name, email: leadSearchHit.email },
      }));
      flash('Lead linked to meeting');
      setLeadSearchHit(null);
      setLeadSearchEmail('');
      load();
    } else flash('Error: ' + (r.error || 'unknown'));
  };

  const handleRemoveMeetingLead = async (leadId: string) => {
    if (!confirm('Remove this lead from the meeting?')) return;
    const r = await removeKrispMeetingLead(eventId, leadId);
    if (r.ok) {
      flash('Lead removed');
      load();
    } else flash('Error: ' + (r.error || 'unknown'));
  };

  if (loading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error || !ev) return <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-4">{error || 'Not found'}</p>;

  const coachHint = ev.coach_hint || { displayName: 'Coach', calendarEmail: '' };
  const meetingLeadRows: { airtable_lead_id: string }[] = ev.meeting_leads || [];

  const setSpeaker = (label: string, patch: Partial<SpeakerForm>) => {
    setSpeakers((s) => ({
      ...s,
      [label]: { name: '', email: '', role: 'unknown', airtable_lead_id: '', ...s[label], ...patch },
    }));
  };

  const pickCoach = (label: string) => {
    setSpeaker(label, {
      role: 'coach',
      name: coachHint.displayName || 'Coach',
      email: coachHint.calendarEmail || '',
      airtable_lead_id: '',
    });
  };

  const pickClientLead = (label: string, leadId: string) => {
    const d = leadDisplay[leadId] || { name: `Lead ${shortLeadId(leadId)}`, email: '' };
    setSpeaker(label, {
      role: 'client',
      airtable_lead_id: leadId,
      name: d.name,
      email: d.email,
    });
  };

  const pickOther = (label: string) => {
    setSpeaker(label, { role: 'other', airtable_lead_id: '' });
  };

  const labels: string[] = ev.speaker_labels || [];
  const calAttendees: { email: string; name: string }[] = ev.calendar_attendees || [];
  const st = normalizeReviewStatus(ev.status || 'incomplete');
  const fullText: string = ev.full_text || '';
  const verified = ev.verified_speakers || {};
  const speakerSamples: Record<string, string[]> = ev.speaker_samples || {};
  const lines = fullText.split('\n');

  const transcriptContent = lines.map((line: string, i: number) => {
    const parsed = parseTranscriptSpeakerLine(line);
    const lineNum = i + 1;
    const isSplitPoint = splitMode && splitLine === lineNum;
    const isAboveSplit = splitMode && splitLine != null && lineNum < splitLine;

    const aiGuess = aiResult?.speakerGuesses;
    let displayLabel = '';
    let rest = line;
    let showColon = true;

    if (parsed) {
      const label = parsed.label;
      const vName = verified[label]?.name;
      const aiName = aiGuess?.[label]?.likelyName;
      displayLabel = vName || aiName || label;
      rest = parsed.rest;
      const isPipe = /^(Speaker\s*\d+)\s*\|\s*/i.test(line);
      showColon = !isPipe;
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
          {parsed ? (
            <>
              <span className="font-semibold text-violet-800" title={parsed.label}>
                {showColon ? `${displayLabel}:` : `${displayLabel} | `}
              </span>
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
          {formatBrisbane(ev.webhook_received_at || ev.created_at)}
          {ev.duration ? ` · ${formatDur(ev.duration)}` : ''}
          {' · Meeting #'}{ev.id}{' · '}
          <Badge status={st} />
          {ev.start_line != null && (
            <span className="ml-2 text-xs text-gray-400">(lines {ev.start_line}–{ev.end_line})</span>
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
                          onClick={() => setSpeakers((s) => {
                            const cur = s[label] || { name: '', email: '', role: 'unknown', airtable_lead_id: '' };
                            return { ...s, [label]: { ...cur, name: String(info.likelyName || '') } };
                          })}
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

      {/* Meeting leads & speaker assignment */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-6">
        <div>
          <h3 className="font-semibold text-gray-900">Meeting leads</h3>
          <p className="text-xs text-gray-500 mt-1">
            Link every client on this call. Status stays <strong>Incomplete</strong> until there is at least one linked lead and every diarized speaker is assigned (coach, a linked lead, or other + name).
          </p>
        </div>
        {meetingLeadRows.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No leads linked yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
            {meetingLeadRows.map((ml: { airtable_lead_id?: string }) => {
              const id = String(ml.airtable_lead_id || '').trim();
              const disp = leadDisplay[id] || { name: `Lead ${shortLeadId(id)}`, email: '' };
              return (
                <li key={id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm bg-white">
                  <span className="min-w-0">
                    <span className="font-medium text-gray-900">{disp.name}</span>
                    {disp.email ? <span className="text-gray-500 ml-2">{disp.email}</span> : null}
                    <span className="text-[10px] font-mono text-gray-400 ml-2">{shortLeadId(id)}</span>
                  </span>
                  <button
                    type="button"
                    className="text-red-600 text-xs shrink-0 hover:underline"
                    onClick={() => handleRemoveMeetingLead(id)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
          <div className="flex-1 min-w-0">
            <label htmlFor="krisp-lead-search-email" className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Find lead by email</label>
            <input
              id="krisp-lead-search-email"
              type="email"
              value={leadSearchEmail}
              onChange={(e) => setLeadSearchEmail(e.target.value)}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
              placeholder="email@example.com"
            />
          </div>
          <button
            type="button"
            onClick={handleSearchLead}
            disabled={leadSearchBusy}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {leadSearchBusy ? 'Searching…' : 'Search'}
          </button>
        </div>
        {leadSearchHit && (
          <div className="flex flex-wrap items-center gap-3 text-sm bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            <span className="text-gray-800">{leadSearchHit.name} — {leadSearchHit.email}</span>
            <button type="button" onClick={handleAddMeetingLead} className="text-violet-700 font-semibold hover:underline">
              Add to meeting
            </button>
          </div>
        )}

        <hr className="border-gray-100" />

        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900">Speakers</h3>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing}
            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 shrink-0"
          >
            {analyzing ? 'Analyzing…' : '🤖 AI identify speakers'}
          </button>
        </div>
        {labels.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No speaker labels detected in transcript.</p>
        ) : (
          <div className="space-y-5">
            {labels.map((label) => {
              const row = speakers[label] || { name: '', email: '', role: 'unknown', airtable_lead_id: '' };
              const samples = speakerSamples[label] || [];
              return (
                <div key={label} className="border border-gray-100 rounded-xl p-4 bg-gray-50/50 space-y-3">
                  <div className="font-semibold text-gray-800">{label}</div>
                  {samples.length > 0 && (
                    <pre className="text-[11px] text-gray-600 bg-white border border-gray-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-sans leading-relaxed max-h-36 overflow-y-auto">
                      {samples.join('\n')}
                    </pre>
                  )}
                  <div className="flex flex-wrap gap-1.5 items-center text-xs">
                    <span className="text-gray-500 font-semibold uppercase tracking-wide mr-1">Quick</span>
                    <button
                      type="button"
                      onClick={() => pickCoach(label)}
                      className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded px-2 py-0.5 hover:bg-emerald-100"
                    >
                      Coach ({coachHint.displayName || 'Coach'})
                    </button>
                    {meetingLeadRows.map((ml: { airtable_lead_id?: string }) => {
                      const lid = String(ml.airtable_lead_id || '').trim();
                      const dn = leadDisplay[lid]?.name || `Lead ${shortLeadId(lid)}`;
                      return (
                        <button
                          key={lid}
                          type="button"
                          onClick={() => pickClientLead(label, lid)}
                          className="bg-violet-50 text-violet-800 border border-violet-200 rounded px-2 py-0.5 hover:bg-violet-100"
                        >
                          Client: {dn}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => pickOther(label)}
                      className="bg-amber-50 text-amber-900 border border-amber-200 rounded px-2 py-0.5 hover:bg-amber-100"
                    >
                      Other (name only)
                    </button>
                    {calAttendees.map((a) => (
                      <button
                        key={`${label}-${a.email}`}
                        type="button"
                        onClick={() => setSpeaker(label, { role: 'client', name: a.name || a.email, email: a.email, airtable_lead_id: '' })}
                        className="bg-slate-50 text-slate-700 border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-100"
                        title="Sets name/email; save to try CRM link by email"
                      >
                        Cal: {a.name || a.email}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <label className="text-xs text-gray-500 font-semibold uppercase">Role</label>
                      <select
                        value={row.role}
                        onChange={(e) => {
                          const role = e.target.value;
                          if (role === 'coach') pickCoach(label);
                          else if (role === 'other') pickOther(label);
                          else if (role === 'client') setSpeaker(label, { role: 'client' });
                          else setSpeaker(label, { role: 'unknown', airtable_lead_id: '' });
                        }}
                        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                      >
                        <option value="unknown">Unknown</option>
                        <option value="coach">Coach</option>
                        <option value="client">Client (linked lead)</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    {row.role === 'client' && (
                      <div>
                        <label className="text-xs text-gray-500 font-semibold uppercase">Linked lead</label>
                        <select
                          value={row.airtable_lead_id || ''}
                          onChange={(e) => {
                            const lid = e.target.value;
                            if (lid) pickClientLead(label, lid);
                            else setSpeaker(label, { role: 'client', airtable_lead_id: '' });
                          }}
                          className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                        >
                          <option value="">Select lead…</option>
                          {meetingLeadRows.map((ml: { airtable_lead_id?: string }) => {
                            const lid = String(ml.airtable_lead_id || '').trim();
                            const dn = leadDisplay[lid]?.name || `Lead ${shortLeadId(lid)}`;
                            return (
                              <option key={lid} value={lid}>{dn}</option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                    <div className={row.role === 'client' ? 'sm:col-span-2' : ''}>
                      <label className="text-xs text-gray-500 font-semibold uppercase">Display name</label>
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => setSpeaker(label, { name: e.target.value })}
                        placeholder={row.role === 'other' ? 'Name (required for Other)' : 'Name'}
                        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs text-gray-500 font-semibold uppercase">Email (optional)</label>
                      <input
                        type="email"
                        value={row.email}
                        onChange={(e) => setSpeaker(label, { email: e.target.value })}
                        placeholder="Used to match CRM on save"
                        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={handleSaveSpeakers}
              disabled={saving}
              className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-700 disabled:opacity-50"
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
        <p className="text-xs text-gray-500 mb-2">
          Saving speakers or leads recalculates <strong>Complete</strong> when rules are met. You can still set <strong>Skipped</strong> manually.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={st}
            onChange={e => handleStatus(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
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
                Defaults to <strong>Incomplete</strong> — meetings that still need linked leads and/or speaker assignment. Use the filter for complete or skipped.
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
