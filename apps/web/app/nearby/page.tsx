'use client';

import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CONFIG } from '../../lib/config';
import { useTransferSession } from '../../hooks/useTransferSession';

export default function NearbyPage() {
  const { sessionId, handleFileSelect } = useTransferSession();
  const [nearbyPeers, setNearbyPeers] = useState<{code: string; sessionId: string}[]>([]);
  const [inputCode, setInputCode] = useState('');

  // Start an empty session when landing on this standby page
  useEffect(() => {
    if (!sessionId) {
      handleFileSelect([]); // Triggers session creation without files
    }
  }, [sessionId, handleFileSelect]);

  useEffect(() => {
    // Poll for active network peers so the user can connect out if they want
    let interval: NodeJS.Timeout | null = null;
    let cancelled = false;
    const fetchNearby = async () => {
      try {
        const res = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/peers`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setNearbyPeers(data.peers || []);
        }
      } catch {}
    };

    fetchNearby();
    interval = setInterval(fetchNearby, 8000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCode.length === 6) {
      window.location.href = `/?s=${inputCode.toUpperCase()}`;
    }
  };

  const qrUrl = typeof window !== 'undefined' && sessionId ? `${window.location.origin}/?s=${sessionId}` : '';

  return (
    <main className="min-h-[calc(100vh-[80px])] bg-(--bg) flex items-center justify-center py-20 px-4">
      <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        
        {/* Left Side: QR Code Card */}
        <div className="w-full flex justify-center md:justify-end">
          <div className="bg-(--surface) border-4 border-(--border) rounded-[2.5rem] p-10 flex flex-col items-center gap-8 shadow-[16px_16px_0px_0px_var(--shadow)] max-w-sm w-full">
            <div className="text-center space-y-2">
              <h3 className="text-(--text) font-black uppercase text-xl">Scan to Connect</h3>
              <p className="text-(--text-secondary) font-bold text-xs uppercase tracking-widest">
                Scan with your phone to link
              </p>
            </div>

            <div className="bg-white p-6 rounded-3xl border-4 border-(--border)">
              {qrUrl ? (
                <QRCodeSVG
                  value={qrUrl}
                  size={200}
                  level="H"
                  includeMargin={false}
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                />
              ) : (
                <div className="w-[200px] h-[200px] bg-gray-200 animate-pulse" />
              )}
            </div>

            <div className="flex gap-2">
              {(sessionId || '').split('').map((char: string, i: number) => (
                <div key={i} className="w-10 h-10 flex flex-col items-center justify-center bg-(--input-bg) border-2 border-(--border) rounded-xl">
                    <span className="font-black text-xl text-(--text)">{char}</span>
                </div>
              ))}
            </div>
            
            <form onSubmit={handleJoinSubmit} className="w-full relative mt-2">
                <input 
                    type="text" 
                    maxLength={6}
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                    placeholder="ENTER CODE" 
                    className="w-full bg-(--input-bg) border-4 border-(--border) rounded-2xl py-4 px-6 font-black text-center text-xl tracking-widest uppercase focus:outline-none focus:ring-4 focus:ring-(--accent-warning)"
                />
                {inputCode.length === 6 && (
                    <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 bg-(--accent-yellow) text-black font-black uppercase px-4 py-2 rounded-xl border-2 border-(--border) hover:-translate-y-0.5 active:translate-y-0 transition-all shadow-[2px_2px_0px_0px_var(--shadow)] active:shadow-none">
                        Go
                    </button>
                )}
            </form>
          </div>
        </div>

        {/* Right Side: Instructions & LAN List */}
        <div className="flex flex-col items-start gap-8">
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-black text-(--text) uppercase tracking-tighter leading-[1.1]">
              Connect to<br />
              <span className="text-(--accent-violet)">Nearby Devices</span>
            </h1>
            <p className="text-(--text-secondary) font-bold text-lg max-w-md">
              Use this page to seamlessly transfer files from your phone to this computer, or download files from another device on the same local network.
            </p>
            <p className="text-(--text-secondary) font-bold text-sm max-w-md opacity-80">
              Simply scan the QR code with your mobile camera. If a file is selected on your mobile device, it will automatically bridge to this screen instantly.
            </p>
          </div>

          {/* LAN Discovery List */}
          <div className="w-full max-w-md space-y-4">
            <h4 className="text-(--text) font-black uppercase tracking-widest text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-(--accent-emerald) animate-pulse" />
                Active on Local Network
            </h4>
            
            {nearbyPeers.length > 0 ? (
                <div className="flex flex-col gap-3">
                    {nearbyPeers.map(peer => (
                        <button
                            key={peer.code}
                            onClick={() => { window.location.href = `/?s=${peer.sessionId}`; }}
                            className="w-full flex items-center justify-between p-4 rounded-2xl border-4 border-(--border) bg-(--surface) hover:bg-(--card-hover) hover:-translate-y-1 transition-all shadow-[4px_4px_0px_0px_var(--shadow)] hover:shadow-[6px_6px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none"
                        >
                            <span className="font-black text-(--text) text-xl uppercase tracking-widest">{peer.code}</span>
                            <span className="text-sm font-black text-black uppercase px-4 py-2 bg-(--accent-emerald) rounded-xl border-2 border-(--border)">Connect</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className="w-full p-6 rounded-2xl border-4 border-dashed border-(--border) bg-(--input-bg) flex items-center justify-center">
                    <span className="text-(--text-secondary) font-bold uppercase text-sm tracking-widest opacity-60">Scanning Network...</span>
                </div>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
