"use client";
import React, { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// LEGACY-DISABLED 2026-05-16: Top Scoring Posts retired (Apify cost).
// Any direct hit on /top-scoring-posts now redirects home (query params preserved).
// Original page preserved at the bottom of this file for resurrection.

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

// useSearchParams must be inside a Suspense boundary for the Next.js build.
function RedirectHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `/?${qs}` : "/");
  }, [router, searchParams]);
  return null;
}

export default function TopScoringPostsPage() {
  return (
    <Suspense fallback={null}>
      <RedirectHome />
    </Suspense>
  );
}

/* LEGACY ORIGINAL — to resurrect: delete the redirect component above and restore this:

import Layout from "../../components/Layout";
import TopScoringPosts from "../../components/TopScoringPosts";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";

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

*/
