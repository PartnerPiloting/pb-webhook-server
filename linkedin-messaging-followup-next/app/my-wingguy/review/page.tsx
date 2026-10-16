import React from "react";
import { Metadata } from 'next';
import Layout from "../../../components/Layout";
import ErrorBoundary from "../../../components/ErrorBoundary";
import WingguyReview from "../../../components/WingguyReview";

// Standalone like /my-wingguy itself: opened from a private link, the ?token= (plus an optional
// &as=<name> for attribution) is the whole story. No Layout, no login.
//
// Server component on purpose (no "use client"): the tab title comes from metadata, so this tab
// reads "What's changed lately" instead of the portal's default in a crowded tab strip.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "Making it sound more like you",
  description: "Setting up is once. After that, every draft you fix teaches it - in a chat.",
};

export default function MyWingguyReviewPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <WingguyReview />
      </Layout>
    </ErrorBoundary>
  );
}
