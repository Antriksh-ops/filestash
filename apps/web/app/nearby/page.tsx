'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../../lib/config';
import Link from 'next/link';

interface NearbyPeer {
  code: string;
  sessionId: string;
}

export default function NearbyPage() {
  const [code, setCode] = useState('');
  const [nearbyPeers, setNearbyPeers] = useState<NearbyPeer[]>([]);
  const [status, setStatus] = useState<'idle' | 'joining' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [serverReachable, setServerReachable] = useState(true);
  const failCountRef = useRef(0);

  // Poll for nearby peers on same network (with backoff on repeated failures)
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let cancelled = false;

    const fetchNearby = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/peers`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setNearbyPeers(data.peers || []);
            setServerReachable(true);
            failCountRef.current = 0;
          }
        } else {
          failCountRef.current++;
          if (failCountRef.current >= 2 && !cancelled) {
            setServerReachable(false);
          }
        }
      } catch {
        failCountRef.current++;
        if (failCountRef.current >= 2 && !cancelled) {
          setServerReachable(false);
        }
      }
    };

    fetchNearby();
    interval = setInterval(() => {
      if (failCountRef.current < 3) {
        fetchNearby();
      }
    }, 8000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  const joinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) return;

    setStatus('joining');
    setError(null);

    // 6-char = regular session code → go straight to main page
    if (trimmed.length === 6) {
      window.location.href = `/?s=${trimmed}`;
      return;
    }

    // 4-char = nearby code → resolve to session ID first
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/resolve?code=${trimmed}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        window.location.href = `/?s=${data.sessionId}`;
      } else {
        setError('Code not found or expired. Try again or use the full 6-digit session code instead.');
        setStatus('error');
      }
    } catch (e) {
      const msg = e instanceof Error && e.name === 'AbortError'
        ? 'Request timed out — server may be starting up. Try again in 30s.'
        : 'Failed to resolve code. The signaling server may not be reachable.';
      setError(msg);
      setStatus('error');
    }
  };

  return (
    <main className="min-h-screen bg-(--bg) py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-12">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="text-6xl">📡</div>
          <h1 className="text-5xl font-black uppercase tracking-tighter text-(--text)">Nearby Devices</h1>
          <p className="text-xl text-(--text-secondary) font-medium">
            Share files instantly with devices on your local network.
          </p>
        </div>

        {/* LAN banner */}
        <div className="p-6 rounded-2xl border-4 border-(--accent-emerald) bg-(--surface) shadow-[4px_4px_0px_0px_var(--shadow)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full bg-(--accent-emerald) animate-pulse" />
            <span className="text-sm font-black uppercase tracking-wider text-(--accent-emerald)">Ultra Fast — LAN Mode</span>
          </div>
          <p className="text-(--text-secondary) text-sm font-medium">
            When both devices are on the same Wi-Fi, data never leaves your local network. Near-gigabit speeds, zero cloud.
          </p>
        </div>

        {/* Server status warning */}
        {!serverReachable && (
          <div className="p-4 rounded-2xl border-4 border-(--accent-yellow) bg-(--surface) text-center space-y-2">
            <p className="text-(--accent-yellow) font-bold text-sm">
              ⚠️ Nearby auto-discovery unavailable — you can still share via session codes.
            </p>
            <p className="text-(--text-secondary) text-xs font-medium">
              If using Render free tier, the server needs ~60s to wake up.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 rounded-2xl border-4 border-(--accent-rose) bg-(--surface) text-center">
            <p className="text-(--accent-rose) font-bold text-sm">{error}</p>
            <button onClick={() => { setError(null); setStatus('idle'); }} className="mt-2 text-(--text-secondary) text-xs font-bold underline">Dismiss</button>
          </div>
        )}

        {/* Auto-detected nearby peers */}
        {nearbyPeers.length > 0 && (
          <div className="p-6 rounded-3xl border-4 border-(--accent-yellow) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)] space-y-4">
            <h2 className="text-lg font-black uppercase text-(--text)">🏠 Devices on your network</h2>
            <div className="space-y-2">
              {nearbyPeers.map(peer => (
                <button
                  key={peer.code}
                  onClick={() => { window.location.href = `/?s=${peer.sessionId}`; }}
                  className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-(--border) bg-(--input-bg) hover:bg-(--card-hover) transition-all"
                >
                  <span className="font-black text-(--text) uppercase">Code: {peer.code}</span>
                  <span className="text-xs font-bold text-(--accent-emerald) uppercase">Join →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* SEND — redirect to main page to use DropZone */}
          <div className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)] space-y-6">
            <h2 className="text-xl font-black uppercase text-(--text)">📤 Send Files</h2>
            <p className="text-(--text-secondary) text-sm font-medium">
              Drop your files on the main page. You&apos;ll get a 6-digit code to share with anyone — even across different networks.
            </p>
            <div className="space-y-3">
              <Link
                href="/"
                className="w-full py-4 bg-(--accent-emerald) text-black font-black uppercase text-lg rounded-2xl border-4 border-(--border) shadow-[6px_6px_0px_0px_var(--shadow)] hover:opacity-90 active:translate-x-1 active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-3"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />
                </svg>
                Choose files to send
              </Link>
              <p className="text-[10px] text-(--text-secondary) font-bold text-center uppercase">
                Works across any network — not just LAN
              </p>
            </div>
          </div>

          {/* RECEIVE — enter code */}
          <div className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)] space-y-6">
            <h2 className="text-xl font-black uppercase text-(--text)">📥 Receive</h2>
            <p className="text-(--text-secondary) text-sm font-medium">Enter a 4-digit nearby code or 6-digit session code.</p>
            <form onSubmit={joinByCode} className="space-y-4">
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                placeholder="CODE"
                className="w-full px-6 py-4 bg-(--input-bg) border-4 border-(--border) rounded-2xl font-black text-3xl text-center text-(--text) placeholder:text-(--text-secondary) placeholder:opacity-30 focus:outline-none focus:ring-4 focus:ring-(--accent-emerald) transition-all tracking-[0.4em]"
              />
              <button
                type="submit"
                disabled={(code.length !== 4 && code.length !== 6) || status === 'joining'}
                className="w-full py-4 bg-(--accent-violet) text-black font-black uppercase text-lg rounded-2xl border-4 border-(--border) shadow-[6px_6px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50"
              >
                {status === 'joining' ? 'Connecting...' : 'Connect'}
              </button>
            </form>
          </div>
        </div>

        <div className="text-center space-y-2">
          <p className="text-(--text-secondary) text-xs font-bold uppercase tracking-widest">
            Nearby codes expire after 10 minutes • Session codes last 24 hours
          </p>
          <p className="text-(--text-secondary) text-[10px] font-medium">
            Tip: You can also share by just pasting the link — no need for the code at all.
          </p>
        </div>
      </div>
    </main>
  );
}
