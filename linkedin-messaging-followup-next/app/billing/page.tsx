"use client";
import React from "react";
import Layout from "../../components/Layout";
import Billing from "../../components/Billing";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function BillingPage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <Billing />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
