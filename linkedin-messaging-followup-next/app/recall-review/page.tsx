'use client';

import React, { useState, useEffect, Suspense, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Layout from '../../components/Layout';
import {
  getRecallReviewQueue,
  getRecallReviewEvent,
  saveRecallSpeakers,
  updateRecallStatus,
  searchRecallLeadByEmail,
  addRecallMeetingLead,
  removeRecallMeetingLead,
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

const SPEAKER_COLOURS = [
  { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-200', highlight: 'bg-violet-50' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', highlight: 'bg-emerald-50' },
  { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-200', highlight: 'bg-sky-50' },
  { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', highlight: 'bg-amber-50' },
  { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', highlight: 'bg-rose-50' },
  { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-200', highlight: 'bg-teal-50' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200', highlight: 'bg-indigo-50' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800', border: 'border-fuchsia-200', highlight: 'bg-fuchsia-50' },
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

type SpeakerForm = { name: string; email: string; role: string; airtable_lead_id: string };

function parseTranscriptSpeakerLine(line: string): { label: string; rest: string } | null {
  const mPipe = line.match(/^(Speaker\s*\d+)\s*\|\s*/i);
  if (mPipe) return { label: mPipe[1].replace(/\s+/g, ' ').trim(), rest: line.slice(mPipe[0].length) };
  const mColon = line.match(/^(Speaker\s*\d+)\s*:\s/i);
  if (mColon) return { label: mColon[1].replace(/\s+/g, ' ').trim(), rest: line.slice(mColon[0].length) };
  const mPartPipe = line.match(/^(Participant\s*\d+)\s*\|\s*/i);
  if (mPartPipe) return { label: mPartPipe[1].replace(/\s+/g, ' ').trim(), rest: line.slice(mPartPipe[0].length) };
  const mName = line.match(/^([^:]{1,40}):\s/);
  if (mName) {
    const label = mName[1].trim();
    if (!label || label.startsWith('{') || label.startsWith('[')) return null;
    return { label, rest: line.slice(mName[0].length) };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

function QueueView({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('incomplete');
  const [titleQ, setTitleQ] = useState('');
  const [debouncedTitleQ, setDebouncedTitleQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTitleQ(titleQ.trim()), 400);
    return () => clearTimeout(t);
  }, [titleQ]);

  useEffect(() => {
    setLoading(true);
    getRecallReviewQueue(filter, debouncedTitleQ).then(r => {
      setRows(r.rows || []);
      setError(r.error || null);
    }).finally(() => setLoading(false));
  }, [filter, debouncedTitleQ]);

  const emptyMsg =
    debouncedTitleQ
      ? 'No meetings match this title for the current filter.'
      : filter === 'incomplete'
        ? 'Nothing incomplete — try "Complete" or "Everything".'
        : filter === 'all'
          ? 'No meetings stored yet.'
          : 'No rows match this filter.';

  if (loading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error) return <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-4">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <label htmlFor="recall-queue-filter" className="text-sm font-medium text-gray-700 shrink-0">Show</label>
          <select
            id="recall-queue-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm max-w-md focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
          >
            {QUEUE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3 max-w-xl">
          <div className="flex-1 min-w-0">
            <label htmlFor="recall-queue-title" className="text-sm font-medium text-gray-700">Search title</label>
            <input
              id="recall-queue-title"
              type="search"
              value={titleQ}
              onChange={(e) => setTitleQ(e.target.value)}
              placeholder="e.g. Dean"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
            />
          </div>
        </div>
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
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatBrisbane(r.webhook_received_at || r.updated_at || r.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="text-gray-900">{title}</span>
                      {dur && <span className="text-gray-400 ml-1 text-xs">({dur})</span>}
                    </td>
                    <td className="px-4 py-3"><Badge status={r.status || 'incomplete'} /></td>
                    <td className="px-4 py-3 space-x-1">
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

/* ------------------------------------------------------------------ */
/* Speaker Card (sidebar)                                              */
/* ------------------------------------------------------------------ */

function SpeakerCard({
  label,
  form,
  colour,
  coachHint,
  leadDisplay,
  onUpdate,
  onMatchAirtable,
  matchBusy,
  highlightedLabel,
  onHighlight,
  onUnlink,
}: {
  label: string;
  form: SpeakerForm;
  colour: typeof SPEAKER_COLOURS[0];
  coachHint: { displayName: string; calendarEmail: string };
  leadDisplay: Record<string, { name: string; email: string }>;
  onUpdate: (patch: Partial<SpeakerForm>) => void;
  onMatchAirtable: (label: string, query: string) => void;
  matchBusy: boolean;
  highlightedLabel: string | null;
  onHighlight: (label: string | null) => void;
  onUnlink: (label: string, leadId: string) => void;
}) {
  const isCoach = form.role === 'coach';
  const isLead = form.role === 'client';
  const isOther = form.role === 'other';
  const isLinked = isLead && !!form.airtable_lead_id;
  const isActive = highlightedLabel === label;

  if (isCoach) {
    return (
      <div
        className={`rounded-lg border p-3 transition-all ${colour.border} ${isActive ? colour.bg : 'bg-white'} ring-2 ring-green-300`}
        onMouseEnter={() => onHighlight(label)}
        onMouseLeave={() => onHighlight(null)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-block w-3 h-3 rounded-full shrink-0 ${colour.bg} ${colour.border} border`} />
            <span className="font-semibold text-sm text-gray-900 truncate">{form.name || coachHint.displayName || 'Coach'}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Coach</span>
          </div>
          <span className="text-green-600 text-sm shrink-0" title="Coach confirmed">&#10003;</span>
        </div>
      </div>
    );
  }

  if (isLinked) {
    const linkedName = leadDisplay[form.airtable_lead_id]?.name || form.name || label;
    return (
      <div
        className={`rounded-lg border p-3 transition-all ${colour.border} ${isActive ? colour.bg : 'bg-white'} ring-2 ring-green-300`}
        onMouseEnter={() => onHighlight(label)}
        onMouseLeave={() => onHighlight(null)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-block w-3 h-3 rounded-full shrink-0 ${colour.bg} ${colour.border} border`} />
            <span className="font-semibold text-sm text-gray-900 truncate">{linkedName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">Lead</span>
          </div>
          <span className="text-green-600 text-sm shrink-0" title="Lead linked">&#10003;</span>
        </div>
        <button
          type="button"
          onClick={() => onUnlink(label, form.airtable_lead_id)}
          className="text-[10px] text-gray-400 hover:text-red-500 mt-1"
        >
          Unlink
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${colour.border} ${isActive ? colour.bg : 'bg-white'}`}
      onMouseEnter={() => onHighlight(label)}
      onMouseLeave={() => onHighlight(null)}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-3 h-3 rounded-full shrink-0 ${colour.bg} ${colour.border} border`} />
          <span className="font-semibold text-sm text-gray-900 truncate">{form.name || label}</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">not matched</span>
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Role</label>
          <div className="flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onUpdate({ role: 'client' })}
              className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                isLead ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-purple-50'
              }`}
            >
              Lead
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ role: 'other', airtable_lead_id: '' })}
              className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors ${
                isOther ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Other
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Speaker name"
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
          />
        </div>

        {isLead && (
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Find lead</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={form.email}
                onChange={(e) => onUpdate({ email: e.target.value })}
                placeholder="Enter email or LinkedIn URL"
                className="flex-1 min-w-0 text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
              {form.email && form.email.trim().length >= 3 && (
                <button
                  type="button"
                  onClick={() => onMatchAirtable(label, form.email)}
                  disabled={matchBusy}
                  className="text-xs px-3 py-1 rounded-md bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50 shrink-0"
                >
                  {matchBusy ? '…' : 'Search'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Event Review (two-column: transcript + sidebar)                     */
/* ------------------------------------------------------------------ */

function EventReview({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const [ev, setEv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<Record<string, SpeakerForm>>({});
  const [leadDisplay, setLeadDisplay] = useState<Record<string, { name: string; email: string }>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [highlightedLabel, setHighlightedLabel] = useState<string | null>(null);
  const [matchBusyLabel, setMatchBusyLabel] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [speakersDirty, setSpeakersDirty] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  function buildLeadDisplayMap(event: any): Record<string, { name: string; email: string }> {
    const map: Record<string, { name: string; email: string }> = {};
    for (const ml of event.meeting_leads || []) {
      const id = String(ml.airtable_lead_id || '').trim();
      if (!id) continue;
      map[id] = { name: `Lead ${shortLeadId(id)}`, email: '' };
    }
    for (const p of event.participants || []) {
      const id = String(p.airtable_lead_id || '').trim();
      if (!id) continue;
      const name = String(p.verified_name || '').trim();
      const email = String(p.verified_email || '').trim();
      if (name || email) {
        map[id] = { name: name || map[id]?.name || `Lead ${shortLeadId(id)}`, email: email || map[id]?.email || '' };
      }
    }
    for (const v of Object.values(event.verified_speakers || {}) as any[]) {
      if (!v || typeof v !== 'object') continue;
      const id = String(v.airtable_lead_id || '').trim();
      if (!id) continue;
      const name = String(v.name || '').trim();
      const email = String(v.email || '').trim();
      if (name || email) {
        map[id] = { name: name || map[id]?.name || `Lead ${shortLeadId(id)}`, email: email || map[id]?.email || '' };
      }
    }
    return map;
  }

  const load = useCallback(() => {
    setLoading(true);
    getRecallReviewEvent(eventId).then(r => {
      if (r.event) {
        const event = r.event;
        setEv(event);
        const vs = event.verified_speakers || {};
        const coachHint = event.coach_hint || { displayName: 'Coach', calendarEmail: '' };
        const init: Record<string, SpeakerForm> = {};
        for (const label of (event.speaker_labels || [])) {
          const v = vs[label] || {};
          const roleRaw = String(v.role || 'unknown').toLowerCase();

          let role = ['coach', 'client', 'other', 'unknown'].includes(roleRaw) ? roleRaw : 'unknown';
          let name = v.name || '';
          let email = v.email || '';

          if (role === 'unknown' && coachHint.displayName) {
            const lcLabel = label.toLowerCase();
            const lcName = name.toLowerCase();
            const lcCoach = coachHint.displayName.toLowerCase();
            const coachFirst = lcCoach.split(/\s+/)[0];
            if (lcLabel.includes(lcCoach) || lcCoach.includes(lcLabel)
                || (coachFirst.length >= 3 && (lcName.includes(coachFirst) || lcLabel.includes(coachFirst)))) {
              role = 'coach';
              name = name || coachHint.displayName;
              email = email || coachHint.calendarEmail || '';
            }
          }

          if (role === 'unknown' && v.airtable_lead_id) {
            role = 'client';
          }
          if (role === 'unknown' && name && name.length >= 2) {
            role = 'client';
          }

          init[label] = { name, email, role, airtable_lead_id: v.airtable_lead_id || '' };
        }
        setSpeakers(init);
        setLeadDisplay(buildLeadDisplayMap(event));

        const allAutoDetected = Object.values(init).every(s => s.role !== 'unknown');
        const anyUnsaved = Object.values(init).some(s => {
          const existing = vs[Object.keys(init).find(k => init[k] === s) || ''] || {};
          return s.role !== (existing.role || 'unknown') || s.name !== (existing.name || '');
        });
        if (allAutoDetected && anyUnsaved && Object.keys(init).length > 0) {
          saveRecallSpeakers(eventId, init).then(sr => {
            if (sr.ok) setLeadDisplay(buildLeadDisplayMap({ ...event, verified_speakers: init }));
          });
        }
      }
      setError(r.error || null);
    }).finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleSaveSpeakers = async () => {
    setSaving(true);
    const r = await saveRecallSpeakers(eventId, speakers);
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
    if (!st || !EDITABLE_STATUSES.includes(st as (typeof EDITABLE_STATUSES)[number])) return;
    const r = await updateRecallStatus(eventId, st);
    if (r.ok) { flash('Status updated'); load(); } else flash('Error: ' + (r.error || 'unknown'));
  };

  const handleMatchAirtable = async (label: string, query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 3) { flash('Enter an email or LinkedIn URL'); return; }
    setMatchBusyLabel(label);
    const isLinkedIn = trimmed.includes('linkedin.com/');
    const r = isLinkedIn
      ? await searchRecallLeadByEmail('', trimmed)
      : await searchRecallLeadByEmail(trimmed);
    setMatchBusyLabel(null);
    if (r.error) { flash(r.error); return; }
    if (!r.lead?.id) { flash('No lead found for ' + trimmed); return; }
    const addR = await addRecallMeetingLead(eventId, r.lead.id);
    if (!addR.ok && !addR.error?.includes('already')) { flash('Error linking: ' + (addR.error || 'unknown')); return; }
    setLeadDisplay(d => ({ ...d, [r.lead.id]: { name: r.lead.name || trimmed, email: r.lead.email || trimmed } }));
    setSpeakers(s => ({
      ...s,
      [label]: { ...s[label], role: 'client', airtable_lead_id: r.lead.id, name: r.lead.name || s[label]?.name || '', email: r.lead.email || '' },
    }));
    setSpeakersDirty(true);
    flash(`Matched: ${r.lead.name || trimmed}`);
    load();
  };

  const handleUnlinkSpeaker = async (label: string, leadId: string) => {
    const r = await removeRecallMeetingLead(eventId, leadId);
    if (r.ok) {
      setSpeakers(s => ({
        ...s,
        [label]: { ...s[label], airtable_lead_id: '' },
      }));
      setSpeakersDirty(true);
      flash('Lead unlinked');
      load();
    } else {
      flash('Error: ' + (r.error || 'unknown'));
    }
  };

  if (loading) return <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>;
  if (error || !ev) return <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-4">{error || 'Not found'}</p>;

  const coachHint = ev.coach_hint || { displayName: 'Coach', calendarEmail: '' };
  const labels: string[] = ev.speaker_labels || [];
  const st = normalizeReviewStatus(ev.status || 'incomplete');
  const fullText: string = ev.full_text || '';
  const lines = fullText.split('\n');

  const labelColourMap: Record<string, typeof SPEAKER_COLOURS[0]> = {};
  labels.forEach((lab, i) => { labelColourMap[lab] = SPEAKER_COLOURS[i % SPEAKER_COLOURS.length]; });

  const setSpeaker = (label: string, patch: Partial<SpeakerForm>) => {
    setSpeakers(s => ({
      ...s,
      [label]: { name: '', email: '', role: 'unknown', airtable_lead_id: '', ...s[label], ...patch },
    }));
    setSpeakersDirty(true);
  };

  const confirmedCount = labels.filter(lab => {
    const f = speakers[lab];
    return f && f.role !== 'unknown' && (f.role === 'coach' || f.role === 'other' || (f.role === 'client' && f.airtable_lead_id));
  }).length;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-violet-700 hover:underline">&larr; Back to queue</button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{ev.title}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {formatBrisbane(ev.webhook_received_at || ev.created_at)}
            {ev.duration ? ` · ${formatDur(ev.duration)}` : ''}
            {' · #'}{ev.id}{' · '}
            <Badge status={st} />
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={st}
            onChange={e => handleStatus(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            {EDITABLE_STATUSES.map(k => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
          </select>
          <button
            onClick={() => { if (confirm('Skip this transcript?')) handleStatus('skipped'); }}
            className="text-xs text-red-600 hover:text-red-800 hover:underline"
          >
            Skip
          </button>
          <button
            onClick={() => setShowHelp(h => !h)}
            className="text-xs px-2 py-1 bg-violet-50 text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-100 font-semibold"
          >
            ?
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-gray-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-violet-900">How to review a transcript</span>
            <button onClick={() => setShowHelp(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
          <ul className="list-disc pl-5 space-y-1.5 text-gray-700">
            <li><strong>Status dropdown</strong> — Change between Incomplete, Complete, Verified, etc.</li>
            <li><strong>Skip</strong> — Marks this meeting as not worth reviewing (test call, junk, etc.).</li>
            <li><strong>Copy</strong> — Copies the full transcript text to your clipboard.</li>
            <li><strong>Speakers</strong> — The system auto-detects speakers. Coach (you) is always confirmed. Leads found in Airtable are auto-linked with a green tick.</li>
            <li><strong>Not matched</strong> — If a speaker isn&apos;t found automatically, enter their email or LinkedIn URL and click Search to find and link them.</li>
            <li><strong>Lead / Other</strong> — Mark a speaker as a Lead (someone you&apos;re coaching or selling to) or Other (anyone else).</li>
            <li><strong>Unlink</strong> — If a lead was linked incorrectly, click Unlink to remove the connection.</li>
            <li><strong>Save changes</strong> — Only appears when you&apos;ve made changes that need saving.</li>
          </ul>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left: transcript */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Transcript</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const plain = lines.map(l => {
                      const p = parseTranscriptSpeakerLine(l);
                      if (p) return `${speakers[p.label]?.name || p.label}: ${p.rest}`;
                      return l;
                    }).join('\n');
                    navigator.clipboard.writeText(plain).then(() => {
                      setCopyFeedback(true);
                      setTimeout(() => setCopyFeedback(false), 1500);
                    });
                  }}
                  className="text-xs px-3 py-1 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100"
                >
                  {copyFeedback ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div
              ref={transcriptRef}
              className="overflow-y-auto text-sm text-gray-700 leading-relaxed font-sans px-4 py-3"
              style={{ maxHeight: 'calc(100vh - 260px)' }}
            >
              {lines.map((line, i) => {
                const parsed = parseTranscriptSpeakerLine(line);
                const isHighlighted = parsed && highlightedLabel && parsed.label === highlightedLabel;
                const speakerColour = parsed ? labelColourMap[parsed.label] : null;

                if (!line.trim()) return <div key={i} className="h-2" />;

                return (
                  <div
                    key={i}
                    className={`group flex items-start gap-2 py-0.5 rounded transition-colors ${
                      isHighlighted ? (speakerColour?.highlight || 'bg-yellow-50') : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      {parsed ? (
                        <>
                          <span
                            className={`inline-block text-xs font-bold px-1.5 py-0.5 rounded mr-1.5 ${speakerColour ? `${speakerColour.bg} ${speakerColour.text}` : 'bg-gray-100 text-gray-700'}`}
                          >
                            {speakers[parsed.label]?.name || parsed.label}
                          </span>
                          <span className="text-gray-700">{parsed.rest}</span>
                        </>
                      ) : (
                        <span className="text-gray-500">{line}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: speaker sidebar */}
        <div className="w-full lg:w-80 shrink-0">
          <div className="lg:sticky lg:top-4 space-y-3">
            {/* Speaker cards */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  Speakers
                  {confirmedCount < labels.length && (
                    <span className="text-xs text-amber-500 font-normal ml-2">{labels.length - confirmedCount} need{labels.length - confirmedCount === 1 ? 's' : ''} review</span>
                  )}
                </h3>
              </div>

              {labels.length === 0 ? (
                <p className="text-xs text-gray-500">No speakers found in the transcript.</p>
              ) : (
                <div className="space-y-2">
                  {labels.map(label => (
                    <SpeakerCard
                      key={label}
                      label={label}
                      form={speakers[label] || { name: '', email: '', role: 'unknown', airtable_lead_id: '' }}
                      colour={labelColourMap[label]}
                      coachHint={coachHint}
                      leadDisplay={leadDisplay}
                      onUpdate={(patch) => setSpeaker(label, patch)}
                      onMatchAirtable={handleMatchAirtable}
                      matchBusy={matchBusyLabel === label}
                      highlightedLabel={highlightedLabel}
                      onHighlight={setHighlightedLabel}
                      onUnlink={handleUnlinkSpeaker}
                    />
                  ))}
                </div>
              )}

              {speakersDirty && (
                <button
                  type="button"
                  onClick={() => { handleSaveSpeakers(); setSpeakersDirty(false); }}
                  disabled={saving}
                  className="w-full px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Per-lead segments */}
      {(ev.lead_segments || []).length > 0 && (
        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-5 space-y-3">
          <h3 className="text-base font-semibold text-gray-900">Per-lead segments</h3>
          <p className="text-xs text-gray-500">
            Utterances for each lead, scoped to when they were in the meeting (join/leave). If no join/leave data, all of that speaker's lines are shown.
          </p>
          <div className="space-y-4">
            {(ev.lead_segments as any[]).map((seg: any) => {
              const disp = leadDisplay[seg.airtable_lead_id] || { name: `Lead ${shortLeadId(seg.airtable_lead_id)}`, email: '' };
              return (
                <div key={seg.airtable_lead_id} className="border border-gray-100 rounded-lg p-3 bg-emerald-50/40">
                  <p className="text-sm font-medium text-gray-900">{disp.name}</p>
                  <pre className="mt-2 text-xs text-gray-700 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto bg-white border border-gray-100 rounded p-2">
                    {seg.text?.trim() ? seg.text : '(No lines in this window yet)'}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function RecallReviewContent() {
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
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6">
        {!selectedId ? (
          <>
            <div className="mb-5">
              <h1 className="text-2xl font-bold text-gray-900">Transcript review</h1>
              <p className="text-sm text-gray-500 mt-1">
                Review meeting transcripts. Confirm who each speaker is, link leads, then mark complete.
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

export default function RecallReviewPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-gray-500">Loading…</div>}>
      <RecallReviewContent />
    </Suspense>
  );
}
