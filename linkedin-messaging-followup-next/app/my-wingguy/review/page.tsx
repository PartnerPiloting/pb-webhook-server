import React from "react";
import { Metadata } from 'next';
import ErrorBoundary from "../../../components/ErrorBoundary";
import WingguyReview from "../../../components/WingguyReview";

// Standalone like /my-wingguy itself: opened from a private link, the ?token= (plus an optional
// &as=<name> for attribution) is the whole story. No Layout, no login.
//
// Server component on purpose (no "use client"): the tab title comes from metadata, so this tab
// reads "What's changed lately" instead of the portal's default in a crowded tab strip.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "What's changed lately",
  description: "Every change to this Wingguy's instructions - who made it, before and after, with notes.",
};

export default function MyWingguyReviewPage() {
  return (
    <ErrorBoundary>
      <WingguyReview />
    </ErrorBoundary>
  );
}
