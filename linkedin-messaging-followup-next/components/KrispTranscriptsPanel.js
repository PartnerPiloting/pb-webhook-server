'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getKrispTranscriptsForLead } from '../services/api';

/**
 * Krisp webhook rows linked to this Airtable lead (via participant email).
 * @param {{ leadId?: string|null, compact?: boolean, className?: string, wrapperId?: string }} props
 */
export default function KrispTranscriptsPanel({ leadId, compact = false, className = '', wrapperId }) {
  const [transcripts, setTranscripts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  const id = leadId != null ? String(leadId).trim() : '';

  useEffect(() => {
    if (!id) {
      setTranscripts([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getKrispTranscriptsForLead(id).then((result) => {
      if (cancelled) return;
      setTranscripts(result.transcripts || []);
      setError(result.error || null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const handleCopy = useCallback(async (fullText, rowKey) => {
    const text = fullText || '';
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(rowKey);
      setTimeout(() => setCopiedKey((k) => (k === rowKey ? null : k)), 2000);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedKey(rowKey);
        setTimeout(() => setCopiedKey((k) => (k === rowKey ? null : k)), 2000);
      } catch {
        /* ignore */
      }
    }
  }, []);

  if (!id) return null;

  const titleClass = compact ? 'text-sm font-semibold text-gray-900' : 'text-lg font-semibold text-gray-900';
  const peekMaxH = compact ? 'max-h-24' : 'max-h-32';

  return (
    <div id={wrapperId || undefined} className={`space-y-3 ${compact ? '' : 'border-t border-gray-100 pt-6'} ${className}`.trim()}>
      <div className={`flex items-center gap-2 ${compact ? 'border-b border-gray-200 pb-2' : 'border-b border-gray-200 pb-2'}`}>
        <h4 className={titleClass}>🎙️ Krisp transcripts</h4>
        {loading && <span className="text-xs text-gray-500">Loading…</span>}
      </div>
      {error && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      {!loading && !error && transcripts.length === 0 && (
        <p className={`text-gray-500 italic ${compact ? 'text-xs' : 'text-sm'}`}>
          No Krisp webhooks linked to this lead yet. Links appear when a saved Krisp payload includes this lead&apos;s email.
        </p>
      )}
      <ul className="space-y-3">
        {transcripts.map((row) => {
          const rowKey = String(row.event_id ?? row.krisp_id ?? row.received_at);
          const when = row.received_at
            ? new Date(row.received_at).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })
            : '—';
          const typeLabel = (row.type_label || 'Krisp').trim();
          const full = row.full_text || '';
          const peek = row.preview || (full ? `${full.slice(0, 500)}${full.length > 500 ? '…' : ''}` : '');
          return (
            <li
              key={rowKey}
              className={`rounded-lg border border-gray-200 bg-slate-50/80 space-y-2 ${compact ? 'p-3' : 'p-4'}`}
            >
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 min-w-0">
                  <span className="text-gray-500 shrink-0">{when}</span>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 bg-violet-100 border border-violet-200 rounded px-1.5 py-0.5 shrink-0"
                    title={row.event || typeLabel}
                  >
                    {typeLabel}
                  </span>
                  {row.krisp_id != null && row.krisp_id !== '' && (
                    <span className="text-xs text-gray-400 font-mono truncate">id {String(row.krisp_id)}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(full, rowKey)}
                  disabled={!full}
                  className="shrink-0 text-sm font-medium text-violet-700 hover:text-violet-900 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {copiedKey === rowKey ? 'Copied' : 'Copy for Claude'}
                </button>
              </div>
              {peek ? (
                <pre className={`text-xs text-gray-600 whitespace-pre-wrap break-words ${peekMaxH} overflow-y-auto bg-white/80 border border-gray-100 rounded p-2 font-sans`}>
                  {peek}
                </pre>
              ) : (
                <p className="text-xs text-gray-400">No extractable text in payload.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
