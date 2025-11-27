"use client";
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getSearchTokenSuggestions } from '../services/api';

// Tokenizer with quoted phrase support
// Rules:
// - Split on commas/semicolons/newlines and whitespace, BUT keep text inside double quotes as one token
// - Lowercase, trim, strip surrounding quotes/parens/brackets, drop empties
// - Dedupe in insertion order, cap to 25, max token length 40
function tokenizeToCanonical(input) {
  if (!input || typeof input !== 'string') return [];
  
  // Normalize separators to make scanning easier
  const src = String(input).replace(/[;\n]/g, ',');

  const tokens = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue; // don't include the quote char itself
    }
    if (!inQuotes && (ch === ',' || /\s/.test(ch))) {
      // boundary
      const t = buf.trim();
      if (t) tokens.push(t);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const last = buf.trim();
  if (last) tokens.push(last);

  const cleaned = tokens
    .map(s => s.trim())
    .map(s => s.replace(/^["'()\[\]{}]+|["'()\[\]{}]+$/g, '')) // strip wrapping quotes/parens/brackets
    .map(s => s.replace(/^[\-_.]+|[\-_.]+$/g, '')) // strip leading/trailing punctuation
    .map(s => s.toLowerCase())
    .filter(Boolean)
    .filter(s => s.length <= 40);

  const seen = new Set();
  const out = [];
  for (const t of cleaned) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 25);
}

// Chip component (minimal styling relying on Tailwind present in app)
const Chip = ({ label, onRemove }) => (
  <span className="inline-flex items-center px-2 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded mr-2 mb-2">
    {label}
    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 text-blue-500 hover:text-blue-700"
        title="Remove"
      >
        ×
      </button>
    )}
  </span>
);

