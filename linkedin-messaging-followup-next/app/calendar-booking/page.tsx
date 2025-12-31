'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
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
  conversationHint: string;
}

interface ClientInfo {
  clientId: string;
  clientName: string;
  calendarConnected: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp?: string;
  bookingAction?: BookingAction;
}

interface BookingAction {
  type: 'setBookingTime' | 'openCalendar';
  dateTime: string;
  timezone: string;
  displayTime: string;
  leadDisplayTime: string;
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
    conversationHint: '',
  });
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<string>('');
  const [generateError, setGenerateError] = useState<string>('');
  const [bookError, setBookError] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [confirmCopied, setConfirmCopied] = useState(false);
  const [suggestTimes, setSuggestTimes] = useState<string[]>(['', '', '']);
  const [bookTime, setBookTime] = useState<string>('');
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [leadTimezone, setLeadTimezone] = useState<string>('');
  const [yourTimezone] = useState<string>('Australia/Brisbane');
  const [leadDisplayTime, setLeadDisplayTime] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  
  // Confirmation message state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [includeEmailInConfirm, setIncludeEmailInConfirm] = useState(true);
  const [confirmationMessage, setConfirmationMessage] = useState('');

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

  // Scroll chat to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Generate confirmation message when booking time changes
  useEffect(() => {
    if (bookTime && showConfirmation) {
      generateConfirmationMessage();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookTime, includeEmailInConfirm, showConfirmation, leadDisplayTime]);

  const parseClipboardData = (text: string): FormData | null => {
    try {
      const fields = text.split('|||').map(f => f.trim());
      
      // Accept 7-10 fields:
      // 1-4: Your Name, LinkedIn, Phone, Zoom
      // 5-7: Lead Name, LinkedIn, Location
      // 8: Lead Email (optional)
      // 9: Conversation Hint / Booking Time Preference (optional)
      // 10: Lead Phone (optional)
      if (fields.length < 7 || fields.length > 10) {
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
        leadEmail: fields[7] ? extractValue(fields[7]) : '',
        conversationHint: fields[8] ? extractValue(fields[8]) : '',
        leadPhone: fields[9] ? extractValue(fields[9]) : '',
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
        setError('❌ Clipboard data format invalid. Expected 7-10 fields separated by |||');
        return;
      }

      setFormData(parsed);
      setSuccess('✅ Data loaded from clipboard successfully!');
      setError('');
      
      // If there's a conversation hint, add it as initial context in chat
      if (parsed.conversationHint) {
        setChatMessages([{
          role: 'assistant',
          content: `📋 From your conversation: "${parsed.conversationHint}"\n\nHow can I help you schedule this meeting?`
        }]);
      }
    } catch (err) {
      setError('❌ Failed to read clipboard. Please allow clipboard access.');
    }
  };

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading) return;
    
    const userMessage = chatInput.trim();
    const timestamp = new Date().toLocaleTimeString();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp }]);
    setChatLoading(true);

    try {
      // Call backend directly (same pattern as AIEditModal for attributes)
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace('/api/linkedin', '') || 'https://pb-webhook-server-staging.onrender.com';
      const response = await fetch(`${baseUrl}/api/calendar/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientInfo!.clientId,
        },
        body: JSON.stringify({
          message: userMessage,
          messages: chatMessages,
          context: {
            yourName: formData.yourName,
            yourTimezone,
            leadName: formData.leadName,
            leadLocation: formData.leadLocation || 'Brisbane',
            conversationHint: formData.conversationHint,
          },
        }),
      });

      const data = await response.json();
      const responseTimestamp = new Date().toLocaleTimeString();
      
      // Check for HTTP errors first (401, 500, etc.)
      if (!response.ok) {
        const errorMsg = data.error || data.message || `Request failed (${response.status})`;
        setChatMessages(prev => [...prev, { 
          role: 'error', 
          content: errorMsg,
          timestamp: responseTimestamp
        }]);
      } else if (data.error) {
        setChatMessages(prev => [...prev, { 
          role: 'error', 
          content: data.error,
          timestamp: responseTimestamp
        }]);
      } else {
        // Build booking action if present
        const bookingAction = data.action?.type === 'setBookingTime' ? data.action as BookingAction : undefined;
        
        setChatMessages(prev => [...prev, { 
          role: 'assistant', 
          content: data.message,
          timestamp: responseTimestamp,
          bookingAction
        }]);
        
        // Update timezone info
        if (data.leadTimezone) {
          setLeadTimezone(data.leadTimezone);
        }
        
        // Handle booking action - auto-fill the picker
        if (data.action?.type === 'setBookingTime') {
          const action = data.action as BookingAction;
          // Convert ISO to datetime-local format
          const dt = new Date(action.dateTime);
          const localDateTime = dt.toISOString().slice(0, 16);
          setBookTime(localDateTime);
          setLeadDisplayTime(action.leadDisplayTime || '');
          setSuccess(`✅ Time set: ${action.displayTime} (${action.leadDisplayTime} for lead)`);
        }
        
        // Handle openCalendar action - auto-open Google Calendar
        if (data.action?.type === 'openCalendar') {
          // Small delay so user sees the AI response first
          setTimeout(() => {
            handleBookMeeting();
          }, 500);
        }
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { 
        role: 'error', 
        content: 'Failed to send message. Please try again.',
        timestamp: new Date().toLocaleTimeString()
      }]);
    } finally {
      setChatLoading(false);
      // Auto-focus back to input
      setTimeout(() => chatInputRef.current?.focus(), 100);
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

  const generateConfirmationMessage = () => {
    const leadFirstName = formData.leadName.split(' ')[0] || 'there';
    const yourFirstName = formData.yourName.split(' ')[0] || '';
    
    // Format the meeting time for display
    let meetingTimeDisplay = '';
    if (bookTime) {
      const dt = new Date(bookTime);
      meetingTimeDisplay = dt.toLocaleString('en-AU', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      
      // Add lead's timezone if different
      if (leadDisplayTime && leadDisplayTime !== meetingTimeDisplay) {
        meetingTimeDisplay = leadDisplayTime;
      }
    }
    
    const emailPart = includeEmailInConfirm && formData.leadEmail 
      ? ` to ${formData.leadEmail}` 
      : '';
    
    const message = `Hi ${leadFirstName},

Great! I have just sent a calendar invite for ${meetingTimeDisplay}${emailPart} - did it come through?

Looking forward to meeting!

${yourFirstName}`;
    
    setConfirmationMessage(message);
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
    
    // Show confirmation message section
    setShowConfirmation(true);
    generateConfirmationMessage();
    setSuccess('✅ Google Calendar opened - send confirmation to lead below');
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
                📅 Calendar not configured - contact admin to set up calendar sharing
              </p>
            </div>
          )}

          {clientInfo.calendarConnected && (
            <p className="mt-2 text-green-600 font-medium">
              ✅ Calendar Ready
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
              Paste AI Blaze output (7-10 fields with |||)
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
                    <span className="text-gray-500 text-xs ml-1">(for timezone)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.leadLocation}
                    onChange={(e) => setFormData({...formData, leadLocation: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Sydney, Australia"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lead Email
                    <span className="text-gray-500 text-xs ml-1">(optional - adds as guest)</span>
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
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Booking Time Preference
                    <span className="text-gray-500 text-xs ml-1">(from conversation)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.conversationHint}
                    onChange={(e) => setFormData({...formData, conversationHint: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g. Wednesday arvo next week"
                  />
                </div>
              </div>
            </div>

            {/* Chat Section for Booking */}
            {clientInfo.calendarConnected && (
              <div className="border-t pt-6 mt-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">📅 Smart Booking Assistant</h2>
                
                {formData.conversationHint && (
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <span className="text-sm text-blue-800">
                      💬 From conversation: &quot;{formData.conversationHint}&quot;
                    </span>
                  </div>
                )}
                
                <div className="bg-gray-50 rounded-lg p-4 mb-4 h-72 overflow-y-auto">
                  {chatMessages.length === 0 ? (
                    <div className="text-gray-500 text-center py-8">
                      <p className="mb-2">🤖 Ask me about your availability!</p>
                      <p className="text-sm">Try: &quot;What&apos;s free Thursday?&quot; or &quot;Check next Tuesday lunch&quot;</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {chatMessages.map((msg, idx) => (
                        <div key={idx}>
                          {/* User messages */}
                          {msg.role === 'user' && (
                            <div className="text-sm p-3 rounded-lg bg-blue-100 ml-8">
                              <div className="flex justify-between items-start mb-1">
                                <span className="font-medium text-blue-800">You:</span>
                                {msg.timestamp && <span className="text-xs text-blue-600">{msg.timestamp}</span>}
                              </div>
                              <div className="text-blue-900">{msg.content}</div>
                            </div>
                          )}
                          
                          {/* Assistant messages */}
                          {msg.role === 'assistant' && (
                            <div className="text-sm p-3 rounded-lg bg-green-50 border border-green-200 mr-8">
                              <div className="flex justify-between items-start mb-1">
                                <span className="font-medium text-green-700">🤖 AI Assistant:</span>
                                {msg.timestamp && <span className="text-xs text-green-600">{msg.timestamp}</span>}
                              </div>
                              <pre className="whitespace-pre-wrap font-sans text-green-800">{msg.content}</pre>
                              
                              {/* Booking action button */}
                              {msg.bookingAction && (
                                <div className="mt-3 p-2 bg-white border border-green-300 rounded">
                                  <div className="text-xs text-green-700 mb-2">✨ Suggested time:</div>
                                  <div className="text-sm font-medium mb-2">{msg.bookingAction.displayTime}</div>
                                  <button
                                    onClick={() => {
                                      // Set time first, then open calendar
                                      const dateTimeToBook = msg.bookingAction!.dateTime;
                                      setBookTime(dateTimeToBook);
                                      if (msg.bookingAction!.leadDisplayTime) {
                                        setLeadDisplayTime(msg.bookingAction!.leadDisplayTime);
                                      }
                                      // Open Google Calendar directly with this time
                                      const startDate = new Date(dateTimeToBook);
                                      const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
                                      const formatGCalDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
                                      const leadNamePart = formData.leadName || 'Contact';
                                      const yourNamePart = formData.yourName || 'Me';
                                      const title = `${leadNamePart} and ${yourNamePart} meeting`;
                                      const descLines = [];
                                      if (formData.yourZoom) descLines.push(`Zoom: ${formData.yourZoom}`);
                                      if (formData.leadLinkedIn) descLines.push(`${leadNamePart}: ${formData.leadLinkedIn}`);
                                      const description = descLines.join('\n');
                                      const location = formData.yourZoom || formData.leadLocation || 'Zoom';
                                      let calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE`;
                                      calUrl += `&text=${encodeURIComponent(title)}`;
                                      calUrl += `&dates=${formatGCalDate(startDate)}/${formatGCalDate(endDate)}`;
                                      calUrl += `&details=${encodeURIComponent(description)}`;
                                      calUrl += `&location=${encodeURIComponent(location)}`;
                                      if (formData.leadEmail) calUrl += `&add=${encodeURIComponent(formData.leadEmail)}`;
                                      window.open(calUrl, '_blank');
                                    }}
                                    className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                  >
                                    Book a Time
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Error messages */}
                          {msg.role === 'error' && (
                            <div className="text-sm p-3 rounded-lg bg-red-50 border border-red-200 mr-8">
                              <div className="flex justify-between items-start mb-1">
                                <span className="font-medium text-red-700">❌ Error:</span>
                                {msg.timestamp && <span className="text-xs text-red-600">{msg.timestamp}</span>}
                              </div>
                              <div className="text-red-800">{msg.content}</div>
                            </div>
                          )}
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="text-sm p-3 rounded-lg bg-green-50 border border-green-200 mr-8">
                          <span className="text-green-700">🤖 Checking calendar...</span>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleChatSend())}
                    placeholder="What's free Thursday afternoon?"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm resize-none"
                    rows={2}
                    disabled={chatLoading}
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={chatLoading || !chatInput.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium disabled:bg-gray-400 self-end"
                  >
                    {chatLoading ? 'Thinking...' : 'Ask AI'}
                  </button>
                </div>
              </div>
            )}
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
