'use client';

import React from 'react';
import DropZone from '../components/DropZone';
import RelayPromptModal from '../components/RelayPromptModal';
import TransferProgress from '../components/TransferProgress';
import CompletionView from '../components/CompletionView';
import SharePanel from '../components/SharePanel';
import FileListPanel from '../components/FileListPanel';
import { useWebRTC } from '../hooks/useWebRTC';
import { getFileChunks } from '../lib/chunker';
import { computeHash, computeFileHash, encryptChunk, decryptChunk } from '../lib/crypto';
import { CONFIG } from '../lib/config';
import { saveTransferState, getTransferState, deleteTransferState } from '../lib/db';

// WakeLock type
interface WakeLockSentinel {
  release(): Promise<void>;
  onrelease: ((this: WakeLockSentinel, ev: Event) => void) | null;
}

interface BatchMetadata {
  files: { name: string; size: number }[];
  sessionId: string;
}

// Retry helper: retries a send function up to maxRetries times with exponential backoff
async function retrySend(
  sendFn: () => boolean,
  maxRetries = 3,
  baseDelay = 100
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (sendFn()) return true;
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  console.error('[SEND] Failed after retries');
  return false;
}


export default function Home() {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [batchMetadata, setBatchMetadata] = React.useState<BatchMetadata | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'receiving' | 'completed'>('idle');
  const [joinCode, setJoinCode] = React.useState('');
  const [isTransferStarted, setIsTransferStarted] = React.useState(false);
  const [showFileList, setShowFileList] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [eta, setEta] = React.useState<string | null>(null);
  const [showRelayPrompt, setShowRelayPrompt] = React.useState(false);
  const [currentFileIndex, setCurrentFileIndex] = React.useState(0);

  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);

  // Progress tracking refs
  const totalSentRef = React.useRef(0);
  const receivedSizeRef = React.useRef(0);
  const startTimeRef = React.useRef<number | null>(null);
  const lastUiUpdateRef = React.useRef(0);
  const lastFeedbackRef = React.useRef(0);

  // Send/key refs (for use inside callbacks without stale closures)
  const sendDataRef = React.useRef<(data: string | ArrayBuffer) => boolean>(() => false);
  const sharedKeyRef = React.useRef<CryptoKey | null>(null);
  const isRelayActiveRef = React.useRef(false);

  // Multi-file receiver state: Map<fileIndex, ArrayBuffer[]>
  const fileChunksMapRef = React.useRef<Map<number, ArrayBuffer[]>>(new Map());
  const manifestRef = React.useRef<Record<number, string>>({});
  const writableRef = React.useRef<FileSystemWritableFileStream | null>(null);

  // Shared key race condition fix: buffer chunks arriving before key is ready
  const pendingEncryptedChunksRef = React.useRef<ArrayBuffer[]>([]);

  const isCancelledRef = React.useRef(false);
  const handleCancelRef = React.useRef<(isInitiator?: boolean) => void>(null);

  // Wake Lock
  const requestWakeLock = React.useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
        console.log('Wake Lock active');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`Wake Lock error: ${err.message}`);
      }
    }
  }, []);

  const releaseWakeLock = React.useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // Progress UI update (throttled to 10 FPS)
  const updateProgressUi = React.useCallback((current: number, total: number) => {
    const now = Date.now();
    if (now - lastUiUpdateRef.current < 100 && current < total) return;
    lastUiUpdateRef.current = now;

    const p = (current / total) * 100;
    setProgress(p);

    if (startTimeRef.current) {
      const elapsed = (now - startTimeRef.current) / 1000;
      if (elapsed > 0) {
        const speed = current / elapsed;
        const remaining = total - current;
        const timeRemaining = remaining / speed;

        if (timeRemaining >= 0 && isFinite(timeRemaining)) {
          const mins = Math.floor(timeRemaining / 60);
          const secs = Math.floor(timeRemaining % 60);
          const speedMB = (speed / (1024 * 1024)).toFixed(2);
          setEta(`${mins > 0 ? `${mins}m ` : ''}${secs}s • ${speedMB} MB/s`);
        }
      }
    }
  }, []);

  const onConnectionStateChange = React.useCallback((state: RTCPeerConnectionState) => {
    console.log('PC State:', state);
  }, []);

  const onTransferStart = React.useCallback(async () => {
    startTimeRef.current = Date.now();
    await requestWakeLock();
  }, [requestWakeLock]);

  const onTransferEnd = React.useCallback(() => {
    releaseWakeLock();
  }, [releaseWakeLock]);

  // Process a single encrypted binary chunk (extracted for reuse in race-condition buffer drain)
  const processEncryptedChunk = React.useCallback(async (data: ArrayBuffer, key: CryptoKey) => {
    const view = new DataView(data);
    const chunkId = view.getUint32(0);
    const iv = new Uint8Array(data, 4, 12);
    const encryptedData = data.slice(16);

    const decrypted = await decryptChunk(encryptedData, key, iv);

    // Verify hash against manifest
    const hash = await computeHash(decrypted);
    const expectedHash = manifestRef.current[chunkId];

    if (expectedHash && hash !== expectedHash) {
      console.error(`INTEGRITY ERROR: Chunk ${chunkId} hash mismatch! Expected: ${expectedHash}, Got: ${hash}`);
    } else {
      console.log(`Verified chunk ${chunkId}`);
    }

    // Write to FileSystem Access API or accumulate in per-file map
    if (writableRef.current) {
      await writableRef.current.write(decrypted);
    } else {
      const currentIdx = currentFileIndex;
      if (!fileChunksMapRef.current.has(currentIdx)) {
        fileChunksMapRef.current.set(currentIdx, []);
      }
      fileChunksMapRef.current.get(currentIdx)!.push(decrypted);
    }

    receivedSizeRef.current += decrypted.byteLength;
    return decrypted.byteLength;
  }, [currentFileIndex]);

  // Handle incoming data channel / relay messages
  const handleRawMessage = React.useCallback(async (data: string | ArrayBuffer) => {
    if (typeof data === 'string') {
      const message = JSON.parse(data);

      if (message.type === 'batch-metadata') {
        setBatchMetadata(message);
        fileChunksMapRef.current = new Map();
        receivedSizeRef.current = 0;
        setCurrentFileIndex(0);
        setProgress(0);
        startTimeRef.current = Date.now();
        setStatus('receiving');

        // Try to get a writable stream for the first file
        if ('showSaveFilePicker' in window && message.files.length > 0) {
          try {
            const handle = await (window as Window & { showSaveFilePicker: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
              suggestedName: message.files[0].name,
            });
            writableRef.current = await handle.createWritable();
          } catch (e: unknown) {
            console.warn('FileSystem Access API declined, falling back to memory:', e instanceof Error ? e.message : e);
          }
        }

        // Fetch manifest for verification
        try {
          const res = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/session/${message.sessionId}/manifest`);
          if (res.ok) {
            manifestRef.current = await res.json();
          }
        } catch (e) {
          console.warn('Failed to fetch manifest:', e);
        }
      } else if (message.type === 'file-start') {
        setCurrentFileIndex(message.index);
        // Close previous writable if using FileSystem Access API
        if (writableRef.current && message.index > 0) {
          await writableRef.current.close();
          writableRef.current = null;
          // Try to open a new file handle for the next file
          if ('showSaveFilePicker' in window) {
            const meta = batchMetadata?.files[message.index];
            if (meta) {
              try {
                const handle = await (window as Window & { showSaveFilePicker: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                  suggestedName: meta.name,
                });
                writableRef.current = await handle.createWritable();
              } catch {
                // User declined — fall back to memory
              }
            }
          }
        }
      } else if (message.type === 'progress-sync') {
        const totalBatchSize = batchMetadata?.files.reduce((acc: number, f: { size: number }) => acc + f.size, 0) || 0;
        if (totalBatchSize > 0) {
          updateProgressUi(message.received, totalBatchSize);
        }
      } else if (message.type === 'cancel') {
        handleCancelRef.current?.(false);
      } else if (message.type === 'error') {
        setError(message.message || 'An unknown error occurred');
        setStatus('idle');
      } else if (message.type === 'resume-request') {
        // Sender receives resume request — skip already-completed chunks
        console.log('[RESUME] Peer requests resume, completed chunks:', message.completedChunks?.length);
      }
    } else if (data instanceof ArrayBuffer) {
      // Key race condition fix: if shared key isn't ready yet, buffer the chunk
      if (!sharedKeyRef.current) {
        console.warn('[CRYPTO] Shared key not yet derived, buffering encrypted chunk...');
        pendingEncryptedChunksRef.current.push(data);
        return;
      }

      try {
        await processEncryptedChunk(data, sharedKeyRef.current);

        if (batchMetadata && startTimeRef.current) {
          const totalSize = batchMetadata.files.reduce((acc: number, f: { size: number }) => acc + f.size, 0);
          updateProgressUi(receivedSizeRef.current, totalSize);

          // Send progress feedback to sender
          if (receivedSizeRef.current - lastFeedbackRef.current > 1024 * 1024) {
            lastFeedbackRef.current = receivedSizeRef.current;
            sendDataRef.current(JSON.stringify({ type: 'progress-sync', received: receivedSizeRef.current }));
          }

          if (receivedSizeRef.current >= totalSize) {
            setStatus('completed');
            setEta(null);
            setProgress(100);
            if (writableRef.current) {
              await writableRef.current.close();
              writableRef.current = null;
            }
            if (sessionId) deleteTransferState(sessionId);
          } else {
            // Save resume state periodically
            if (sessionId && batchMetadata && receivedSizeRef.current - lastFeedbackRef.current > 5 * 1024 * 1024) {
              saveTransferState({
                sessionId,
                files: batchMetadata.files,
                receivedSize: receivedSizeRef.current,
                lastUpdate: Date.now(),
                status: 'active',
                totalChunks: 0,
                completedChunks: [],
              });
            }
          }
        }
      } catch (e: unknown) {
        console.error('Decryption failed:', e instanceof Error ? e.message : e);
      }
    }
  }, [batchMetadata, updateProgressUi, sessionId, processEncryptedChunk]);

  const { sendData, sendSignaling, dataChannel, channelState, waitForBuffer, sharedKey, isRelayActive, activateRelay, reconnectP2P, signalingState } = useWebRTC({
    sessionId: sessionId || '',
    isSender: files.length > 0,
    onDataChannelMessage: handleRawMessage,
    onMessage: (msg: unknown) => {
      if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'force-relay') {
        return;
      }
      handleRawMessage(JSON.stringify(msg));
    },
    onConnectionStateChange: (state) => {
      onConnectionStateChange(state);
      if (state === 'failed') setShowRelayPrompt(true);
    },
    onStalled: () => setShowRelayPrompt(true),
    onComplete: () => {
      onTransferEnd();
      setStatus('completed');
    }
  });

  const sendSignalingRef = React.useRef(sendSignaling);

  React.useEffect(() => {
    sendDataRef.current = sendData;
    sharedKeyRef.current = sharedKey;
    isRelayActiveRef.current = isRelayActive;
    sendSignalingRef.current = sendSignaling;
  }, [sendData, sharedKey, isRelayActive, sendSignaling]);

  // Drain buffered encrypted chunks once shared key becomes available
  React.useEffect(() => {
    if (sharedKey && pendingEncryptedChunksRef.current.length > 0) {
      const buffered = [...pendingEncryptedChunksRef.current];
      pendingEncryptedChunksRef.current = [];
      console.log(`[CRYPTO] Shared key ready, processing ${buffered.length} buffered chunks`);

      (async () => {
        for (const chunk of buffered) {
          try {
            await processEncryptedChunk(chunk, sharedKey);
          } catch (e) {
            console.error('Failed to process buffered chunk:', e);
          }
        }
        // Update progress after draining
        if (batchMetadata && startTimeRef.current) {
          const totalSize = batchMetadata.files.reduce((acc: number, f: { size: number }) => acc + f.size, 0);
          updateProgressUi(receivedSizeRef.current, totalSize);
        }
      })();
    }
  }, [sharedKey, processEncryptedChunk, batchMetadata, updateProgressUi]);

  const handleCancel = React.useCallback((isInitiator = true) => {
    isCancelledRef.current = true;
    if (isInitiator) {
      if (dataChannel?.readyState === 'open') {
        try { sendData(JSON.stringify({ type: 'cancel' })); } catch { /* ignored */ }
      }
      try { sendSignalingRef.current({ type: 'cancel' }); } catch { /* ignored */ }
    }
    setFiles([]);
    setBatchMetadata(null);
    fileChunksMapRef.current = new Map();
    receivedSizeRef.current = 0;
    setProgress(0);
    startTimeRef.current = null;
    setEta(null);
    setStatus('idle');
    setSessionId(null);
    setError(null);
    setIsTransferStarted(false);
    window.history.pushState({}, '', window.location.pathname);
  }, [dataChannel, sendData]);

  React.useEffect(() => {
    handleCancelRef.current = handleCancel;
  }, [handleCancel]);

  // Sync session from URL on mount
  React.useEffect(() => {
    const checkResumption = async () => {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get('s');
      if (sid) {
        const savedState = await getTransferState(sid);
        if (savedState && savedState.status === 'active') {
          console.log('Resuming session:', sid, 'at', savedState.receivedSize);
          setSessionId(sid);
          setBatchMetadata({ files: savedState.files, sessionId: sid });
          receivedSizeRef.current = savedState.receivedSize;
          setStatus('receiving');
        } else if (files.length === 0 && !sessionId) {
          setSessionId(sid);
          setStatus('receiving');
        }
      }
    };
    checkResumption();
  }, [files.length, sessionId]);

  const handleFileSelect = async (selectedFiles: File[]) => {
    isCancelledRef.current = false;
    setFiles(selectedFiles);

    try {
      const signalingUrl = CONFIG.SIGNALING_URL_HTTP;
      const response = await fetch(`${signalingUrl}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: selectedFiles.map(f => ({ name: f.name, size: f.size }))
        })
      });
      const data = await response.json();
      setSessionId(data.sessionId);
      setStatus('sending');
      window.history.pushState({}, '', `?s=${data.sessionId}`);

      // Background: compute chunk hashes and upload manifest
      (async () => {
        const manifest: Record<number, string> = {};
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          const fileId = await computeFileHash(file);
          const chunks = getFileChunks(file, fileId);
          for await (const chunk of chunks) {
            manifest[chunk.chunk_id] = chunk.hash;
            if (chunk.chunk_id % 10 === 0) {
              await fetch(`/api/manifest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: data.sessionId, manifest })
              });
            }
          }
        }
        await fetch(`/api/manifest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: data.sessionId, manifest })
        });
        console.log('Manifest fully synchronized');
      })().catch((e: Error) => {
        console.error('Background hashing/sync failed:', e);
      });
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to create session:', e.message);
      const sid = Math.random().toString(36).substring(2, 8).toUpperCase();
      setSessionId(sid);
      setStatus('sending');
      window.history.pushState({}, '', `?s=${sid}`);
    }
  };

  const startTransfer = React.useCallback(async () => {
    if (files.length === 0) return;
    await onTransferStart();
    isCancelledRef.current = false;
    startTimeRef.current = Date.now();
    totalSentRef.current = 0;

    // Send batch metadata
    await retrySend(() => sendData(JSON.stringify({
      type: 'batch-metadata',
      files: files.map(f => ({ name: f.name, size: f.size }))
    })));

    const totalBatchSize = files.reduce((acc, f) => acc + f.size, 0);

    for (let i = 0; i < files.length; i++) {
      if (isCancelledRef.current) break;
      const file = files[i];
      setCurrentFileIndex(i);

      await retrySend(() => sendData(JSON.stringify({ type: 'file-start', index: i })));

      const fileId = await computeFileHash(file);
      const chunks = getFileChunks(file, fileId);
      for await (const chunk of chunks) {
        if (isCancelledRef.current) break;
        await waitForBuffer();
        if (isCancelledRef.current) break;

        if (sharedKey) {
          const { encryptedData, iv } = await encryptChunk(chunk.data, sharedKey);

          const totalBuffer = new Uint8Array(4 + iv.length + encryptedData.byteLength);
          const view = new DataView(totalBuffer.buffer);
          view.setUint32(0, chunk.chunk_id);
          totalBuffer.set(iv, 4);
          totalBuffer.set(new Uint8Array(encryptedData), 4 + iv.length);

          const sent = await retrySend(() => sendData(totalBuffer.buffer));
          if (sent) {
            totalSentRef.current += chunk.size;
            updateProgressUi(totalSentRef.current, totalBatchSize);
          }
        }
      }
      await retrySend(() => sendData(JSON.stringify({ type: 'file-end', index: i })));
    }

    if (!isCancelledRef.current && totalSentRef.current >= totalBatchSize) {
      setStatus('completed');
      setEta(null);
      setProgress(100);
      onTransferEnd();
      sendData(JSON.stringify({ type: 'transfer-complete' }));
    }
  }, [files, sendData, waitForBuffer, updateProgressUi, sharedKey, onTransferStart, onTransferEnd]);

  React.useEffect(() => {
    if (status === 'sending' && files.length > 0 && channelState === 'open' && isTransferStarted) {
      startTransfer();
    }
  }, [status, files, channelState, startTransfer, isTransferStarted]);

  // Download files (multi-file aware)
  const downloadAll = React.useCallback(() => {
    if (!batchMetadata) return;

    if (fileChunksMapRef.current.size === 0) return;

    // Download each file separately
    for (let i = 0; i < batchMetadata.files.length; i++) {
      const chunks = fileChunksMapRef.current.get(i);
      if (!chunks || chunks.length === 0) continue;

      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = batchMetadata.files[i].name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [batchMetadata]);

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.length === 6) {
      setSessionId(joinCode.toUpperCase());
      setStatus('receiving');
      window.history.pushState({}, '', `?s=${joinCode.toUpperCase()}`);
    }
  };

  // Prevent default drop globally
  React.useEffect(() => {
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
              receivedBytes={receivedSizeRef.current}
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
                startTime={startTimeRef.current}
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
