"use client";
import React from "react";
import ErrorBoundary from "../../../components/ErrorBoundary";
import WingguyReview from "../../../components/WingguyReview";

// Standalone like /my-wingguy itself: opened from a private link, the ?token= (plus an optional
// &as=<name> for attribution) is the whole story. No Layout, no login.
export const dynamic = 'force-dynamic'

export default function MyWingguyReviewPage() {
  return (
    <ErrorBoundary>
      <WingguyReview />
    </ErrorBoundary>
  );
}
