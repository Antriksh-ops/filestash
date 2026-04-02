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
        <div className="space-y-5 pt-4 border-t-2 border-(--border)">
            {/* Status Banner */}
            {!peerConnected && (
                <div className="p-5 rounded-2xl border-4 border-(--accent-yellow) bg-(--accent-yellow) bg-opacity-10 space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-(--accent-yellow) animate-pulse" />
                        <p className="font-black text-sm uppercase tracking-wider text-(--text)">
                            Your bridge is ready — share the link!
                        </p>
                    </div>
                    <p className="text-(--text-secondary) text-xs font-medium pl-6">
                        Send the code or link below to your recipient. They can open it on any device, anytime. Just keep this tab open until the transfer completes.
                    </p>
                </div>
            )}

            {/* Session Code */}
            <div className="flex flex-col items-center gap-3">
                <p className="text-(--text-secondary) font-black text-xs tracking-[0.3em] uppercase">ACTIVE BRIDGE CODE</p>
                <h2 className="text-4xl md:text-6xl font-black text-(--text) tracking-[0.2em] bg-(--accent-yellow) px-6 py-2 border-4 border-(--border) rounded-2xl shadow-[4px_4px_0px_0px_var(--shadow)]">{sessionId}</h2>
            </div>

            {/* QR Code */}
            <div className="flex flex-col items-center gap-4 p-4 border-2 border-(--border) rounded-xl bg-(--input-bg) shadow-[2px_2px_0px_0px_var(--shadow)]">
                <QRCodeSVG value={shareLink} size={140} level="H" includeMargin={true} bgColor="transparent" fgColor="currentColor" className="text-(--text)" />
                <p className="text-(--text) font-black text-[10px] uppercase text-center">Scan to receive instantly</p>
            </div>

            {/* Link + Copy + Share */}
            <div className="p-4 bg-(--input-bg) border-2 border-(--border) rounded-xl shadow-[2px_2px_0px_0px_var(--shadow)]">
                <div className="flex gap-2">
                    <input
                        readOnly
                        value={shareLink}
                        className="bg-transparent text-xs text-(--text) font-bold w-full outline-none truncate"
                    />
                    <button
                        onClick={handleCopy}
                        className="px-4 py-1 bg-(--accent-yellow) hover:opacity-90 text-black border-2 border-(--border) rounded-lg font-black text-[10px] uppercase transition-all shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shrink-0"
                    >
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
            </div>

            {/* Native Share Button (mobile) */}
            {hasNativeShare && (
                <button
                    onClick={handleNativeShare}
                    className="w-full py-4 bg-(--accent-emerald) text-black font-black uppercase text-sm rounded-2xl border-4 border-(--border) shadow-[4px_4px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center gap-3"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
                    Share via WhatsApp, Email, etc.
                </button>
            )}
        </div>
    );
}

