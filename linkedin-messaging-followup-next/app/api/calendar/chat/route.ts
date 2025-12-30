import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Types for chat messages and actions
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface BookingAction {
  type: 'setBookingTime';
  dateTime: string;
  timezone: string;
  leadDateTime: string;
  leadTimezone: string;
  displayTime: string;
  leadDisplayTime: string;
}

interface ChatContext {
  yourName: string;
  yourTimezone: string; // Brisbane for now
  leadName: string;
  leadLocation: string;
  leadTimezone: string;
  conversationHint?: string; // Field 9 from AI Blaze
}

// Helper to get timezone from location
async function getTimezoneFromLocation(location: string): Promise<string> {
  // Simple mapping for common Australian cities
  const locationLower = location.toLowerCase();
  
  if (locationLower.includes('sydney') || locationLower.includes('melbourne') || locationLower.includes('canberra')) {
    return 'Australia/Sydney';
  }
  if (locationLower.includes('brisbane') || locationLower.includes('queensland')) {
    return 'Australia/Brisbane';
  }
  if (locationLower.includes('perth') || locationLower.includes('western australia')) {
    return 'Australia/Perth';
  }
  if (locationLower.includes('adelaide') || locationLower.includes('south australia')) {
    return 'Australia/Adelaide';
  }
  if (locationLower.includes('darwin') || locationLower.includes('northern territory')) {
    return 'Australia/Darwin';
  }
  if (locationLower.includes('hobart') || locationLower.includes('tasmania')) {
    return 'Australia/Hobart';
  }
  if (locationLower.includes('auckland') || locationLower.includes('new zealand') || locationLower.includes('wellington')) {
    return 'Pacific/Auckland';
  }
  if (locationLower.includes('singapore')) {
    return 'Asia/Singapore';
  }
  if (locationLower.includes('hong kong')) {
    return 'Asia/Hong_Kong';
  }
  if (locationLower.includes('tokyo') || locationLower.includes('japan')) {
    return 'Asia/Tokyo';
  }
  if (locationLower.includes('london') || locationLower.includes('uk') || locationLower.includes('england')) {
    return 'Europe/London';
  }
  if (locationLower.includes('new york') || locationLower.includes('ny')) {
    return 'America/New_York';
  }
  if (locationLower.includes('los angeles') || locationLower.includes('la') || locationLower.includes('california')) {
    return 'America/Los_Angeles';
  }
  
  // Default to Brisbane
  return 'Australia/Brisbane';
}

