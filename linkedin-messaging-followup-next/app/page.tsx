"use client";
import React from "react";
import Layout from "../components/Layout";
import LeadSearchUpdate from "../components/LeadSearchUpdate";
import ErrorBoundary from "../components/ErrorBoundary";

export default function Home() {
  return (
    <ErrorBoundary>
      <Layout>
        <LeadSearchUpdate />
      </Layout>
    </ErrorBoundary>
  );
}
