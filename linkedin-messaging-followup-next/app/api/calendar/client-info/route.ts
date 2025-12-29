import { NextResponse } from 'next/server';

// This will connect to your existing clientService once we integrate with backend
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json({ error: 'Client ID required' }, { status: 400 });
    }

    // TODO: Connect to existing clientService.js on backend
    // For now, mock response for guy-wilson
    if (clientId === 'guy-wilson') {
      return NextResponse.json({
        clientId: 'guy-wilson',
        clientName: 'Guy Wilson',
        calendarConnected: false, // Will be true after OAuth
      });
    }

    // Return error for unknown clients
    return NextResponse.json(
      { error: 'Client not found or inactive' },
      { status: 404 }
    );

  } catch (error) {
    console.error('Client info error:', error);
    return NextResponse.json(
      { error: 'Failed to load client information' },
      { status: 500 }
    );
  }
}
