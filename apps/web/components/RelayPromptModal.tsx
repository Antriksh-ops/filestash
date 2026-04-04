'use client';

import React from 'react';

interface RelayPromptModalProps {
    onRetry: () => void;
    onRelay: () => void;
    onDismiss: () => void;
}

export default function RelayPromptModal({ onRetry, onRelay, onDismiss }: RelayPromptModalProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-(--surface) border-4 border-(--border) rounded-[2.5rem] p-10 max-w-lg w-full shadow-[16px_16px_0px_0px_var(--shadow)] space-y-8">
                <div className="space-y-4">
                    <div className="w-20 h-20 bg-(--input-bg) border-4 border-(--border) rounded-3xl flex items-center justify-center text-orange-500 shadow-[4px_4px_0px_0px_var(--shadow)]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="m9 12 2 2 4-4" /></svg>
                    </div>
                    <h3 className="text-3xl font-black uppercase tracking-tight text-(--text)">P2P Connection Stalled</h3>
                    <div className="space-y-4 text-(--text-secondary) font-bold uppercase text-xs leading-relaxed">
                        <p>Direct device-to-device connection is failing. This often happens due to restrictive corporate firewalls or complex mobile networks.</p>
                        <div className="bg-(--input-bg) border-2 border-(--border) p-4 rounded-xl space-y-2">
                            <p className="text-(--text)">What is Relay Mode?</p>
                            <p>Data will pass through our signaling server as a fallback. Transfer may be slower and is subject to bandwidth limits (1GB). <span className="text-(--accent-yellow)">Note: Relay mode is NOT end-to-end encrypted</span> — for maximum privacy, retry direct P2P.</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <button
                        onClick={onRetry}
                        className="w-full py-4 bg-(--accent-yellow) hover:opacity-90 text-black font-black uppercase rounded-2xl border-4 border-(--border) shadow-[4px_4px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                    >
                        Retry Direct P2P
                    </button>
                    <button
                        onClick={onRelay}
                        className="w-full py-4 bg-(--text) text-(--bg) hover:opacity-90 font-black uppercase rounded-2xl border-4 border-(--border) shadow-[4px_4px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                    >
                        Enable Relay Fallback
                    </button>
                    <button
                        onClick={onDismiss}
                        className="w-full py-2 text-(--text-secondary) font-black uppercase text-[10px] tracking-widest hover:text-(--text) transition-colors"
                    >
                        Keep Waiting...
                    </button>
                </div>
            </div>
        </div>
    );
}

