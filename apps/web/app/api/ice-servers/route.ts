import { NextResponse } from 'next/server';

export async function GET() {
    const apiKey = process.env.METERED_API_KEY;
    const appName = process.env.METERED_APP_NAME;

    if (!apiKey || !appName) {
        console.error('Metered API key or app name is missing');
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    try {
        const response = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`, {
            cache: 'no-store'
        });

        if (!response.ok) {
            console.error(`Metered API responded with status: ${response.status}`);
            return NextResponse.json({ error: 'Failed to fetch ICE servers' }, { status: 502 });
        }

        const iceServers = await response.json();

        return NextResponse.json(iceServers, {
            headers: {
                'Cache-Control': 'no-store'
            }
        });
    } catch (error) {
        console.error('Error fetching ICE servers from Metered:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