// Helper to get valid access token (same as freebusy route)
async function getValidAccessToken(clientId: string): Promise<{ token: string; error?: string }> {
  const lookupResponse = await fetch(
    `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients?filterByFormula=LOWER({Client ID})=LOWER('${clientId}')&fields[]=Google Calendar Token&fields[]=Google Calendar Refresh Token&fields[]=Google Calendar Token Expiry`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
      },
      cache: 'no-store',
    }
  );

  if (!lookupResponse.ok) {
    return { token: '', error: 'Failed to lookup client' };
  }

  const data = await lookupResponse.json();
  if (!data.records || data.records.length === 0) {
    return { token: '', error: 'Client not found' };
  }

  const record = data.records[0];
  const fields = record.fields;
  const accessToken = fields['Google Calendar Token'];
  const refreshToken = fields['Google Calendar Refresh Token'];
  const tokenExpiry = fields['Google Calendar Token Expiry'];

  if (!accessToken || !refreshToken) {
    return { token: '', error: 'Calendar not connected' };
  }

  const expiryDate = new Date(tokenExpiry);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;

  if (expiryDate.getTime() - bufferMs > now.getTime()) {
    return { token: accessToken };
  }

  // Refresh token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });

  const tokens = await tokenResponse.json();
  if (tokens.error) {
    return { token: '', error: 'Failed to refresh token' };
  }

  const newExpiryDate = new Date(Date.now() + tokens.expires_in * 1000);

  await fetch(
    `https://api.airtable.com/v0/${process.env.MASTER_CLIENTS_BASE_ID}/Clients/${record.id}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          'Google Calendar Token': tokens.access_token,
          'Google Calendar Token Expiry': newExpiryDate.toISOString(),
        },
      }),
    }
  );

  return { token: tokens.access_token };
}

// Helper to get free slots for a date range
async function getFreeSlotsForDate(
  accessToken: string,
  date: string,
  startHour: number = 9,
  endHour: number = 17,
  timezone: string = 'Australia/Brisbane'
): Promise<Array<{ time: string; display: string }>> {
  const startTime = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`);
  const endTime = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00`);

  const freebusyResponse = await fetch(
    'https://www.googleapis.com/calendar/v3/freeBusy',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        timeZone: timezone,
        items: [{ id: 'primary' }],
      }),
    }
  );

  if (!freebusyResponse.ok) {
    console.error('FreeBusy API error:', await freebusyResponse.text());
    return [];
  }

  const freebusyData = await freebusyResponse.json();
  const busySlots = freebusyData.calendars?.primary?.busy || [];

  const freeSlots: Array<{ time: string; display: string }> = [];
  const slotDuration = 30 * 60 * 1000;

  for (let time = startTime.getTime(); time < endTime.getTime(); time += slotDuration) {
    const slotStart = new Date(time);
    const slotEnd = new Date(time + slotDuration);

    const isAvailable = !busySlots.some((busy: { start: string; end: string }) => {
      const busyStart = new Date(busy.start).getTime();
      const busyEnd = new Date(busy.end).getTime();
      return slotStart.getTime() < busyEnd && slotEnd.getTime() > busyStart;
    });

    if (isAvailable) {
      const displayTime = slotStart.toLocaleTimeString('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });

      freeSlots.push({
        time: slotStart.toISOString(),
        display: displayTime,
      });
    }
  }

  return freeSlots;
}

// Format time in a specific timezone
function formatTimeInTimezone(isoTime: string, timezone: string): string {
  const date = new Date(isoTime);
  return date.toLocaleString('en-AU', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
}

// Convert time between timezones
function convertTime(isoTime: string, fromTz: string, toTz: string): string {
  // The ISO time is already absolute, so we just format it in the target timezone
  return formatTimeInTimezone(isoTime, toTz);
}

export async function POST(request: Request) {
  try {
    const clientId = request.headers.get('x-client-id');
    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    const body = await request.json();
    const { message, messages = [], context }: { 
      message: string; 
      messages: ChatMessage[]; 
      context: ChatContext 
    } = body;

    if (!message || !context) {
      return NextResponse.json({ error: 'Message and context required' }, { status: 400 });
    }

    // Get valid access token for calendar queries
    const { token, error: tokenError } = await getValidAccessToken(clientId);
    if (tokenError) {
      return NextResponse.json({ error: tokenError }, { status: 401 });
    }

    // Detect lead timezone from location
    const leadTimezone = await getTimezoneFromLocation(context.leadLocation || 'Brisbane');
    const yourTimezone = 'Australia/Brisbane'; // Hardcoded for now

    // Get today's date and next 7 days for potential calendar queries
    const today = new Date();
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    // Build system prompt with context
    const systemPrompt = `You are a helpful calendar booking assistant for ${context.yourName}.

CONTEXT:
- Your timezone: ${yourTimezone} (Brisbane)
- Lead's name: ${context.leadName}
- Lead's location: ${context.leadLocation || 'Unknown'}
- Lead's timezone: ${leadTimezone}
- Today's date: ${today.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
${context.conversationHint ? `- From conversation: "${context.conversationHint}"` : ''}

YOUR CAPABILITIES:
1. Check calendar availability for specific dates
2. Show free time slots in both your timezone and lead's timezone
3. Suggest the best meeting time when asked
4. Set a booking time when the user confirms

RULES:
- Always show times in BOTH timezones: "2pm Brisbane (3pm Sydney for ${context.leadName})"
- Be conversational but concise
- When user picks a time, respond with confirmation and include the ACTION JSON
- For vague requests like "next week", ask which specific days to check

ACTIONS:
When the user confirms a booking time, include this JSON at the END of your response (on its own line):
ACTION: {"type":"setBookingTime","dateTime":"2025-01-07T14:00:00","timezone":"Australia/Brisbane"}

