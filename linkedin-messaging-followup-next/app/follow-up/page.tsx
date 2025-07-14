"use client";
import React from "react";
import Layout from "../../components/Layout";
import FollowUpManager from "../../components/FollowUpManager";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function FollowUpPage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <FollowUpManager />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
