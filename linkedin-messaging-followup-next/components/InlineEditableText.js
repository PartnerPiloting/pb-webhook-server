"use client";
import React, { useState, useEffect, useRef } from 'react';
import { updateLead } from '../services/api';

/**
 * Generic single-line inline editable text field for a lead.
 * Props:
 *  - lead: lead object (must contain id or Profile Key)
 *  - field: backend canonical frontend field name (e.g. 'email', 'phone')
 *  - value: initial display value
 *  - placeholder: placeholder when empty
 *  - type: 'text' | 'email' | 'tel'
 *  - validate: (val) => string | null  returns error message or null if ok
 *  - formatOnBlur: optional (val)=>val  for phone normalization
 *  - onUpdated: callback(newValue, leadId)
 */
export default function InlineEditableText({
  lead,
  field,
  value: externalValue,
  placeholder = '—',
  type = 'text',
  validate,
  formatOnBlur,
  onUpdated,
  maxLength = 140,
  autoSaveOnBlur = true,
}) {
  const leadId = lead?.id || lead?.recordId || lead?.['Profile Key'];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(externalValue || '');
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => { setValue(externalValue || ''); if (!editing) setDraft(externalValue || ''); }, [externalValue, editing]);

  useEffect(() => {
    if (!editing) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (autoSaveOnBlur && draft.trim() !== value.trim()) {
          commit();
        } else {
          cancel();
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing, draft, value, autoSaveOnBlur]);

  const start = (e) => { e?.stopPropagation(); setEditing(true); setTimeout(()=> inputRef.current?.focus(), 0); };
  const cancel = () => { setEditing(false); setDraft(value); setError(''); };

  const commit = async () => {
    try { console.debug('[InlineEditableText] commit start', { field, draft, value, leadId }); } catch {}
    let newVal = draft.trim();
    if (formatOnBlur) {
      try { newVal = formatOnBlur(newVal); } catch { /* ignore */ }
    }
    if (newVal === value) { setEditing(false); return; }
    if (validate) {
      const msg = validate(newVal);
      if (msg) { setError(msg); return; }
    }
    setSaving(true); setError('');
    try {
      await updateLead(leadId, { [field]: newVal });
      setValue(newVal);
      try { console.debug('[InlineEditableText] commit success', { field, newVal }); } catch {}
      // Mutate lead object for immediate parent visibility (best-effort)
      try {
        if (lead) {
          lead[field] = newVal;
          // Also update common capitalized form if present (e.g., 'Email', 'Phone')
          const capKey = field.charAt(0).toUpperCase() + field.slice(1);
            lead[capKey] = newVal;
        }
      } catch {}
      if (onUpdated) onUpdated(newVal, leadId);
      setEditing(false);
    } catch (e) {
      const detail = e?.response?.data?.message || e.message;
      setError(detail || 'Save failed');
      try { console.error('[InlineEditableText] commit error', detail); } catch {}
    } finally { setSaving(false); }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  if (!editing) {
    return (
      <div className="group min-w-[80px]" onClick={start} onMouseDown={(e)=> e.stopPropagation()}>
        {value ? (
          <span className="text-xs break-all">{value}</span>
        ) : (
          <span className="text-xs text-gray-400">{placeholder}</span>
        )}
        <span className="ml-1 opacity-0 group-hover:opacity-100 text-[9px] text-blue-500">Edit</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative z-30" onMouseDown={(e)=> e.stopPropagation()} onClick={(e)=> e.stopPropagation()}>
      <div className="flex items-start gap-1">
        <input
          ref={inputRef}
          type={type}
          value={draft}
          maxLength={maxLength}
          onChange={(e)=> { setDraft(e.target.value); if (error) setError(''); }}
          onKeyDown={handleKey}
          className="border px-1 py-0.5 rounded text-xs w-40 focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none"
          placeholder={placeholder}
          autoFocus
        />
        <div className="flex flex-col gap-0.5">
          <button onClick={commit} disabled={saving} className="text-[10px] px-1 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">{saving? '…' : 'Save'}</button>
          <button onClick={cancel} className="text-[10px] px-1 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">Cancel</button>
        </div>
      </div>
      {error && <div className="text-[10px] text-red-600 mt-0.5 w-56 break-words">{error}</div>}
    </div>
  );
}

// Simple built-in validators for convenience
export const validators = {
  email: (val) => {
    if (!val) return null; // allow clearing
    // Basic RFC5322-lite pattern
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return re.test(val) ? null : 'Invalid email format';
  },
  phone: (val) => {
    if (!val) return null;
    // Allow digits, space, +, -, parentheses
    const cleaned = val.replace(/[^0-9+]/g, '');
    if (cleaned.replace(/\D/g,'').length < 7) return 'Too short';
    if (cleaned.length > 20) return 'Too long';
    return null;
  }
};

export const formatters = {
  phone: (val) => {
    if (!val) return '';
    // Normalize multiple spaces/dashes, keep leading + if any
    let trimmed = val.trim();
    // Remove spaces and dashes, keep + and digits
    const plus = trimmed.startsWith('+');
    const digits = trimmed.replace(/[^0-9]/g,'');
    return plus ? '+' + digits : digits;
  }
};
