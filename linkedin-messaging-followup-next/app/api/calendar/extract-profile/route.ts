import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/calendar/extract-profile
 * Uses AI to extract lead profile data from raw LinkedIn copy-paste
 */
export async function POST(request: Request) {
  try {
    const { rawText } = await request.json();

    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json({ error: 'rawText is required' }, { status: 400 });
    }

    // Truncate if too long (first 15000 chars should have all profile info)
    const text = rawText.substring(0, 15000);

    // Use Gemini to extract profile data
    const prompt = `You are a LinkedIn profile data extractor. Extract the following fields from this raw LinkedIn profile copy-paste.

EXTRACT THESE FIELDS:
1. leadName - The person's full name (first and last name). Look for the name that appears prominently at the top of the profile, often after "Background Image" or similar. Ignore pronouns like (She/Her).
2. leadLocation - Their location (city, region, country). Look for patterns like "Greater Brisbane Area" or "Sydney, Australia".
3. leadEmail - Their email if visible on the profile. If not found, return empty string.
4. leadPhone - Their phone number if visible on the profile. If not found, return empty string.
5. bookingTimeHint - If there's any conversation visible that mentions meeting times (e.g., "next week", "Thursday afternoon", "after Christmas"), extract that hint. If not found, return empty string.
6. headline - Their job title/headline (the line that describes what they do)
7. company - Their current company if identifiable from headline or experience

IMPORTANT RULES:
- For leadName: Get the actual person's name, not "LinkedIn" or UI text. The name typically appears 2-3 times at the start.
- For leadLocation: Extract just the location, not "Contact info" or other UI text.
- For bookingTimeHint: Look in any messaging/conversation section for time-related phrases.
- Return ONLY valid JSON, no markdown, no explanation.

RAW LINKEDIN TEXT:
${text}

RESPOND WITH ONLY THIS JSON FORMAT (no markdown):
{"leadName":"","leadLocation":"","leadEmail":"","leadPhone":"","bookingTimeHint":"","headline":"","company":""}`;

    // Call Gemini API (using the backend's Gemini setup)
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return NextResponse.json(
        { error: 'AI extraction failed', details: errorText },
        { status: 500 }
      );
    }

    const geminiData = await geminiResponse.json();
    
    // Extract the text response
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      console.error('No response from Gemini:', geminiData);
      return NextResponse.json(
        { error: 'No response from AI' },
        { status: 500 }
      );
    }

    // Parse JSON from response (handle potential markdown wrapping)
    let extracted;
    try {
      // Remove markdown code blocks if present
      let cleanJson = responseText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      extracted = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse AI response', raw: responseText },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      extracted: {
        leadName: extracted.leadName || '',
        leadLocation: extracted.leadLocation || '',
        leadEmail: extracted.leadEmail || '',
        leadPhone: extracted.leadPhone || '',
        bookingTimeHint: extracted.bookingTimeHint || '',
        headline: extracted.headline || '',
        company: extracted.company || '',
      },
    });

  } catch (error) {
    console.error('Profile extraction error:', error);
    return NextResponse.json(
      { error: 'Profile extraction failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
