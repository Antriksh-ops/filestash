import { useState, useEffect, useRef, useCallback } from 'react';
import {
    generateECDHKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveAESKey
} from '../lib/crypto';

interface WebRTCOptions {
    sessionId: string;
    isSender: boolean;
    onDataChannelMessage?: (data: string | ArrayBuffer) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

export function useWebRTC({ sessionId, isSender, onDataChannelMessage, onConnectionStateChange }: WebRTCOptions) {
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
    const relayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        messageHandlerRef.current = onDataChannelMessage;
    }, [onDataChannelMessage]);

    useEffect(() => {
        connectionStateHandlerRef.current = onConnectionStateChange;
    }, [onConnectionStateChange]);

    const sendSignaling = useCallback((msg: unknown) => {
        const json = JSON.stringify(msg);
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(json);
        } else {
            queueRef.current.push(json);
        }
    }, []);

    const startRelayTimeout = useCallback(() => {
        if (relayTimeoutRef.current) return;
        console.log('Handshake started, arming relay fallback (8s)...');
        relayTimeoutRef.current = setTimeout(() => {
            if (channelState !== 'open') {
                console.log('P2P taking too long, activating relay fallback...');
                setIsRelayActive(true);
                setChannelState('open');
            }
        }, 8000);
    }, [channelState]);

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
        dc.onmessage = (event) => messageHandlerRef.current?.(event.data);
        setDataChannel(dc);
        setChannelState(dc.readyState);
    }, []);

    const createOffer = useCallback(async () => {
        if (!pcRef.current) return;
        startRelayTimeout();
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

    const handleSignalingMessage = useCallback(async (message: { type?: string; offer?: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; publicKey?: number[] }) => {
        if (!pcRef.current) return;

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
            console.log('Peer joined, re-initiating offer');
            createOffer();
        } else if (message.offer && !isSender) {
            startRelayTimeout();
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
        }
    }, [isSender, createOffer, sendSignaling]);

    useEffect(() => {
        if (!sessionId || sessionId === '') return;

        const init = async () => {
            // 1. Generate ECDH keys
            myKeyPairRef.current = await generateECDHKeyPair();

            // 2. Setup WebSocket
            const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_URL || 'wss://filestash-z8go.onrender.com';
            console.log('DEBUG: Initializing WebRTC with signaling URL:', signalingUrl);
            const socket = new WebSocket(`${signalingUrl}?sessionId=${sessionId}`);
            socketRef.current = socket;

            socket.onopen = () => {
                while (queueRef.current.length > 0) {
                    socket.send(queueRef.current.shift()!);
                }
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
            const pc = new RTCPeerConnection(STUN_SERVERS);
            pcRef.current = pc;
            setPeerConnection(pc);

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    sendSignaling({ candidate: event.candidate });
                }
            };

            pc.onconnectionstatechange = () => {
                connectionStateHandlerRef.current?.(pc.connectionState);
                if (pc.connectionState === 'failed') {
                    console.warn('P2P connection failed, checking relay...');
                    setIsRelayActive(true);
                    setChannelState('open'); // Fake open for relay
                }
            };

            if (isSender) {
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

    return {
        peerConnection,
        dataChannel,
        channelState,
        sendData,
        waitForBuffer,
        sharedKey,
        isRelayActive
    };
}
