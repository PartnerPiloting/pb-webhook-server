'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface IntakeRequest {
  id: string;
  name: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  linkedinProfileUrl: string;
  phone?: string;
  timezone: string;
  coachId: string;
  coachNotes?: string;
  status: string;
  submittedAt: string;
}

interface FormData {
  coachId: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  linkedinProfileUrl: string;
  phone: string;
  timezone: string;
  customTimezone: string;
  coachNotes: string;
}

const TIMEZONES = [
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
  { value: 'America/New_York', label: 'New York (EST)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST)' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'other', label: 'Other...' }
];

const EMPTY_FORM: FormData = {
  coachId: '',
  clientFirstName: '',
  clientLastName: '',
  clientEmail: '',
  linkedinProfileUrl: '',
  phone: '',
  timezone: 'Australia/Brisbane',
  customTimezone: '',
  coachNotes: ''
};

function ClientIntakeContent() {
  const searchParams = useSearchParams();
  const viewCoachId = searchParams.get('view');
  
  const [mode, setMode] = useState<'submit' | 'view'>(viewCoachId ? 'view' : 'submit');
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [requests, setRequests] = useState<IntakeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [coachValidation, setCoachValidation] = useState<{ valid: boolean; name?: string } | null>(null);
  const [validatingCoach, setValidatingCoach] = useState(false);
  
  // Lookup coach ID for view mode
  const [lookupCoachId, setLookupCoachId] = useState(viewCoachId || '');
  
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://pb-webhook-server-staging.onrender.com';
  
  // Load requests when in view mode
  useEffect(() => {
    if (mode === 'view' && lookupCoachId) {
      fetchRequests();
    }
  }, [mode, lookupCoachId]);
  
  // Validate coach ID with debounce
  useEffect(() => {
    if (!formData.coachId || formData.coachId.length < 3) {
      setCoachValidation(null);
      return;
    }
    
    const timer = setTimeout(async () => {
      setValidatingCoach(true);
      try {
        const response = await fetch(`${apiUrl}/api/validate-coach/${encodeURIComponent(formData.coachId)}`);
        const data = await response.json();
        setCoachValidation({ valid: data.valid, name: data.coachName });
      } catch (err) {
        setCoachValidation(null);
      } finally {
        setValidatingCoach(false);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [formData.coachId]);
  
  const fetchRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/intake?coachId=${encodeURIComponent(lookupCoachId)}`);
      const data = await response.json();
      if (data.success) {
        setRequests(data.requests);
      } else {
        setError(data.error || 'Failed to fetch requests');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch requests');
    } finally {
      setLoading(false);
    }
  };
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError(null);
    setSuccess(null);
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    // Validate coach first
    if (!coachValidation?.valid) {
      setError('Please enter a valid Coach ID');
      setLoading(false);
      return;
    }
    
    const timezone = formData.timezone === 'other' ? formData.customTimezone : formData.timezone;
    
    try {
      const url = editingId 
        ? `${apiUrl}/api/intake/${editingId}`
        : `${apiUrl}/api/intake`;
      
      const method = editingId ? 'PATCH' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientFirstName: formData.clientFirstName,
          clientLastName: formData.clientLastName,
          clientEmail: formData.clientEmail,
          linkedinProfileUrl: formData.linkedinProfileUrl,
          phone: formData.phone || null,
          timezone,
          coachId: formData.coachId,
          coachNotes: formData.coachNotes || null
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSuccess(editingId 
          ? 'Request updated successfully!' 
          : `Thanks! We'll set up ${formData.clientFirstName} ${formData.clientLastName} and be in touch shortly.`);
        setFormData(EMPTY_FORM);
        setEditingId(null);
        setCoachValidation(null);
        
        // Refresh list if in view mode
        if (mode === 'view') {
          fetchRequests();
        }
      } else {
        setError(data.errors?.join(', ') || data.error || 'Submission failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };
  
  const handleEdit = (request: IntakeRequest) => {
    setFormData({
      coachId: request.coachId,
      clientFirstName: request.clientFirstName,
      clientLastName: request.clientLastName,
      clientEmail: request.clientEmail,
      linkedinProfileUrl: request.linkedinProfileUrl,
      phone: request.phone || '',
      timezone: TIMEZONES.find(t => t.value === request.timezone) ? request.timezone : 'other',
      customTimezone: TIMEZONES.find(t => t.value === request.timezone) ? '' : request.timezone,
      coachNotes: request.coachNotes || ''
    });
    setEditingId(request.id);
    setMode('submit');
    setError(null);
    setSuccess(null);
  };
  
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this request?')) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${apiUrl}/api/intake/${id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSuccess('Request deleted successfully');
        fetchRequests();
      } else {
        setError(data.error || 'Failed to delete');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete request');
    } finally {
      setLoading(false);
    }
  };
  
  const handleCancelEdit = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setCoachValidation(null);
    if (lookupCoachId) {
      setMode('view');
    }
  };
  
  const getClientCode = () => {
    if (!formData.clientFirstName || !formData.clientLastName) return '';
    return `${formData.clientFirstName.trim()}-${formData.clientLastName.trim()}`.replace(/\s+/g, '-');
  };
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {editingId ? '✏️ Edit Client Request' : '👤 New Client Intake'}
          </h1>
          <p className="text-gray-600 mt-1">
            {editingId 
              ? 'Update the client details below'
              : 'Submit details for a new client you want to onboard'}
          </p>
        </div>
        
        {/* Mode Toggle */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => { setMode('submit'); setEditingId(null); setFormData(EMPTY_FORM); }}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              mode === 'submit' 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            ➕ Submit New
          </button>
          <button
            onClick={() => setMode('view')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              mode === 'view' 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            📋 View My Requests
          </button>
        </div>
        
        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            ❌ {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
            ✅ {success}
          </div>
        )}
        
        {/* Submit Form Mode */}
        {mode === 'submit' && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
            {/* Coach ID - First Field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your Coach ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="coachId"
                value={formData.coachId}
                onChange={handleChange}
                placeholder="e.g., Guy-Wilson"
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  coachValidation?.valid === false ? 'border-red-300' : 
                  coachValidation?.valid === true ? 'border-green-300' : ''
                }`}
                required
                disabled={!!editingId}
              />
              {validatingCoach && (
                <p className="text-sm text-gray-500 mt-1">Validating...</p>
              )}
              {coachValidation?.valid && (
                <p className="text-sm text-green-600 mt-1">✓ {coachValidation.name}</p>
              )}
              {coachValidation?.valid === false && (
                <p className="text-sm text-red-600 mt-1">✗ Coach ID not found</p>
              )}
            </div>
            
            <hr className="my-4" />
            
            <h3 className="font-medium text-gray-900">Client Details</h3>
            
            {/* Client First Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="clientFirstName"
                  value={formData.clientFirstName}
                  onChange={handleChange}
                  placeholder="John"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="clientLastName"
                  value={formData.clientLastName}
                  onChange={handleChange}
                  placeholder="Smith"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
            </div>
            
            {/* Client Code Preview */}
            {getClientCode() && (
              <p className="text-sm text-gray-500">
                Client Code will be: <code className="bg-gray-100 px-2 py-1 rounded">{getClientCode()}</code>
              </p>
            )}
            
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                name="clientEmail"
                value={formData.clientEmail}
                onChange={handleChange}
                placeholder="john@example.com"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            
            {/* LinkedIn URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                LinkedIn Profile URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                name="linkedinProfileUrl"
                value={formData.linkedinProfileUrl}
                onChange={handleChange}
                placeholder="https://www.linkedin.com/in/johnsmith"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            
            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+61 400 000 000"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            {/* Timezone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client Timezone
              </label>
              <select
                name="timezone"
                value={formData.timezone}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
              {formData.timezone === 'other' && (
                <input
                  type="text"
                  name="customTimezone"
                  value={formData.customTimezone}
                  onChange={handleChange}
                  placeholder="e.g., Europe/Paris"
                  className="w-full mt-2 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              )}
            </div>
            
            {/* Coach Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                name="coachNotes"
                value={formData.coachNotes}
                onChange={handleChange}
                rows={3}
                placeholder="Any additional context about this client..."
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            {/* Submit Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={loading || !coachValidation?.valid}
                className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading ? 'Submitting...' : editingId ? '💾 Update Request' : '📤 Submit Request'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-4 py-3 border rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        
        {/* View Requests Mode */}
        {mode === 'view' && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enter your Coach ID to view requests
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={lookupCoachId}
                  onChange={(e) => setLookupCoachId(e.target.value)}
                  placeholder="e.g., Guy-Wilson"
                  className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  onClick={fetchRequests}
                  disabled={!lookupCoachId || loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {loading ? '...' : 'Load'}
                </button>
              </div>
            </div>
            
            {requests.length === 0 && !loading && lookupCoachId && (
              <p className="text-gray-500 text-center py-8">No requests found for this Coach ID</p>
            )}
            
            {requests.length > 0 && (
              <div className="space-y-3">
                {requests.map(request => (
                  <div key={request.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium text-gray-900">{request.name}</h4>
                        <p className="text-sm text-gray-500">{request.clientEmail}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Submitted: {new Date(request.submittedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          request.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                          request.status === 'Processed' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {request.status}
                        </span>
                        {request.status === 'Pending' && (
                          <>
                            <button
                              onClick={() => handleEdit(request)}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(request.id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Help Text */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Questions? Contact your administrator.</p>
        </div>
      </div>
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function ClientIntakePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 py-8 flex items-center justify-center">Loading...</div>}>
      <ClientIntakeContent />
    </Suspense>
  );
}
