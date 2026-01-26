'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { initializeClient, getCurrentClientId, getCurrentPortalToken } from '../../utils/clientUtils';

// Lazy-load the Quick Update modal
const QuickUpdateModal = dynamic(() => import('../../components/QuickUpdateModal'), { ssr: false });

function QuickUpdateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [clientId, setClientId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const validateAccess = async () => {
      // Check for token (secure) or devKey (admin)
      // Check localStorage first (persists across tabs), then sessionStorage (legacy fallback)
      const token = searchParams.get('token') 
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('portalToken') : null)
        || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('portalToken') : null);
      const devKey = searchParams.get('devKey')
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('devKey') : null);
      
      // If no token or devKey, redirect to membership required page
      if (!token && !devKey) {
        router.push('/membership-required');
        return;
      }
      
      // Initialize client via backend authentication
      try {
        await initializeClient();
        const resolvedClientId = getCurrentClientId();
        if (resolvedClientId) {
          setClientId(resolvedClientId);
          setIsReady(true);
        } else {
          setAuthError('Unable to authenticate. Please use a valid portal link.');
        }
      } catch (error: unknown) {
        console.error('Quick Update: Auth failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
        if (errorMessage.includes('portal link has been updated') || errorMessage.includes('Invalid')) {
          setAuthError('Your portal link is invalid or has been updated. Please contact your coach.');
        } else {
          setAuthError(errorMessage);
        }
      }
    };
    
    validateAccess();
  }, [searchParams, router]);

  // Show error state
  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="text-red-500 text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Access Denied</h2>
          <p className="text-gray-600 mb-4">{authError}</p>
          <a href="/membership-required" className="text-blue-600 hover:underline">
            Learn more about access
          </a>
        </div>
      </div>
    );
  }

  // Loading state
  if (!isReady || !clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Build return URL with token preserved
  const portalToken = getCurrentPortalToken();
  const returnUrl = portalToken ? `/?token=${portalToken}` : '/';
  
  // Check for pre-selected lead from URL (by LinkedIn URL or legacy record ID)
  const initialLinkedInUrl = searchParams.get('linkedinUrl');
  const initialLeadId = searchParams.get('lead');

  // Render the Quick Update as a standalone page (not modal)
  return (
    <QuickUpdateModal
      isOpen={true}
      onClose={() => {
        window.location.href = returnUrl;
      }}
      clientId={clientId as unknown as null}
      standalone={true}
      initialLeadId={initialLeadId as unknown as undefined}
      initialLinkedInUrl={initialLinkedInUrl as unknown as undefined}
    />
  );
}

export default function QuickUpdatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading Quick Update...</div>
      </div>
    }>
      <QuickUpdateContent />
    </Suspense>
  );
}
