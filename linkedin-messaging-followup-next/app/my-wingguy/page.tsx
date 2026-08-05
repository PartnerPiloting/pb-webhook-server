"use client";
import React from "react";
import ErrorBoundary from "../../components/ErrorBoundary";
import WingguySetup from "../../components/WingguySetup";

// Deliberately NOT wrapped in <Layout> or <EnvironmentValidator>: this page is opened from a
// private link by a client who has not signed in to anything. The ?token= in the URL is the whole
// authentication story, so the page must not depend on the logged-in portal shell.
export const dynamic = 'force-dynamic'

export default function MyWingguyPage() {
  return (
    <ErrorBoundary>
      <WingguySetup />
    </ErrorBoundary>
  );
}
