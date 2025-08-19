"use client";
import React, { useMemo, useState } from "react";
import { CANONICAL_TOKENS, splitTokens, suggest, validateToken, canonicalize, MAX_TOKENS_PER_LEAD } from "../lib/tags";
export default function SearchTermsInput({ value = [], onChange, placeholder="Add tags…", suggestList, maxTokens = MAX_TOKENS_PER_LEAD }:{ value?: string[]; onChange?: (tokens: string[], invalid: string[]) => void; placeholder?: string; suggestList?: string[]; maxTokens?: number; }) {
  const [tokens, setTokens] = useState<string[]>(value); const [invalid, setInvalid] = useState<string[]>([]); const [input, setInput] = useState(""); const list = suggestList || CANONICAL_TOKENS;
  function addFromRaw(raw: string) { const parts = splitTokens(raw); const next = new Set(tokens); const bad: string[] = []; for (let p of parts) { const canon = canonicalize(p); const v = validateToken(canon); if (!v.valid) { bad.push(p); continue; } if (next.size < maxTokens) next.add(canon); } const out = Array.from(next); setTokens(out); setInvalid(bad); onChange?.(out, bad); }
  function remove(tok: string) { const out = tokens.filter(t => t !== tok); setTokens(out); onChange?.(out, invalid); }
  const suggestions = useMemo(() => suggest(input, 8), [input]);
  return (<div style={{ border: "1px solid #cfd4dc", borderRadius: 10, padding: 8, background: "#fff" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {tokens.map(t => (<span key={t} style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 8px", borderRadius:999, border:"1px solid #d0d7de", background:"#f6f8fa", fontSize:12 }}>{t}<button onClick={()=>remove(t)} style={{ border:"none", background:"transparent", cursor:"pointer", fontSize:12, color:"#555" }}>×</button></span>))}
      <input value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>{ if (e.key==="Enter" || e.key===",") { e.preventDefault(); if (input.trim()) { addFromRaw(input); setInput(""); } } if (e.key==="Backspace" && !input) { const out = tokens.slice(0,-1); setTokens(out); onChange?.(out, invalid); } }} placeholder={placeholder} style={{ flex:1, minWidth:160, border:"none", outline:"none", fontSize:14 }} />
    </div>
    {input && suggestions.length>0 && (<div style={{ marginTop: 8, display:"flex", flexWrap:"wrap", gap:6 }}>{suggestions.map(s => (<button key={s} onClick={()=>{ addFromRaw(s); setInput(""); }} style={{ padding:"4px 8px", borderRadius:999, border:"1px solid #cfd4dc", background:"#fff", fontSize:12 }}>{s}</button>))}</div>)}
    {invalid.length>0 && (<div style={{ marginTop: 6, color:"#b42318", fontSize:12 }}>Ignored invalid: {invalid.join(", ")}</div>)}
    <div style={{ marginTop: 6, color:"#667085", fontSize:12 }}>Max {maxTokens} tags. Allowed: lowercase letters, numbers, hyphens, optional <code>namespace:token</code>.</div>
  </div>);
}