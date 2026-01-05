'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, CheckCircle, XCircle, AlertCircle, UserPlus, Database, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const SERVICE_LEVELS = [
  { value: '1-Lead Scoring', label: 'Lead Scoring', description: 'Profile scoring only' },
  { value: '2-Post Scoring', label: 'Post Scoring', description: 'Lead + post analysis' },
  { value: '3-Full Service', label: 'Full Service', description: 'Complete service package' }
];

const TIMEZONES = [
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
  { value: 'America/New_York', label: 'New York (EST)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST)' },
  { value: 'Europe/London', label: 'London (GMT)' }
];

export default function OnboardClientPage() {
  const { data: session } = useSession();
  const [formData, setFormData] = useState({
    clientName: '',
    email: '',
    wordpressUserId: '',
    airtableBaseId: '',
    serviceLevel: '1-Lead Scoring',
    linkedinUrl: '',
    timezone: 'Australia/Brisbane',
    phone: '',
    googleCalendarEmail: ''
  });
  
  const [validationResult, setValidationResult] = useState(null);
  const [onboardingResult, setOnboardingResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear results when form changes
    if (name === 'airtableBaseId') {
      setValidationResult(null);
    }
    setOnboardingResult(null);
    setError(null);
  };

  const generateClientId = (name) => {
    return name.trim().replace(/\s+/g, '-');
  };

  const validateBase = async () => {
    if (!formData.airtableBaseId) {
      setError('Please enter an Airtable Base ID first');
      return;
    }
    
    setIsValidating(true);
    setError(null);
    setValidationResult(null);
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://pb-webhook-server-staging.onrender.com';
      const response = await fetch(`${apiUrl}/api/validate-client-base`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': 'SYSTEM'
        },
        body: JSON.stringify({ airtableBaseId: formData.airtableBaseId })
      });
      
      const result = await response.json();
      setValidationResult(result);
      
      if (!result.success) {
        setError(result.error || 'Base validation failed');
      }
    } catch (err) {
      setError(`Validation request failed: ${err.message}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!formData.clientName || !formData.email || !formData.wordpressUserId || !formData.airtableBaseId) {
      setError('Please fill in all required fields');
      return;
    }
    
    // Check if base was validated
    if (!validationResult?.success) {
      setError('Please validate the Airtable base first');
      return;
    }
    
    setIsOnboarding(true);
    setError(null);
    setOnboardingResult(null);
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://pb-webhook-server-staging.onrender.com';
      const response = await fetch(`${apiUrl}/api/onboard-client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': 'SYSTEM'
        },
        body: JSON.stringify(formData)
      });
      
      const result = await response.json();
      
      if (result.success) {
        setOnboardingResult(result);
      } else {
        setError(result.error || 'Onboarding failed');
      }
    } catch (err) {
      setError(`Onboarding request failed: ${err.message}`);
    } finally {
      setIsOnboarding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <UserPlus className="w-8 h-8 text-blue-600" />
            Onboard New Client
          </h1>
          <p className="text-gray-600 mt-2">
            Create a new client record after duplicating the template Airtable base.
          </p>
        </div>

        {/* Success Result */}
        {onboardingResult?.success && (
          <div className="mb-6 p-6 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-6 h-6 text-green-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-green-800 text-lg">
                  {onboardingResult.message}
                </h3>
                <p className="text-green-700 mt-1">
                  Client ID: <code className="bg-green-100 px-2 py-0.5 rounded">{onboardingResult.clientId}</code>
                </p>
                <p className="text-green-700 text-sm mt-2">
                  Record ID: {onboardingResult.recordId}
                </p>
                <div className="mt-4">
                  <Link 
                    href="/"
                    className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Go to Dashboard
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="text-red-800">{error}</div>
          </div>
        )}

        {/* Form */}
        {!onboardingResult?.success && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Step 1: Client Details */}
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 1: Client Details</h2>
              
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="clientName"
                    value={formData.clientName}
                    onChange={handleChange}
                    placeholder="e.g., Keith Sinclair"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                  {formData.clientName && (
                    <p className="mt-1 text-sm text-gray-500">
                      Client ID will be: <code className="bg-gray-100 px-1 rounded">{generateClientId(formData.clientName)}</code>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="client@example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      WordPress User ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      name="wordpressUserId"
                      value={formData.wordpressUserId}
                      onChange={handleChange}
                      placeholder="e.g., 123"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Service Level <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="serviceLevel"
                      value={formData.serviceLevel}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {SERVICE_LEVELS.map(level => (
                        <option key={level.value} value={level.value}>
                          {level.label} - {level.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Timezone
                    </label>
                    <select
                      name="timezone"
                      value={formData.timezone}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {TIMEZONES.map(tz => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Airtable Base */}
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-gray-600" />
                Step 2: Airtable Base Validation
              </h2>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Airtable Base ID <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="airtableBaseId"
                    value={formData.airtableBaseId}
                    onChange={handleChange}
                    placeholder="appXXXXXXXXXXXXXX"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={validateBase}
                    disabled={isValidating || !formData.airtableBaseId}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      'Validate Base'
                    )}
                  </button>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Find this in the Airtable URL: airtable.com/<strong>appXXXXXXX</strong>/...
                </p>
              </div>

              {/* Validation Results */}
              {validationResult && (
                <div className={`p-4 rounded-lg ${validationResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-start gap-2 mb-3">
                    {validationResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600" />
                    )}
                    <span className={`font-medium ${validationResult.success ? 'text-green-800' : 'text-red-800'}`}>
                      {validationResult.message}
                    </span>
                  </div>
                  
                  {validationResult.validation?.tables && (
                    <div className="space-y-2 text-sm">
                      {Object.entries(validationResult.validation.tables).map(([table, info]) => (
                        <div key={table} className="flex items-center gap-2">
                          {info.exists ? (
                            <CheckCircle className="w-4 h-4 text-green-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600" />
                          )}
                          <span className={info.exists ? 'text-green-700' : 'text-red-700'}>
                            {table} table: {info.exists ? 'Found' : 'Missing'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {validationResult.validation?.warnings?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-yellow-200">
                      {validationResult.validation.warnings.map((warning, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-yellow-700">
                          <AlertCircle className="w-4 h-4" />
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 3: Optional Fields */}
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Step 3: Optional Details</h2>
              
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    LinkedIn Profile URL
                  </label>
                  <input
                    type="url"
                    name="linkedinUrl"
                    value={formData.linkedinUrl}
                    onChange={handleChange}
                    placeholder="https://linkedin.com/in/..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="+61..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Google Calendar Email
                    </label>
                    <input
                      type="email"
                      name="googleCalendarEmail"
                      value={formData.googleCalendarEmail}
                      onChange={handleChange}
                      placeholder="calendar@gmail.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="p-6 bg-gray-50">
              <button
                type="submit"
                disabled={isOnboarding || !validationResult?.success}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
              >
                {isOnboarding ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating Client...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-5 h-5" />
                    Create Client Record
                  </>
                )}
              </button>
              
              {!validationResult?.success && (
                <p className="text-center text-sm text-gray-500 mt-2">
                  Please validate the Airtable base first
                </p>
              )}
            </div>
          </form>
        )}

        {/* Instructions */}
        <div className="mt-8 p-6 bg-blue-50 rounded-xl border border-blue-200">
          <h3 className="font-semibold text-blue-900 mb-3">Before You Start</h3>
          <ol className="list-decimal list-inside space-y-2 text-blue-800">
            <li>Duplicate the template Airtable base (Guy-Wilson's base)</li>
            <li>Rename it to "My Leads - [Client Name]"</li>
            <li>Get the new Base ID from the URL</li>
            <li>Look up the client's WordPress User ID from PMPro</li>
            <li>Fill in this form and validate the base</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
