import React from "react";
import { Metadata } from 'next';
import ErrorBoundary from "../../components/ErrorBoundary";
import WingguySetup from "../../components/WingguySetup";

// Deliberately NOT wrapped in <Layout> or <EnvironmentValidator>: this page is opened from a
// private link by a client who has not signed in to anything. The ?token= in the URL is the whole
// authentication story, so the page must not depend on the logged-in portal shell.
//
// Server component on purpose (no "use client"): the tab title has to come from metadata, and
// with four portal tabs open, four identical rocket titles means opening the wrong one.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "Your Wingguy setup",
  description: "Fill in the blanks, teach it your voice, and see every instruction it follows.",
};

export default function MyWingguyPage() {
  return (
    <ErrorBoundary>
      <WingguySetup />
    </ErrorBoundary>
  );
}
