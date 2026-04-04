const { WebSocketServer, WebSocket } = require('ws');
const { createServer } = require('http');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');

const PORT = process.env.PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Anti-abuse: Limits
const MAX_RELAY_BYTES_PER_SESSION = 1024 * 1024 * 1024; // 1GB Hard Cap
const MAX_SESSIONS_PER_IP_WINDOW = 500; // Sessions per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 Hour

const ipSessionTracker = new Map(); // ip -> { count, startTime }
const relayByteTracker = new Map(); // sessionId -> totalBytes
const nearbyCodeMap = new Map(); // 4-digit code -> { sessionId, ip, createdAt }

// Redis client for session metadata
let redis = null;
try {
    redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
            if (times > 3) return null;
            return 1000;
        }
    });
    redis.on('error', (err) => {
        console.warn('Redis connection failed, continuing with in-memory sessions only.');
        redis = null;
    });
} catch (e) {
    console.warn('Could not initialize Redis:', e);
}

const sessions = new Map(); // Fallback for when Redis is unavailable
const sessionPeers = new Map();

const server = createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/session/create') {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ip = rawIp.split(',')[0].trim();
        const now = Date.now();

        if (!ipSessionTracker.has(ip)) {
            ipSessionTracker.set(ip, { count: 0, startTime: now });
        }

        const tracking = ipSessionTracker.get(ip);
        if (now - tracking.startTime > RATE_LIMIT_WINDOW) {
            tracking.count = 0;
            tracking.startTime = now;
        }

        if (tracking.count >= MAX_SESSIONS_PER_IP_WINDOW) {
            console.warn(`Rate limit exceeded for IP ${ip}`);
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in an hour.' }));
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            tracking.count++;
            try {
                const metadata = JSON.parse(body);
                const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
                const sessionData = {
                    ...metadata,
                    sessionId,
                    creatorIp: ip,
                    chunkManifest: metadata.chunkManifest || {},
                    createdAt: Date.now(),
                    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24h default
                };

                if (redis) {
                    await redis.set(`session:${sessionId}`, JSON.stringify(sessionData), 'EX', 24 * 60 * 60);
                } else {
                    sessions.set(sessionId, sessionData);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(sessionData));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid metadata' }));
            }
        });
        return;
    }

    if (req.url.startsWith('/session/')) {
        const parts = req.url.split('/');
        const sessionId = parts[2];
        const isManifestRequest = parts[3] === 'manifest';

        let sessionData = null;
        if (redis) {
            const data = await redis.get(`session:${sessionId}`);
            if (data) sessionData = JSON.parse(data);
        } else {
            sessionData = sessions.get(sessionId);
        }

        if (!sessionData) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
        }

        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (isManifestRequest) {
                res.end(JSON.stringify(sessionData.chunkManifest || {}));
            } else {
                res.end(JSON.stringify(sessionData));
            }
            return;
        }

        if (req.method === 'PUT' && isManifestRequest) {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const newManifest = JSON.parse(body);
                    sessionData.chunkManifest = { ...sessionData.chunkManifest, ...newManifest };

                    if (redis) {
                        await redis.set(`session:${sessionId}`, JSON.stringify(sessionData), 'EX', 24 * 60 * 60);
                    } else {
                        sessions.set(sessionId, sessionData);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid manifest' }));
                }
            });
            return;
        }
    }

    // --- Nearby Devices endpoints ---
    if (req.method === 'POST' && req.url === '/nearby/create') {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ip = rawIp.split(',')[0].trim();
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { sessionId } = JSON.parse(body);
                // Generate a unique 4-digit code
                let code;
                let attempts = 0;
                do {
                    code = String(Math.floor(1000 + Math.random() * 9000));
                    attempts++;
                } while (nearbyCodeMap.has(code) && attempts < 100);

                nearbyCodeMap.set(code, { sessionId, ip, createdAt: Date.now() });

                // Auto-expire after 10 minutes
                setTimeout(() => nearbyCodeMap.delete(code), 10 * 60 * 1000);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code, sessionId }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request' }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/nearby/resolve')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const code = url.searchParams.get('code');
        const entry = nearbyCodeMap.get(code);

        if (entry) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sessionId: entry.sessionId, ip: entry.ip }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Code not found or expired' }));
        }
        return;
    }

    if (req.method === 'GET' && req.url.startsWith('/nearby/peers')) {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ip = rawIp.split(',')[0].trim();
        // Find all active sessions created from the same IP (same network)
        const nearbySessions = [];
        for (const [code, entry] of nearbyCodeMap.entries()) {
            if (entry.ip === ip) {
                nearbySessions.push({ code, sessionId: entry.sessionId });
            }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ peers: nearbySessions }));
        return;
    }

    // Health check endpoint for Render / uptime monitors
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            activeSessions: sessionPeers.size
        }));
        return;
    }

    res.writeHead(404);
    res.end();
});


const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const peerId = uuidv4();

    if (!sessionId) {
        ws.close(1008, 'Missing sessionId');
        return;
    }

    if (!sessionPeers.has(sessionId)) {
        sessionPeers.set(sessionId, new Set());
    }
    sessionPeers.get(sessionId).add(ws);

    console.log(`Peer ${peerId} joined session ${sessionId}`);

    // Notify others that someone joined
    const peers = sessionPeers.get(sessionId);
    if (peers) {
        peers.forEach((peer) => {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                peer.send(JSON.stringify({ type: 'peer_joined', peerId }));
            }
        });
    }

    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            // RELAY fallback bandwidth tracking
            const currentBytes = relayByteTracker.get(sessionId) || 0;
            const newTotal = currentBytes + data.length;

            if (newTotal > MAX_RELAY_BYTES_PER_SESSION) {
                console.warn(`Session ${sessionId} exceeded relay bandwidth cap. Terminating.`);
                ws.send(JSON.stringify({ type: 'error', message: 'Relay bandwidth limit exceeded' }));
                ws.close(1008, 'Bandwidth limit exceeded');
                return;
            }

            relayByteTracker.set(sessionId, newTotal);

            // RELAY fallback: broadcast binary data to all OTHER peers in session
            const peers = sessionPeers.get(sessionId);
            if (peers) {
                peers.forEach((peer) => {
                    if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                        peer.send(data, { binary: true });
                    }
                });
            }
            return;
        }

        try {
            const message = JSON.parse(data.toString());
            // Broadcast signaling to other peers in the SAME session
            const peers = sessionPeers.get(sessionId);
            if (peers) {
                peers.forEach((peer) => {
                    if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                        peer.send(JSON.stringify({
                            peerId,
                            ...message
                        }));
                    }
                });
            }
        } catch (e) {
            console.error('Failed to parse message', e);
        }
    });

    ws.on('close', () => {
        const peersInSession = sessionPeers.get(sessionId);
        peersInSession?.delete(ws);
        if (!peersInSession || peersInSession.size === 0) {
            sessionPeers.delete(sessionId);
            relayByteTracker.delete(sessionId); // Cleanup tracker when session dies
        }
        console.log(`Peer ${peerId} disconnected from session ${sessionId}`);
    });
});

server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
