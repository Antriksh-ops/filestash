import { NextResponse } from 'next/server';
import { CONFIG } from '@/lib/config';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { sessionId, manifest } = body;

        if (!sessionId || !manifest) {
            return NextResponse.json({ error: 'Missing sessionId or manifest' }, { status: 400 });
        }

        const signalingUrl = CONFIG.SIGNALING_URL_HTTP;

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
