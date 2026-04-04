const getSignalingURL = () => {
    if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const override = params.get('signaling');
        if (override) return override;

        const envUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
        if (envUrl && !envUrl.includes('SIGNALLING_SERVER_HOST')) {
            return envUrl;
        }

        // Production Fallback: connect to the Render signaling server
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            return 'wss://filestash-z8go.onrender.com';
        }

        return `ws://localhost:8080`;
    }
    return process.env.NEXT_PUBLIC_SIGNALING_URL && !process.env.NEXT_PUBLIC_SIGNALING_URL.includes('SIGNALLING_SERVER_HOST')
        ? process.env.NEXT_PUBLIC_SIGNALING_URL
        : 'ws://localhost:8080';
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
