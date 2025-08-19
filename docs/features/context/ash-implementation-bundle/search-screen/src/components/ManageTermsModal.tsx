"use client";
import React, { useMemo, useState } from "react";
export type Term = { term: string; count?: number };
export default function ManageTermsModal({
  open, onClose, selected, potential, onChange
}: { open: boolean; onClose: ()=>void; selected: string[]; potential: Term[]; onChange: (tokens: string[])=>void; }) {
  const [query, setQuery] = useState(""); const [sel, setSel] = useState<string[]>(selected);
  const left = useMemo(()=>{ const q=query.toLowerCase().trim(); const s=new Set(sel); return potential.filter(t=>!s.has(t.term)).filter(t=>!q||t.term.includes(q)).slice(0,200); },[potential,sel,query]);
  function add(t: string){ if (!sel.includes(t)) setSel([...sel, t]); }
  function remove(t: string){ setSel(sel.filter(x => x !== t)); }
  if (!open) return null;
  return (<div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.35)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
    <div style={{ width:"min(1000px, 95vw)", maxHeight:"90vh", background:"#fff", borderRadius:12, overflow:"hidden", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:12, borderBottom:"1px solid #eee", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontWeight:600 }}>Manage Terms</div>
        <button onClick={onClose} style={{ padding:"6px 10px" }}>Close</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0, minHeight:360 }}>
        <div style={{ padding:12, borderRight:"1px solid #eee" }}>
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search potential terms…" style={{ width:"100%", padding:"8px 10px", border:"1px solid #cfd4dc", borderRadius:8 }} />
          <div style={{ marginTop:8, maxHeight:360, overflow:"auto", border:"1px solid #f1f3f5", borderRadius:8 }}>
            {left.map(t => (<div key={t.term} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderBottom:"1px solid #f7f7f7" }}>
              <div>{t.term} {t.count ? <span style={{ color:"#98a2b3" }}>({t.count})</span> : null}</div>
              <button onClick={()=>add(t.term)} style={{ padding:"4px 8px" }}>Add</button>
            </div>))}
          </div>
        </div>
        <div style={{ padding:12 }}>
          <div style={{ maxHeight:420, overflow:"auto", border:"1px solid #f1f3f5", borderRadius:8 }}>
            {sel.map(t => (<div key={t} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderBottom:"1px solid #f7f7f7" }}>
              <div>{t}</div><button onClick={()=>remove(t)} style={{ padding:"4px 8px" }}>Remove</button>
            </div>))}
          </div>
        </div>
      </div>
      <div style={{ padding:12, borderTop:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:12, color:"#667085" }}>Total: <b>{sel.length}</b></div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setSel([])} style={{ padding:"6px 10px" }}>Clear</button>
          <button onClick={()=>{ onChange(sel); onClose(); }} style={{ padding:"6px 10px" }}>Save</button>
        </div>
      </div>
    </div>
  </div>);
}