import { useState, useEffect, useRef, useCallback } from 'react';
import { CONFIG } from '../lib/config';
import { getIceServers } from '../lib/turn';

interface WebRTCOptions {
    sessionId: string;
    isSender: boolean;
    onDataChannelMessage?: (data: string | ArrayBuffer) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
    onMessage?: (message: unknown) => void;
    onStalled?: () => void;
    onComplete?: () => void;
}

const RTC_CONFIG_BASE: Omit<RTCConfiguration, 'iceServers'> = {
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    iceTransportPolicy: 'all', // Ensure 'relay' candidates can be used
};

export function useWebRTC({ sessionId, isSender, onDataChannelMessage, onConnectionStateChange, onMessage, onStalled, onComplete }: WebRTCOptions) {
    const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
    const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
    // Fix #12: Default to 'closed' — no session exists yet at mount time
    const [channelState, setChannelState] = useState<RTCDataChannelState>('closed');
    const [isRelayActive, setIsRelayActive] = useState(false);
    const [signalingState, setSignalingState] = useState<number>(WebSocket.CLOSED);

    const socketRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
    const queueRef = useRef<string[]>([]);
    const messageHandlerRef = useRef(onDataChannelMessage);
    const connectionStateHandlerRef = useRef(onConnectionStateChange);
    const messageRef = useRef(onMessage);
    const completeRef = useRef(onComplete);
    const stalledRef = useRef(onStalled);
    const stallTimerRef = useRef<NodeJS.Timeout | null>(null);
    const relayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isSenderRef = useRef(isSender);

    useEffect(() => {
        messageHandlerRef.current = onDataChannelMessage;
    }, [onDataChannelMessage]);

    useEffect(() => {
        connectionStateHandlerRef.current = onConnectionStateChange;
    }, [onConnectionStateChange]);

    useEffect(() => {
        messageRef.current = onMessage;
    }, [onMessage]);

    useEffect(() => {
        completeRef.current = onComplete;
    }, [onComplete]);

    useEffect(() => {
        stalledRef.current = onStalled;
    }, [onStalled]);

    useEffect(() => {
        isSenderRef.current = isSender;
    }, [isSender]);

    const sendSignaling = useCallback((msg: unknown) => {
        const json = JSON.stringify(msg);
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(json);
        } else {
            queueRef.current.push(json);
        }
    }, []);

    const activateRelay = useCallback(() => {
        console.log('MANUAL RELAY ACTIVATION: User consented to relay via server.');
        setIsRelayActive(true);
        setChannelState('open');
        if (relayTimeoutRef.current) clearTimeout(relayTimeoutRef.current);
        sendSignaling({ type: 'force-relay' });
    }, [sendSignaling]);

    const setupDataChannel = useCallback((dc: RTCDataChannel) => {
        // Neutralize old channel's handlers to prevent state corruption
        const old = dataChannelRef.current;
        if (old && old !== dc) {
            console.warn('[P2P] Replacing old data channel — neutralizing its handlers');
            old.onopen = null;
            old.onclose = null;
            old.onmessage = null;
            old.onerror = null;
            try { old.close(); } catch { /* already closed */ }
        }
        dataChannelRef.current = dc;

        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = 256 * 1024; // 256KB — resume sending faster to keep pipe full

        dc.onopen = () => {
            // Only update state if this is still the active channel
            if (dataChannelRef.current !== dc) return;
            console.log('Data channel opened');
            setChannelState('open');
            setIsRelayActive(false);
            if (relayTimeoutRef.current) clearTimeout(relayTimeoutRef.current);
        };
        dc.onclose = () => {
            if (dataChannelRef.current !== dc) return;
            console.log(`Data channel closed (readyState was: ${dc.readyState}, pc state: ${pcRef.current?.connectionState})`);
            setChannelState('closed');
        };
        dc.onerror = (e: Event) => console.warn('[P2P] Data channel error:', e);
        dc.onmessage = (event: MessageEvent) => {
            const data = event.data;
            // Forward raw data to the data channel message handler
            messageHandlerRef.current?.(data);
            // Also parse JSON messages for signaling/control
            if (typeof data === 'string') {
                try {
                    const message = JSON.parse(data);
                    if (message.type === 'transfer-complete') {
                        completeRef.current?.();
                    }
                    messageRef.current?.(message);
                } catch { }
            }
        };
        setDataChannel(dc);
        setChannelState(dc.readyState);
    }, []);

    const createOffer = useCallback(async () => {
        if (!pcRef.current) return;
        const pc = pcRef.current;

        // CRITICAL GUARD: do NOT renegotiate if the connection + data channel are already established.
        // SDP renegotiation can kill the SCTP association and close the data channel mid-transfer.
        const existing = dataChannelRef.current;
        if (existing && (existing.readyState === 'open' || existing.readyState === 'connecting')) {
            console.log('[P2P] Data channel already active — skipping offer (would disrupt transfer)');
            return; // FULL BAIL OUT — do not renegotiate
        }

        console.log('[P2P] Creating new data channel + offer');
        const dc = pc.createDataChannel('file-transfer', { ordered: true });
        setupDataChannel(dc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignaling({ offer });
    }, [setupDataChannel, sendSignaling]);

    // Use a ref for handleSignalingMessage so the init effect doesn't re-run
    const handleSignalingMessageRef = useRef<(message: any) => Promise<void>>(undefined);

    // Signaling message queue to prevent concurrent async processing
    const signalingQueueRef = useRef<Array<any>>([]);
    const isProcessingSignalingRef = useRef(false);

    // Fix #7: Explicit return type — false means "not ready, keep in queue", true means "processed"
    const processSignalingMessage = useCallback(async (message: { type?: string; offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; publicKey?: number[]; action?: string }): Promise<boolean> => {
        if (!pcRef.current) {
            console.warn('[SIGNALLING] PeerConnection not ready, buffering message...');
            return false;
        }

        console.log(`[SIGNALLING] Processing: ${message.type || message.offer ? 'offer' : message.answer ? 'answer' : message.candidate ? 'candidate' : 'unknown'}`);

        if (message.type === 'force-relay' || message.action === 'force-relay') {
            console.log('Received force-relay signal from peer');
            setIsRelayActive(true);
            setChannelState('open');
            if (relayTimeoutRef.current) clearTimeout(relayTimeoutRef.current);
            return true;
        }



        if (message.type === 'peer_joined' && isSenderRef.current) {
            console.log('[P2P] Peer joined — creating offer (if not already connected)');
            // Start stall timer
            if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
            stallTimerRef.current = setTimeout(() => {
                if (pcRef.current?.connectionState !== 'connected') {
                    console.warn('[P2P] Connection process stalled (15s). Notifying UI...');
                    stalledRef.current?.();
                }
            }, 15000);
            await createOffer();
        } else if (message.offer && !isSenderRef.current) {
            // GUARD: if we already have a stable connection, ignore duplicate offers
            if (pcRef.current.connectionState === 'connected' && dataChannelRef.current?.readyState === 'open') {
                console.log('[P2P] Ignoring offer — already connected with open data channel');
                return true;
            }
            console.log('Received WebRTC Offer, creating Answer...');
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(message.offer));
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);

            sendSignaling({ answer });

            // Process queued candidates
            while (pendingCandidates.current.length > 0) {
                const head = pendingCandidates.current.shift();
                if (head) await pcRef.current.addIceCandidate(head);
            }
        } else if (message.answer && isSenderRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(message.answer));

            // Process queued candidates
            while (pendingCandidates.current.length > 0) {
                const head = pendingCandidates.current.shift();
                if (head) await pcRef.current.addIceCandidate(head);
            }
        } else if (message.candidate) {
            if (pcRef.current.remoteDescription) {
                await pcRef.current.addIceCandidate(message.candidate);
            } else {
                pendingCandidates.current.push(message.candidate);
            }
        } else if (message.type === 'cancel') {
            console.warn('[SIGNALLING] Peer sent a cancel signal via fallback');
            messageRef.current?.({ type: 'cancel' });
        } else {
            messageRef.current?.(message);
        }
        return true;
    }, [createOffer, sendSignaling]);

    // Queued handler: serializes signaling messages to prevent race conditions
    const drainSignalingQueue = useCallback(async () => {
        if (isProcessingSignalingRef.current || !pcRef.current) return;
        isProcessingSignalingRef.current = true;

        while (signalingQueueRef.current.length > 0) {
            const next = signalingQueueRef.current[0];
            try {
                const handled = await processSignalingMessage(next);
                if (handled === false) break; // Still not ready, keep in queue
                signalingQueueRef.current.shift(); // Successfully processed
            } catch (e) {
                console.error('[SIGNALLING] Error processing message:', e);
                signalingQueueRef.current.shift(); // Drop malformed message
            }
        }
        isProcessingSignalingRef.current = false;
    }, [processSignalingMessage]);

    const handleSignalingMessage = useCallback(async (message: any) => {
        signalingQueueRef.current.push(message);
        drainSignalingQueue();
    }, [drainSignalingQueue]);

    // Keep the ref always up-to-date
    useEffect(() => {
        handleSignalingMessageRef.current = handleSignalingMessage;
    }, [handleSignalingMessage]);

    // ===== MAIN INIT EFFECT =====
    // Fix #2: WebSocket reconnection with exponential backoff
    // Only depends on sessionId — all other callbacks are accessed via refs
    useEffect(() => {
        if (!sessionId || sessionId === '') return;

        let destroyed = false;
        let wsReconnectTimer: NodeJS.Timeout | null = null;
        let wsReconnectAttempt = 0;
        const MAX_WS_RECONNECTS = 8;

        // Extracted WebSocket setup — can be called again on reconnect
        const connectWebSocket = () => {
            if (destroyed) return;

            const signalingUrl = CONFIG.SIGNALING_URL;
            console.log(`[SIGNALLING] ${wsReconnectAttempt > 0 ? 'Reconnecting' : 'Connecting'} WebSocket to:`, signalingUrl);
            const socket = new WebSocket(`${signalingUrl}?sessionId=${sessionId}`);
            socket.binaryType = 'arraybuffer';
            socketRef.current = socket;
            setSignalingState(socket.readyState);

            socket.onopen = () => {
                if (destroyed) return;
                console.log('[SIGNALLING] WebSocket Connected');
                wsReconnectAttempt = 0; // Reset backoff on success
                setSignalingState(WebSocket.OPEN);
                while (queueRef.current.length > 0) {
                    socket.send(queueRef.current.shift()!);
                }
            };

            socket.onerror = (e) => {
                console.error('[SIGNALLING] WebSocket Error:', e);
                if (!destroyed) setSignalingState(socket.readyState);
            };

            socket.onclose = (e) => {
                console.warn('[SIGNALLING] WebSocket Closed:', e.code, e.reason);
                if (destroyed) return;
                setSignalingState(WebSocket.CLOSED);

                // Don't reconnect if server explicitly rejected (1008 = policy violation)
                if (e.code === 1008) {
                    console.warn('[SIGNALLING] Server rejected connection — not reconnecting.');
                    return;
                }

                // Auto-reconnect with exponential backoff
                if (wsReconnectAttempt < MAX_WS_RECONNECTS) {
                    const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempt), 30000);
                    console.log(`[SIGNALLING] Reconnecting in ${delay}ms (attempt ${wsReconnectAttempt + 1}/${MAX_WS_RECONNECTS})...`);
                    wsReconnectAttempt++;
                    wsReconnectTimer = setTimeout(connectWebSocket, delay);
                } else {
                    console.error('[SIGNALLING] Max reconnection attempts reached. Signaling channel is dead.');
                }
            };

            socket.onmessage = (event) => {
                if (destroyed) return;
                if (typeof event.data === 'string') {
                    const message = JSON.parse(event.data);
                    // Use the ref to always call the latest version of handleSignalingMessage
                    handleSignalingMessageRef.current?.(message);
                } else {
                    // Binary RELAY data
                    messageHandlerRef.current?.(event.data);
                }
            };
        };

        const init = async () => {
            // Check for Secure Context / WebCrypto API
            if (!window.isSecureContext || !window.crypto || !window.crypto.subtle) {
                console.error('[SECURITY] Web Crypto API is not available (likely missing Secure Context).');
                connectionStateHandlerRef.current?.('failed');
                return; // Stop initialization
            }

            // 1. Setup WebSocket (with auto-reconnection on close)
            connectWebSocket();

            // 2. Setup RTCPeerConnection
            const iceServers = await getIceServers();
            console.log(`[P2P] Fetched ${iceServers.length} ICE servers securely`);

            if (destroyed) return;

            const rtcConfig: RTCConfiguration = {
                ...RTC_CONFIG_BASE,
                iceServers,
            };

            const pc = new RTCPeerConnection(rtcConfig);
            pcRef.current = pc;
            setPeerConnection(pc);

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const typeMatch = event.candidate.candidate.match(/typ (\w+)/);
                    const type = typeMatch ? typeMatch[1] : event.candidate.type;

                    // Diagnostic helper: log ICE candidate types
                    console.info(`🎯 [ICE Diagnostics] Gathered candidate type: ${type}`);

                    console.log(`[P2P] Local ICE Candidate (${type}):`, event.candidate.candidate);
                    sendSignaling({ candidate: event.candidate });
                }
            };

            pc.onconnectionstatechange = () => {
                if (destroyed) return;
                console.log(`[P2P] Connection state changed: ${pc.connectionState}`);
                if (pc.iceConnectionState) {
                    console.log(`[P2P] ICE Connection state: ${pc.iceConnectionState}`);
                }
                connectionStateHandlerRef.current?.(pc.connectionState);

                if (pc.connectionState === 'connected') {
                    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
                }

                if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
                    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
                    console.error('[P2P] CONNECTION FAILED. Attempting ICE restart before relay fallback...');
                    // Auto-attempt ICE restart once before showing relay prompt
                    try {
                        pc.restartIce();
                    } catch (e) {
                        console.warn('[P2P] ICE restart not supported:', e);
                    }
                }
                if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
                    console.warn('[P2P] Peer disconnected.');
                }
            };

            pc.onicegatheringstatechange = () => {
                console.log(`[P2P] ICE Gathering state: ${pc.iceGatheringState}`);
            };

            if (isSenderRef.current) {
                // Don't create offer yet — wait for peer_joined signal
                // This prevents creating duplicate data channels
                console.log('[P2P] Sender ready, waiting for peer to join...');
            } else {
                pc.ondatachannel = (event) => {
                    setupDataChannel(event.channel);
                };
            }

            // [RACE CONDITION FIX] Process any messages that arrived while we were initializing
            drainSignalingQueue();
        };

        init();

        return () => {
            destroyed = true;
            if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
            if (pcRef.current) pcRef.current.close();
            if (socketRef.current) socketRef.current.close();
            // eslint-disable-next-line react-hooks/exhaustive-deps
            if (relayTimeoutRef.current) clearTimeout(relayTimeoutRef.current);
            pcRef.current = null;
            socketRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    const waitForBuffer = useCallback(() => {
        if (isRelayActive && socketRef.current) {
            // WebSockets buffer logic: wait if bufferedAmount exceeds 1MB 
            return new Promise<void>((resolve) => {
                const checkWSBuffer = () => {
                    if (!socketRef.current || socketRef.current.bufferedAmount <= 1024 * 1024) {
                        resolve();
                    } else {
                        setTimeout(checkWSBuffer, 50); // Poll every 50ms for relay backpressure
                    }
                };
                checkWSBuffer();
            });
        }
        return new Promise<void>((resolve) => {
            if (!dataChannel || dataChannel.bufferedAmount <= dataChannel.bufferedAmountLowThreshold) {
                resolve();
                return;
            }
            const listener = () => {
                dataChannel.removeEventListener('bufferedamountlow', listener);
                resolve();
            };
            dataChannel.addEventListener('bufferedamountlow', listener);
        });
    }, [dataChannel, isRelayActive]);

    const sendData = useCallback((data: string | ArrayBuffer | Blob | ArrayBufferView) => {
        if (isRelayActive && socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(data);
            return true;
        }

        if (dataChannel && dataChannel.readyState === 'open') {
            try {
                // RTCDataChannel.send() natively accepts string | ArrayBuffer | Blob | ArrayBufferView
                if (typeof data === 'string') {
                    dataChannel.send(data);
                } else {
                    dataChannel.send(data as ArrayBuffer);
                }
                return true;
            } catch (e) {
                console.error('Send error:', e);
                return false;
            }
        }
        return false;
    }, [dataChannel, isRelayActive]);

    // Fix #4: Protect active transfers — only allow reconnect when data channel is NOT open
    const reconnectP2P = useCallback(() => {
        console.log('[P2P] Manual Re-Handshake requested...');

        // Guard: do NOT disrupt an active data channel (protects in-progress transfers)
        const existing = dataChannelRef.current;
        if (existing && existing.readyState === 'open') {
            console.warn('[P2P] Data channel is still open — aborting reconnect to protect active transfer');
            return;
        }

        // Attempt ICE restart first (works for both roles)
        if (pcRef.current) {
            try {
                pcRef.current.restartIce();
            } catch (e) {
                console.warn('[P2P] ICE restart failed:', e);
            }
        }
        // Sender re-creates offer to renegotiate
        if (isSenderRef.current) {
            createOffer();
        }
    }, [createOffer]);

    return {
        peerConnection,
        dataChannel,
        channelState,
        sendData,
        waitForBuffer,
        isRelayActive,
        activateRelay,
        reconnectP2P,
        signalingState,
        sendSignaling
    };
}
