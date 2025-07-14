"use client";
import React from "react";
import Layout from "../../components/Layout";
import TopScoringPosts from "../../components/TopScoringPosts";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function TopScoringPostsPage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <TopScoringPosts />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}
