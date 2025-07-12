// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

"use client";
import React from "react";
import Layout from "../../components/Layout";
import NewLeads from "../../components/NewLeads";
import ErrorBoundary from "../../components/ErrorBoundary";

export default function NewLeadsPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <NewLeads />
      </Layout>
    </ErrorBoundary>
  );
}
