"use client";
import React, { useState, useEffect, useMemo } from 'react';

// Simple tokenizer to produce canonical tokens from a freeform terms string
// Rules:
// - split on commas/semicolons and whitespace
// - lowercase, trim, drop empty
// - strip surrounding quotes and common punctuation
// - dedupe, keep insertion order
function tokenizeToCanonical(input) {
  if (!input || typeof input !== 'string') return [];
  const rawPieces = input
    .split(/[,;\n]+/g) // first split on commas/semicolons/newlines
    .flatMap(part => part.split(/\s+/g)); // then split on whitespace

  const cleaned = rawPieces
    .map(s => (s || '').trim())
    .map(s => s.replace(/^['"()\[\]{}]+|['"()\[\]{}]+$/g, '')) // strip wrapping quotes/parens/brackets
    .map(s => s.replace(/^[-_.]+|[-_.]+$/g, '')) // strip leading/trailing punctuation
    .map(s => s.toLowerCase())
    .filter(Boolean)
    .filter(s => s.length <= 40); // light cap to avoid junk tokens

  const seen = new Set();
  const out = [];
  for (const t of cleaned) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 25); // cap at 25 canonical tokens
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
export default function SearchTermsField({ initialTerms, onTermsChange, placeholder = 'Type terms and press Enter or comma…', disabled = false }) {
  const [inputValue, setInputValue] = useState('');
  const [selectedTokens, setSelectedTokens] = useState([]);

  // Initialize from initialTerms
  useEffect(() => {
    if (typeof initialTerms === 'string') {
      const tokens = tokenizeToCanonical(initialTerms);
      setSelectedTokens(tokens);
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
    }
  }, [outputs, onTermsChange]);

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
    setSelectedTokens(merged);
    setInputValue('');
  };

  const removeToken = (t) => {
    setSelectedTokens(prev => prev.filter(x => x !== t));
  };

  return (
    <div className="flex-1">
      <div className={`w-full px-3 py-2 border border-gray-300 rounded-md bg-white ${disabled ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap">
          {selectedTokens.map(t => (
            <Chip key={t} label={t} onRemove={disabled ? undefined : () => removeToken(t)} />
          ))}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
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
        <div className="mt-2 text-xs text-gray-500 flex justify-between">
          <span>{selectedTokens.length}/25 terms</span>
          <span>Case-insensitive • Duplicates removed • Stored as canonical tokens</span>
        </div>
      </div>
    </div>
  );
}
