"use client";
import React, { useEffect, useRef, useState } from 'react';
import { updateLead } from '../services/api';

/**
 * Inline editable select/dropdown for constrained fields like status/priority.
 * Props:
 *  - lead: lead object (must contain id or Profile Key)
 *  - field: backend canonical frontend field name (e.g. 'status', 'priority')
 *  - value: initial value (string)
 *  - options: string[] allowed values
 *  - placeholder: text when empty
 *  - onUpdated: (newValue, leadId) => void
 *  - renderDisplay?: (value) => ReactNode optional custom renderer when not editing
 */
export default function InlineEditableSelect({
  lead,
  field,
  value: externalValue,
  options = [],
  placeholder = '—',
  onUpdated,
  renderDisplay,
}) {
  const leadId = lead?.id || lead?.recordId || lead?.['Profile Key'];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(externalValue || '');
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);
  const selectRef = useRef(null);

  // Keep internal in sync when external changes
  useEffect(() => { setValue(externalValue || ''); if (!editing) setDraft(externalValue || ''); }, [externalValue, editing]);

  // Click outside to cancel (no autosave to avoid accidental changes)
  useEffect(() => {
    if (!editing) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        cancel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  const start = (e) => { e?.stopPropagation(); setEditing(true); setTimeout(()=> selectRef.current?.focus(), 0); };
  const cancel = () => { setEditing(false); setDraft(value); setError(''); };

  const commit = async () => {
    const newVal = draft;
    if (newVal === value) { setEditing(false); return; }
    setSaving(true); setError('');
    try {
      await updateLead(leadId, { [field]: newVal });
      setValue(newVal);
      // Best-effort local mutation for immediate table reflect
      try {
        if (lead) {
          lead[field] = newVal;
          const capKey = field.charAt(0).toUpperCase() + field.slice(1);
          lead[capKey] = newVal;
          // Also update Airtable-like fields if present
          if (field === 'status') lead['Status'] = newVal;
          if (field === 'priority') lead['Priority'] = newVal;
        }
      } catch {}
      if (onUpdated) onUpdated(newVal, leadId);
      setEditing(false);
    } catch (e) {
      const detail = e?.response?.data?.message || e.message;
      setError(detail || 'Save failed');
      try { console.error('[InlineEditableSelect] commit error', detail); } catch {}
    } finally { setSaving(false); }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  // Ensure current value is present in options (avoid disappearing current custom value)
  const mergedOptions = React.useMemo(() => {
    const set = new Set(options.filter(Boolean).map((s) => String(s)));
    if (value && !set.has(String(value))) set.add(String(value));
    return Array.from(set);
  }, [options, value]);

  if (!editing) {
    return (
      <div className="group inline-flex items-center gap-1 min-w-[80px]" onClick={start} onMouseDown={(e)=> e.stopPropagation()}>
        {renderDisplay ? (
          renderDisplay(value)
        ) : value ? (
          <span className="text-xs">{value}</span>
        ) : (
          <span className="text-xs text-gray-400">{placeholder}</span>
        )}
        <span className="opacity-0 group-hover:opacity-100 text-[9px] text-blue-500">Edit</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative z-30 inline-flex items-start gap-1" onMouseDown={(e)=> e.stopPropagation()} onClick={(e)=> e.stopPropagation()}>
      <select
        ref={selectRef}
        value={draft}
        onChange={(e)=> { setDraft(e.target.value); if (error) setError(''); }}
        onKeyDown={handleKey}
        className="border px-1 py-0.5 rounded text-xs w-44 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none bg-white"
      >
        {/* Allow clearing by selecting empty option */}
        <option value="">—</option>
        {mergedOptions.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <div className="flex flex-col gap-0.5">
        <button onClick={commit} disabled={saving} className="text-[10px] px-1 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">{saving? '…' : 'Save'}</button>
        <button onClick={cancel} className="text-[10px] px-1 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">Cancel</button>
      </div>
      {error && <div className="absolute left-0 top-full mt-1 text-[10px] text-red-600 w-56 break-words">{error}</div>}
    </div>
  );
}
