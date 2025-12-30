'use client';

import { useState, useEffect, Suspense } from 'react';
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
}

interface ClientInfo {
  clientId: string;
  clientName: string;
  calendarConnected: boolean;
}

function CalendarBookingContent() {
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
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<string>('');
  const [generateError, setGenerateError] = useState<string>('');
  const [bookError, setBookError] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [suggestTimes, setSuggestTimes] = useState<string[]>(['', '', '']);
  const [bookTime, setBookTime] = useState<string>('');

  // Load client info from URL
  useEffect(() => {
    const clientId = searchParams.get('client');
    if (!clientId) {
      setError('⚠️ Missing client ID. Please use your personalized link.');
      return;
    }

    fetch(`/api/calendar/client-info?clientId=${clientId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError('⚠️ Invalid client ID: ' + data.error);
        } else {
          setClientInfo(data);
        }
      })
      .catch(() => {
        setError('⚠️ Failed to load client information');
      });
  }, [searchParams]);

  const parseClipboardData = (text: string): FormData | null => {
    try {
      const fields = text.split('|||').map(f => f.trim());
      
      if (fields.length !== 7) {
        return null;
      }

      const extractValue = (field: string): string => {
        const parts = field.split(':');
        if (parts.length < 2) return '';
        return parts.slice(1).join(':').trim();
      };

      return {
        yourName: extractValue(fields[0]),
        yourLinkedIn: extractValue(fields[1]),
        yourPhone: extractValue(fields[2]),
        yourZoom: extractValue(fields[3]),
        leadName: extractValue(fields[4]),
        leadLinkedIn: extractValue(fields[5]),
        leadLocation: extractValue(fields[6]),
        leadEmail: '',
        leadPhone: '',
      };
    } catch (e) {
      return null;
    }
  };

  const handleFillFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseClipboardData(text);
      
      if (!parsed) {
        setError('❌ Clipboard data format invalid. Expected 7 fields separated by |||');
        return;
      }

      setFormData(parsed);
      setSuccess('✅ Data loaded from clipboard successfully!');
      setError('');
    } catch (err) {
      setError('❌ Failed to read clipboard. Please allow clipboard access.');
    }
  };

  const handleGenerateMessage = async () => {
    setGenerateError('');
    setSuccess('');
    
    const times = suggestTimes.filter(t => t.trim());
    if (times.length === 0) {
      setGenerateError('Please select at least one time slot');
      return;
    }

    setLoading(true);

    try {
      const location = formData.leadLocation.trim() || 'Brisbane, Australia';
      const timezoneRes = await fetch('/api/calendar/detect-timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location }),
      });

      const timezoneData = await timezoneRes.json();
      const detectedTimezone = timezoneData.timezone || 'Australia/Brisbane';

      const messageRes = await fetch('/api/calendar/suggest-times', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientInfo!.clientId,
        },
        body: JSON.stringify({
          yourName: formData.yourName,
          leadName: formData.leadName,
          suggestedTimes: times,
          leadTimezone: detectedTimezone,
        }),
      });

      const messageData = await messageRes.json();
      console.log('API Response:', messageData);
      
      if (messageData.error) {
        setGenerateError(messageData.error);
      } else {
        const msg = messageData.message || '';
        console.log('Setting generatedMessage to:', msg);
        setGeneratedMessage(msg);
        if (msg) {
          setSuccess('✅ Message generated! Scroll down to see it.');
        } else {
          setGenerateError('API returned empty message');
        }
      }
    } catch (err) {
      setGenerateError('Failed to generate message');
    } finally {
      setLoading(false);
    }
  };

  const handleBookMeeting = async () => {
    setBookError('');
    
    if (!bookTime.trim()) {
      setBookError('Please select a meeting time');
      return;
    }

    // Build Google Calendar URL with pre-filled details
    const startDate = new Date(bookTime);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 min meeting
    
    // Format dates for Google Calendar (YYYYMMDDTHHmmss)
    const formatGCalDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    };
    
    // Title: "Lead Name and Your Name meeting"
    const leadNamePart = formData.leadName || 'Contact';
    const yourNamePart = formData.yourName || 'Me';
    const title = `${leadNamePart} and ${yourNamePart} meeting`;
    
    // Description with proper line breaks
    const descriptionLines = [];
    if (formData.yourZoom) descriptionLines.push(`Zoom: ${formData.yourZoom}`);
    if (formData.leadLinkedIn) descriptionLines.push(`${leadNamePart}: ${formData.leadLinkedIn}`);
    if (formData.yourLinkedIn || formData.yourPhone) {
      let yourLine = `${yourNamePart}: `;
      if (formData.yourLinkedIn) yourLine += formData.yourLinkedIn;
      if (formData.yourLinkedIn && formData.yourPhone) yourLine += ' | ';
      if (formData.yourPhone) yourLine += formData.yourPhone;
      descriptionLines.push(yourLine);
    }
    const description = descriptionLines.join('\n');
    
    const location = formData.yourZoom || formData.leadLocation || 'Zoom';
    
    // Build Google Calendar URL
    let calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE`;
    calUrl += `&text=${encodeURIComponent(title)}`;
    calUrl += `&dates=${formatGCalDate(startDate)}/${formatGCalDate(endDate)}`;
    calUrl += `&details=${encodeURIComponent(description)}`;
    calUrl += `&location=${encodeURIComponent(location)}`;
    
    if (formData.leadEmail) {
      calUrl += `&add=${encodeURIComponent(formData.leadEmail)}`;
    }
    
    // Open Google Calendar in new tab
    window.open(calUrl, '_blank');
    setSuccess('✅ Google Calendar opened - review and save the event');
  };

  if (!clientInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <p className="text-gray-600">Loading client information...</p>
          {error && <p className="mt-4 text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            Calendar Booking
          </h1>
          <p className="text-gray-600">
            Client: <span className="font-medium">{clientInfo.clientName}</span>
          </p>
          
          {!clientInfo.calendarConnected && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-yellow-800 mb-3">
                📅 Connect your Google Calendar to enable booking
              </p>
              <button
                onClick={() => window.location.href = `/api/auth/google?clientId=${clientInfo.clientId}`}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium"
              >
                Connect Google Calendar
              </button>
            </div>
          )}

          {clientInfo.calendarConnected && (
            <p className="mt-2 text-green-600 font-medium">
              ✅ Google Calendar Connected
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="mb-6">
            <button
              onClick={handleFillFromClipboard}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-md font-medium"
            >
              📋 Fill from Clipboard
            </button>
            <p className="text-sm text-gray-500 mt-2 text-center">
              Paste AI Blaze output (7 fields with |||)
            </p>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-800">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md text-green-800">
              {success}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Your Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Your Name
                  </label>
                  <input
                    type="text"
                    value={formData.yourName}
                    onChange={(e) => setFormData({...formData, yourName: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Your LinkedIn
                  </label>
                  <input
                    type="text"
                    value={formData.yourLinkedIn}
                    onChange={(e) => setFormData({...formData, yourLinkedIn: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Your Phone
                  </label>
                  <input
                    type="text"
                    value={formData.yourPhone}
                    onChange={(e) => setFormData({...formData, yourPhone: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Your Zoom Link
                  </label>
                  <input
                    type="text"
                    value={formData.yourZoom}
                    onChange={(e) => setFormData({...formData, yourZoom: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Lead Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lead Name
                  </label>
                  <input
                    type="text"
                    value={formData.leadName}
                    onChange={(e) => setFormData({...formData, leadName: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lead LinkedIn
                  </label>
                  <input
                    type="text"
                    value={formData.leadLinkedIn}
                    onChange={(e) => setFormData({...formData, leadLinkedIn: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lead Location
                    <span className="text-gray-500 text-xs ml-1">(defaults to Brisbane)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.leadLocation}
                    onChange={(e) => setFormData({...formData, leadLocation: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Brisbane, Australia"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lead Email
                    <span className="text-red-500 text-xs ml-1">(required for booking)</span>
                  </label>
                  <input
                    type="email"
                    value={formData.leadEmail}
                    onChange={(e) => setFormData({...formData, leadEmail: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lead Phone
                  </label>
                  <input
                    type="text"
                    value={formData.leadPhone}
                    onChange={(e) => setFormData({...formData, leadPhone: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6 mt-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Actions</h2>
              
              <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                <h3 className="font-medium text-gray-800 mb-3">Generate AI Message</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Select multiple times to suggest to lead
                </p>
                <div className="space-y-2 mb-4">
                  {suggestTimes.map((time, index) => (
                    <input
                      key={index}
                      type="datetime-local"
                      value={time}
                      onChange={(e) => {
                        const newTimes = [...suggestTimes];
                        newTimes[index] = e.target.value;
                        setSuggestTimes(newTimes);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  ))}
                </div>
                
                <button
                  onClick={handleGenerateMessage}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-md font-medium disabled:bg-gray-400"
                >
                  {loading ? 'Generating...' : '💬 Generate Message'}
                </button>
                
                {generateError && (
                  <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
                    ❌ {generateError}
                  </div>
                )}
                
                {generatedMessage && (
                  <div className="mt-4 p-4 bg-white border rounded-md">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-gray-700">Generated Message:</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedMessage);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                      >
                        {copied ? '✅ Copied!' : '📋 Copy'}
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-gray-800">
                      {generatedMessage}
                    </pre>
                  </div>
                )}
              </div>

              <div className="p-4 bg-green-50 rounded-lg">
                <h3 className="font-medium text-gray-800 mb-3">Book Meeting</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Select a time - opens Google Calendar to review and save
                </p>
                <input
                  type="datetime-local"
                  value={bookTime}
                  onChange={(e) => setBookTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md mb-4"
                />
                <button
                  onClick={handleBookMeeting}
                  className="w-full bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-md font-medium"
                >
                  📅 Open in Google Calendar
                </button>
                
                {bookError && (
                  <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
                    ❌ {bookError}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CalendarBookingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>}>
      <CalendarBookingContent />
    </Suspense>
  );
}
