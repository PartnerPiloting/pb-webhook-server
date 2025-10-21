"use client";
import React, { useEffect, useState, Suspense } from "react";
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
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  
  useEffect(() => {
    const validateAccess = async () => {
      // Check for clientId or testClient parameter
      const clientId = searchParams.get('clientId') || searchParams.get('testClient');
      
      // If no client ID, redirect to membership required page
      if (!clientId) {
        router.push('/membership-required');
        return;
      }
      
      // Validate the clientId with the backend API
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://pb-webhook-server-staging.onrender.com';
        const response = await fetch(`${backendUrl}/api/verify-client-access/${clientId}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            setValidationError(`Client "${clientId}" not found. Please check your client ID.`);
          } else {
            const data = await response.json();
            setValidationError(data.error || 'Unable to verify client access');
          }
          setIsValidating(false);
          return;
        }
        
        const data = await response.json();
        
        // Check if access is allowed
        if (!data.isAllowed) {
          setValidationError(data.message || 'Access not allowed');
          setIsValidating(false);
          return;
        }
        
        // All good, allow access
        setIsValidating(false);
      } catch (error) {
        console.error('Error validating client access:', error);
        setValidationError('Unable to connect to server. Please try again.');
        setIsValidating(false);
      }
    };
    
    validateAccess();
  }, [searchParams, router]);
  
  // Show loading state while validating
  if (isValidating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verifying access...</p>
        </div>
      </div>
    );
  }
  
  // Show error if validation failed
  if (validationError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-medium text-gray-900">Access Denied</h3>
            <p className="mt-2 text-sm text-gray-600">{validationError}</p>
            <div className="mt-6">
              <a
                href="/membership-required"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                Learn More
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
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
