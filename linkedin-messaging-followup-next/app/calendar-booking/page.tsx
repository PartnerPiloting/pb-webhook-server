'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

interface FormData {
  yourName: string;
  yourLinkedIn: string;
  yourPhone: string;
  yourZoom: string;
  leadName: string;
  leadLinkedIn: string;
  leadLocation: string;
  leadEmail: string;
  leadPhone: string;
  detectedTimezone?: string;
  detectedOffset?: string;
}

interface ClientInfo {
  clientId: string;
  clientName: string;
  calendarConnected: boolean;
}

export default function CalendarBooking() {
  const searchParams = useSearchParams();
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [formData, setFormData] = useState<FormData>({
    yourName: '',
    yourLinkedIn: '',
    yourPhone: '',
    yourZoom: '',
    leadName: '',
    leadLinkedIn: '',
    leadLocation: '',
    leadEmail: '',
    leadPhone: '',
  });
  const [activeTab, setActiveTab] = useState<'suggest' | 'book'>('suggest');
  const [clipboardError, setClipboardError] = useState<string>('');
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<string>('');
  const [selectedDates, setSelectedDates] = useState<string[]>(['', '', '']);

  // Load client info from URL
  useEffect(() => {
    const clientId = searchParams.get('client');
    if (!clientId) {
      setClipboardError('⚠️ Missing client ID. Please use your personalized link.');
      return;
    }

    // Validate client and check calendar connection
    fetch(`/api/calendar/client-info?clientId=${clientId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setClipboardError('⚠️ Invalid client ID: ' + data.error);
        } else {
          setClientInfo(data);
        }
      })
      .catch(() => {
        setClipboardError('⚠️ Failed to load client information');
      });
  }, [searchParams]);

  const parseClipboardData = (text: string): FormData | null => {
    try {
      // Expected format: My Name: Guy Wilson|||My LinkedIn: https://...|||etc
      const fields = text.split('|||').map(f => f.trim());
      
      if (fields.length !== 7) {
        return null;
      }

      const extractValue = (field: string, label: string): string => {
        const parts = field.split(':');
        if (parts.length < 2) return '';
        return parts.slice(1).join(':').trim();
      };

      return {
        yourName: extractValue(fields[0], 'My Name'),
        yourLinkedIn: extractValue(fields[1], 'My LinkedIn'),
        yourPhone: extractValue(fields[2], 'My Phone'),
        yourZoom: extractValue(fields[3], 'My Zoom'),
        leadName: extractValue(fields[4], 'Lead Name'),
        leadLinkedIn: extractValue(fields[5], 'Lead LinkedIn Profile'),
        leadLocation: extractValue(fields[6], 'Lead Location'),
        leadEmail: '',
        leadPhone: '',
      };
    } catch (e) {
      return null;
    }
  };

  const handleReadClipboard = async () => {
    try {
      setClipboardError('');
      const text = await navigator.clipboard.readText();
      const parsed = parseClipboardData(text);

      if (!parsed) {
        setClipboardError('⚠️ Clipboard doesn\'t contain valid data. Please run AI Blaze first.');
        return;
      }

      // Detect timezone
      setLoading(true);
      try {
        const tzResponse = await fetch('/api/calendar/detect-timezone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location: parsed.leadLocation }),
        });
        const tzData = await tzResponse.json();
        
        setFormData({
          ...parsed,
          detectedTimezone: tzData.timezone,
          detectedOffset: tzData.offset,
        });
      } catch (tzError) {
        // Fallback if timezone detection fails
        setFormData(parsed);
      }

      setDataLoaded(true);
      setClipboardError('');
    } catch (error) {
      setClipboardError('❌ Could not read clipboard. Please check browser permissions.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMessage = async () => {
    if (!formData.leadName || selectedDates.filter(d => d).length === 0) {
      alert('Please enter at least one suggested time');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/calendar/suggest-times', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-client-id': clientInfo?.clientId || '',
        },
        body: JSON.stringify({
          yourName: formData.yourName,
          leadName: formData.leadName,
          leadLocation: formData.leadLocation,
          leadTimezone: formData.detectedTimezone,
          suggestedTimes: selectedDates.filter(d => d),
          yourTimezone: 'Australia/Brisbane',
        }),
      });

      const data = await response.json();
      setGeneratedMessage(data.message);
    } catch (error) {
      alert('Failed to generate message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBookMeeting = async () => {
    if (!formData.leadEmail) {
      alert('Email is required to send calendar invite');
      return;
    }

    if (!selectedDates[0]) {
      alert('Please select a meeting time');
      return;
    }

    if (!clientInfo?.calendarConnected) {
      alert('Please connect your Google Calendar first');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/calendar/book-meeting', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-client-id': clientInfo.clientId,
        },
        body: JSON.stringify({
          yourName: formData.yourName,
          yourEmail: formData.yourLinkedIn, // Or add separate email field
          yourPhone: formData.yourPhone,
          yourZoom: formData.yourZoom,
          yourLinkedIn: formData.yourLinkedIn,
          leadName: formData.leadName,
          leadEmail: formData.leadEmail,
          leadPhone: formData.leadPhone,
          leadLinkedIn: formData.leadLinkedIn,
          meetingTime: selectedDates[0],
          timezone: formData.detectedTimezone,
        }),
      });

      const data = await response.json();
      if (data.success) {
        alert('✅ Meeting booked successfully! Calendar invite sent.');
        // Reset form
        setDataLoaded(false);
        setFormData({
          yourName: '',
          yourLinkedIn: '',
          yourPhone: '',
          yourZoom: '',
          leadName: '',
          leadLinkedIn: '',
          leadLocation: '',
          leadEmail: '',
          leadPhone: '',
        });
        setSelectedDates(['', '', '']);
        setGeneratedMessage('');
      } else {
        alert('❌ Failed to book meeting: ' + data.error);
      }
    } catch (error) {
      alert('Failed to book meeting. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">📅 Calendar Booking</h1>
        {clientInfo && (
          <p className="text-sm text-gray-600 mb-8">
            Client: <strong>{clientInfo.clientName}</strong> ({clientInfo.clientId})
          </p>
        )}

        {/* Calendar Connection Status */}
        {clientInfo && !clientInfo.calendarConnected && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-yellow-900 mb-2">
              🔗 Connect Your Google Calendar
            </h2>
            <p className="text-sm text-yellow-800 mb-4">
              You need to connect your Google Calendar to create meeting invites.
            </p>
            <button
              onClick={() => {
                window.location.href = `/api/auth/google?clientId=${clientInfo.clientId}`;
              }}
              className="bg-blue-600 text-white py-2 px-6 rounded-lg font-semibold hover:bg-blue-700"
            >
              Connect Google Calendar
            </button>
          </div>
        )}

        {clientInfo?.calendarConnected && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-green-800">
              ✓ Google Calendar connected
            </p>
          </div>
        )}

        {/* Clipboard Reader */}
        {!dataLoaded && (
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <button
              onClick={handleReadClipboard}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-4 px-6 rounded-lg text-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? '⏳ Loading...' : '📋 Read from Clipboard'}
            </button>
            {clipboardError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
                {clipboardError}
              </div>
            )}
            <p className="mt-4 text-sm text-gray-600 text-center">
              Run AI Blaze on LinkedIn profile, then click above to auto-fill
            </p>
          </div>
        )}

        {/* Data Display */}
        {dataLoaded && (
          <>
            <div className="bg-white p-6 rounded-lg shadow mb-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-semibold">✓ Data Loaded Successfully</h2>
                <button
                  onClick={() => {
                    setDataLoaded(false);
                    setFormData({
                      yourName: '',
                      yourLinkedIn: '',
                      yourPhone: '',
                      yourZoom: '',
                      leadName: '',
                      leadLinkedIn: '',
                      leadLocation: '',
                      leadEmail: '',
                      leadPhone: '',
                    });
                    setGeneratedMessage('');
                    setSelectedDates(['', '', '']);
                  }}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Clear & Start Over
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">Your Details</h3>
                  <div className="text-sm space-y-1 text-gray-600">
                    <p><strong>Name:</strong> {formData.yourName}</p>
                    <p><strong>Phone:</strong> {formData.yourPhone}</p>
                    <p><strong>LinkedIn:</strong> <a href={formData.yourLinkedIn} target="_blank" className="text-blue-600 hover:underline">Profile</a></p>
                    <p><strong>Zoom:</strong> <a href={formData.yourZoom} target="_blank" className="text-blue-600 hover:underline">Link</a></p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">Lead Details</h3>
                  <div className="text-sm space-y-1 text-gray-600">
                    <p><strong>Name:</strong> {formData.leadName}</p>
                    <p><strong>Location:</strong> {formData.leadLocation}</p>
                    {formData.detectedTimezone && (
                      <p><strong>Timezone:</strong> {formData.detectedTimezone} ({formData.detectedOffset})</p>
                    )}
                    <p><strong>LinkedIn:</strong> <a href={formData.leadLinkedIn} target="_blank" className="text-blue-600 hover:underline">Profile</a></p>
                  </div>
                </div>
              </div>

              {/* Additional inputs */}
              <div className="mt-6 pt-6 border-t">
                <h3 className="font-semibold text-gray-700 mb-3">Additional Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lead Email {activeTab === 'book' && <span className="text-red-500">*</span>}
                    </label>
                    <input
                      type="email"
                      value={formData.leadEmail}
                      onChange={(e) => setFormData({ ...formData, leadEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="john@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lead Phone (optional)
                    </label>
                    <input
                      type="tel"
                      value={formData.leadPhone}
                      onChange={(e) => setFormData({ ...formData, leadPhone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="0400 123 456"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-lg shadow">
              <div className="flex border-b">
                <button
                  onClick={() => setActiveTab('suggest')}
                  className={`flex-1 py-4 px-6 font-semibold ${
                    activeTab === 'suggest'
                      ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  💬 Suggest Times
                </button>
                <button
                  onClick={() => setActiveTab('book')}
                  className={`flex-1 py-4 px-6 font-semibold ${
                    activeTab === 'book'
                      ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  📅 Book Meeting
                </button>
              </div>

              <div className="p-6">
                {activeTab === 'suggest' && (
                  <div>
                    <h3 className="font-semibold mb-4">Pick 2-3 times to suggest:</h3>
                    <div className="space-y-3 mb-6">
                      {[0, 1, 2].map((idx) => (
                        <div key={idx}>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Option {idx + 1}
                          </label>
                          <input
                            type="datetime-local"
                            value={selectedDates[idx]}
                            onChange={(e) => {
                              const newDates = [...selectedDates];
                              newDates[idx] = e.target.value;
                              setSelectedDates(newDates);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={handleGenerateMessage}
                      disabled={loading}
                      className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {loading ? '⏳ Generating...' : '✨ Generate AI Message'}
                    </button>

                    {generatedMessage && (
                      <div className="mt-6 p-4 bg-gray-50 border rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-semibold">Generated Message:</h4>
                          <button
                            onClick={() => navigator.clipboard.writeText(generatedMessage)}
                            className="text-sm text-blue-600 hover:underline"
                          >
                            📋 Copy
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap text-sm text-gray-700">
                          {generatedMessage}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'book' && (
                  <div>
                    <h3 className="font-semibold mb-4">Select meeting time:</h3>
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Meeting Date & Time (Brisbane time)
                      </label>
                      <input
                        type="datetime-local"
                        value={selectedDates[0]}
                        onChange={(e) => setSelectedDates([e.target.value, '', ''])}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                      {formData.detectedTimezone && selectedDates[0] && (
                        <p className="mt-2 text-sm text-gray-600">
                          This will be sent to {formData.leadName} in their timezone ({formData.detectedTimezone})
                        </p>
                      )}
                    </div>

                    <button
                      onClick={handleBookMeeting}
                      disabled={loading}
                      className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400"
                    >
                      {loading ? '⏳ Booking...' : '✅ Book Meeting & Send Invite'}
                    </button>

                    <p className="mt-4 text-sm text-gray-600">
                      This will create a Google Calendar event and send invites to both parties.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
