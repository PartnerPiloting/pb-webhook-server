"use client";
import React, { useMemo, useState } from "react";
import FilterPanel from "../../src/components/FilterPanel";
import ResultsTable from "../../src/components/ResultsTable";
import BulkCopyLite from "../../src/components/BulkCopyLite";
import { indexLead, filterLeadsByState, type FilterState } from "../../src/lib/filter-helpers";
type Lead = { id: string; name: string; company?: string; title?: string; searchTerms?: string; email?: string; phone?: string; linkedin?: string; addressCity?: string; status?: string; stage?: string; owner?: string };
function makeLeads(): Lead[] {
  const cities = ["Sydney","Melbourne","Brisbane","Perth","Adelaide"]; const roles = ["Product","Engineer","Partnerships","Marketing","Data"]; const companies = ["Acme","BetaWorks","CoreOne","Delta","Evergreen"]; const arr: Lead[] = []; let id = 1;
  function pick<T>(list: T[]) { return list[Math.floor(Math.random()*list.length)]; }
  for (let i=0;i<800;i++){ const city = pick(cities), role = pick(roles);
    arr.push({ id: String(id++), name: `Lead ${i+1}`, company: Math.random()<0.8? pick(companies): undefined, title: Math.random()<0.8? role: undefined, searchTerms: `${city.toLowerCase()}, ${role.toLowerCase()}${Math.random()<0.15? ", do-not-contact": ""}`, email: Math.random()<0.7? `lead${i+1}@example.com`: undefined, linkedin: Math.random()<0.6? `https://www.linkedin.com/in/lead-${i+1}`: undefined, phone: Math.random()<0.5? `+61 4${Math.floor(10000000 + Math.random()*8999999)}`: undefined, addressCity: city, status: Math.random()<0.95? (Math.random()<0.5? "Active":"Dormant"): undefined, stage: Math.random()<0.9? (Math.random()<0.5? "Qualified":"Proposal"): undefined, owner: Math.random()<0.8? "Guy": undefined, });
  } return arr;
}
export default function Page() {
  const leads = useMemo(()=> makeLeads(), []); const indexed = useMemo(()=> leads.map(indexLead), [leads]);
  const [state, setState] = useState<FilterState>({ includeAll: [], includeAny: [], exclude: [] });
  const visible = useMemo(()=> filterLeadsByState(indexed, state), [indexed, state]);
  const columns = ["name","company","title","email","phone","linkedin","addressCity","status","stage","owner"]; const labels = { email: "Email", phone: "Phone", linkedin: "LinkedIn", addressCity: "City" };
  return (<div style={{ maxWidth: 1200, margin: "24px auto", padding: 16 }}>
    <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Lead Search</h1>
    <FilterPanel leads={leads} value={state} onChange={setState} matchedCount={visible.length} />
    <ResultsTable rows={visible} allRows={leads} columns={columns} labels={labels} title="Filtered Leads" />
    <BulkCopyLite leads={visible} allLeads={leads} />
  </div>);
}