'use client';

import React from 'react';

interface TransferProgressProps {
    progress: number;
    eta: string | null;
    status: 'idle' | 'sending' | 'receiving' | 'completed';
    signalingState: number;
    channelState: RTCDataChannelState;
    sharedKey: CryptoKey | null;
    isRelayActive: boolean;
    isTransferStarted: boolean;
    receivedBytes: number;
}

export default function TransferProgress({
    progress,
    eta,
    status,
    signalingState,
    channelState,
    sharedKey,
    isRelayActive,
    isTransferStarted,
    receivedBytes,
}: TransferProgressProps) {
    const statusLabel = React.useMemo(() => {
        if (status === 'completed') return 'SUCCESS';
        if (channelState === 'open') {
            if (status === 'sending') return isTransferStarted ? 'SENDING' : 'READY';
            return receivedBytes > 0 ? 'RECEIVING' : 'WAITING FOR SENDER';
        }
        if (status === 'sending') {
            return signalingState === WebSocket.OPEN ? 'WAITING FOR PEER' : 'INITIALIZING...';
        }
        return 'CONNECTING...';
    }, [status, channelState, isTransferStarted, receivedBytes, signalingState]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                <span className={`text-black font-black uppercase text-[10px] tracking-widest px-3 py-1 rounded-lg border-2 border-(--border) ${signalingState === 1 ? 'bg-(--accent-emerald)' : 'bg-(--accent-rose) animate-pulse'}`}>
                    SIGNALING: {signalingState === 1 ? 'ONLINE' : 'OFFLINE'}
                </span>
                <span className="text-black font-black uppercase text-[10px] tracking-widest bg-(--accent-yellow) px-3 py-1 rounded-lg border-2 border-(--border)">
                    {statusLabel}
                </span>
                {sharedKey && (
                    <span className="text-black font-black uppercase text-[10px] tracking-widest bg-(--accent-emerald) px-3 py-1 rounded-lg border-2 border-(--border) flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        Encrypted
                    </span>
                )}
                {isRelayActive && (
                    <span className="text-white font-black uppercase text-[10px] tracking-widest bg-(--accent-rose) px-3 py-1 rounded-lg border-2 border-(--border)">
                        Relay Mode
                    </span>
                )}
            </div>
            <span className="text-(--text) font-black text-3xl tracking-tighter">{Math.min(100, Math.round(progress))}%</span>
            <div className="w-full h-8 bg-(--input-bg) border-4 border-(--border) rounded-2xl overflow-hidden shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                <div
                    className="h-full bg-blue-500 border-r-4 border-(--border) transition-all duration-300 relative overflow-hidden"
                    style={{ width: `${Math.min(100, progress)}%` }}
                >
                    <div className="absolute inset-0 bg-white/20 animate-[pulse_2s_infinite]" />
                </div>
            </div>
            {eta && status !== 'completed' && (
                <p className="text-(--text-secondary) font-black text-xs uppercase text-right tracking-widest flex items-center justify-end gap-2">
                    <span className="animate-pulse">●</span> {eta}
                </p>
            )}
        </div>
    );
}

