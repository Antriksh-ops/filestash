'use client';

import React from 'react';

interface FileInfo {
    name: string;
    size: number;
}

interface CompletionViewProps {
    files: File[] | FileInfo[];
    startTime: number | null;
    isSender: boolean;
    onDownload: () => void;
    onNewTransfer: () => void;
}

export default function CompletionView({ files, startTime, isSender, onDownload, onNewTransfer }: CompletionViewProps) {
    const totalSize = files.reduce((a, b) => a + b.size, 0);
    const duration = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;

    return (
        <div className="space-y-6 pt-6 border-t-4 border-black animate-in fade-in zoom-in duration-500">
            <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-emerald-50 border-4 border-black rounded-2xl text-center">
                    <p className="text-zinc-500 font-black text-[10px] uppercase">TOTAL DATA</p>
                    <p className="text-black font-black text-xl">
                        {(totalSize / (1024 * 1024)).toFixed(2)} MB
                    </p>
                </div>
                <div className="p-4 bg-violet-50 border-4 border-black rounded-2xl text-center">
                    <p className="text-zinc-500 font-black text-[10px] uppercase">DURATION</p>
                    <p className="text-black font-black text-xl">{duration}s</p>
                </div>
            </div>

            {!isSender ? (
                <button
                    onClick={onDownload}
                    className="w-full py-6 bg-emerald-400 hover:bg-emerald-300 text-black font-black uppercase text-2xl tracking-widest rounded-2xl border-4 border-black transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none"
                >
                    Download Files
                </button>
            ) : (
                <div className="p-6 bg-yellow-200 border-4 border-black rounded-2xl text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-black font-black uppercase text-lg">Transfer Complete!</p>
                    <p className="text-black/60 font-bold text-xs uppercase">Your peer has received the files.</p>
                </div>
            )}

            <button
                onClick={onNewTransfer}
                className="w-full py-4 bg-white hover:bg-zinc-50 text-black font-black uppercase text-sm tracking-widest rounded-2xl border-4 border-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
                Start New Transfer
            </button>
        </div>
    );
}
