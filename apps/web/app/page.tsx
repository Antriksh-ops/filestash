'use client';

import React, { useEffect } from 'react';
import DropZone from '../components/DropZone';
import RelayPromptModal from '../components/RelayPromptModal';
import TransferProgress from '../components/TransferProgress';
import CompletionView from '../components/CompletionView';
import SharePanel from '../components/SharePanel';
import FileListPanel from '../components/FileListPanel';
import { useTransferSession } from '../hooks/useTransferSession';

export default function Home() {
  const {
    sessionId, files, batchMetadata, progress, status, joinCode, setJoinCode,
    isTransferStarted, setIsTransferStarted, showFileList, setShowFileList,
    error, setError, eta, showRelayPrompt, setShowRelayPrompt, currentFileIndex,
    receivedBytes, channelState, signalingState, sharedKey,
    isRelayActive, handleFileSelect, handleJoinByCode, handleCancel, downloadAll,
    reconnectP2P, activateRelay
  } = useTransferSession();

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

  return (
    <main className="min-h-screen bg-[#fafafa] flex flex-col items-center py-12 px-4 selection:bg-yellow-300 selection:text-black font-sans overflow-x-hidden relative">
      {/* Grain Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.03] mix-blend-multiply bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      {/* Relay Prompt Modal */}
      {showRelayPrompt && (
        <RelayPromptModal
          onRetry={() => { reconnectP2P(); setShowRelayPrompt(false); }}
          onRelay={() => { activateRelay(); setShowRelayPrompt(false); }}
          onDismiss={() => setShowRelayPrompt(false)}
        />
      )}

      {/* Header */}
      <div className="text-center space-y-4 pt-12">
        <h1 className="text-7xl font-black text-black tracking-tighter uppercase drop-shadow-[4px_4px_0px_#fde047]">
          FILEDROP
        </h1>
        <h2 className="text-zinc-600 text-xl font-bold uppercase tracking-widest mt-4">
          Unlimited P2P Magic • No Limits • No Cloud
        </h2>
      </div>

      <div className="w-full max-w-5xl space-y-8 flex-1 flex flex-col items-center justify-start min-h-[850px] transition-all duration-500 pt-8">
        {/* Error Banner */}
        {error && (
          <div className="w-full bg-rose-50 border-4 border-rose-500 p-6 rounded-3xl flex items-center justify-between shadow-[8px_8px_0px_0px_rgba(244,63,94,1)] animate-in slide-in-from-top-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-rose-500 flex items-center justify-center text-white shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
              </div>
              <p className="text-rose-900 font-black uppercase text-sm">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="p-2 hover:bg-rose-100 rounded-xl transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
        )}

        {status === 'idle' ? (
          <div className="w-full space-y-12 animate-in fade-in zoom-in slide-in-from-top-4 duration-700 ease-out">
            <DropZone onFileSelect={handleFileSelect} />

            <div className="bg-white border-4 border-black rounded-[2.5rem] p-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] hover:shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 transition-all duration-300">
              <h4 className="text-black font-black uppercase text-lg mb-6 tracking-tight">Access an existing bridge</h4>
              <form onSubmit={handleJoinByCode} className="flex flex-col gap-6">
                <div className="relative group">
                  <input
                    type="text"
                    maxLength={6}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="ENTER 6-DIGIT CODE"
                    className="w-full px-6 py-4 bg-orange-50 border-4 border-black rounded-2xl font-black text-2xl text-black placeholder:text-zinc-300 focus:outline-none focus:ring-4 focus:ring-yellow-200 transition-all uppercase"
                  />
                  {joinCode && (
                    <button
                      type="button"
                      onClick={() => setJoinCode('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black text-white rounded-xl hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="w-full py-4 bg-violet-400 text-black font-black uppercase text-xl rounded-2xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:bg-violet-300 active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                >
                  Join
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="w-full bg-white border-4 border-black rounded-3xl p-10 space-y-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] animate-in slide-in-from-bottom-10 duration-500 mx-auto">
            {/* File List */}
            <div className="space-y-6">
              <FileListPanel
                files={displayFiles}
                currentFileIndex={currentFileIndex}
                showFileList={showFileList}
                onToggle={() => setShowFileList(!showFileList)}
              />
            </div>

            {/* Progress */}
            <TransferProgress
              progress={progress}
              eta={eta}
              status={status}
              signalingState={signalingState}
              channelState={channelState}
              sharedKey={sharedKey}
              isRelayActive={isRelayActive}
              isTransferStarted={isTransferStarted}
              receivedBytes={receivedBytes}
            />

            {/* Start Transfer Button */}
            {status === 'sending' && channelState === 'open' && !isTransferStarted && (
              <button
                onClick={() => setIsTransferStarted(true)}
                className="w-full py-6 bg-yellow-400 hover:bg-yellow-300 text-black font-black uppercase text-2xl tracking-widest rounded-2xl border-4 border-black transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none mt-4"
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

            {/* Share Panel (sender only) */}
            {sessionId && status === 'sending' && (
              <SharePanel sessionId={sessionId} shareLink={shareLink} />
            )}

            {/* Cancel Button */}
            <button
              onClick={() => handleCancel(true)}
              className="w-full py-3 bg-white hover:bg-zinc-50 text-zinc-500 font-black uppercase text-xs tracking-widest rounded-xl border-2 border-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
              Cancel Bridge
            </button>
          </div>
        )}
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl px-4 mt-8 pb-12">
        <div className="p-8 bg-yellow-300 border-4 border-black rounded-3xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center space-y-2">
          <p className="text-black font-black text-xl uppercase">Unlimited</p>
          <p className="text-black font-bold text-xs uppercase opacity-70">Share 1TB+ as easily as 1MB. No server limits, ever.</p>
        </div>
        <div className="p-8 bg-violet-400 border-4 border-black rounded-3xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center space-y-2">
          <p className="text-black font-black text-xl uppercase">Ultra Private</p>
          <p className="text-black font-bold text-xs uppercase opacity-70">End-to-End Encrypted. Files never touch any cloud storage.</p>
        </div>
        <div className="p-8 bg-emerald-400 border-4 border-black rounded-3xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center space-y-2">
          <p className="text-black font-black text-xl uppercase">Blazing Fast</p>
          <p className="text-black font-bold text-xs uppercase opacity-70">Direct P2P core. The fastest way to move data locally or globally.</p>
        </div>
      </div>

      <div className="text-zinc-400 text-[10px] font-black uppercase tracking-[0.2em]">
        Built for the open web
      </div>
    </main>
  );
}
