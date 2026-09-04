"use client";
import React, { useState } from "react";
import Layout from "../../components/Layout";
import NewLeadForm from "../../components/NewLeadForm";
import PeopleYouveMet from "../../components/PeopleYouveMet";
import PossibleMatches from "../../components/PossibleMatches";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function NewLeadsPage() {
  // "People you've met": Add is one click inside that section (Guy, 2026-09-04) - the record is
  // created there and the server attaches the waiting transcripts on create. We only bump
  // refreshKey so "Possible matches" re-checks; the met list keeps the added row on screen itself
  // (it carries the LinkedIn box) until Done. The form below is a plain form again.
  const [refreshKey, setRefreshKey] = useState(0);

  const handleAdded = () => setRefreshKey((k) => k + 1);

  const handleLeadCreated = (newLead: any) => {
    console.log('New lead created:', newLead);
    setRefreshKey((k) => k + 1);
  };

  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <div className="p-8">
            <PossibleMatches refreshKey={refreshKey} />
            <PeopleYouveMet onAdded={handleAdded} refreshKey={refreshKey} />
            <NewLeadForm onLeadCreated={handleLeadCreated} initialValues={null} />
          </div>
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
