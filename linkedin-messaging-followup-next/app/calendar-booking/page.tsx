'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ClientIdPrompt from '../../components/ClientIdPrompt';
import { verifyCalendarConnection, updateClientTimezone, updateClientCalendarEmail } from '../../services/api';
import { setCurrentClientId } from '../../utils/clientUtils';

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
  calendarEmail: string | null;
  timezone: string | null;
  timezoneConfigured: boolean;
  // Profile fields for form auto-fill
  linkedInUrl: string | null;
  phone: string | null;
  meetingLink: string | null;
  location: string | null;
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
  const [bookTime, setBookTime] = useState<string>('');
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [leadTimezone, setLeadTimezone] = useState<string>('');
  const [yourTimezone, setYourTimezone] = useState<string>('Australia/Brisbane');
  const [leadDisplayTime, setLeadDisplayTime] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  
  // Confirmation message state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [includeEmailInConfirm, setIncludeEmailInConfirm] = useState(true);
  const [confirmationMessage, setConfirmationMessage] = useState('');

  // Load client info from URL
  const [showClientPrompt, setShowClientPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string>('');
  const router = useRouter();
  
  // Lead lookup state (URL/email/name-based lookup)
  const [lookingUpLead, setLookingUpLead] = useState(false);
  const [leadLookupError, setLeadLookupError] = useState('');
  const [leadRecordId, setLeadRecordId] = useState<string | null>(null);
  const [leadFound, setLeadFound] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    recordId: string;
    firstName: string;
    lastName: string;
    fullName: string;
    linkedInUrl: string;
    location: string;
    email: string;
    phone: string;
    headline: string;
    company: string;
    aiScore: number | null;
  }>>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Raw LinkedIn paste extraction (legacy - kept for fallback)
  const [rawPasteText, setRawPasteText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState('');
  
  // Setup state for self-service configuration
  const [showSetup, setShowSetup] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState('');
  const [customTimezone, setCustomTimezone] = useState('');
  const [calendarEmail, setCalendarEmail] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [verifyingCalendar, setVerifyingCalendar] = useState(false);
  const [calendarVerified, setCalendarVerified] = useState(false);
  const [calendarAccessError, setCalendarAccessError] = useState<string | null>(null);
  const [verifyingOnLoad, setVerifyingOnLoad] = useState(false);
  
  // Service account email from environment variable
  const serviceAccountEmail = process.env.NEXT_PUBLIC_GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  
  // Timezone options
  const TIMEZONE_OPTIONS = [
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', region: 'Australia' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)', region: 'Australia' },
    { value: 'Australia/Brisbane', label: 'Brisbane (AEST)', region: 'Australia' },
    { value: 'Australia/Perth', label: 'Perth (AWST)', region: 'Australia' },
    { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)', region: 'Australia' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)', region: 'Pacific' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)', region: 'Asia' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', region: 'Asia' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)', region: 'Asia' },
    { value: 'Europe/London', label: 'London (GMT/BST)', region: 'Europe' },
    { value: 'America/New_York', label: 'New York (EST/EDT)', region: 'Americas' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)', region: 'Americas' },
  ];
  
  useEffect(() => {
    const clientId = searchParams.get('client');
    if (!clientId) {
      setShowClientPrompt(true);
      return;
    }

    // Set the client ID for api.js functions to use
    setCurrentClientId(clientId);

    fetch(`/api/calendar/client-info?clientId=${clientId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          // Invalid client - clear URL and show prompt with error
          setPromptError(data.error);
          setShowClientPrompt(true);
          // Clear the URL params
          window.history.replaceState({}, '', window.location.pathname);
        } else {
          setClientInfo(data);
          // Set timezone from client config, fallback to Brisbane
          if (data.timezoneConfigured && data.timezone) {
            setYourTimezone(data.timezone);
          }
          // Auto-fill "Your Details" from client profile
          setFormData(prev => ({
            ...prev,
            yourName: data.clientName || prev.yourName,
            yourLinkedIn: data.linkedInUrl || prev.yourLinkedIn,
            yourPhone: data.phone || prev.yourPhone,
            yourZoom: data.meetingLink || prev.yourZoom,
          }));
        }
      })
      .catch(() => {
        setPromptError('Failed to load client information');
        setShowClientPrompt(true);
        window.history.replaceState({}, '', window.location.pathname);
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

  // Verify calendar access on page load when calendar email is configured
  useEffect(() => {
    if (clientInfo?.calendarConnected && clientInfo?.calendarEmail && !calendarVerified && !verifyingOnLoad && !calendarAccessError) {
      setVerifyingOnLoad(true);
      
      verifyCalendarConnection(clientInfo.calendarEmail)
        .then(data => {
          if (data.success) {
            setCalendarVerified(true);
            setCalendarAccessError(null);
          } else {
            setCalendarAccessError(data.message || 'Calendar sharing may have been removed');
          }
        })
        .catch((err: Error) => {
          setCalendarAccessError(err.message || 'Failed to verify calendar access');
        })
        .finally(() => {
          setVerifyingOnLoad(false);
        });
    }
  }, [clientInfo, calendarVerified, verifyingOnLoad, calendarAccessError]);

  // Helper to validate timezone
  const isValidTimezone = (tz: string): boolean => {
    if (!tz) return false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };

  // Save setup (timezone + calendar email)
  const handleSaveSetup = async () => {
    if (!clientInfo) return;
    
    const timezoneToSave = selectedTimezone === 'OTHER' ? customTimezone.trim() : selectedTimezone;
    
    // Validate timezone if provided
    if (timezoneToSave && !isValidTimezone(timezoneToSave)) {
      setSetupError(`Invalid timezone: "${timezoneToSave}"`);
      return;
    }
    
    // Validate email if provided
    if (calendarEmail && !calendarEmail.includes('@')) {
      setSetupError('Please enter a valid email address');
      return;
    }
    
    setSetupSaving(true);
    setSetupError('');
    
    try {
      // Save timezone if changed
      if (timezoneToSave) {
        await updateClientTimezone(timezoneToSave);
        setYourTimezone(timezoneToSave);
      }
      
      // Save calendar email if changed
      if (calendarEmail) {
        await updateClientCalendarEmail(calendarEmail);
      }
      
      // Refresh client info
      const refreshRes = await fetch(`/api/calendar/client-info?clientId=${clientInfo.clientId}`);
      const refreshData = await refreshRes.json();
      if (!refreshData.error) {
        setClientInfo(refreshData);
        if (refreshData.timezoneConfigured && refreshData.timezone) {
          setYourTimezone(refreshData.timezone);
        }
      }
      
      // If both are now configured, close setup
      if ((timezoneToSave || clientInfo.timezoneConfigured) && (calendarEmail || clientInfo.calendarConnected)) {
        setShowSetup(false);
      }
      
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSetupSaving(false);
    }
  };

  // Verify calendar connection
  const handleVerifyCalendar = async () => {
    if (!clientInfo) return;
    
    setVerifyingCalendar(true);
    setSetupError('');
    
    try {
      // Use the calendar email from input if provided, otherwise from clientInfo
      const emailToVerify = calendarEmail || clientInfo.calendarEmail;
      if (!emailToVerify) {
        setSetupError('Please enter a calendar email first');
        return;
      }
      
      const data = await verifyCalendarConnection(emailToVerify);
      
      if (data.success) {
        setCalendarVerified(true);
        setCalendarAccessError(null);
        // Refresh client info
        const refreshRes = await fetch(`/api/calendar/client-info?clientId=${clientInfo.clientId}`);
        const refreshData = await refreshRes.json();
        if (!refreshData.error) {
          setClientInfo(refreshData);
        }
      } else {
        setSetupError(data.message || 'Calendar not accessible - check sharing permissions');
      }
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to connect to server');
    } finally {
      setVerifyingCalendar(false);
    }
  };

  // Open setup and pre-populate existing values
  const openSetup = () => {
    // Pre-populate timezone if configured
    if (clientInfo?.timezoneConfigured && clientInfo?.timezone) {
      const matchingOption = TIMEZONE_OPTIONS.find(tz => tz.value === clientInfo.timezone);
      if (matchingOption) {
        setSelectedTimezone(clientInfo.timezone);
      } else {
        setSelectedTimezone('OTHER');
        setCustomTimezone(clientInfo.timezone);
      }
    }
    // Pre-populate calendar email if configured
    if (clientInfo?.calendarEmail) {
      setCalendarEmail(clientInfo.calendarEmail);
    }
    setShowSetup(true);
  };

  // Copy service account email to clipboard
  const handleCopyServiceEmail = async () => {
    if (serviceAccountEmail) {
      await navigator.clipboard.writeText(serviceAccountEmail);
    }
  };

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

  // Extract lead data from raw LinkedIn paste using AI
  const handleExtractFromPaste = async () => {
    if (!rawPasteText.trim()) {
      setExtractionError('Please paste LinkedIn profile content first');
      return;
    }
    
    setExtracting(true);
    setExtractionError('');
    
    try {
      const response = await fetch('/api/calendar/extract-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          rawText: rawPasteText,
          clientId: clientInfo?.clientId || 'unknown'
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        setExtractionError(data.error || 'Failed to extract profile data');
        return;
      }
      
      const { extracted } = data;
      
      console.log('Extracted data:', extracted);
      
      // Update lead fields from extraction
      // Keep leadLinkedIn if already set (user pasted URL separately)
      setFormData(prev => ({
        ...prev,
        leadName: extracted.leadName || prev.leadName,
        leadLocation: extracted.leadLocation || prev.leadLocation,
        leadEmail: extracted.leadEmail || prev.leadEmail,
        leadPhone: extracted.leadPhone || prev.leadPhone,
        conversationHint: extracted.bookingTimeHint || prev.conversationHint,
      }));
      
      // Build success message with extracted fields
      const extractedFields = [];
      if (extracted.leadName) extractedFields.push(`Name: ${extracted.leadName}`);
      if (extracted.leadLocation) extractedFields.push(`Location: ${extracted.leadLocation}`);
      if (extracted.headline) extractedFields.push(`Title: ${extracted.headline}`);
      
      setSuccess(`✅ Extracted: ${extractedFields.join(' | ') || extracted.leadName}`);
      setRawPasteText(''); // Clear paste area on success
      
      // If there's a booking hint, add it to chat
      if (extracted.bookingTimeHint) {
        setChatMessages([{
          role: 'assistant',
          content: `📋 Found booking hint: "${extracted.bookingTimeHint}"\n\nHow can I help you schedule this meeting?`
        }]);
      }
    } catch (err) {
      setExtractionError('Failed to extract profile data. Please try again.');
    } finally {
      setExtracting(false);
    }
  };

  // Look up lead by LinkedIn URL, email, or name in Airtable
  const handleSearchLead = async (query: string) => {
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setLookingUpLead(true);
    setLeadLookupError('');
    setLeadFound(null);

    try {
      const response = await fetch(`/api/calendar/lookup-lead?query=${encodeURIComponent(query.trim())}`, {
        headers: {
          'x-client-id': clientInfo?.clientId || '',
        },
      });

      const data = await response.json();

      if (!response.ok || !data.found) {
        setSearchResults([]);
        setShowSearchResults(false);
        setLeadFound(false);
        setLeadLookupError(data.message || 'Lead not found');
        return;
      }

      // Check if single result or multiple
      if (data.leads) {
        // Multiple results - show dropdown
        setSearchResults(data.leads);
        setShowSearchResults(true);
        setLeadFound(null);
      } else {
        // Single result - auto-select
        selectLead(data);
      }

    } catch (err) {
      setLeadLookupError('Failed to look up lead. Please try again.');
      setSearchResults([]);
      setShowSearchResults(false);
    } finally {
      setLookingUpLead(false);
    }
  };

  // Select a lead from search results
  const selectLead = (lead: { recordId: string; fullName: string; location: string; email: string; phone: string; linkedInUrl: string; headline?: string }) => {
    setLeadFound(true);
    setLeadRecordId(lead.recordId);
    setFormData(prev => ({
      ...prev,
      leadName: lead.fullName || '',
      leadLocation: lead.location || '',
      leadEmail: lead.email || '',
      leadPhone: lead.phone || '',
      leadLinkedIn: lead.linkedInUrl || prev.leadLinkedIn,
      conversationHint: '', // Clear previous booking context
    }));
    
    // Clear search state
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    setChatMessages([]);

    // Build success message
    const foundFields = [];
    if (lead.fullName) foundFields.push(lead.fullName);
    if (lead.location) foundFields.push(lead.location);
    if (lead.headline) foundFields.push(lead.headline);
    
    setSuccess(`✅ Found: ${foundFields.join(' | ')}`);
  };

  // Legacy: Look up lead by LinkedIn URL directly (for paste events)
  const handleLookupLead = async (urlOverride?: string) => {
    const url = (urlOverride || formData.leadLinkedIn).trim();
    
    if (!url) {
      setLeadLookupError('Please enter a search term');
      return;
    }

    // Use the new search function
    await handleSearchLead(url);
  };

  // Save updated lead details back to Airtable
  const handleSaveLeadDetails = async () => {
    if (!leadRecordId) {
      setLeadLookupError('No lead record to update');
      return;
    }

    setLookingUpLead(true);
    setLeadLookupError('');

    try {
      const response = await fetch('/api/calendar/update-lead', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientInfo?.clientId || '',
        },
        body: JSON.stringify({
          recordId: leadRecordId,
          location: formData.leadLocation,
          email: formData.leadEmail,
          phone: formData.leadPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setLeadLookupError(data.error || 'Failed to save lead details');
        return;
      }

      setSuccess('✅ Lead details saved to Airtable');

    } catch (err) {
      setLeadLookupError('Failed to save lead details. Please try again.');
    } finally {
      setLookingUpLead(false);
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
            leadEmail: formData.leadEmail || '',
            leadPhone: formData.leadPhone || '',
            leadLinkedIn: formData.leadLinkedIn || '',
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
          const action = data.action as BookingAction & { openCalendar?: boolean };
          // Convert ISO to datetime-local format
          const dt = new Date(action.dateTime);
          const localDateTime = dt.toISOString().slice(0, 16);
          setBookTime(localDateTime);
          setLeadDisplayTime(action.leadDisplayTime || '');
          setSuccess(`✅ Time set: ${action.displayTime} (${action.leadDisplayTime} for lead)`);
          
          // If openCalendar flag is set, also open the calendar
          if (action.openCalendar) {
            // Small delay so user sees the time set first
            setTimeout(() => {
              handleBookMeeting();
            }, 500);
          }
        }
        
        // Handle standalone openCalendar action (legacy support)
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
    setError('');
    
    if (!bookTime.trim()) {
      setError('Please select a meeting time');
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

  // Show client ID prompt if no client in URL
  if (showClientPrompt) {
    return (
      <ClientIdPrompt 
        title="Smart Booking Assistant"
        description="Enter your client code to access your personalized calendar booking assistant."
        initialError={promptError}
      />
    );
  }

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
          
          {/* Configuration prompts - friendly style with Set Up button */}
          {(!clientInfo.timezoneConfigured || !clientInfo.calendarConnected) && !showSetup && (
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700 mb-1">Quick setup needed</p>
                  <ul className="text-xs text-gray-500 space-y-1">
                    {!clientInfo.timezoneConfigured && (
                      <li className="flex items-center gap-2">
                        <span className="text-gray-400">•</span>
                        <span>Set your timezone {clientInfo.timezone ? `(current: "${clientInfo.timezone}")` : ''}</span>
                      </li>
                    )}
                    {!clientInfo.calendarConnected && (
                      <li className="flex items-center gap-2">
                        <span className="text-gray-400">•</span>
                        <span>Connect your Google Calendar</span>
                      </li>
                    )}
                  </ul>
                </div>
                <button
                  onClick={openSetup}
                  className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Set Up
                </button>
              </div>
            </div>
          )}

          {/* Setup Panel - shown when user clicks Set Up */}
          {showSetup && (
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-700">
                    {clientInfo.timezoneConfigured && clientInfo.calendarConnected ? 'Edit Settings' : 'Quick Setup'}
                  </h3>
                  {!(clientInfo.timezoneConfigured && clientInfo.calendarConnected) && (
                    <p className="text-xs text-gray-500 mt-1">Just a few quick steps to get you started</p>
                  )}
                </div>
                <button
                  onClick={() => setShowSetup(false)}
                  className="text-gray-500 hover:text-gray-700 text-sm"
                >
                  Cancel
                </button>
              </div>

              {/* Timezone Section - always show in setup */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-600">
                  Your Timezone {clientInfo.timezoneConfigured && <span className="text-xs text-gray-400">(current: {yourTimezone})</span>}
                </label>
                <select
                  value={selectedTimezone === 'OTHER' ? 'OTHER' : selectedTimezone}
                  onChange={(e) => {
                      if (e.target.value === 'OTHER') {
                        setSelectedTimezone('OTHER');
                        setCustomTimezone('');
                      } else {
                        setSelectedTimezone(e.target.value);
                        setCustomTimezone('');
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Choose timezone...</option>
                    <optgroup label="Australia">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Australia').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Pacific">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Pacific').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Asia">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Asia').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Europe">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Europe').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Americas">
                      {TIMEZONE_OPTIONS.filter(tz => tz.region === 'Americas').map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </optgroup>
                    <option value="OTHER">Other (enter manually)...</option>
                  </select>
                  {selectedTimezone === 'OTHER' && (
                    <input
                      type="text"
                      value={customTimezone}
                      onChange={(e) => setCustomTimezone(e.target.value)}
                      placeholder="e.g. Europe/Paris, America/Denver"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  )}
              </div>

              {/* Calendar Section - always show in setup */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-600">
                  Google Calendar {clientInfo.calendarConnected && <span className="text-xs text-gray-400">(configured)</span>}
                </label>
                  
                  {/* Step 1: Share calendar */}
                  <div className="p-3 bg-white rounded border border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-2">Step 1: Share your calendar</p>
                    {serviceAccountEmail ? (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-gray-100 p-2 rounded break-all">{serviceAccountEmail}</code>
                        <button
                          onClick={handleCopyServiceEmail}
                          className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                        >
                          Copy
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">Loading...</p>
                    )}
                    <p className="text-xs text-gray-500 mt-2">
                      In Google Calendar → Settings → Share with specific people → Add this email with <span className="font-semibold text-gray-700">"Make changes to events"</span> permission
                    </p>
                  </div>

                  {/* Step 2: Enter your email */}
                  <div className="p-3 bg-white rounded border border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-2">Step 2: Enter your calendar email</p>
                    <input
                      type="email"
                      value={calendarEmail}
                      onChange={(e) => setCalendarEmail(e.target.value)}
                      placeholder="your.email@gmail.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>
              </div>

              {/* Error message */}
              {setupError && (
                <p className="text-sm text-red-600">{setupError}</p>
              )}

              {/* Calendar verified message */}
              {calendarVerified && (
                <p className="text-sm text-green-600">✅ Calendar connected successfully!</p>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveSetup}
                  disabled={setupSaving || (!selectedTimezone && !calendarEmail)}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
                >
                  {setupSaving ? 'Saving...' : 'Save'}
                </button>
                {calendarEmail && (
                  <button
                    onClick={handleVerifyCalendar}
                    disabled={verifyingCalendar}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
                  >
                    {verifyingCalendar ? 'Verifying...' : 'Verify Calendar'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Status indicators */}
          {clientInfo.calendarConnected && clientInfo.timezoneConfigured && !showSetup && (
            <>
              {verifyingOnLoad && (
                <p className="mt-2 text-gray-500 font-medium flex items-center gap-2">
                  <span className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                  Verifying calendar...
                </p>
              )}
              {!verifyingOnLoad && calendarVerified && !calendarAccessError && (
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-green-600 font-medium">
                    ✅ Ready ({clientInfo.location || yourTimezone.split('/').pop()?.replace('_', ' ')})
                  </p>
                  <span className="text-xs text-gray-400">Your timezone: {yourTimezone}</span>
                  <button
                    onClick={openSetup}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    Edit
                  </button>
                </div>
              )}
              {!verifyingOnLoad && calendarAccessError && (
                <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800 font-medium">⚠️ Calendar sharing needed</p>
                  <p className="text-xs text-amber-700 mt-2">
                    Share your Google Calendar with this email (set to <span className="font-semibold">"Make changes to events"</span>):
                  </p>
                  {serviceAccountEmail && (
                    <div className="flex items-center gap-2 mt-2">
                      <code className="flex-1 text-xs bg-white p-2 rounded border border-amber-200 break-all">{serviceAccountEmail}</code>
                      <button
                        onClick={handleCopyServiceEmail}
                        className="px-2 py-1 text-xs bg-amber-200 hover:bg-amber-300 rounded"
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setCalendarAccessError(null);
                      openSetup();
                    }}
                    className="mt-3 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded font-medium"
                  >
                    Open Setup
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
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

            {/* Lead Lookup by URL, Email, or Name */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-blue-800 mb-2">🔍 Find Lead</h2>
              <p className="text-sm text-blue-600 mb-3">
                Search by LinkedIn URL, email, or name to find the lead in your Airtable.
              </p>
              
              {/* Search input with debounced lookup */}
              <div className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setSearchQuery(newValue);
                        setLeadFound(null);
                        setLeadLookupError('');
                        
                        // Clear existing timeout
                        if (searchTimeoutRef.current) {
                          clearTimeout(searchTimeoutRef.current);
                        }
                        
                        // Debounced search (300ms)
                        if (newValue.trim().length >= 2) {
                          searchTimeoutRef.current = setTimeout(() => {
                            handleSearchLead(newValue);
                          }, 300);
                        } else {
                          setSearchResults([]);
                          setShowSearchResults(false);
                        }
                      }}
                      placeholder="LinkedIn URL, email, or name..."
                      className="w-full pl-10 pr-4 py-2 border border-blue-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={() => handleSearchLead(searchQuery)}
                    disabled={lookingUpLead || searchQuery.trim().length < 2}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {lookingUpLead ? '🔄' : '🔍'}
                  </button>
                </div>
                
                {/* Search results dropdown */}
                {showSearchResults && searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchResults.map((lead) => (
                      <button
                        key={lead.recordId}
                        onClick={() => selectLead(lead)}
                        className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                      >
                        <div className="font-medium text-gray-900">
                          {lead.firstName} {lead.lastName}
                          {lead.aiScore && (
                            <span className="ml-2 text-xs text-blue-600 font-normal">
                              Score: {lead.aiScore}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {lead.headline && <span>{lead.headline}</span>}
                          {lead.headline && lead.company && <span> @ </span>}
                          {lead.company && <span>{lead.company}</span>}
                        </div>
                        {lead.email && (
                          <div className="text-xs text-gray-400">{lead.email}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Lookup result feedback */}
              {leadLookupError && (
                <p className="mt-2 text-sm text-red-600">{leadLookupError}</p>
              )}
              {leadFound === false && !lookingUpLead && searchQuery.trim().length >= 2 && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                  <p className="text-yellow-800">⚠️ Lead not found. You can still enter details manually below.</p>
                </div>
              )}
              {leadFound === true && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-sm">
                  <p className="text-green-800">✅ Lead found! Details loaded below. Edit if needed and save.</p>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-gray-800">Lead Details</h2>
                {leadRecordId && (
                  <button
                    onClick={handleSaveLeadDetails}
                    disabled={lookingUpLead}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {lookingUpLead ? 'Saving...' : '💾 Save'}
                  </button>
                )}
              </div>
              {leadRecordId && (
                <p className="text-xs text-gray-500 mb-3">
                  If you click Save, changes to Location, Email, or Phone will be saved to the lead&apos;s record.
                </p>
              )}
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
                
                <div className="bg-gray-50 rounded-lg p-4 mb-4 min-h-72 max-h-96 overflow-y-auto">
                  {chatMessages.length === 0 ? (
                    <div className="text-gray-500 text-center py-8">
                      <p className="mb-2">🤖 Ask me about your availability!</p>
                      <p className="text-sm">I can check any date in the next 90 days.</p>
                      <p className="text-sm mt-1">Try: &quot;What&apos;s free Thursday?&quot; or &quot;Check end of February&quot;</p>
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
                                      // Add your info (LinkedIn + phone)
                                      if (formData.yourLinkedIn || formData.yourPhone) {
                                        let yourLine = `${yourNamePart}: `;
                                        if (formData.yourLinkedIn) yourLine += formData.yourLinkedIn;
                                        if (formData.yourLinkedIn && formData.yourPhone) yourLine += ' | ';
                                        if (formData.yourPhone) yourLine += formData.yourPhone;
                                        descLines.push(yourLine);
                                      }
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
                    placeholder="Book a call anytime in the next 90 days..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm resize-y min-h-[80px]"
                    rows={4}
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
