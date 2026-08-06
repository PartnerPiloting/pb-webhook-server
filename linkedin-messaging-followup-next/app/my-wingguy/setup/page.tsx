import React from "react";
import { Metadata } from 'next';
import Layout from "../../../components/Layout";
import ErrorBoundary from "../../../components/ErrorBoundary";
import WingguySetup from "../../../components/WingguySetup";

// The fill-in-the-blanks half. Moved here from /my-wingguy when that became the hub - old client
// links to /my-wingguy still work, they just land on the front door instead of the form.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "Your Wingguy instructions",
  description: "The handful of things only you can tell it, and every instruction it follows.",
};

export default function WingguySetupPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <WingguySetup />
      </Layout>
    </ErrorBoundary>
  );
}
