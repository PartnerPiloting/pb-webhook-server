'use client';

import React, { useState } from 'react';
import { Loader2, Key, Copy, CheckCircle, RefreshCw, Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

// Detect backend URL from current hostname
function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '';
    if (/^(localhost|127\.0\.0\.1)$/i.test(host)) {
      return 'http://localhost:3001';
    }
    if (/staging/i.test(host)) {
      return 'https://pb-webhook-server-staging.onrender.com';
    }
  }
  return 'https://pb-webhook-server.onrender.com';
}

interface TokenResult {
  clientId: string;
  clientName: string;
  token: string;
  portalUrl: string;
  status: string;
}

export default function PortalTokensPage() {
  const [adminKey, setAdminKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TokenResult[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  
  // For single client regeneration
  const [singleClientId, setSingleClientId] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [singleResult, setSingleResult] = useState<TokenResult | null>(null);

  const portalBaseUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/billing`
    : 'https://pb-webhook-server-six.vercel.app/billing';

  const generateAllTokens = async () => {
    if (!adminKey) {
      setError('Please enter your admin key');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch(`${getBackendUrl()}/admin/generate-portal-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          debugKey: adminKey,
          baseUrl: portalBaseUrl
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to generate tokens');
      }

      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message || 'Failed to generate tokens');
    } finally {
      setIsLoading(false);
    }
  };

  const regenerateSingleToken = async () => {
    if (!adminKey) {
      setError('Please enter your admin key');
      return;
    }
    if (!singleClientId.trim()) {
      setError('Please enter a Client ID');
      return;
    }

    setIsRegenerating(true);
    setError(null);
    setSingleResult(null);

    try {
      const response = await fetch(`${getBackendUrl()}/admin/generate-portal-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          debugKey: adminKey,
          clientId: singleClientId.trim(),
          force: true,
          baseUrl: portalBaseUrl
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to regenerate token');
      }

      if (data.results && data.results.length > 0) {
        setSingleResult(data.results[0]);
      } else {
        throw new Error('Client not found or no token generated');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate token');
    } finally {
      setIsRegenerating(false);
    }
  };

  const copyToClipboard = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link href="/owner-dashboard" className="text-blue-600 hover:text-blue-800 flex items-center gap-2 mb-4">
            <ArrowLeft size={16} />
            Back to Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <Shield className="text-green-600" size={32} />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Portal Token Management</h1>
              <p className="text-gray-600">Generate secure billing portal links for clients</p>
            </div>
          </div>
        </div>

        {/* Admin Key Input */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Admin Key (required for all operations)
          </label>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Enter your admin key..."
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            ❌ {error}
          </div>
        )}

        {/* Regenerate Single Client Token */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-amber-800 flex items-center gap-2 mb-2">
            <RefreshCw size={20} />
            Regenerate Single Client Token
          </h2>
          <p className="text-amber-700 text-sm mb-4">
            Use this if a client needs a new secure link (lost it, shared it accidentally, etc.). 
            Their old link will immediately stop working.
          </p>
          
          <div className="flex gap-3">
            <input
              type="text"
              value={singleClientId}
              onChange={(e) => setSingleClientId(e.target.value)}
              placeholder="Client ID (e.g., Sam-Noble)"
              className="flex-1 p-3 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
            <button
              onClick={regenerateSingleToken}
              disabled={isRegenerating}
              className="px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:bg-amber-300 flex items-center gap-2"
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Regenerating...
                </>
              ) : (
                <>
                  <RefreshCw size={18} />
                  Regenerate
                </>
              )}
            </button>
          </div>

          {/* Single Result */}
          {singleResult && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="font-semibold text-green-800 flex items-center gap-2">
                <CheckCircle size={18} />
                New Token Generated for {singleResult.clientName}
              </h3>
              <p className="text-sm text-green-700 mt-2">New Portal URL:</p>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={singleResult.portalUrl}
                  readOnly
                  className="flex-1 p-2 bg-white border border-green-300 rounded text-sm font-mono"
                />
                <button
                  onClick={() => copyToClipboard(singleResult.portalUrl, -1)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
                >
                  {copiedIndex === -1 ? <CheckCircle size={16} /> : <Copy size={16} />}
                  {copiedIndex === -1 ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-green-600 mt-2">
                Send this to {singleResult.clientName}. Their old link no longer works.
              </p>
            </div>
          )}
        </div>

        {/* Generate All Tokens */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2 mb-2">
            <Key size={20} />
            Generate Tokens for All Clients
          </h2>
          <p className="text-gray-600 text-sm mb-4">
            Generate tokens for all active clients who don't have one yet. 
            Existing tokens are preserved (use the single regenerate above to replace).
          </p>
          
          <button
            onClick={generateAllTokens}
            disabled={isLoading}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-300 flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Generating...
              </>
            ) : (
              <>
                <Key size={18} />
                Generate All Tokens
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <CheckCircle className="text-green-600" size={20} />
              Generated {results.length} Tokens
            </h2>
            
            <div className="space-y-3">
              {results.map((result, index) => (
                <div key={result.clientId} className="border border-gray-200 rounded-lg p-4">
                  <div className="font-medium text-gray-900 mb-2">{result.clientName}</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={result.portalUrl}
                      readOnly
                      className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded text-sm font-mono text-gray-600"
                    />
                    <button
                      onClick={() => copyToClipboard(result.portalUrl, index)}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
                    >
                      {copiedIndex === index ? <CheckCircle size={16} /> : <Copy size={16} />}
                      {copiedIndex === index ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-800 mb-2">ℹ️ How Token Authentication Works</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Each client gets a unique, secure token in their billing URL</li>
            <li>• Tokens are stored in the Clients table in Airtable</li>
            <li>• Old <code className="bg-blue-100 px-1 rounded">?client=Name</code> links no longer work</li>
            <li>• Coaches can still use <code className="bg-blue-100 px-1 rounded">?client=Name&devKey=...</code> for admin access</li>
            <li>• Regenerating a token immediately invalidates the old one</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
