"use client";
import React from "react";
import Layout from "../../components/Layout";
import NewLeadForm from "../../components/NewLeadForm";
import ErrorBoundary from "../../components/ErrorBoundary";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function NewLeadsPage() {
  const handleLeadCreated = (newLead) => {
    // Optional: Add any specific actions after lead creation
    console.log('New lead created:', newLead);
  };

  return (
    <ErrorBoundary>
      <Layout>
        <div className="p-8">
          <NewLeadForm onLeadCreated={handleLeadCreated} />
        </div>
      </Layout>
    </ErrorBoundary>
  );
}
