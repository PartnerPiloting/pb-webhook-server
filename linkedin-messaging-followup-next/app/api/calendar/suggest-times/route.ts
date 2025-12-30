import { NextResponse } from 'next/server';

function formatDateTime(dateTimeStr: string, fromTimezone: string, toTimezone: string): string {
  // Convert datetime-local format to readable format
  // This is a simplified version - you may want to use a library like date-fns-tz
  try {
    const date = new Date(dateTimeStr);
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: fromTimezone,
    };
    return date.toLocaleString('en-US', options);
  } catch (error) {
    return dateTimeStr;
  }
}

async function generateMessageWithGemini(params: {
  yourName: string;
  leadName: string;
  leadLocation: string;
  suggestedTimes: string[];
  yourTimezone: string;
  leadTimezone?: string;
}): Promise<string> {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured');
    }

    const firstName = params.leadName.split(' ')[0];
    
    // Convert times to lead's timezone
    const timesInLeadTimezone = params.suggestedTimes.map((time, idx) => {
      const formatted = formatDateTime(time, params.yourTimezone, params.leadTimezone || 'UTC');
      return `Option ${idx + 1}: ${formatted}`;
    }).join('\n');

    const prompt = `You are helping ${params.yourName} suggest meeting times to ${params.leadName} who is located in ${params.leadLocation}.

${params.yourName} is in Brisbane, Australia (AEST UTC+10).
${params.leadName} is in ${params.leadLocation} (${params.leadTimezone || 'Unknown timezone'}).

Generate a friendly, professional message suggesting these meeting times (already converted to ${params.leadName}'s local timezone):

${timesInLeadTimezone}

Requirements:
- Use first name only: "${firstName}"
- Warm but professional tone
- Mention the timezone has been converted for their convenience
- Keep it concise (3-4 sentences)
- Include a call-to-action asking which time works best
- Sign off with "${params.yourName}"

Generate the message:`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    const data = await response.json();
    console.log('Gemini response:', JSON.stringify(data));
    
    const message = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // If Gemini returned empty, use fallback
    if (!message.trim()) {
      console.log('Gemini returned empty, using fallback');
      const firstName = params.leadName.split(' ')[0];
      return `Hi ${firstName},\n\nI'd love to schedule a time to connect. Here are a few options that should work well with your ${params.leadLocation} timezone:\n\n${params.suggestedTimes.map((t, i) => `Option ${i + 1}: ${t}`).join('\n')}\n\nWhich time works best for you?\n\nBest regards,\n${params.yourName}`;
    }
    
    return message.trim();
  } catch (error) {
    console.error('Gemini message generation failed:', error);
    
    // Fallback message
    const firstName = params.leadName.split(' ')[0];
    return `Hi ${firstName},\n\nI'd love to schedule a time to connect. Here are a few options that should work well with your ${params.leadLocation} timezone:\n\n${params.suggestedTimes.map((t, i) => `Option ${i + 1}: ${t}`).join('\n')}\n\nWhich time works best for you?\n\nBest regards,\n${params.yourName}`;
  }
}

export async function POST(request: Request) {
  try {
    const {
      yourName,
      leadName,
      leadLocation,
      leadTimezone,
      suggestedTimes,
      yourTimezone,
    } = await request.json();

    if (!suggestedTimes || suggestedTimes.length === 0) {
      return NextResponse.json(
        { error: 'At least one time slot is required' },
        { status: 400 }
      );
    }
    
    // Use fallback values for optional fields
    const finalYourName = yourName?.trim() || '[Your Name]';
    const finalLeadName = leadName?.trim() || '[Contact]';
    const finalLeadLocation = leadLocation?.trim() || 'Brisbane, Australia';

    const message = await generateMessageWithGemini({
      yourName: finalYourName,
      leadName: finalLeadName,
      leadLocation: finalLeadLocation,
      leadTimezone,
      suggestedTimes,
      yourTimezone: yourTimezone || 'Australia/Brisbane',
    });

    return NextResponse.json({ message });

  } catch (error) {
    console.error('Suggest times error:', error);
    return NextResponse.json(
      { error: 'Failed to generate message' },
      { status: 500 }
    );
  }
}
