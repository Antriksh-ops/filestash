import { NextResponse } from 'next/server';

/**
 * Issue #8 fix: Use env vars directly for server-side signaling URL
 * instead of importing the client-side CONFIG (which resolves to localhost
 * on Vercel because window is undefined server-side).
 */
function getServerSignalingUrl(): string {
    const envUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
    if (envUrl && !envUrl.includes('SIGNALLING_SERVER_HOST')) {
        return envUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    }
    // Production fallback — same as the client-side config.ts fallback
    return 'https://filestash-z8go.onrender.com';
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { sessionId, manifest } = body;

        if (!sessionId || !manifest) {
            return NextResponse.json({ error: 'Missing sessionId or manifest' }, { status: 400 });
        }

        const signalingUrl = getServerSignalingUrl();

        const response = await fetch(`${signalingUrl}/session/${sessionId}/manifest`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(manifest),
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`Signaling server responded with ${response.status}: ${errorMsg}`);
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Manifest proxy error:', error);
        return NextResponse.json(
            { error: 'Failed to proxy manifest update' },
            { status: 500 }
        );
    }
}
