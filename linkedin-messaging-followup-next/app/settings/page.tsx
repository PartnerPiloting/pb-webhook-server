"use client";
import React from "react";
import Layout from "../../components/Layout";
import Settings from "../../components/Settings";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function SettingsPage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <Settings />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