// Props:
// - initialTerms: string (the Long text field value)
// - onTermsChange: (termsString, canonicalTokensCsv) => void
// - placeholder?: string
// - disabled?: boolean
export default function SearchTermsField({ initialTerms, onTermsChange, placeholder = 'Type terms and press Enter or comma. Supports: AND, OR, NOT, ( ), "exact phrase"', disabled = false }) {
  const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';
  const debug = isDev && (typeof window !== 'undefined') && (window.localStorage?.DEBUG_SEARCH_TERMS === '1');
  const [inputValue, setInputValue] = useState('');
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSug, setLoadingSug] = useState(false);
  const [sugError, setSugError] = useState('');
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  // Initialize from initialTerms
  useEffect(() => {
    if (typeof initialTerms === 'string') {
      // Check if initialTerms looks like already processed canonical data
      // (lowercase tokens without quotes/special punctuation)
      const isCanonical = /^[a-z0-9\s,_-]*$/.test(initialTerms.trim()) && 
                         !initialTerms.includes('"') && 
                         !initialTerms.includes("'") &&
                         !initialTerms.includes('(') &&
                         !initialTerms.includes(')');
      
      if (isCanonical) {
        // Already canonical - split by commas or treat as single term
        const tokens = initialTerms.includes(',') 
          ? initialTerms.split(',').map(t => t.trim()).filter(Boolean)
          : [initialTerms.trim()].filter(Boolean);
        setSelectedTokens(tokens);
      } else {
        // Raw input - needs tokenization
        const tokens = tokenizeToCanonical(initialTerms);
        setSelectedTokens(tokens);
      }
    } else {
      setSelectedTokens([]);
    }
  }, [initialTerms]);

  // Recompute outputs on token change
  const outputs = useMemo(() => {
    const canonicalCsv = selectedTokens.join(', ');
    // Preserve the original terms format as a comma+space list for now
    const displayTerms = canonicalCsv;
    return { displayTerms, canonicalCsv };
  }, [selectedTokens]);

  useEffect(() => {
    if (onTermsChange) {
      onTermsChange(outputs.displayTerms, outputs.canonicalCsv);
      if (debug) {
        try { console.debug('[SearchTermsField] onTermsChange', { display: outputs.displayTerms, canonical: outputs.canonicalCsv }); } catch {}
      }
    }
  }, [outputs.displayTerms, outputs.canonicalCsv, onTermsChange]);

  const tryCommitInput = () => {
    if (!inputValue.trim()) return;
    const newTokens = tokenizeToCanonical(inputValue);
    if (newTokens.length === 0) {
      setInputValue('');
      return;
    }
    // merge with existing, dedupe, cap 25
    const mergedSet = new Set([...selectedTokens, ...newTokens]);
    const merged = Array.from(mergedSet).slice(0, 25);
    if (debug) { try { console.debug('[SearchTermsField] commit input', { inputValue, newTokens, merged }); } catch {} }
    setSelectedTokens(merged);
    setInputValue('');
  };  const removeToken = (t) => {
    setSelectedTokens(prev => prev.filter(x => x !== t));
  };

  // Load suggestions on mount and when showing all
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingSug(true);
        setSugError('');
        // Get more suggestions when showing all, fewer for initial load
        const limit = showAllSuggestions ? 200 : 30;
        const minCount = showAllSuggestions ? 1 : 1; // Show all terms when expanded
        const list = await getSearchTokenSuggestions({ limit, minCount });
        if (cancelled) return;
        setSuggestions(list);
      } catch (e) {
        if (cancelled) return;
        setSugError(''); // silent fail in UI; keep clean
      } finally {
        if (!cancelled) setLoadingSug(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showAllSuggestions]);

  const addSuggested = (token) => {
    if (disabled) return;
    if (!token) return;
    if (selectedTokens.includes(token)) return;
    if (selectedTokens.length >= 25) return; // cap
    
    const newTokens = [...selectedTokens, token];
    setSelectedTokens(newTokens);
    
    // Notify parent of the change
    const displayTerms = newTokens.join(', ');
    const canonicalCsv = newTokens.join(',');
    onTermsChange(displayTerms, canonicalCsv);
  };

  return (
    <div className="flex-1">
      {/* Boolean search help hint */}
      <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
        <span className="font-semibold">Boolean Search:</span>{' '}
        <span className="font-mono bg-white px-1 rounded">term1 term2</span> (both) •{' '}
        <span className="font-mono bg-white px-1 rounded">term1 OR term2</span> (either) •{' '}
        <span className="font-mono bg-white px-1 rounded">NOT term</span> (exclude) •{' '}
        <span className="font-mono bg-white px-1 rounded">"exact phrase"</span> •{' '}
        <span className="font-mono bg-white px-1 rounded">(group OR logic)</span>
      </div>
      
      <div className={`w-full px-3 py-2 border border-gray-300 rounded-md bg-white ${disabled ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap">
          {selectedTokens.map(t => (
            <Chip key={t} label={t} onRemove={disabled ? undefined : () => removeToken(t)} />
          ))}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => setShowAllSuggestions(true)}
            onBlur={() => {
              if (!disabled) tryCommitInput();
              // Delay hiding suggestions to allow clicks
              setTimeout(() => setShowAllSuggestions(false), 150);
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                tryCommitInput();
              } else if (e.key === 'Backspace' && !inputValue && selectedTokens.length > 0) {
                // backspace with empty input removes last token
                removeToken(selectedTokens[selectedTokens.length - 1]);
              }
            }}
            placeholder={placeholder}
            className="flex-1 min-w-[180px] outline-none text-sm py-1"
            disabled={disabled}
          />
        </div>
      </div>
      
      {/* Compressed suggestions - minimal vertical space */}
      {!loadingSug && suggestions && suggestions.length > 0 && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {showAllSuggestions ? 'Available terms' : 'Popular'}
              </span>
              {selectedTokens.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs text-purple-600">
                    {selectedTokens.length} selected: {selectedTokens.slice(0, 3).join(', ')}{selectedTokens.length > 3 ? '...' : ''}
                  </span>
                </div>
              )}
            </div>
            {!showAllSuggestions && suggestions.length > 20 && (
              <button
                type="button"
                onClick={() => setShowAllSuggestions(true)}
                className="text-xs text-blue-600 hover:text-blue-700"
                disabled={disabled}
              >
                all ({suggestions.length})
              </button>
            )}
          </div>
          <div className={`flex flex-wrap gap-1 ${showAllSuggestions ? 'max-h-32 overflow-y-auto' : ''}`}>
            {(showAllSuggestions ? suggestions : suggestions.slice(0, 20))
              .filter(s => !selectedTokens.includes(s.term || s.token)) // Support both 'term' and 'token' fields
              .map(s => (
              <button
                key={s.term || s.token}
                type="button"
                onClick={() => addSuggested(s.term || s.token)}
                disabled={disabled || selectedTokens.length >= 25}
                className="inline-flex items-center px-1.5 py-0.5 text-xs rounded border bg-green-50 text-green-700 border-green-200 hover:bg-green-100 disabled:opacity-50"
                title={typeof s.count === 'number' ? `Used in ${s.count} leads` : 'Click to add'}
              >
                {s.term || s.token}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Remove the manage modal */}
    </div>
  );
}
