"use client";
import { useState } from 'react';

export default function ClientCodeEntry({ onSubmit, error: initialError = null }) {
  const [clientCode, setClientCode] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState(initialError);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const code = clientCode.trim();
    if (!code) {
      setError('Please enter your client code');
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      // Validate the client code by calling the backend
      const response = await fetch(`/api/auth/test?clientId=${encodeURIComponent(code)}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success' && data.client?.status === 'Active') {
          // Valid and active - redirect with testClient param
          const url = new URL(window.location.href);
          url.searchParams.set('testClient', code);
          window.location.href = url.toString();
          return;
        } else if (data.client?.status !== 'Active') {
          setError('Your membership has expired. Please check with your coach.');
        } else {
          setError('Client code not found');
        }
      } else {
        setError('Client code not found');
      }
    } catch (err) {
      console.error('Client code validation error:', err);
      setError('Unable to validate client code. Please try again.');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-6">
          <div className="text-blue-600 mb-4">
            <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Required</h2>
          <p className="text-gray-600">
            Please enter your client code to access this area
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="clientCode" className="block text-sm font-medium text-gray-700 mb-1">
              Client Code
            </label>
            <input
              id="clientCode"
              type="text"
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
              placeholder="e.g., Guy-Wilson"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isChecking}
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isChecking}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isChecking ? 'Checking...' : 'Continue'}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Don't have a client code? Contact your Australian Side Hustles coach to get started.
          </p>
        </div>
      </div>
    </div>
  );
}
