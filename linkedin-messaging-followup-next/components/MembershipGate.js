'use client';

/**
 * MembershipGate.js
 * 
 * Component that verifies user's membership status before granting access to portal
 * Checks for clientId parameter, validates membership, shows appropriate messages
 * 
 * User Journey:
 * 1. No clientId → Show "Need membership" message + link to benefits page
 * 2. Invalid clientId → Show "Unable to find record" message
 * 3. Not Active status → Show "Not yet active" message
 * 4. Expired membership → Show "Expired" message + renewal link
 * 5. Expiring soon → Show warning banner + grant access
 * 6. Active & valid → Grant access silently
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function MembershipGate({ children }) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [accessGranted, setAccessGranted] = useState(false);
  const [verificationData, setVerificationData] = useState(null);
  const [error, setError] = useState(null);

  // Get configuration from env vars (with defaults)
  const PORTAL_BENEFITS_URL = process.env.NEXT_PUBLIC_PORTAL_BENEFITS_URL || 'https://australiansidehustles.com.au/portal-benefits/';
  const RENEWAL_URL = process.env.NEXT_PUBLIC_RENEWAL_URL || 'https://australiansidehustles.com.au/renew-membership/';
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

  useEffect(() => {
    // Only run on client side, not during SSR/build
    if (typeof window !== 'undefined') {
      verifyAccess();
    }
  }, [searchParams]);

  async function verifyAccess() {
    try {
      setLoading(true);
      setError(null);

      // Check for clientId parameter (prefer clientId, fallback to testClient for backward compatibility)
      const clientId = searchParams.get('clientId') || searchParams.get('testClient');

      // Case 1: No clientId parameter
      if (!clientId) {
        console.log('MembershipGate: No clientId parameter found');
        setVerificationData({
          errorType: 'NO_CLIENT_ID',
          message: 'You need an active Australian Side Hustles membership to access this portal.',
          actionText: 'Learn About Membership Benefits',
          actionUrl: PORTAL_BENEFITS_URL
        });
        setAccessGranted(false);
        setLoading(false);
        return;
      }

      console.log(`MembershipGate: Verifying access for clientId: ${clientId}`);

      // Call backend verification API
      const response = await fetch(`${API_BASE_URL}/api/verify-client-access/${encodeURIComponent(clientId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // Case 2: Client not found (404)
        if (response.status === 404) {
          const data = await response.json();
          console.log('MembershipGate: Client not found');
          setVerificationData({
            errorType: 'CLIENT_NOT_FOUND',
            message: data.message || 'Unable to find your client record. Please let us know and we\'ll investigate.',
            actionText: 'Contact Support',
            actionUrl: 'https://australiansidehustles.com.au/contact/'
          });
          setAccessGranted(false);
          setLoading(false);
          return;
        }

        // Other errors
        throw new Error(`Verification failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('MembershipGate: Verification response:', data);

      // Case 3-5: Check access status
      if (!data.isAllowed) {
        let actionText = 'Learn More';
        let actionUrl = PORTAL_BENEFITS_URL;

        // Customize action based on error type
        if (data.errorType === 'EXPIRED') {
          actionText = 'Renew Membership';
          actionUrl = data.renewalUrl || RENEWAL_URL;
        } else if (data.errorType === 'NOT_ACTIVE') {
          actionText = 'Check Membership Status';
          actionUrl = PORTAL_BENEFITS_URL;
        }

        setVerificationData({
          errorType: data.errorType,
          message: data.message,
          actionText: actionText,
          actionUrl: actionUrl
        });
        setAccessGranted(false);
      } else {
        // Case 6: Access granted
        console.log('MembershipGate: Access granted');
        
        // Store verification data for optional warning banner
        if (data.expiryWarning) {
          setVerificationData({
            showWarning: true,
            message: data.message,
            daysUntilExpiry: data.daysUntilExpiry,
            renewalUrl: data.renewalUrl || RENEWAL_URL
          });
        }
        
        setAccessGranted(true);
      }

      setLoading(false);

    } catch (err) {
      console.error('MembershipGate: Verification error:', err);
      setError('Unable to verify your membership status. Please try again or contact support.');
      setAccessGranted(false);
      setLoading(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Verifying your membership...</p>
        </div>
      </div>
    );
  }

  // Error state (network/server errors)
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Error</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={verifyAccess}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Access denied states (no client, not found, not active, expired)
  if (!accessGranted && verificationData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-yellow-500 text-5xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Required</h1>
          <p className="text-gray-600 mb-6">{verificationData.message}</p>
          {verificationData.actionUrl && (
            <a
              href={verificationData.actionUrl}
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {verificationData.actionText}
            </a>
          )}
        </div>
      </div>
    );
  }

  // Access granted - render children with optional expiry warning
  return (
    <>
      {verificationData?.showWarning && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  {verificationData.message}
                </p>
              </div>
            </div>
            {verificationData.renewalUrl && (
              <div className="ml-3">
                <a
                  href={verificationData.renewalUrl}
                  className="text-sm font-medium text-yellow-700 hover:text-yellow-600 underline"
                >
                  Renew Now →
                </a>
              </div>
            )}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
