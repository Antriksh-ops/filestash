'use client';

import React from 'react';

interface TransferProgressProps {
    progress: number;
    eta: string | null;
    status: 'idle' | 'sending' | 'receiving' | 'completed';
    signalingState: number;
    channelState: RTCDataChannelState;
    isRelayActive: boolean;
    receivedBytes: number;
    isPaused: boolean;
    togglePause: () => void;
    isSender: boolean;
}

export default function TransferProgress({
    progress,
    eta,
    status,
    signalingState,
    channelState,
    isRelayActive,
    receivedBytes,
    isPaused,
    togglePause,
    isSender,
}: TransferProgressProps) {
    const statusLabel = React.useMemo(() => {
        if (status === 'completed') return 'SUCCESS';
        if (signalingState === 3 || signalingState === 2) return 'OFFLINE'; // WebSocket.CLOSED or CLOSING
        if (channelState === 'open') {
            if (status === 'sending') return 'SENDING';
            return receivedBytes > 0 ? 'RECEIVING' : 'WAITING FOR SENDER';
        }
        if (status === 'sending') {
            return signalingState === WebSocket.OPEN ? 'WAITING FOR PEER' : 'INITIALIZING...';
        }
        return signalingState === WebSocket.OPEN ? 'CONNECTING...' : 'SIGNALING LOST';
    }, [status, channelState, receivedBytes, signalingState]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                <span className={`text-black font-black uppercase text-[10px] tracking-widest px-3 py-1 rounded-lg border-2 border-(--border) ${signalingState === 1 ? 'bg-(--accent-emerald)' : 'bg-(--accent-rose) animate-pulse'}`}>
                    SIGNALING: {signalingState === 1 ? 'ONLINE' : 'OFFLINE'}
                </span>
                <span className="text-black font-black uppercase text-[10px] tracking-widest bg-(--accent-yellow) px-3 py-1 rounded-lg border-2 border-(--border)">
                    {statusLabel}
                </span>

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
                <div className="flex justify-between items-center w-full">
                    <p className="text-(--text-secondary) font-black text-xs uppercase tracking-widest flex items-center gap-2">
                        <span className="animate-pulse">●</span> {eta}
                    </p>
                    {isSender && status === 'sending' && (
                        <button
                            onClick={togglePause}
                            className={`px-4 py-2 font-black uppercase text-xs rounded-xl border-2 border-(--border) shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all ${isPaused ? 'bg-(--accent-yellow) text-black' : 'bg-(--surface) text-(--text-secondary) hover:bg-(--card-hover)'}`}
                        >
                            {isPaused ? 'RESUME' : 'PAUSE'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

