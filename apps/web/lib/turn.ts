export async function getIceServers(): Promise<RTCIceServer[]> {
    const defaultStun = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
    ];

    try {
        const response = await fetch('/api/ice-servers');
        if (!response.ok) {
            throw new Error(`Failed to fetch ICE servers: ${response.status}`);
        }
        const data = await response.json();
        // Prepend reliable public STUNs to force maximum chance of NAT hairpinning (Gigabit speeds)
        // before falling back to Metered TURN (1Mbps limit).
        return [...defaultStun, ...(data as RTCIceServer[])];
    } catch (error) {
        console.error('Failed to fetch Metered ICE servers, falling back to Google STUN:', error);
        return defaultStun;
    }
}