The frontend will parse this to auto-fill the booking form.`;

    // Check if the user is asking about availability
    const isAvailabilityQuery = message.toLowerCase().match(/free|available|open|slot|what.*work|check.*calendar|tuesday|wednesday|thursday|friday|monday|saturday|sunday|tomorrow|next week|this week/i);

    let calendarContext = '';
    
    if (isAvailabilityQuery) {
      // Try to extract date references from the message
      const dayMatches = message.toLowerCase().match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today/gi) || [];
      
      if (dayMatches.length > 0 || message.toLowerCase().includes('next week') || message.toLowerCase().includes('this week')) {
        // Get availability for mentioned days
        const slots: { date: string; day: string; freeSlots: Array<{ time: string; display: string; leadDisplay: string }> }[] = [];
        
        for (const dateStr of dates) {
          const date = new Date(dateStr);
          const dayName = date.toLocaleDateString('en-AU', { weekday: 'long', timeZone: yourTimezone }).toLowerCase();
          
          // Check if this day was mentioned
          const shouldInclude = dayMatches.some(m => dayName.includes(m.toLowerCase())) ||
            (message.toLowerCase().includes('tomorrow') && dateStr === dates[1]) ||
            (message.toLowerCase().includes('today') && dateStr === dates[0]) ||
            message.toLowerCase().includes('next week') ||
            message.toLowerCase().includes('this week');
          
          if (shouldInclude) {
            const freeSlots = await getFreeSlotsForDate(token, dateStr, 9, 17, yourTimezone);
            
            // Add lead timezone display for each slot
            const slotsWithLeadTime = freeSlots.map(slot => ({
              ...slot,
              leadDisplay: formatTimeInTimezone(slot.time, leadTimezone),
            }));
            
            slots.push({
              date: dateStr,
              day: date.toLocaleDateString('en-AU', { weekday: 'long', month: 'short', day: 'numeric', timeZone: yourTimezone }),
              freeSlots: slotsWithLeadTime,
            });
          }
        }
        
        if (slots.length > 0) {
          calendarContext = `\n\nCALENDAR AVAILABILITY:\n${slots.map(s => 
            `${s.day}: ${s.freeSlots.length > 0 ? s.freeSlots.slice(0, 8).map(f => `${f.display} Brisbane (${f.leadDisplay} for lead)`).join(', ') : 'Fully booked'}`
          ).join('\n')}`;
        }
      }
    }

    // Build conversation history for Gemini
    const conversationHistory = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    // Add the new message
    conversationHistory.push({
      role: 'user',
      parts: [{ text: message + calendarContext }]
    });

    // Call Gemini
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 });
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: conversationHistory,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    const geminiData = await geminiResponse.json();
    console.log('Gemini chat response:', JSON.stringify(geminiData, null, 2));

    // Check for Gemini API errors
    if (geminiData.error) {
      console.error('Gemini API error:', geminiData.error);
      return NextResponse.json({
        message: `❌ Gemini API error: ${geminiData.error.message || 'Unknown error'}`,
        leadTimezone,
        yourTimezone,
      });
    }

    // Check if response has expected structure
    if (!geminiData.candidates || !geminiData.candidates[0]?.content?.parts?.[0]?.text) {
      console.error('Unexpected Gemini response structure:', geminiData);
      return NextResponse.json({
        message: '❌ Gemini returned an unexpected response. Please try again.',
        leadTimezone,
        yourTimezone,
      });
    }

    const responseText = geminiData.candidates[0].content.parts[0].text;

    // Parse any ACTION from the response
    let action: BookingAction | null = null;
    const actionMatch = responseText.match(/ACTION:\s*({.*})/);
    
    if (actionMatch) {
      try {
        const actionData = JSON.parse(actionMatch[1]);
        if (actionData.type === 'setBookingTime') {
          // Enhance the action with display times
          action = {
            ...actionData,
            leadTimezone,
            leadDateTime: actionData.dateTime, // Same absolute time, different display
            displayTime: formatTimeInTimezone(actionData.dateTime, yourTimezone),
            leadDisplayTime: formatTimeInTimezone(actionData.dateTime, leadTimezone),
          };
        }
      } catch (e) {
        console.error('Failed to parse action:', e);
      }
    }

    // Remove the ACTION line from the message shown to user
    const cleanMessage = responseText.replace(/ACTION:\s*{.*}/, '').trim();

    return NextResponse.json({
      message: cleanMessage,
      action,
      leadTimezone,
      yourTimezone,
    });

  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
}
