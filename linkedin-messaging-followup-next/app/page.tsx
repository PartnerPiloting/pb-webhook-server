"use client";
import React from "react";
import Layout from "../components/Layout";
import LeadSearchUpdate from "../components/LeadSearchUpdate";
import ErrorBoundary from "../components/ErrorBoundary";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function Home() {
  return (
    <ErrorBoundary>
      <Layout>
        <LeadSearchUpdate />
      </Layout>
    </ErrorBoundary>
  );
}
