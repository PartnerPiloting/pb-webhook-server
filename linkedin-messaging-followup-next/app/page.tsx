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
      // Check for token (secure), client, clientId, or testClient (legacy) parameter
      // Priority: URL params > localStorage (persists across tabs/sessions) > sessionStorage (legacy)
      const token = searchParams.get('token') 
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('portalToken') : null)
        || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('portalToken') : null);
      const clientId = searchParams.get('client') || searchParams.get('clientId') || searchParams.get('testClient')
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('clientCode') : null);
      const devKey = searchParams.get('devKey')
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('devKey') : null);
      
      // If no token or client ID, show error (don't redirect - stay on page with message)
      if (!token && !clientId) {
        setValidationError('No active session. Please use your portal access link to log in.');
        setIsValidating(false);
        return;
      }
      
      // If token is present, let the Layout/clientUtils handle authentication
      // Just allow access - the auth will be validated by the backend
      if (token) {
        setIsValidating(false);
        return;
      }
      
      // Validate the clientId with the backend API (legacy flow - will be blocked by backend)
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
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-100">
              <svg className="h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-gray-900">Session Expired</h3>
            <p className="mt-2 text-gray-600">{validationError}</p>
            <p className="mt-4 text-sm text-gray-500">
              Check your email for your portal access link, or contact your coach.
            </p>
            <div className="mt-6 space-y-3">
              <a
                href="https://australiansidehustles.com.au/contact/"
                className="block w-full px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Contact Support
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
