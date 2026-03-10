'use client';

import React from 'react';

interface RelayPromptModalProps {
    onRetry: () => void;
    onRelay: () => void;
    onDismiss: () => void;
}

export default function RelayPromptModal({ onRetry, onRelay, onDismiss }: RelayPromptModalProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white border-4 border-black rounded-[2.5rem] p-10 max-w-lg w-full shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] space-y-8 animate-in zoom-in-95 duration-300">
                <div className="space-y-4">
                    <div className="w-20 h-20 bg-orange-100 border-4 border-black rounded-3xl flex items-center justify-center text-orange-600 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="m9 12 2 2 4-4" /></svg>
                    </div>
                    <h3 className="text-3xl font-black uppercase tracking-tight">P2P Connection Stalled</h3>
                    <div className="space-y-4 text-zinc-600 font-bold uppercase text-xs leading-relaxed">
                        <p>Direct device-to-device connection is failing. This often happens due to restrictive corporate firewalls or complex mobile networks.</p>
                        <div className="bg-orange-50 border-2 border-black p-4 rounded-xl space-y-2">
                            <p className="text-black">What is Relay Mode?</p>
                            <p>Data will pass through our secure signaling server as a fallback. Your files remain <span className="text-emerald-600">End-to-End Encrypted</span>, but transfer may be slower and subject to bandwidth limits (1GB).</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <button
                        onClick={onRetry}
                        className="w-full py-4 bg-yellow-400 hover:bg-yellow-300 text-black font-black uppercase rounded-2xl border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                    >
                        Retry Direct P2P
                    </button>
                    <button
                        onClick={onRelay}
                        className="w-full py-4 bg-black text-white hover:bg-zinc-800 font-black uppercase rounded-2xl border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                    >
                        Enable Relay Fallback
                    </button>
                    <button
                        onClick={onDismiss}
                        className="w-full py-2 text-zinc-400 font-black uppercase text-[10px] tracking-widest hover:text-black transition-colors"
                    >
                        Keep Waiting...
                    </button>
                </div>
            </div>
        </div>
    );
}
