"use client";
import React, { useState } from "react";
import Layout from "../../components/Layout";
import NewLeadForm from "../../components/NewLeadForm";
import PeopleYouveMet from "../../components/PeopleYouveMet";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function NewLeadsPage() {
  // "People you've met" -> pre-fill the form; bump refreshKey after a create so the list
  // drops anyone whose lead now exists (the server attaches their transcripts on create).
  const [prefill, setPrefill] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleAddPerson = (person: any) => {
    const nameParts = String(person.name || '').trim().split(/\s+/).filter(Boolean);
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : (nameParts[0] || '');
    setPrefill({
      firstName,
      lastName,
      email: person.email || '',
    });
    // Bring the form into view so the pre-fill is obvious
    if (typeof window !== 'undefined') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const handleLeadCreated = (newLead: any) => {
    console.log('New lead created:', newLead);
    setPrefill(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <div className="p-8">
            <PeopleYouveMet onAddPerson={handleAddPerson} refreshKey={refreshKey} />
            <NewLeadForm onLeadCreated={handleLeadCreated} initialValues={prefill} />
          </div>
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
