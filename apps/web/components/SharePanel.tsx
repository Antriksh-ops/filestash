'use client';

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface SharePanelProps {
    sessionId: string;
    shareLink: string;
    peerConnected: boolean;
}

export default function SharePanel({ sessionId, shareLink, peerConnected }: SharePanelProps) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(shareLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleNativeShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Filedrop — File Transfer',
                    text: `Use this link to receive files from me:`,
                    url: shareLink,
                });
            } catch {
                // User cancelled or share failed silently
            }
        }
    };

    const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

    return (
        <div className="pt-4 border-t-2 border-(--border)">
            {/* Status Banner */}
            {!peerConnected && (
                <div className="p-4 rounded-2xl border-4 border-(--accent-yellow) bg-(--accent-yellow) bg-opacity-10 mb-6 flex flex-col md:flex-row items-start md:items-center gap-4">
                    <div className="flex items-center gap-3 shrink-0">
                        <div className="w-3 h-3 rounded-full bg-(--accent-yellow) animate-pulse" />
                        <p className="font-black text-sm uppercase tracking-wider text-(--text)">
                            Bridge Ready
                        </p>
                    </div>
                    <p className="text-(--text-secondary) text-xs font-medium border-l-2 border-(--accent-yellow)/30 pl-4">
                        Share this code/link. Keep tab open.
                    </p>
                </div>
            )}

            <div className="flex flex-col md:flex-row gap-6 items-center md:items-stretch">
                {/* Left: QR Code */}
                <div className="flex flex-col items-center justify-center p-4 border-4 border-(--border) rounded-2xl bg-(--input-bg) shadow-[4px_4px_0px_0px_var(--shadow)] shrink-0">
                    <QRCodeSVG value={shareLink} size={120} level="H" includeMargin={false} bgColor="transparent" fgColor="currentColor" className="text-(--text) mb-3" />
                    <p className="text-(--text) font-black text-[10px] uppercase tracking-widest text-center">Scan to connect</p>
                </div>

                {/* Right: Code, Link, Share */}
                <div className="flex-1 flex flex-col justify-between w-full space-y-4">
                    <div className="flex flex-col md:flex-row gap-4 items-stretch">
                        <div className="flex-1 flex flex-col items-center justify-center bg-(--surface) border-4 border-(--border) rounded-2xl shadow-[4px_4px_0px_0px_var(--shadow)] p-4">
                            <p className="text-(--text-secondary) font-black text-[10px] tracking-[0.2em] uppercase mb-1">Bridge Code</p>
                            <h2 className="text-3xl font-black text-(--text) tracking-[0.2em] uppercase">{sessionId}</h2>
                        </div>
                        {hasNativeShare && (
                            <button
                                onClick={handleNativeShare}
                                className="md:w-32 py-2 bg-(--accent-emerald) text-black font-black uppercase text-xs rounded-2xl border-4 border-(--border) shadow-[4px_4px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all flex flex-col items-center justify-center gap-1"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
                                Share Apps
                            </button>
                        )}
                    </div>

                    {/* Link + Copy */}
                    <div className="p-3 bg-(--input-bg) border-4 border-(--border) rounded-2xl shadow-[4px_4px_0px_0px_var(--shadow)] flex items-center gap-3">
                        <input
                            readOnly
                            value={shareLink}
                            className="bg-transparent text-sm text-(--text) font-bold flex-1 outline-none truncate px-2"
                        />
                        <button
                            onClick={handleCopy}
                            className="px-5 py-2 bg-(--accent-yellow) hover:opacity-90 text-black border-4 border-(--border) rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shrink-0"
                        >
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

