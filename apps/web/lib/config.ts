export const CONFIG = {
    SIGNALING_URL: process.env.NEXT_PUBLIC_SIGNALING_URL || 'ws://localhost:8080',
    SIGNALING_URL_HTTP: process.env.NEXT_PUBLIC_SIGNALING_URL_HTTP ||
        (process.env.NEXT_PUBLIC_SIGNALING_URL || 'ws://localhost:8080')
            .replace('ws://', 'http://')
            .replace('wss://', 'https://'),
    // Anti-abuse: Maximum relay size per session (2GB default)
    MAX_RELAY_BYTES: 2 * 1024 * 1024 * 1024,
};

console.log('CONFIG INITIALIZED:', {
    ws: CONFIG.SIGNALING_URL,
    http: CONFIG.SIGNALING_URL_HTTP
});
