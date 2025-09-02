"use client";
import React, { useEffect, useState } from "react";
import { makeHttpDataSource, type Sort, type FilterState } from "@/src/lib/server-datasource";
const ds = makeHttpDataSource(); const DEFAULT_COLUMNS = ["name","company","title","email","phone","linkedinUrl","addressCity","status","stage","owner"];
export default function Page() {
  const [filters, setFilters] = useState<FilterState>({ includeAll: [], includeAny: [], exclude: [] });
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(0); const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const limit = 50;
  async function load() { const { rows, total } = await ds.list({ offset: page*limit, limit, sort, filters, select: DEFAULT_COLUMNS }); setRows(rows); setTotal(total); }
  useEffect(() => { load(); }, [filters, sort, page]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (<div style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
    <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Server-mode Table</h1>
    <div style={{ display:"flex", gap:8, marginBottom: 12 }}>
      <input placeholder="Type tokens…" onKeyDown={(e)=>{ if (e.key==="Enter"){ const v=(e.target as HTMLInputElement).value; const parts=v.split(/[,;\s]+/).filter(Boolean); const inc=[] as string[]; const any=[] as string[]; const exc=[] as string[]; for (const p of parts){ if (p.startsWith("-")) exc.push(p.slice(1)); else if (p.includes("|")) any.push(...p.split("|")); else inc.push(p); } setFilters({ includeAll: inc, includeAny: any, exclude: exc }); (e.target as HTMLInputElement).value=""; setPage(0);} }} style={{ flex:1, padding:"8px 10px", border:"1px solid #cfd4dc", borderRadius:8 }} />
      <button onClick={()=> setSort(s => ({ key: "name", dir: s.dir === "asc" ? "desc":"asc" }))}>Sort: Name {sort.dir}</button>
    </div>
    <div style={{ border:"1px solid #e7e9ee", borderRadius: 12, background: "#fff" }}>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr>{DEFAULT_COLUMNS.map(k => (<th key={k} style={{ textAlign: "left", borderBottom:"1px solid #e7e9ee", padding: 8 }}>{k}</th>))}</tr></thead>
        <tbody>{rows.map((r:any) => (<tr key={r.id}>{DEFAULT_COLUMNS.map(k => (<td key={k} style={{ borderBottom:"1px solid #f1f3f5", padding:8, fontSize:13 }}>{String(r[k] ?? "")}</td>))}</tr>))}</tbody>
      </table>
    </div>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
      <button disabled={page===0} onClick={()=> setPage(p => Math.max(0, p-1))}>Prev</button>
      <div style={{ fontSize: 12 }}>Page {page+1} / {totalPages}</div>
      <button disabled={page+1>=totalPages} onClick={()=> setPage(p => Math.min(totalPages-1, p+1))}>Next</button>
    </div>
  </div>);
}