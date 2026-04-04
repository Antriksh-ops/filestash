import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CONFIG } from '../lib/config';

interface NearbyModalProps {
  onClose: () => void;
  currentSessionId: string | null;
  onEnsureSession: () => void;
}

export default function NearbyModal({ onClose, currentSessionId, onEnsureSession }: NearbyModalProps) {
  const [nearbyPeers, setNearbyPeers] = useState<{code: string; sessionId: string}[]>([]);

  // If no session exists, create one empty so we have a QR code to show
  useEffect(() => {
    if (!currentSessionId) {
      onEnsureSession();
    }
  }, [currentSessionId, onEnsureSession]);

  useEffect(() => {
    // Poll for active network peers so the user can connect out
    let interval: NodeJS.Timeout | null = null;
    let cancelled = false;
    const fetchNearby = async () => {
      try {
        const res = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/peers`);
        if (res.ok) {
          const data = await res.json();
          // Filter out our own session if it's in the list
          const peers = data.peers || [];
          if (!cancelled) setNearbyPeers(peers.filter((p: {sessionId: string; code: string}) => p.sessionId !== currentSessionId));
        }
      } catch {}
    };

    fetchNearby();
    interval = setInterval(fetchNearby, 8000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [currentSessionId]);

  const qrUrl = typeof window !== 'undefined' && currentSessionId ? `${window.location.origin}/?s=${currentSessionId}` : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-(--bg) w-full max-w-5xl rounded-[2.5rem] border-4 border-(--border) shadow-[16px_16px_0px_0px_var(--shadow)] overflow-hidden flex flex-col md:flex-row relative">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center bg-(--surface) border-2 border-(--border) rounded-xl hover:-translate-y-0.5 hover:bg-(--card-hover) active:translate-y-0 transition-all z-10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>

        {/* LEFT: QR scanner / Connect */}
        <div className="flex-1 bg-(--surface) p-8 md:p-12 flex flex-col items-center justify-center border-b-4 md:border-b-0 md:border-r-4 border-(--border)">
          <div className="text-center space-y-2 mb-8">
            <h3 className="text-(--text) font-black uppercase text-2xl">Scan to Connect</h3>
            <p className="text-(--text-secondary) font-bold text-xs uppercase tracking-widest">
              Scan with your phone to link
            </p>
          </div>

          <div className="bg-white p-6 rounded-3xl border-4 border-(--border) mb-6 transition-all duration-300">
            {qrUrl ? (
              <QRCodeSVG
                value={qrUrl}
                size={220}
                level="H"
                includeMargin={false}
                bgColor="#FFFFFF"
                fgColor="#000000"
              />
            ) : (
              <div className="w-[220px] h-[220px] bg-gray-200 animate-pulse flex items-center justify-center">
                <span className="font-bold uppercase text-xs text-gray-400 tracking-widest">Generating...</span>
              </div>
            )}
          </div>

           {/* Code Display */}
           <div className="flex gap-2">
            {(currentSessionId || '------').split('').map((char: string, i: number) => (
              <div key={i} className={`w-10 h-12 flex flex-col items-center justify-center bg-(--input-bg) border-2 border-(--border) rounded-xl ${!currentSessionId ? 'animate-pulse' : ''}`}>
                  <span className="font-black text-xl text-(--text)">{char}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: LAN Discovery List */}
        <div className="flex-1 p-8 md:p-12 bg-(--bg) flex flex-col">
          <div className="mb-8">
            <h1 className="text-3xl font-black text-(--text) uppercase tracking-tighter leading-tight mb-3">
              Nearby <span className="text-(--accent-violet)">Devices</span>
            </h1>
            <p className="text-(--text-secondary) font-bold text-sm">
              Use this screen to seamlessly link up with another device on your local network. 
            </p>
          </div>

          <h4 className="text-(--text) font-black uppercase tracking-widest text-xs mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-(--accent-emerald) animate-pulse" />
              Active on Local Network
          </h4>
          
          <div className="flex-1 max-h-[300px] md:max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {nearbyPeers.length > 0 ? (
                <div className="flex flex-col gap-3">
                    {nearbyPeers.map(peer => (
                        <button
                            key={peer.code}
                            onClick={() => { window.location.href = `/?s=${peer.sessionId}`; }}
                            className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border-4 border-(--border) bg-(--surface) hover:bg-(--card-hover) hover:-translate-y-1 transition-all shadow-[4px_4px_0px_0px_var(--shadow)] hover:shadow-[6px_6px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none mb-1"
                        >
                            <span className="font-black text-(--text) text-xl uppercase tracking-widest">{peer.code}</span>
                            <span className="text-xs font-black text-black uppercase px-4 py-2 bg-(--accent-emerald) rounded-xl border-2 border-(--border)">Connect</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className="w-full p-8 rounded-3xl border-4 border-dashed border-(--border) bg-(--input-bg) flex items-center justify-center">
                    <span className="text-(--text-secondary) font-bold uppercase text-sm tracking-widest opacity-60 flex items-center gap-2">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-(--text-secondary)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      Scanning Network...
                    </span>
                </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
