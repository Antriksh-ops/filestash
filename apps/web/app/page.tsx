'use client';

import React, { useEffect, useState } from 'react';
import DropZone from '../components/DropZone';
import RelayPromptModal from '../components/RelayPromptModal';
import TransferProgress from '../components/TransferProgress';
import CompletionView from '../components/CompletionView';
import SharePanel from '../components/SharePanel';
import FileListPanel from '../components/FileListPanel';
import ConnectionBadge from '../components/ConnectionBadge';
import QRScanner from '../components/QRScanner';
import { useTransferSession } from '../hooks/useTransferSession';
import { CONFIG } from '../lib/config';
import { useRef } from 'react';

export default function Home() {
  const {
    sessionId, files, batchMetadata, progress, status, joinCode, setJoinCode,
    isTransferStarted, setIsTransferStarted, showFileList, setShowFileList,
    error, setError, eta, showRelayPrompt, setShowRelayPrompt, currentFileIndex,
    receivedBytes, channelState, signalingState,
    isRelayActive, handleFileSelect, handleJoinByCode, handleCancel, downloadAll,
    reconnectP2P, activateRelay, isPaused, togglePause
  } = useTransferSession();

  const [nearbyPeers, setNearbyPeers] = useState<{code: string; sessionId: string}[]>([]);
  const failCountRef = useRef(0);

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
            failCountRef.current = 0;
          }
        } else {
          failCountRef.current++;
        }
      } catch {
        failCountRef.current++;
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

  const [showQRScanner, setShowQRScanner] = useState(false);

  // Prevent default drop globally
  useEffect(() => {
    const preventDefault = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const shareLink = typeof window !== 'undefined' ? `${window.location.origin}?s=${sessionId}` : '';
  const displayFiles = files.length > 0 ? files : (batchMetadata?.files || []);

  const handleQRScan = (code: string) => {
    setShowQRScanner(false);
    if (code) {
      setJoinCode(code);
      // Navigate directly to the session
      window.location.href = `${window.location.origin}?s=${code}`;
    }
  };

  return (
    <main className="min-h-screen bg-(--bg) flex flex-col items-center py-12 px-4 font-sans overflow-x-hidden relative">
      {/* QR Scanner Modal */}
      {showQRScanner && (
        <QRScanner
          onScan={handleQRScan}
          onClose={() => setShowQRScanner(false)}
        />
      )}

      {/* Relay Prompt Modal */}
      {showRelayPrompt && (
        <RelayPromptModal
          onRetry={() => { reconnectP2P(); setShowRelayPrompt(false); }}
          onRelay={() => { activateRelay(); setShowRelayPrompt(false); }}
          onDismiss={() => setShowRelayPrompt(false)}
        />
      )}

      {/* Header */}
      <div className="text-center space-y-4 pt-8">
        <h1 className="text-6xl md:text-7xl font-black text-(--text) tracking-tighter uppercase">
          FILEDROP
        </h1>
        <h2 className="text-(--text-secondary) text-lg md:text-xl font-bold uppercase tracking-widest mt-4">
          Unlimited P2P Magic • No Limits • No Cloud
        </h2>
      </div>

      <div className="w-full max-w-5xl space-y-8 flex-1 flex flex-col items-center justify-start min-h-[850px] transition-all duration-500 pt-8">
        {/* Error Banner */}
        {error && (
          <div className="w-full bg-rose-50 dark:bg-rose-950 border-4 border-(--accent-rose) p-6 rounded-3xl flex items-center justify-between shadow-[8px_8px_0px_0px_var(--shadow)]">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-(--accent-rose) flex items-center justify-center text-white shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
              </div>
              <p className="text-(--text) font-black uppercase text-sm">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="p-2 hover:bg-rose-100 dark:hover:bg-rose-900 rounded-xl transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-(--text)"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
        )}

        {status === 'idle' ? (
          <div className="w-full space-y-12">
            <DropZone onFileSelect={handleFileSelect} />

            <div className="bg-(--surface) border-4 border-(--border) rounded-[2.5rem] p-10 shadow-[12px_12px_0px_0px_var(--shadow)] hover:shadow-[16px_16px_0px_0px_var(--shadow)] hover:-translate-y-1 transition-all duration-300">
              <h4 className="text-(--text) font-black uppercase text-lg mb-6 tracking-tight">Access an existing bridge</h4>
              <form onSubmit={handleJoinByCode} className="flex flex-col gap-6">
                <div className="relative group flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      maxLength={6}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="ENTER 6-DIGIT CODE"
                      className="w-full px-6 py-4 bg-(--input-bg) border-4 border-(--border) rounded-2xl font-black text-2xl text-(--text) placeholder:text-(--text-secondary) placeholder:opacity-40 focus:outline-none focus:ring-4 focus:ring-(--accent-yellow) transition-all uppercase"
                    />
                    {joinCode && (
                      <button
                        type="button"
                        onClick={() => setJoinCode('')}
                        className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-(--text) text-(--bg) rounded-xl hover:opacity-80 transition-colors shadow-[2px_2px_0px_0px_var(--shadow)]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                      </button>
                    )}
                  </div>
                  {/* QR Scan Button */}
                  <button
                    type="button"
                    onClick={() => setShowQRScanner(true)}
                    className="px-4 py-4 bg-(--accent-violet) border-4 border-(--border) rounded-2xl shadow-[4px_4px_0px_0px_var(--shadow)] hover:opacity-90 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all shrink-0 flex items-center justify-center"
                    title="Scan QR Code"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                      <rect width="7" height="5" x="7" y="7" rx="1" /><rect width="7" height="5" x="10" y="12" rx="1" />
                    </svg>
                  </button>
                </div>
                <button
                  type="submit"
                  className="w-full py-4 bg-(--accent-violet) text-black font-black uppercase text-xl rounded-2xl border-4 border-(--border) shadow-[8px_8px_0px_0px_var(--shadow)] hover:opacity-90 active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                >
                  Join
                </button>
              </form>
            </div>

            {/* Nearby Devices Section */}
            {nearbyPeers.length > 0 && (
              <div className="bg-(--surface) border-4 border-(--accent-yellow) rounded-[2.5rem] p-8 shadow-[8px_8px_0px_0px_var(--shadow)] transition-all">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-3 h-3 rounded-full bg-(--accent-yellow) animate-pulse" />
                  <h4 className="text-(--text) font-black uppercase text-lg tracking-tight">Devices Nearby</h4>
                </div>
                <div className="flex flex-col gap-3">
                  {nearbyPeers.map(peer => (
                    <button
                      key={peer.code}
                      onClick={() => { window.location.href = `/?s=${peer.sessionId}`; }}
                      className="w-full flex items-center justify-between p-4 rounded-xl border-4 border-(--border) bg-(--input-bg) hover:bg-(--card-hover) hover:-translate-y-1 transition-all shadow-[4px_4px_0px_0px_var(--shadow)] hover:shadow-[6px_6px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none"
                    >
                      <span className="font-black text-(--text) text-xl uppercase tracking-widest">{peer.code}</span>
                      <span className="text-sm font-black text-(--accent-emerald) uppercase px-4 py-2 bg-(--surface) rounded-lg border-2 border-(--border)">Connect</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full bg-(--surface) border-4 border-(--border) rounded-3xl p-10 space-y-8 shadow-[12px_12px_0px_0px_var(--shadow)] mx-auto">
            {/* Share Panel FIRST (sender only) — most important for single-device use case */}
            {sessionId && status === 'sending' && (
              <SharePanel sessionId={sessionId} shareLink={shareLink} peerConnected={channelState === 'open'} />
            )}

            {/* Connection Badge */}
            <ConnectionBadge
              signalingState={signalingState}
              channelState={channelState}
              isRelayActive={isRelayActive}
            />

            {/* File List */}
            <FileListPanel
              files={displayFiles}
              currentFileIndex={currentFileIndex}
              showFileList={showFileList}
              onToggle={() => setShowFileList(!showFileList)}
            />

            {/* Progress */}
            <TransferProgress
              progress={progress}
              eta={eta}
              status={status}
              signalingState={signalingState}
              channelState={channelState}
              isRelayActive={isRelayActive}
              isTransferStarted={isTransferStarted}
              receivedBytes={receivedBytes}
              isPaused={isPaused}
              togglePause={togglePause}
              isSender={files.length > 0}
            />

            {/* Start Transfer Button */}
            {status === 'sending' && channelState === 'open' && !isTransferStarted && (
              <button
                onClick={() => setIsTransferStarted(true)}
                className="w-full py-6 bg-(--accent-yellow) hover:opacity-90 text-black font-black uppercase text-2xl tracking-widest rounded-2xl border-4 border-(--border) transition-all shadow-[8px_8px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none mt-4"
              >
                Start Transfer
              </button>
            )}

            {/* Completion View */}
            {status === 'completed' && (
              <CompletionView
                files={displayFiles}
                startTime={Date.now()}
                isSender={files.length > 0}
                onDownload={downloadAll}
                onNewTransfer={() => handleCancel(true)}
              />
            )}

            {/* Cancel Button */}
            <button
              onClick={() => handleCancel(true)}
              className="w-full py-3 bg-(--surface) hover:bg-(--card-hover) text-(--text-secondary) font-black uppercase text-xs tracking-widest rounded-xl border-2 border-(--border) transition-all shadow-[4px_4px_0px_0px_var(--shadow)] active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
              Cancel Bridge
            </button>
          </div>
        )}
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl px-4 mt-8 pb-12">
        <div className="p-8 bg-(--accent-yellow) border-4 border-(--border) rounded-3xl shadow-[8px_8px_0px_0px_var(--shadow)] text-center space-y-2">
          <p className="text-black font-black text-xl uppercase">Unlimited</p>
          <p className="text-black font-bold text-xs uppercase opacity-70">Share 1TB+ as easily as 1MB. No server limits, ever.</p>
        </div>
        <div className="p-8 bg-(--accent-violet) border-4 border-(--border) rounded-3xl shadow-[8px_8px_0px_0px_var(--shadow)] text-center space-y-2">
          <p className="text-black font-black text-xl uppercase">Ultra Private</p>
          <p className="text-black font-bold text-xs uppercase opacity-70">End-to-End Encrypted. Files never touch any cloud storage.</p>
        </div>
        <div className="p-8 bg-(--accent-emerald) border-4 border-(--border) rounded-3xl shadow-[8px_8px_0px_0px_var(--shadow)] text-center space-y-2">
          <p className="text-black font-black text-xl uppercase">Blazing Fast</p>
          <p className="text-black font-bold text-xs uppercase opacity-70">Direct P2P core. The fastest way to move data locally or globally.</p>
        </div>
      </div>
    </main>
  );
}

