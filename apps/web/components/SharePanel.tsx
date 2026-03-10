'use client';

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface SharePanelProps {
    sessionId: string;
    shareLink: string;
}

export default function SharePanel({ sessionId, shareLink }: SharePanelProps) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(shareLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-4 pt-4 border-t-2 border-zinc-100">
            <div className="flex flex-col items-center gap-3 mb-4">
                <p className="text-zinc-500 font-black text-xs tracking-[0.3em] uppercase">ACTIVE BRIDGE CODE</p>
                <h2 className="text-6xl font-black text-black tracking-[0.2em] bg-yellow-200 px-6 py-2 border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">{sessionId}</h2>
            </div>

            <div className="flex flex-col items-center gap-4 p-4 border-2 border-black rounded-xl bg-orange-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <QRCodeSVG value={shareLink} size={140} level="H" includeMargin={true} bgColor="#fffbeb" fgColor="#000000" />
                <p className="text-black font-black text-[10px] uppercase text-center">Scan to receive instantly</p>
            </div>

            <div className="p-4 bg-orange-50 border-2 border-black rounded-xl shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex gap-2">
                    <input
                        readOnly
                        value={shareLink}
                        className="bg-transparent text-xs text-black font-bold w-full outline-none truncate"
                    />
                    <button
                        onClick={handleCopy}
                        className="px-4 py-1 bg-yellow-300 hover:bg-yellow-200 text-black border-2 border-black rounded-lg font-black text-[10px] uppercase transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shrink-0"
                    >
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
            </div>
        </div>
    );
}
