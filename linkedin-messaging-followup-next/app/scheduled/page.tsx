"use client";
import React from "react";
import Layout from "../../components/Layout";
import ScheduledEmails from "../../components/ScheduledEmails";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function ScheduledPage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <ScheduledEmails />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
