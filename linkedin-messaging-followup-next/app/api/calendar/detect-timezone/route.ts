import { NextResponse } from 'next/server';
import { getTimezoneFromLocation } from '../../../../lib/timezoneFromLocation';

// Offset strings for display (approximate - DST varies)
const TZ_OFFSETS: Record<string, string> = {
  'Australia/Perth': 'AWST (UTC+8)',
  'Australia/Sydney': 'AEDT (UTC+11)',
  'Australia/Melbourne': 'AEDT (UTC+11)',
  'Australia/Brisbane': 'AEST (UTC+10)',
  'Australia/Adelaide': 'ACDT (UTC+10:30)',
  'Australia/Darwin': 'ACST (UTC+9:30)',
  'Australia/Hobart': 'AEDT (UTC+11)',
  'Pacific/Auckland': 'NZDT (UTC+13)',
  'America/New_York': 'EST (UTC-5)',
  'America/Los_Angeles': 'PST (UTC-8)',
  'America/Chicago': 'CST (UTC-6)',
  'Europe/London': 'GMT (UTC+0)',
  'Asia/Singapore': 'SGT (UTC+8)',
  'Asia/Tokyo': 'JST (UTC+9)',
  'Asia/Hong_Kong': 'HKT (UTC+8)',
  'Asia/Dubai': 'GST (UTC+4)',
};

function detectTimezoneFromLocation(location: string): { timezone: string; offset: string } | null {
  const timezone = getTimezoneFromLocation(location);
  if (!timezone) return null;
  const offset = TZ_OFFSETS[timezone] || `${timezone.split('/').pop()} (UTC)`;
  return { timezone, offset };
}

async function detectTimezoneWithGemini(location: string): Promise<{ timezone: string; offset: string }> {
  try {
    // Use Gemini to detect timezone for unknown locations
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `What is the IANA timezone identifier for "${location}"? Reply ONLY with the timezone in format: Continent/City|||Abbreviation (UTC offset). Example: America/New_York|||EST (UTC-5)`
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 100,
          },
        }),
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Parse response: "America/Chicago|||CST (UTC-6)"
    const [timezone, offset] = text.split('|||').map((s: string) => s.trim());
    
    if (timezone && offset) {
      return { timezone, offset };
    }

    // Fallback
    return { timezone: 'UTC', offset: 'UTC (UTC+0)' };
  } catch (error) {
    console.error('Gemini timezone detection failed:', error);
    return { timezone: 'UTC', offset: 'UTC (UTC+0)' };
  }
}

export async function POST(request: Request) {
  try {
    const { location } = await request.json();

    if (!location) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    // Try rule-based detection first
    const detected = detectTimezoneFromLocation(location);
    
    if (detected) {
      return NextResponse.json(detected);
    }

    // Fallback to Gemini for unknown locations
    const geminiResult = await detectTimezoneWithGemini(location);
    return NextResponse.json(geminiResult);

  } catch (error) {
    console.error('Timezone detection error:', error);
    return NextResponse.json(
      { error: 'Failed to detect timezone' },
      { status: 500 }
    );
  }
}
