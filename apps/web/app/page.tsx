'use client';

import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import DropZone from '../components/DropZone';
import RelayPromptModal from '../components/RelayPromptModal';
import TransferProgress from '../components/TransferProgress';
import CompletionView from '../components/CompletionView';
import ConnectionBadge from '../components/ConnectionBadge';
import QRScanner from '../components/QRScanner';
import { useTransferSession } from '../hooks/useTransferSession';

export default function Home() {
  const {
    sessionId, files, batchMetadata, progress, status, joinCode, setJoinCode,
    error, setError, eta, showRelayPrompt, setShowRelayPrompt,
    receivedBytes, channelState, signalingState,
    isRelayActive, handleFileSelect, handleJoinByCode, handleCancel, downloadAll,
    reconnectP2P, activateRelay, isPaused, togglePause
  } = useTransferSession();


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
          <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-10 py-10">
            {/* 1. Primary Action */}
            <div className="w-full">
              <DropZone onFileSelect={handleFileSelect} />
            </div>

            {/* 2. Secondary Actions (Join or Nearby) */}
            <div className="w-full flex flex-col md:flex-row items-stretch gap-4">
              <form onSubmit={handleJoinByCode} className="w-full relative">
                <input
                  type="text"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="HAVE A CODE?"
                  className="w-full px-6 py-4 bg-(--bg) border-4 border-(--border) rounded-2xl font-black text-center text-lg text-(--text) placeholder:opacity-50 focus:outline-none focus:ring-4 focus:ring-(--accent-yellow) transition-all shadow-[4px_4px_0px_0px_var(--shadow)] uppercase"
                />
                {joinCode && (
                  <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 bg-(--accent-violet) text-black font-black uppercase text-xs px-4 py-2 rounded-xl transition-all hover:bg-(--accent-yellow)">
                    JOIN
                  </button>
                )}
              </form>
            </div>
          </div>
        ) : status === 'completed' ? (
          <div className="w-full max-w-2xl mx-auto py-10">
            <CompletionView
              files={displayFiles}
              startTime={Date.now()}
              isSender={files.length > 0}
              onDownload={downloadAll}
              onNewTransfer={() => handleCancel(true)}
            />
          </div>
        ) : (
          /* ── ACTIVE SESSION: Compact ToffeeShare-style layout ── */
          <div className="w-full grid grid-cols-1 md:grid-cols-[320px_1fr] gap-8 items-start pt-4">

            {/* LEFT CARD: Compact file info + sharing tools */}
            <div className="bg-(--surface) border-4 border-(--border) rounded-3xl p-6 shadow-[8px_8px_0px_0px_var(--shadow)] space-y-4 relative">
              
              {/* File info */}
              {displayFiles.length > 0 && (
                <div>
                  <p className="text-(--text) font-black text-sm uppercase truncate pr-8">{displayFiles[0]?.name || 'File'}</p>
                  <p className="text-(--text-secondary) font-bold text-xs">
                    {displayFiles[0] && 'size' in displayFiles[0]
                      ? `${(displayFiles[0].size / (1024 * 1024)).toFixed(2)} MB`
                      : ''}
                    {displayFiles.length > 1 && ` + ${displayFiles.length - 1} more`}
                  </p>
                </div>
              )}

              {/* Share link & Code */}
              {sessionId && status === 'sending' && (
                <>
                  {/* Big Code Display */}
                  <div className="bg-(--bg) border-4 border-(--border) rounded-2xl p-4 text-center">
                    <p className="text-(--text-secondary) font-bold text-[10px] uppercase tracking-widest mb-1">Bridge Code</p>
                    <p className="text-(--text) font-black text-3xl tracking-[0.2em]">{sessionId}</p>
                  </div>

                  <button
                    onClick={() => { navigator.clipboard.writeText(shareLink); }}
                    className="w-full text-left px-3 py-2 bg-(--input-bg) border-2 border-(--border) rounded-xl text-(--accent-violet) font-bold text-xs truncate hover:bg-(--card-hover) transition-colors"
                  >
                    {shareLink}
                  </button>

                  {/* QR Code + Social share row */}
                  <div className="flex items-start gap-3">
                    <div className="bg-white p-2 rounded-xl border-2 border-(--border) shrink-0">
                      <div className="w-[100px] h-[100px]">
                        {typeof window !== 'undefined' && shareLink && (
                          <QRCodeSVG
                            value={shareLink}
                            size={100}
                            level="M"
                            includeMargin={false}
                            bgColor="#FFFFFF"
                            fgColor="#000000"
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 w-full">
                      {/* Copy */}
                      <button
                        onClick={() => navigator.clipboard.writeText(shareLink)}
                        className="w-full px-3 py-2 bg-(--accent-yellow) text-black font-black uppercase text-[10px] rounded-lg border-2 border-(--border) shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
                      >
                        Copy Link
                      </button>
                      {/* Share API */}
                      {typeof navigator !== 'undefined' && navigator.share && (
                        <button
                          onClick={() => navigator.share?.({ url: shareLink }).catch(() => {})}
                          className="w-full px-3 py-2 bg-(--accent-emerald) text-black font-black uppercase text-[10px] rounded-lg border-2 border-(--border) shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
                        >
                          Share
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}



              {/* Cancel Button */}
              <button
                onClick={() => handleCancel(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-rose-500/10 text-rose-500 border-2 border-rose-500/20 hover:bg-rose-500/20 hover:border-rose-500/50 transition-all font-black uppercase text-xs tracking-widest mt-4"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                Cancel Transfer
              </button>
            </div>

            {/* RIGHT SIDE: Status + Progress */}
            <div className="flex flex-col justify-center gap-6 py-4">
              {/* Headline */}
              <div>
                <h2 className="text-(--text) font-black text-3xl md:text-4xl uppercase tracking-tighter leading-tight">
                  {channelState === 'open'
                    ? (progress > 0 ? 'Transfer in progress' : 'Connected. Sending...')
                    : 'Sharing your files directly from your device'}
                </h2>
                <p className="text-(--text-secondary) font-bold text-sm mt-3 max-w-md leading-relaxed">
                  {channelState === 'open'
                    ? 'Files are flowing directly between devices. Do not close this tab.'
                    : 'Share the link or scan the QR code on another device to begin the transfer. Keep this tab open.'}
                </p>
              </div>

              {/* Connection + Progress inline */}
              <div className="space-y-3">
                <ConnectionBadge
                  signalingState={signalingState}
                  channelState={channelState}
                  isRelayActive={isRelayActive}
                />
                <TransferProgress
                  progress={progress}
                  eta={eta}
                  status={status}
                  signalingState={signalingState}
                  channelState={channelState}
                  isRelayActive={isRelayActive}
                  receivedBytes={receivedBytes}
                  isPaused={isPaused}
                  togglePause={togglePause}
                  isSender={files.length > 0}
                />
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Feature Cards — only show on idle */}
      {status === 'idle' && (
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
      )}

    </main>
  );
}

