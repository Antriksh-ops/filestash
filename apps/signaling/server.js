const { WebSocketServer, WebSocket } = require('ws');
const { createServer } = require('http');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');

const PORT = process.env.PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

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
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const metadata = JSON.parse(body);
                const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
                const sessionData = {
                    ...metadata,
                    sessionId,
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
        sessionPeers.get(sessionId)?.delete(ws);
        if (sessionPeers.get(sessionId)?.size === 0) {
            sessionPeers.delete(sessionId);
        }
        console.log(`Peer ${peerId} disconnected from session ${sessionId}`);
    });
});

server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
