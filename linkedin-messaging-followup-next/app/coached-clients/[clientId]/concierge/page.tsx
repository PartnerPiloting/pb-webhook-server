"use client";
import React from "react";
import Layout from "../../../../components/Layout";
import ConciergeSheet from "../../../../components/ConciergeSheet";
import ErrorBoundary from "../../../../components/ErrorBoundary";
import EnvironmentValidator from "../../../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

/**
 * The concierge run sheet for one client - the coach drives the whole onboarding over remote
 * access in one sitting, and this page hands them every link and line to paste, minted live
 * from the client's record. See components/ConciergeSheet.js.
 */
export default function ConciergePage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <ConciergeSheet />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
