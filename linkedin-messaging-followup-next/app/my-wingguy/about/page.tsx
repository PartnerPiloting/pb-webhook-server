import React from "react";
import { Metadata } from 'next';
import Layout from "../../../components/Layout";
import ErrorBoundary from "../../../components/ErrorBoundary";
import WingguyAbout from "../../../components/WingguyAbout";

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "What Wingguy does",
  description: "A day of it, moment by moment - what you say, and what it does.",
};

export default function WingguyAboutPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <WingguyAbout />
      </Layout>
    </ErrorBoundary>
  );
}
