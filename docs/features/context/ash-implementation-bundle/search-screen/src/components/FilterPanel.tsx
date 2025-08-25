"use client";
import React, { useMemo, useState } from "react";
import { normalizeTerms, type FilterState } from "../lib/filter-helpers";
type Suggestion = { term: string; count: number };
export default function FilterPanel<TLead extends { searchTerms?: string }>({
  leads, value, onChange, matchedCount = null, maxSuggestions = 8
}: { leads: TLead[]; value: FilterState; onChange: (s: FilterState) => void; matchedCount?: number | null; maxSuggestions?: number; }) {
  const [input, setInput] = useState("");
  const suggestions = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of leads) for (const p of normalizeTerms(lead.searchTerms || "")) map.set(p, (map.get(p) || 0) + 1);
    const arr: Suggestion[] = []; for (const [term, count] of map.entries()) arr.push({ term, count });
    arr.sort((a,b)=>b.count-a.count || a.term.localeCompare(b.term)); return arr.slice(0, maxSuggestions);
  }, [leads, maxSuggestions]);
  function addTokens(raw: string) {
    const tokens = normalizeTerms(raw); const next: FilterState = { includeAll: [...value.includeAll], includeAny: [...value.includeAny], exclude: [...value.exclude] };
    for (const tok of tokens) { if (!tok) continue; if (tok.includes("|")) tok.split("|").forEach(p=> next.includeAny.push(p));
      else if (tok.startsWith("-") && tok.length>1) next.exclude.push(tok.slice(1)); else next.includeAll.push(tok); }
    onChange(next);
  }
  return (<div style={{ border: "1px solid #e7e9ee", borderRadius: 10, padding: 8, background: "#fff" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <input
        style={{ flex: 1, padding: "10px 12px", border: "1px solid #cfd4dc", borderRadius: 10, outline: "none", fontSize: 14 }}
        placeholder="Filter (e.g., sydney product* -do-not-contact, product|partnerships)"
        value={input}
        onChange={(e)=>setInput(e.target.value)}
        onKeyDown={(e)=>{ if (e.key==="Enter"||e.key===","){ e.preventDefault(); if(input.trim()){ addTokens(input); setInput(""); }}}}
        onBlur={()=>{ if (input.trim()) { addTokens(input); setInput(""); } }}
      />
      {matchedCount !== null && <div style={{ fontSize: 12, color: "#667085" }}>Showing <b>{matchedCount}</b> leads</div>}
    </div>
    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
      {suggestions.map(s => <button key={s.term} onClick={()=>addTokens(s.term)} style={{ padding:"4px 8px", border:"1px solid #cfd4dc", borderRadius:999 }}>{s.term} ({s.count})</button>)}
    </div>
  </div>);
}