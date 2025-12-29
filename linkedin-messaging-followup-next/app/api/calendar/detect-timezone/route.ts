import { NextResponse } from 'next/server';

// Timezone detection logic
function detectTimezoneFromLocation(location: string): { timezone: string; offset: string } | null {
  const lower = location.toLowerCase();

  // Australian cities
  if (lower.includes('perth')) return { timezone: 'Australia/Perth', offset: 'AWST (UTC+8)' };
  if (lower.includes('sydney')) return { timezone: 'Australia/Sydney', offset: 'AEDT (UTC+11)' };
  if (lower.includes('melbourne')) return { timezone: 'Australia/Melbourne', offset: 'AEDT (UTC+11)' };
  if (lower.includes('brisbane')) return { timezone: 'Australia/Brisbane', offset: 'AEST (UTC+10)' };
  if (lower.includes('adelaide')) return { timezone: 'Australia/Adelaide', offset: 'ACDT (UTC+10:30)' };
  if (lower.includes('darwin')) return { timezone: 'Australia/Darwin', offset: 'ACST (UTC+9:30)' };
  if (lower.includes('hobart')) return { timezone: 'Australia/Hobart', offset: 'AEDT (UTC+11)' };
  if (lower.includes('canberra')) return { timezone: 'Australia/Sydney', offset: 'AEDT (UTC+11)' };

  // Australian states (fallback)
  if (lower.includes('western australia') || lower.includes('wa, australia')) {
    return { timezone: 'Australia/Perth', offset: 'AWST (UTC+8)' };
  }
  if (lower.includes('new south wales') || lower.includes('nsw')) {
    return { timezone: 'Australia/Sydney', offset: 'AEDT (UTC+11)' };
  }
  if (lower.includes('victoria')) {
    return { timezone: 'Australia/Melbourne', offset: 'AEDT (UTC+11)' };
  }
  if (lower.includes('queensland')) {
    return { timezone: 'Australia/Brisbane', offset: 'AEST (UTC+10)' };
  }
  if (lower.includes('south australia')) {
    return { timezone: 'Australia/Adelaide', offset: 'ACDT (UTC+10:30)' };
  }

  // Generic Australia = Brisbane (no daylight saving)
  if (lower.includes('australia')) {
    return { timezone: 'Australia/Brisbane', offset: 'AEST (UTC+10)' };
  }

  // US cities
  if (lower.includes('new york') || lower.includes('nyc')) {
    return { timezone: 'America/New_York', offset: 'EST (UTC-5)' };
  }
  if (lower.includes('los angeles') || lower.includes('la,')) {
    return { timezone: 'America/Los_Angeles', offset: 'PST (UTC-8)' };
  }
  if (lower.includes('chicago')) {
    return { timezone: 'America/Chicago', offset: 'CST (UTC-6)' };
  }
  if (lower.includes('san francisco')) {
    return { timezone: 'America/Los_Angeles', offset: 'PST (UTC-8)' };
  }

  // US states
  if (lower.includes('california')) {
    return { timezone: 'America/Los_Angeles', offset: 'PST (UTC-8)' };
  }
  if (lower.includes('texas')) {
    return { timezone: 'America/Chicago', offset: 'CST (UTC-6)' };
  }
  if (lower.includes('florida')) {
    return { timezone: 'America/New_York', offset: 'EST (UTC-5)' };
  }
  if (lower.includes('illinois')) {
    return { timezone: 'America/Chicago', offset: 'CST (UTC-6)' };
  }

  // UK
  if (lower.includes('london') || lower.includes('united kingdom') || lower.includes('uk')) {
    return { timezone: 'Europe/London', offset: 'GMT (UTC+0)' };
  }

  // Other major cities
  if (lower.includes('singapore')) {
    return { timezone: 'Asia/Singapore', offset: 'SGT (UTC+8)' };
  }
  if (lower.includes('tokyo')) {
    return { timezone: 'Asia/Tokyo', offset: 'JST (UTC+9)' };
  }
  if (lower.includes('hong kong')) {
    return { timezone: 'Asia/Hong_Kong', offset: 'HKT (UTC+8)' };
  }
  if (lower.includes('dubai')) {
    return { timezone: 'Asia/Dubai', offset: 'GST (UTC+4)' };
  }

  return null;
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
