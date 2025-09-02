"use client";
import React, { useMemo, useState } from "react";
import { detectFields, extractByFieldMap } from "../lib/field-detect";
type AnyRow = Record<string, any>; type Dir = "asc" | "desc";
export default function ResultsTable<T extends AnyRow>({ rows, allRows, columns, labels = {}, title = "Results" }:
  { rows: T[]; allRows?: T[]; columns: string[]; labels?: Record<string,string>; title?: string; }) {
  const detection = useMemo(() => detectFields((allRows?.length? allRows: rows) as any[]), [rows, allRows]);
  const fieldMap = detection.fieldMap || null;
  function getCell(row: AnyRow, key: string): string {
    if (key === "email" || key === "linkedin" || key === "phone") {
      if (!fieldMap) return ""; const ex = extractByFieldMap(row, fieldMap);
      return key === "email" ? (ex.email[0] || "") : key === "linkedin" ? (ex.linkedin[0] || "") : (ex.phone[0] || "");
    }
    const v = (row as any)[key]; if (v == null) return ""; if (typeof v === "object") return ""; return String(v);
  }
  function compare(a: string, b: string) { const na = parseFloat(a), nb = parseFloat(b); if (!isNaN(na)&&!isNaN(nb)) return na-nb; return a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" }); }
  const [sortKey, setSortKey] = useState<string>(columns[0] || ""); const [sortDir, setSortDir] = useState<Dir>("asc"); 
  const sorted = useMemo(()=>{ const arr=[...rows]; if(!sortKey) return arr; arr.sort((A,B)=>{ const a=getCell(A,sortKey); const b=getCell(B,sortKey); const cmp=compare(a,b); return sortDir==="asc"?cmp:-cmp; }); return arr; },[rows,sortKey,sortDir]);
  function toggle(k:string){ if (sortKey!==k){ setSortKey(k); setSortDir("asc"); } else { setSortDir(d=>d==="asc"?"desc":"asc"); } }
  function downloadCSV(){
    const escape=(s:string)=> s==null? "": (/[",\n]/.test(s)? `"${s.replace(/"/g,'""')}"`: s);
    const header=columns.map(k=>labels[k]||k).join(","); const lines=sorted.map(r=> columns.map(k=> escape(getCell(r,k))).join(","));
    const blob=new Blob([[header,...lines].join("\n")],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="leads.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  return (<div style={{ border:"1px solid #e7e9ee", borderRadius:12, padding:12, background:"#fff", marginTop:16 }}>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:8 }}>
      <h3 style={{ margin:0, fontSize:16 }}>{title}</h3>
      <button onClick={downloadCSV} style={{ padding:"6px 10px" }}>Download CSV</button>
    </div>
    <div style={{ overflow:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr>{columns.map(k=>(
          <th key={k} onClick={()=>toggle(k)} style={{ cursor:"pointer", textAlign:"left", borderBottom:"1px solid #e7e9ee", padding:8, whiteSpace:"nowrap" }}>
            {labels[k]||k}{sortKey===k? (sortDir==="asc"?" ▲":" ▼"):""}
          </th>
        ))}</tr></thead>
        <tbody>
          {sorted.map((r,i)=>(<tr key={(r as any).id ?? i}>
            {columns.map(k=>(<td key={k} style={{ borderBottom:"1px solid #f1f3f5", padding:8, fontSize:13, verticalAlign:"top" }}>{getCell(r,k)}</td>))}
          </tr>))}
          {sorted.length===0 && (<tr><td colSpan={columns.length} style={{ padding:12, color:"#98a2b3", textAlign:"center" }}>No rows</td></tr>)}
        </tbody>
      </table>
    </div>
    <div style={{ marginTop:8, fontSize:12, color:"#667085" }}>Rows: <b>{sorted.length}</b>{sortKey? <> · Sorted by <b>{labels[sortKey]||sortKey}</b> ({sortDir})</> : null}</div>
  </div>);
}