"use client";
import React, { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Layout from "../components/Layout";
import LeadSearchUpdate from "../components/LeadSearchUpdate";
import ErrorBoundary from "../components/ErrorBoundary";
import EnvironmentValidator from "../components/EnvironmentValidator";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  useEffect(() => {
    // Check for clientId or testClient parameter
    const clientId = searchParams.get('clientId') || searchParams.get('testClient');
    
    // If no client ID, redirect to membership required page
    if (!clientId) {
      router.push('/membership-required');
    }
  }, [searchParams, router]);
  
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <LeadSearchUpdate />
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
