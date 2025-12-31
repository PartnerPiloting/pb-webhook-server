'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface ClientIdPromptProps {
  title?: string;
  description?: string;
}

export default function ClientIdPrompt({ 
  title = 'Enter Your Client Code',
  description = 'Please enter your client code to continue.'
}: ClientIdPromptProps) {
  const [clientCode, setClientCode] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const code = clientCode.trim();
    if (!code) {
      setError('Please enter your client code');
      return;
    }

    // Redirect to same page with client parameter (and testClient for legacy compatibility)
    const url = new URL(window.location.href);
    url.searchParams.set('client', code);
    url.searchParams.set('testClient', code);
    window.location.href = url.toString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white shadow-xl rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <svg 
              className="w-8 h-8 text-blue-600" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" 
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {title}
          </h1>
          <p className="text-gray-600">
            {description}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="clientCode" className="block text-sm font-medium text-gray-700 mb-1">
              Client Code
            </label>
            <input
              type="text"
              id="clientCode"
              value={clientCode}
              onChange={(e) => {
                setClientCode(e.target.value);
                setError('');
              }}
              placeholder="e.g., guy-wilson"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
              autoFocus
            />
            {error && (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Continue
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Don't have a client code?{' '}
          <a 
            href="https://australiansidehustles.com.au/contact/" 
            className="text-blue-600 hover:underline"
          >
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}
