"use client";
import React from "react";
import Layout from "../../components/Layout";
import FollowUpManager from "../../components/FollowUpManager";
import ErrorBoundary from "../../components/ErrorBoundary";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function FollowUpPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <FollowUpManager />
      </Layout>
    </ErrorBoundary>
  );
}
