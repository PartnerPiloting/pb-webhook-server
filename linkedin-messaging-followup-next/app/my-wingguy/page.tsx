import React from "react";
import { Metadata } from 'next';
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import WingguyHub from "../../components/WingguyHub";

// The front door behind the portal's "My Wingguy" tab. Inside the portal shell so the rest of the
// menu stays visible and this tab highlights - a client following a plain link gets the same
// thing, because the token in that link is portal auth.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "My Wingguy",
  description: "What Wingguy does, your instructions, and what has changed lately.",
};

export default function MyWingguyPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <WingguyHub />
      </Layout>
    </ErrorBoundary>
  );
}
