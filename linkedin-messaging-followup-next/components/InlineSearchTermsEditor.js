"use client";
import React, { useState, useEffect, useRef } from 'react';
import { updateLeadSearchTerms, getPopularSearchTerms } from '../services/api';

function Chip({ term, onRemove }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] mr-1 mb-1">
      {term}
      {onRemove && (
        <button
          type="button"
          className="ml-1 text-blue-500 hover:text-blue-700"
          onClick={onRemove}
          aria-label={`Remove term ${term}`}
        >×</button>
      )}
    </span>
  );
}

export default function InlineSearchTermsEditor({ lead, onUpdated, activateOnHover = true }) {
  const raw = lead['Search Terms'] || lead.searchTerms || '';
  const initial = raw.split(',').map(t => t.trim()).filter(Boolean);
  const [terms, setTerms] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [popular, setPopular] = useState([]);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);
  const MAX = 15;

  useEffect(() => { setTerms(initial); }, [raw]);

  useEffect(() => {
    if (editing && popular.length === 0) {
      getPopularSearchTerms({ limit: 60 }).then(setPopular).catch(()=>{});
    }
  }, [editing, popular.length]);

  useEffect(() => {
    if (!editing) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setEditing(false);
        setInput('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing]);

  const startEdit = (e) => { if (e) e.stopPropagation(); setEditing(true); };

  const commitServer = async (newTerms, prevTerms) => {
    const prevSet = new Set(prevTerms);
    const newSet = new Set(newTerms);
    const add = [...newSet].filter(t => !prevSet.has(t));
    const remove = [...prevSet].filter(t => !newSet.has(t));
    if (add.length === 0 && remove.length === 0) return;
    setSaving(true); // clear any previous error before attempting save
    setError('');
    try {
      const res = await updateLeadSearchTerms(lead.id || lead.recordId || lead['Profile Key'], { add, remove });
      // On success, ensure terms reflect server canonical tokens (if provided)
      const serverTokens = res?.tokens && Array.isArray(res.tokens) ? res.tokens : null;
      if (serverTokens) {
        setTerms(serverTokens);
      } else {
        setTerms(newTerms);
      }
      // Clear any previous error (stale 'Save failed')
      setError('');
      if (onUpdated) {
        const joined = res?.searchTerms || (serverTokens ? serverTokens.join(', ') : newTerms.join(', '));
        onUpdated(joined);
      }
    } catch (e) {
      // Provide a concise, user-friendly error; include server detail if present
      const detail = e?.response?.data?.error || e.message || '';
      setError(detail ? `Save failed: ${detail}` : 'Save failed');
      setTerms(prevTerms);
    } finally { setSaving(false); }
  };

  const removeTerm = (t) => {
    if (saving) return;
    const prev = terms;
    const next = terms.filter(x => x !== t);
    setTerms(next);
    commitServer(next, prev);
  };

  const addTerm = (t) => {
    if (!t) return;
    const norm = t.trim().toLowerCase();
    if (!norm) return;
    if (terms.includes(norm)) return;
    if (terms.length >= MAX) return;
    const prev = terms;
    const next = [...terms, norm];
    setTerms(next);
    commitServer(next, prev);
    setInput('');
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTerm(input);
    } else if (e.key === 'Backspace' && !input && terms.length && editing) {
      removeTerm(terms[terms.length - 1]);
    }
  };

  if (!editing) {
    const emptyState = !terms.length;
    return (
      <div
        className={`group relative ${emptyState ? 'text-gray-400' : ''}`}
        onMouseEnter={activateOnHover ? () => setEditing(true) : undefined}
        onClick={startEdit}
        onMouseDown={(e)=> e.stopPropagation()}
      >
        {emptyState ? (
          <span className="text-xs hover:text-blue-600">Add terms…</span>
        ) : (
          <div className="flex flex-wrap gap-1 max-w-[240px]">
            {terms.slice(0,3).map(t => <Chip key={t} term={t} />)}
            {terms.length>3 && <span className="text-[10px] text-gray-500">+{terms.length-3}</span>}
          </div>
        )}
        <span className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] bg-white border rounded px-1 py-0.5 shadow text-blue-600">Edit</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative z-30" onMouseDown={(e)=> e.stopPropagation()} onClick={(e)=> e.stopPropagation()}>
      <div className="p-2 border rounded bg-white shadow-xl w-64">
        <div className="flex flex-wrap mb-1">
          {terms.map(t => <Chip key={t} term={t} onRemove={() => removeTerm(t)} />)}
          {terms.length < MAX && (
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={terms.length? 'Add…' : 'Add search terms…'}
              className="flex-1 min-w-[60px] text-[11px] outline-none"
              autoFocus
            />
          )}
        </div>
        {terms.length >= MAX && <div className="text-[10px] text-orange-600 mb-1">Max {MAX} terms</div>}
        {popular.length>0 && (
          <div className="max-h-24 overflow-y-auto -m-1 p-1 border-t mt-1">
            <div className="text-[10px] uppercase text-gray-400 mb-1">Popular</div>
            <div className="flex flex-wrap gap-1">
              {popular.filter(t => !terms.includes(t)).slice(0,40).map(t => (
                <button
                  key={t}
                  onClick={() => addTerm(t)}
                  disabled={terms.length>=MAX || saving}
                  className="px-1.5 py-0.5 bg-green-50 hover:bg-green-100 border border-green-200 rounded text-[10px] text-green-700 disabled:opacity-50"
                >{t}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-between mt-2">
          <button className="text-[10px] text-gray-500 hover:text-gray-700" onClick={(e)=>{ e.stopPropagation(); setEditing(false); setInput(''); }}>Close</button>
          {saving && <span className="text-[10px] text-blue-500">Saving…</span>}
          {error && <span className="text-[10px] text-red-500">{error}</span>}
        </div>
      </div>
    </div>
  );
}
