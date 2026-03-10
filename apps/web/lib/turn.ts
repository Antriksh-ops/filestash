export async function getIceServers(): Promise<RTCIceServer[]> {
    try {
        const response = await fetch('/api/ice-servers');
        if (!response.ok) {
            throw new Error(`Failed to fetch ICE servers: ${response.status}`);
        }
        const data = await response.json();
        return data as RTCIceServer[];
    } catch (error) {
        console.error('Failed to fetch Metered ICE servers, falling back to Google STUN:', error);
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ];
    }
}
