"use client";
import React, { useMemo, useState } from "react";
import { detectFields, extractByFieldMap } from "../lib/field-detect";
export default function BulkCopyLite({ leads, allLeads, title="Bulk Copy" }:{ leads: any[]; allLeads?: any[]; title?: string; }){
  const detection = useMemo(()=> detectFields((allLeads?.length? allLeads: leads) as any[]), [leads, allLeads]);
  const fm = detection.fieldMap || {};
  const [type, setType] = useState<"email"|"linkedin"|"phone">("email");
  const items = useMemo(()=>{
    const vals = new Set<string>();
    for (const lead of leads) {
      const ex = extractByFieldMap(lead, fm);
      const arr = type==="email"? ex.email: type==="linkedin"? ex.linkedin: ex.phone;
      for (const v of arr) vals.add(v);
    }
    return Array.from(vals);
  }, [leads, fm, type]);
  function copyAll(){ navigator.clipboard.writeText(items.join(", ")); alert(`Copied ${items.length} ${type}(s)`); }
  return (<div style={{ border:"1px solid #e7e9ee", borderRadius:12, padding:12, background:"#fff", marginTop:12 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"space-between" }}>
      <h3 style={{ margin:0, fontSize:16 }}>{title}</h3>
      <select value={type} onChange={e=> setType(e.target.value as any)}>
        <option value="email">Emails</option>
        <option value="linkedin">LinkedIn</option>
        <option value="phone">Phone</option>
      </select>
    </div>
    <div style={{ marginTop:8, fontSize:12, color:"#667085" }}>Items: <b>{items.length}</b></div>
    <div style={{ marginTop:8, maxHeight:160, overflow:"auto", border:"1px solid #f1f3f5", borderRadius:8, padding:8, background:"#fafbfc" }}>
      <pre style={{ margin:0, whiteSpace:"pre-wrap", wordBreak:"break-word", fontSize:12 }}>{items.join(", ")}</pre>
    </div>
    <button onClick={copyAll} style={{ marginTop:8, padding:"6px 10px" }}>Copy all</button>
  </div>);
}