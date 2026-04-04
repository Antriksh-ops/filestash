'use client';

import React from 'react';

interface FileInfo {
    name: string;
    size: number;
}

interface CompletionViewProps {
    files: File[] | FileInfo[];
    startTime: number | null;
    finishTime?: number | null;
    isSender: boolean;
    onDownload: () => void;
    onNewTransfer: () => void;
}

export default function CompletionView({ files, startTime, finishTime, isSender, onDownload, onNewTransfer }: CompletionViewProps) {
    const totalSize = files.reduce((a, b) => a + b.size, 0);
    const duration = startTime ? Math.round(((finishTime || Date.now()) - startTime) / 1000) : 0;

    return (
        <div className="space-y-6 pt-6 border-t-4 border-(--border)">
            <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-(--input-bg) border-4 border-(--border) rounded-2xl text-center">
                    <p className="text-(--text-secondary) font-black text-[10px] uppercase">TOTAL DATA</p>
                    <p className="text-(--text) font-black text-xl">
                        {(totalSize / (1024 * 1024)).toFixed(2)} MB
                    </p>
                </div>
                <div className="p-4 bg-(--input-bg) border-4 border-(--border) rounded-2xl text-center">
                    <p className="text-(--text-secondary) font-black text-[10px] uppercase">DURATION</p>
                    <p className="text-(--text) font-black text-xl">{duration}s</p>
                </div>
            </div>

            {!isSender ? (
                <button
                    onClick={onDownload}
                    className="w-full py-6 bg-(--accent-emerald) hover:opacity-90 text-black font-black uppercase text-2xl tracking-widest rounded-2xl border-4 border-(--border) transition-all shadow-[8px_8px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none"
                >
                    Download Files
                </button>
            ) : (
                <div className="p-6 bg-(--accent-yellow) border-4 border-(--border) rounded-2xl text-center shadow-[4px_4px_0px_0px_var(--shadow)]">
                    <p className="text-black font-black uppercase text-lg">Transfer Complete!</p>
                    <p className="text-black/60 font-bold text-xs uppercase">Your peer has received the files.</p>
                </div>
            )}

            <button
                onClick={onNewTransfer}
                className="w-full py-4 bg-(--surface) hover:bg-(--card-hover) text-(--text) font-black uppercase text-sm tracking-widest rounded-2xl border-4 border-(--border) transition-all shadow-[4px_4px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
                Start New Transfer
            </button>
        </div>
    );
}

