"use client";
import React from "react";
import Layout from "../../components/Layout";
import TopScoringPosts from "../../components/TopScoringPosts";
import ErrorBoundary from "../../components/ErrorBoundary";

export default function TopScoringPostsPage() {
  return (
    <ErrorBoundary>
      <Layout>
        <TopScoringPosts />
      </Layout>
    </ErrorBoundary>
  );
}
