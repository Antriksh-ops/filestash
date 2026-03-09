import { useState, useEffect, useRef, useCallback } from 'react';
import {
    generateECDHKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveAESKey
} from '../lib/crypto';
import { CONFIG } from '../lib/config';

interface WebRTCOptions {
    sessionId: string;
    isSender: boolean;
    onDataChannelMessage?: (data: string | ArrayBuffer) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
    onMessage?: (message: unknown) => void;
    onStalled?: () => void;
    onComplete?: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        // [IMPORTANT] Add TURN servers here for high reliability (e.g., across symmetric NATs/Firewalls)
        // You can use a service like Metered.ca (Free Tier), Twilio, or self-hosted Coturn.
        /*
        { 
          urls: 'turn:YOUR_TURN_DOMAIN:PORT', 
          username: 'YOUR_USERNAME', 
          credential: 'YOUR_PASSWORD' 
        },
        */
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    iceTransportPolicy: 'all', // Ensure 'relay' candidates can be used
};

export function useWebRTC({ sessionId, isSender, onDataChannelMessage, onConnectionStateChange, onMessage, onStalled, onComplete }: WebRTCOptions) {
    const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
    const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
    const [channelState, setChannelState] = useState<RTCDataChannelState>('connecting');
    const [isRelayActive, setIsRelayActive] = useState(false);
    const [sharedKey, setSharedKey] = useState<CryptoKey | null>(null);

    const socketRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const myKeyPairRef = useRef<CryptoKeyPair | null>(null);
    const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
    const queueRef = useRef<string[]>([]);
    const messageHandlerRef = useRef(onDataChannelMessage);
    const connectionStateHandlerRef = useRef(onConnectionStateChange);
    const messageRef = useRef(onMessage);
    const completeRef = useRef(onComplete);
    const stalledRef = useRef(onStalled);
    const stallTimerRef = useRef<NodeJS.Timeout | null>(null);
    const relayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = 1024 * 1024; // 1MB threshold

        dc.onopen = () => {
            console.log('Data channel opened');
            setChannelState('open');
            setIsRelayActive(false);
            if (relayTimeoutRef.current) clearTimeout(relayTimeoutRef.current);
        };
        dc.onclose = () => {
            console.log('Data channel closed');
            setChannelState('closed');
        };
        dc.onmessage = (event) => {
            const data = event.data;
            messageHandlerRef.current?.(data);
            if (typeof data === 'string') {
                try {
                    const message = JSON.parse(data);
                    if (message.type === 'transfer-complete') {
                        completeRef.current?.();
                    }
                    messageRef.current?.(message);
                } catch (e) { }
            }
        };
        setDataChannel(dc);
        setChannelState(dc.readyState);
    }, []);

    const startStallTimer = useCallback(() => {
        if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
        stallTimerRef.current = setTimeout(() => {
            if (pcRef.current?.connectionState !== 'connected') {
                console.warn('[P2P] Connection process stalled (15s). Notifying UI...');
                stalledRef.current?.();
            }
        }, 15000);
    }, []);

    const createOffer = useCallback(async () => {
        if (!pcRef.current) return;
        const pc = pcRef.current;
        const dc = pc.createDataChannel('file-transfer', { ordered: true });
        setupDataChannel(dc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Include public key in offer if available
        let publicKeyBuffer = null;
        if (myKeyPairRef.current) {
            publicKeyBuffer = await exportPublicKey(myKeyPairRef.current.publicKey);
        }

        sendSignaling({
            offer,
            publicKey: publicKeyBuffer ? Array.from(new Uint8Array(publicKeyBuffer)) : null
        });
    }, [setupDataChannel, sendSignaling]);

    const handleSignalingMessage = useCallback(async (message: { type?: string; offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; publicKey?: number[]; action?: string }) => {
        if (!pcRef.current) return;

        console.log(`[SIGNALLING] Received message: ${message.type || 'unknown'}`, message);

        if (message.type === 'force-relay' || message.action === 'force-relay') {
            console.log('Received force-relay signal from peer');
            setIsRelayActive(true);
            setChannelState('open');
            if (relayTimeoutRef.current) clearTimeout(relayTimeoutRef.current);
            return;
        }

        // Handle Public Key Exchange
        if (message.publicKey && myKeyPairRef.current) {
            console.log('Received peer public key, deriving shared secret...');
            const peerPubKey = await importPublicKey(new Uint8Array(message.publicKey).buffer as ArrayBuffer);
            const key = await deriveAESKey(myKeyPairRef.current.privateKey, peerPubKey);
            setSharedKey(key);

            // If we are receiver, send our public key back
            if (!isSender && message.offer) {
                // Handled in answer block below
            }
        }

        if (message.type === 'peer_joined' && isSender) {
            console.log('Peer joined, re-initiating offer and starting stall timer');
            startStallTimer(); // Only start the 15s timeout once we know a peer is actually listening
            createOffer();
        } else if (message.offer && !isSender) {
            console.log('Received WebRTC Offer, creating Answer...');
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(message.offer));
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);

            let publicKeyBuffer = null;
            if (myKeyPairRef.current) {
                publicKeyBuffer = await exportPublicKey(myKeyPairRef.current.publicKey);
            }

            sendSignaling({
                answer,
                publicKey: publicKeyBuffer ? Array.from(new Uint8Array(publicKeyBuffer)) : null
            });

            // Process queued candidates
            while (pendingCandidates.current.length > 0) {
                const head = pendingCandidates.current.shift();
                if (head) await pcRef.current.addIceCandidate(head);
            }
        } else if (message.answer && isSender) {
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
        } else {
            // Forward any other messages (like errors or custom sync signals)
            // to the application message handler.
            messageRef.current?.(message);
        }
    }, [isSender, createOffer, sendSignaling]);

    useEffect(() => {
        if (!sessionId || sessionId === '') return;

        const init = async () => {
            // 1. Generate ECDH keys
            myKeyPairRef.current = await generateECDHKeyPair();

            // 2. Setup WebSocket
            const signalingUrl = CONFIG.SIGNALING_URL;
            console.log('DEBUG: Initializing WebRTC with signaling URL:', signalingUrl);
            const socket = new WebSocket(`${signalingUrl}?sessionId=${sessionId}`);
            socket.binaryType = 'arraybuffer';
            socketRef.current = socket;

            socket.onopen = () => {
                console.log('[SIGNALLING] WebSocket Connected');
                while (queueRef.current.length > 0) {
                    socket.send(queueRef.current.shift()!);
                }
            };

            socket.onerror = (e) => {
                console.error('[SIGNALLING] WebSocket Error:', e);
            };

            socket.onclose = (e) => {
                console.warn('[SIGNALLING] WebSocket Closed:', e.code, e.reason);
            };

            socket.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    const message = JSON.parse(event.data);
                    handleSignalingMessage(message);
                } else {
                    // Binary RELAY data
                    messageHandlerRef.current?.(event.data);
                }
            };

            // 3. Setup RTCPeerConnection
            const pc = new RTCPeerConnection(RTC_CONFIG);
            pcRef.current = pc;
            setPeerConnection(pc);

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const type = event.candidate.type || (event.candidate.candidate.includes('typ relay') ? 'relay' : event.candidate.candidate.includes('typ srflx') ? 'srflx' : 'host');
                    console.log(`[P2P] Local ICE Candidate (${type}):`, event.candidate.candidate);
                    sendSignaling({ candidate: event.candidate });
                }
            };

            pc.onconnectionstatechange = () => {
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
                    console.error('[P2P] CONNECTION FAILED. Possible reasons: Symmetric NAT on both ends, firewall blocks, or no STUN/TURN path.');
                }
                if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
                    console.warn('[P2P] Peer disconnected.');
                }
            };

            pc.onicegatheringstatechange = () => {
                console.log(`[P2P] ICE Gathering state: ${pc.iceGatheringState}`);
            };

            if (isSender) {
                // startStallTimer(); // REMOVED: Don't start timer until peer joins (handled in handleSignalingMessage)
                createOffer();
            } else {
                pc.ondatachannel = (event) => {
                    setupDataChannel(event.channel);
                };
            }
        };

        init();

        return () => {
            if (pcRef.current) pcRef.current.close();
            if (socketRef.current) socketRef.current.close();
            if (relayTimeoutRef.current) clearTimeout(relayTimeoutRef.current);
            pcRef.current = null;
            socketRef.current = null;
        };
    }, [sessionId, isSender, handleSignalingMessage, createOffer, setupDataChannel, sendSignaling]);

    const waitForBuffer = useCallback(() => {
        if (isRelayActive) return Promise.resolve(); // WS relay uses different flow control
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
                dataChannel.send(data as any);
                return true;
            } catch (e) {
                console.error('Send error:', e);
                return false;
            }
        }
        return false;
    }, [dataChannel, isRelayActive]);

    const reconnectP2P = useCallback(() => {
        console.log('[P2P] Manual Re-Handshake requested...');
        if (isSender) {
            createOffer();
        }
    }, [isSender, createOffer]);

    return {
        peerConnection,
        dataChannel,
        channelState,
        sendData,
        waitForBuffer,
        sharedKey,
        isRelayActive,
        activateRelay,
        reconnectP2P,
        signalingState: socketRef.current?.readyState ?? WebSocket.CLOSED
    };
}
