const getSignalingURL = () => {
    if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const override = params.get('signaling');
        if (override) return override;

        if (process.env.NEXT_PUBLIC_SIGNALING_URL) {
            return process.env.NEXT_PUBLIC_SIGNALING_URL;
        }

        // If on production but no URL set, we can try to guess a subdomain or just warn
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            console.warn('PRODUCTION DETECTED: NEXT_PUBLIC_SIGNALING_URL is missing. Falling back to localhost will fail.');
        }
    }
    return process.env.NEXT_PUBLIC_SIGNALING_URL || 'ws://localhost:8080';
};

const signalingUrl = getSignalingURL();

export const CONFIG = {
    SIGNALING_URL: signalingUrl,
    SIGNALING_URL_HTTP: signalingUrl
        .replace('ws://', 'http://')
        .replace('wss://', 'https://'),
    // Anti-abuse: Maximum relay size per session (2GB default)
    MAX_RELAY_BYTES: 2 * 1024 * 1024 * 1024,
};

if (typeof window !== 'undefined') {
    console.log('CONFIG INITIALIZED:', {
        ws: CONFIG.SIGNALING_URL,
        http: CONFIG.SIGNALING_URL_HTTP,
        envSet: !!process.env.NEXT_PUBLIC_SIGNALING_URL
    });
}
