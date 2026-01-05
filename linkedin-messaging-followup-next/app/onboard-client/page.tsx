'use client';

import React, { useState, ChangeEvent, FormEvent } from 'react';
import { Loader2, CheckCircle, XCircle, AlertCircle, UserPlus, Database, ArrowLeft, Pencil, Search, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';

// Detect backend URL from current hostname (same pattern as api.js)
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

interface ValidationResult {
  success: boolean;
  message?: string;
  error?: string;
  validation?: {
    tables?: Record<string, { exists: boolean; error?: string }>;
    warnings?: string[];
  };
}

interface OnboardingResult {
  success: boolean;
  message?: string;
  clientId?: string;
  recordId?: string;
  error?: string;
  updatedFields?: string[];
}

interface ClientData {
  clientName: string;
  email: string;
  wordpressUserId: string;
  airtableBaseId: string;
  serviceLevel: string;
  linkedinUrl: string;
  timezone: string;
  phone: string;
  googleCalendarEmail: string;
  status?: string;
  // Advanced settings
  profileScoringTokenLimit: string;
  postScoringTokenLimit: string;
  postsDailyTarget: string;
  leadsBatchSizeForPostCollection: string;
  maxPostBatchesPerDayGuardrail: string;
  postScrapeBatchSize: string;
  processingStream: string;
  // Post Access Control
  postAccessEnabled: boolean;
}

// Helper to get the service level number from the service level string
function getServiceLevelNumber(serviceLevel: string): string {
  if (serviceLevel.startsWith('1-')) return '1';
  if (serviceLevel.startsWith('2-')) return '2';
  return '2'; // Default to post scoring
}

// Build the client dashboard URL
function buildClientUrl(clientCode: string, serviceLevel: string): string {
  const level = getServiceLevelNumber(serviceLevel);
  return `https://pb-webhook-server-staging.vercel.app/?testClient=${encodeURIComponent(clientCode)}&level=${level}`;
}

// Only two actual service levels in the system
const SERVICE_LEVELS = [
  { value: '1-Lead Scoring', label: 'Lead Scoring', description: 'Profile scoring only' },
  { value: '2-Post Scoring', label: 'Post Scoring', description: 'Lead + post analysis' }
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

// Always use Post Scoring defaults for all clients
// (Even Level 1 clients get these values pre-set for when they upgrade)
const DEFAULT_SETTINGS = {
  profileScoringTokenLimit: '5000',
  postScoringTokenLimit: '3000',
  postsDailyTarget: '10',
  leadsBatchSizeForPostCollection: '10',
  maxPostBatchesPerDayGuardrail: '3',
  postScrapeBatchSize: '10',
  processingStream: '1'
};

const EMPTY_FORM: ClientData = {
  clientName: '',
  email: '',
  wordpressUserId: '',
  airtableBaseId: '',
  serviceLevel: '2-Post Scoring',
  linkedinUrl: '',
  timezone: 'Australia/Brisbane',
  phone: '',
  googleCalendarEmail: '',
  // Advanced settings (Post Scoring defaults)
  profileScoringTokenLimit: '5000',
  postScoringTokenLimit: '3000',
  postsDailyTarget: '10',
  leadsBatchSizeForPostCollection: '10',
  maxPostBatchesPerDayGuardrail: '3',
  postScrapeBatchSize: '10',
  processingStream: '1',
  // Post Access Control - enabled by default for new clients
  postAccessEnabled: true
};

export default function OnboardClientPage() {
  // Mode: 'add' or 'edit'
  const [mode, setMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<ClientData>(EMPTY_FORM);
  const [editClientId, setEditClientId] = useState('');
  const [searchClientId, setSearchClientId] = useState('');
  
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: newValue }));
    
    if (name === 'airtableBaseId') {
      setValidationResult(null);
    }
    setResult(null);
    setError(null);
  };

  const generateClientId = (name: string): string => {
    return name.trim().replace(/\s+/g, '-');
  };

  // Load client for editing
  const loadClient = async () => {
    if (!searchClientId.trim()) {
      setError('Please enter a Client Code to search');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const apiUrl = getBackendUrl();
      const response = await fetch(`${apiUrl}/api/client/${encodeURIComponent(searchClientId.trim())}`, {
        headers: { 'x-client-id': 'SYSTEM' }
      });
      
      const data = await response.json();
      
      if (!data.success) {
        setError(data.error || 'Client not found');
        return;
      }
      
      // Map Airtable fields to form fields
      const fields = data.fields;
      setFormData({
        clientName: fields['Client Name'] || '',
        email: fields['Client Email Address'] || '',
        wordpressUserId: String(fields['WordPress User ID'] || ''),
        airtableBaseId: fields['Airtable Base ID'] || '',
        serviceLevel: fields['Service Level'] || '2-Post Scoring',
        linkedinUrl: fields['LinkedIn URL'] || '',
        timezone: fields['Timezone'] || 'Australia/Brisbane',
        phone: fields['Phone'] || '',
        googleCalendarEmail: fields['Google Calendar Email'] || '',
        status: fields['Status'] || 'Active',
        // Advanced settings
        profileScoringTokenLimit: String(fields['Profile Scoring Token Limit'] || '5000'),
        postScoringTokenLimit: String(fields['Post Scoring Token Limit'] || '0'),
        postsDailyTarget: String(fields['Posts Daily Target'] || '0'),
        leadsBatchSizeForPostCollection: String(fields['Leads Batch Size For Post Collection'] || '0'),
        maxPostBatchesPerDayGuardrail: String(fields['Max Post Batches Per Day Guardrail'] || '0'),
        postScrapeBatchSize: String(fields['Post Scrape Batch Size'] || '0'),
        processingStream: String(fields['Processing Stream'] || ''),
        // Post Access Control
        postAccessEnabled: fields['Post Access Enabled'] === 'Yes'
      });
      setShowAdvanced(true); // Show advanced settings when editing
      setEditClientId(searchClientId.trim());
      setValidationResult({ success: true, message: 'Base already validated (existing client)' });
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load client: ${message}`);
    } finally {
      setIsLoading(false);
    }
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
      const apiUrl = getBackendUrl();
      const response = await fetch(`${apiUrl}/api/validate-client-base`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': 'SYSTEM'
        },
        body: JSON.stringify({ airtableBaseId: formData.airtableBaseId })
      });
      
      const data = await response.json();
      setValidationResult(data);
      
      if (!data.success) {
        setError(data.error || 'Base validation failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Validation request failed: ${message}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!formData.clientName || !formData.email || !formData.wordpressUserId || !formData.airtableBaseId) {
      setError('Please fill in all required fields');
      return;
    }
    
    if (mode === 'add' && !validationResult?.success) {
      setError('Please validate the Airtable base first');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    
    try {
      const apiUrl = getBackendUrl();
      
      if (mode === 'add') {
        // Create new client
        const response = await fetch(`${apiUrl}/api/onboard-client`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': 'SYSTEM'
          },
          body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
          setResult(data);
        } else {
          setError(data.error || 'Onboarding failed');
        }
      } else {
        // Update existing client
        const response = await fetch(`${apiUrl}/api/update-client/${encodeURIComponent(editClientId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': 'SYSTEM'
          },
          body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
          setResult(data);
        } else {
          setError(data.error || 'Update failed');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Request failed: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditClientId('');
    setSearchClientId('');
    setValidationResult(null);
    setResult(null);
    setError(null);
  };

  const switchMode = (newMode: 'add' | 'edit') => {
    setMode(newMode);
    resetForm();
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link href="/" className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            {mode === 'add' ? (
              <><UserPlus className="w-8 h-8 text-blue-600" /> Add New Client</>
            ) : (
              <><Pencil className="w-8 h-8 text-green-600" /> Edit Client</>
            )}
          </h1>
        </div>

        {/* Mode Toggle */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => switchMode('add')}
            className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
              mode === 'add' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Add New
          </button>
          <button
            onClick={() => switchMode('edit')}
            className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
              mode === 'edit' 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <Pencil className="w-4 h-4" />
            Edit Existing
          </button>
        </div>

        {/* Success Result */}
        {result?.success && (
          <div className="mb-6 p-6 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-6 h-6 text-green-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-green-800 text-lg">
                  {result.message}
                </h3>
                {result.clientId && (
                  <p className="text-green-700 mt-1">
                    Client Code: <code className="bg-green-100 px-2 py-0.5 rounded">{result.clientId}</code>
                  </p>
                )}
                {result.updatedFields && (
                  <p className="text-green-700 text-sm mt-2">
                    Updated fields: {result.updatedFields.join(', ')}
                  </p>
                )}
                
                {/* Client Dashboard URL */}
                {(result.clientId || editClientId) && (
                  <div className="mt-4 p-3 bg-white border border-green-200 rounded-lg">
                    <p className="text-sm font-medium text-gray-700 mb-2">📧 Client Dashboard URL (copy & send):</p>
                    <div className="flex gap-2 items-center">
                      <code className="flex-1 text-sm bg-gray-50 px-3 py-2 rounded border border-gray-200 text-gray-800 break-all">
                        {buildClientUrl(result.clientId || editClientId, formData.serviceLevel)}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(buildClientUrl(result.clientId || editClientId, formData.serviceLevel));
                        }}
                        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium whitespace-nowrap"
                      >
                        Copy URL
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={resetForm}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    {mode === 'add' ? 'Add Another Client' : 'Edit Another Client'}
                  </button>
                  <Link 
                    href="/"
                    className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
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

        {/* Edit Mode: Client Search */}
        {mode === 'edit' && !editClientId && !result?.success && (
          <div className="mb-6 p-6 bg-white rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-gray-600" />
              Find Client to Edit
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchClientId}
                onChange={(e) => setSearchClientId(e.target.value)}
                placeholder="Enter Client Code (e.g., Keith-Sinclair)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                onKeyDown={(e) => e.key === 'Enter' && loadClient()}
              />
              <button
                onClick={loadClient}
                disabled={isLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</>
                ) : (
                  <><Search className="w-4 h-4" /> Load Client</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        {!result?.success && (mode === 'add' || editClientId) && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Step 1: Client Details */}
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {mode === 'add' ? 'Step 1: Client Details' : 'Client Details'}
                {mode === 'edit' && editClientId && (
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    Editing: {editClientId}
                  </span>
                )}
              </h2>
              
              {/* Client URL - shown in edit mode */}
              {mode === 'edit' && editClientId && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-gray-700 mb-2">📧 Client Dashboard URL:</p>
                  <div className="flex gap-2 items-center">
                    <code className="flex-1 text-sm bg-white px-3 py-2 rounded border border-blue-200 text-gray-800 break-all">
                      {buildClientUrl(editClientId, formData.serviceLevel)}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(buildClientUrl(editClientId, formData.serviceLevel));
                      }}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
              
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
                  {mode === 'add' && formData.clientName && (
                    <p className="mt-1 text-sm text-gray-500">
                      Client Code will be: <code className="bg-gray-100 px-1 rounded">{generateClientId(formData.clientName)}</code>
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

                {/* Post Access Control */}
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <input
                    type="checkbox"
                    id="postAccessEnabled"
                    name="postAccessEnabled"
                    checked={formData.postAccessEnabled}
                    onChange={handleChange}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="postAccessEnabled" className="flex-1">
                    <span className="font-medium text-gray-900">Enable Post Access (Apify)</span>
                    <p className="text-sm text-gray-600">
                      Allow this client to use Apify for LinkedIn post scraping. Disable to prevent Apify usage regardless of service level.
                    </p>
                  </label>
                </div>
              </div>
            </div>

            {/* Step 2: Airtable Base */}
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-gray-600" />
                {mode === 'add' ? 'Step 2: Airtable Base Validation' : 'Airtable Base'}
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
                    disabled={mode === 'edit'}
                  />
                  {mode === 'add' && (
                    <button
                      type="button"
                      onClick={validateBase}
                      disabled={isValidating || !formData.airtableBaseId}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isValidating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Validating...</>
                      ) : (
                        'Validate Base'
                      )}
                    </button>
                  )}
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

                  {validationResult.validation?.warnings && validationResult.validation.warnings.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-yellow-200">
                      {validationResult.validation.warnings.map((warning: string, i: number) => (
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
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {mode === 'add' ? 'Step 3: Optional Details' : 'Additional Details'}
              </h2>
              
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

            {/* Advanced Settings */}
            <div className="p-6 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-gray-700"
              >
                {showAdvanced ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                <Settings className="w-5 h-5 text-gray-600" />
                Advanced Settings
                <span className="text-sm font-normal text-gray-500">
                  (Token limits, batch sizes)
                </span>
              </button>
              
              {showAdvanced && (
                <div className="mt-4 grid gap-4">
                  <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
                    💡 Post Scoring defaults are pre-set for all clients (ready for Level 2 upgrade). Only change if you need custom limits.
                  </p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Profile Scoring Token Limit <span className="text-gray-400 font-normal">(default: {DEFAULT_SETTINGS.profileScoringTokenLimit})</span>
                      </label>
                      <input
                        type="number"
                        name="profileScoringTokenLimit"
                        value={formData.profileScoringTokenLimit}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Post Scoring Token Limit <span className="text-gray-400 font-normal">(default: {DEFAULT_SETTINGS.postScoringTokenLimit})</span>
                      </label>
                      <input
                        type="number"
                        name="postScoringTokenLimit"
                        value={formData.postScoringTokenLimit}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Posts Daily Target <span className="text-gray-400 font-normal">(default: {DEFAULT_SETTINGS.postsDailyTarget})</span>
                      </label>
                      <input
                        type="number"
                        name="postsDailyTarget"
                        value={formData.postsDailyTarget}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Leads Batch Size for Post Collection <span className="text-gray-400 font-normal">(default: {DEFAULT_SETTINGS.leadsBatchSizeForPostCollection})</span>
                      </label>
                      <input
                        type="number"
                        name="leadsBatchSizeForPostCollection"
                        value={formData.leadsBatchSizeForPostCollection}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Max Post Batches/Day <span className="text-gray-400 font-normal">(default: {DEFAULT_SETTINGS.maxPostBatchesPerDayGuardrail})</span>
                      </label>
                      <input
                        type="number"
                        name="maxPostBatchesPerDayGuardrail"
                        value={formData.maxPostBatchesPerDayGuardrail}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Post Scrape Batch Size <span className="text-gray-400 font-normal">(default: {DEFAULT_SETTINGS.postScrapeBatchSize})</span>
                      </label>
                      <input
                        type="number"
                        name="postScrapeBatchSize"
                        value={formData.postScrapeBatchSize}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Processing Stream <span className="text-gray-400 font-normal">(default: {DEFAULT_SETTINGS.processingStream})</span>
                      </label>
                      <input
                        type="number"
                        name="processingStream"
                        value={formData.processingStream}
                        onChange={handleChange}
                        placeholder="1, 2, or 3"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <div className="p-6 bg-gray-50">
              <button
                type="submit"
                disabled={isSubmitting || (mode === 'add' && !validationResult?.success)}
                className={`w-full px-6 py-3 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium ${
                  mode === 'add' 
                    ? 'bg-blue-600 hover:bg-blue-700' 
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isSubmitting ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> {mode === 'add' ? 'Creating...' : 'Updating...'}</>
                ) : mode === 'add' ? (
                  <><UserPlus className="w-5 h-5" /> Create Client Record</>
                ) : (
                  <><Pencil className="w-5 h-5" /> Update Client Record</>
                )}
              </button>
              
              {mode === 'add' && !validationResult?.success && (
                <p className="text-center text-sm text-gray-500 mt-2">
                  Please validate the Airtable base first
                </p>
              )}
            </div>
          </form>
        )}

        {/* Instructions (Add mode only) */}
        {mode === 'add' && !result?.success && (
          <div className="mt-8 p-6 bg-blue-50 rounded-xl border border-blue-200">
            <h3 className="font-semibold text-blue-900 mb-3">Before You Start</h3>
            <ol className="list-decimal list-inside space-y-2 text-blue-800">
              <li>Duplicate the template Airtable base <strong>(My Leads - Client Template)</strong></li>
              <li>Rename it to "My Leads - [Client Name]"</li>
              <li>Get the new Base ID from the URL</li>
              <li>Look up the client's WordPress User ID from PMPro</li>
              <li>Fill in this form and validate the base</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
