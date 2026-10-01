import React from "react";
import { Metadata } from 'next';
import Layout from "../../../components/Layout";
import ErrorBoundary from "../../../components/ErrorBoundary";
import WingguyInstall from "../../../components/WingguyInstall";

// The "Install the extension" door in the My Wingguy hub. A client gets the extension - and every
// later version - from here, by clicking a button and following a few plain steps. See
// WingguyInstall for why this lane exists (it is the one antivirus never objects to).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "Install the extension",
  description: "Get the Wingguy browser extension, and keep it up to date, in a couple of minutes.",
};

export default function WingguyInstallPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <WingguyInstall />
      </Layout>
    </ErrorBoundary>
  );
}
