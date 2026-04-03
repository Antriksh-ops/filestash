'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../../lib/config';

interface NearbyPeer {
  code: string;
  sessionId: string;
}

export default function NearbyPage() {
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [generatedSessionId, setGeneratedSessionId] = useState<string | null>(null);
  const [nearbyPeers, setNearbyPeers] = useState<NearbyPeer[]>([]);
  const [status, setStatus] = useState<'idle' | 'creating' | 'joining' | 'error'>('idle');
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
          // Server responded but route doesn't exist yet — not critical
          failCountRef.current++;
          if (failCountRef.current >= 2 && !cancelled) {
            setServerReachable(false);
          }
        }
      } catch {
        // Network error or timeout — silently degrade
        failCountRef.current++;
        if (failCountRef.current >= 2 && !cancelled) {
          setServerReachable(false);
        }
      }
    };

    fetchNearby();
    // Poll less aggressively: every 8s if reachable, stop if not
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

  const createNearbySession = async () => {
    setStatus('creating');
    setError(null);
    try {
      // First create a normal session
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const sessionRes = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [], nearby: true }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const sessionData = await sessionRes.json();

      // Then register a nearby short code for it
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 8000);
      const nearbyRes = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionData.sessionId }),
        signal: controller2.signal,
      });
      clearTimeout(timeout2);

      if (!nearbyRes.ok) {
        throw new Error(`Server returned ${nearbyRes.status}`);
      }

      const nearbyData = await nearbyRes.json();

      setGeneratedCode(nearbyData.code);
      setGeneratedSessionId(sessionData.sessionId);
      setStatus('idle');
    } catch (e) {
      const msg = e instanceof Error && e.name === 'AbortError'
        ? 'Request timed out. The signaling server may be waking up — try again in 30s.'
        : 'Failed to create nearby session. The signaling server may need a redeployment with the latest code.';
      setError(msg);
      setStatus('error');
    }
  };

  const joinNearbySession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 4) return;

    setStatus('joining');
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/resolve?code=${code}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        window.location.href = `/?s=${data.sessionId}`;
      } else {
        setError('Code not found or expired. Check the code and try again.');
        setStatus('error');
      }
    } catch (e) {
      const msg = e instanceof Error && e.name === 'AbortError'
        ? 'Request timed out. The signaling server may be starting up — try again in 30s.'
        : 'Failed to resolve code. Is the signaling server running?';
      setError(msg);
      setStatus('error');
    }
  };

  const goToSession = () => {
    if (generatedSessionId) {
      window.location.href = `/?s=${generatedSessionId}`;
    }
  };

  return (
    <main className="min-h-screen bg-(--bg) py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-12">
        <div className="text-center space-y-4">
          <div className="text-6xl">📡</div>
          <h1 className="text-5xl font-black uppercase tracking-tighter text-(--text)">Nearby Devices</h1>
          <p className="text-xl text-(--text-secondary) font-medium">
            Share files instantly with devices on your local network using a simple 4-digit code.
          </p>
        </div>

        <div className="p-6 rounded-2xl border-4 border-(--accent-emerald) bg-(--surface) shadow-[4px_4px_0px_0px_var(--shadow)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full bg-(--accent-emerald) animate-pulse" />
            <span className="text-sm font-black uppercase tracking-wider text-(--accent-emerald)">Ultra Fast — LAN Mode</span>
          </div>
          <p className="text-(--text-secondary) text-sm font-medium">
            When both devices are on the same Wi-Fi, data travels directly through your local network at near-gigabit speeds. It never leaves your building.
          </p>
        </div>

        {/* Server status warning */}
        {!serverReachable && (
          <div className="p-4 rounded-2xl border-4 border-(--accent-yellow) bg-(--surface) text-center space-y-2">
            <p className="text-(--accent-yellow) font-bold text-sm">
              ⚠️ Signaling server is unreachable or hasn&apos;t been deployed with nearby endpoints.
            </p>
            <p className="text-(--text-secondary) text-xs font-medium">
              The nearby feature requires the signaling server to have the <code>/nearby/*</code> routes deployed. If using Render free tier, the server may need ~60s to wake up.
            </p>
          </div>
        )}

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
          {/* Send */}
          <div className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)] space-y-6">
            <h2 className="text-xl font-black uppercase text-(--text)">📤 Send</h2>
            <p className="text-(--text-secondary) text-sm font-medium">Generate a 4-digit code for someone on your network.</p>
            {generatedCode ? (
              <div className="text-center py-4 space-y-4">
                <p className="text-5xl font-black tracking-[0.3em] text-(--text)">{generatedCode}</p>
                <p className="text-xs text-(--text-secondary) font-bold uppercase">Share this code with nearby device</p>
                <button
                  onClick={goToSession}
                  className="w-full py-3 bg-(--accent-yellow) text-black font-black uppercase rounded-xl border-2 border-(--border) shadow-[4px_4px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
                >
                  Go to Transfer →
                </button>
              </div>
            ) : (
              <button
                onClick={createNearbySession}
                disabled={status === 'creating'}
                className="w-full py-4 bg-(--accent-emerald) text-black font-black uppercase text-lg rounded-2xl border-4 border-(--border) shadow-[6px_6px_0px_0px_var(--shadow)] hover:opacity-90 active:translate-x-1 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50"
              >
                {status === 'creating' ? 'Creating...' : 'Generate Code'}
              </button>
            )}
          </div>

          {/* Receive */}
          <div className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)] space-y-6">
            <h2 className="text-xl font-black uppercase text-(--text)">📥 Receive</h2>
            <p className="text-(--text-secondary) text-sm font-medium">Enter the 4-digit code from the sending device.</p>
            <form onSubmit={joinNearbySession} className="space-y-4">
              <input
                type="text"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="0000"
                className="w-full px-6 py-4 bg-(--input-bg) border-4 border-(--border) rounded-2xl font-black text-3xl text-center text-(--text) placeholder:text-(--text-secondary) placeholder:opacity-30 focus:outline-none focus:ring-4 focus:ring-(--accent-emerald) transition-all tracking-[0.4em]"
              />
              <button
                type="submit"
                disabled={code.length !== 4 || status === 'joining'}
                className="w-full py-4 bg-(--accent-violet) text-black font-black uppercase text-lg rounded-2xl border-4 border-(--border) shadow-[6px_6px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50"
              >
                {status === 'joining' ? 'Connecting...' : 'Connect'}
              </button>
            </form>
          </div>
        </div>

        <div className="text-center text-(--text-secondary) text-xs font-bold uppercase tracking-widest">
          Codes expire after 10 minutes
        </div>
      </div>
    </main>
  );
}
