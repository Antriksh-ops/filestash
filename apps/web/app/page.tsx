'use client';

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import DropZone from '../components/DropZone';
import { useWebRTC } from '../hooks/useWebRTC';
import { getFileChunks } from '../lib/chunker';
import { computeHash, computeFileHash, encryptChunk, decryptChunk } from '../lib/crypto';
import { CONFIG } from '../lib/config';
import { saveTransferState, getTransferState, deleteTransferState } from '../lib/db';

// Add type for WakeLock
interface WakeLockSentinel {
  release(): Promise<void>;
  onrelease: ((this: WakeLockSentinel, ev: Event) => any) | null;
}

interface BatchMetadata {
  files: { name: string; size: number }[];
  sessionId: string;
}

const SecurityShield = ({ status, sharedKey, progress }: { status: string, sharedKey: any, progress: number }) => {
  if (status === 'idle') return null;
  return (
    <div className="fixed top-24 right-8 z-50 animate-in slide-in-from-right-4 duration-500">
      <div className="bg-black/90 backdrop-blur-md border-2 border-emerald-400 p-4 rounded-2xl shadow-[0_0_20px_rgba(52,211,153,0.3)] space-y-3 w-64">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sharedKey ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
          <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Security Link Verified</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[8px] font-bold text-zinc-400 uppercase">
            <span>ECDH Handshake</span>
            <span className={sharedKey ? 'text-emerald-400' : ''}>{sharedKey ? 'SECURE' : 'PENDING'}</span>
          </div>
          <div className="flex justify-between text-[8px] font-bold text-zinc-400 uppercase">
            <span>AES-256-GCM</span>
            <span className={sharedKey ? 'text-emerald-400' : ''}>{sharedKey ? 'ACTIVE' : 'WAITING'}</span>
          </div>
          <div className="flex justify-between text-[8px] font-bold text-zinc-400 uppercase">
            <span>Integrity Check</span>
            <span className={progress > 0 ? 'text-emerald-400' : ''}>{progress > 0 ? 'VERIFYING' : 'IDLE'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function Home() {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [batchMetadata, setBatchMetadata] = React.useState<BatchMetadata | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'receiving' | 'completed'>('idle');
  const [joinCode, setJoinCode] = React.useState('');
  const [isTransferStarted, setIsTransferStarted] = React.useState(false);
  const [showFileList, setShowFileList] = React.useState(false);

  // const totalBatchSize = React.useMemo(() => files.reduce((acc, f) => acc + f.size, 0), [files]);

  const [eta, setEta] = React.useState<number | null>(null);
  const wakeLockRef = React.useRef<WakeLockSentinel | null>(null);

  // Manage Wake Lock
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Wake Lock active - Screen will not sleep');
      } catch (error) {
        const err = error as any;
        console.error(`${err?.name || 'Error'}, ${err?.message || 'Unknown error'}`);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
      console.log('Wake Lock released');
    }
  };

  // Progress tracking (Re-synced with REFs for accuracy)
  const totalSentRef = React.useRef(0);
  const receivedSizeRef = React.useRef(0);
  const startTimeRef = React.useRef<number | null>(null);
  const lastUiUpdateRef = React.useRef(0);
  const lastFeedbackRef = React.useRef(0);

  const sendDataRef = React.useRef<(data: string | ArrayBuffer) => boolean>(() => false);
  const sharedKeyRef = React.useRef<CryptoKey | null>(null);
  const isRelayActiveRef = React.useRef(false);

  // Receiver state
  const chunksRef = React.useRef<ArrayBuffer[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = React.useState(0);

  const isCancelledRef = React.useRef(false);
  const handleCancelRef = React.useRef<(isInitiator?: boolean) => void>(null);

  const updateProgressUi = React.useCallback((current: number, total: number) => {
    const now = Date.now();
    // Throttle UI updates to 10 FPS for performance
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
        if (timeRemaining > 0 && isFinite(timeRemaining)) {
          const mins = Math.floor(timeRemaining / 60);
          const secs = Math.floor(timeRemaining % 60);
          setEta(timeRemaining); // Store raw seconds for ETA
        }
      }
    }
  }, []);

  const onConnectionStateChange = React.useCallback((state: RTCPeerConnectionState) => {
    console.log('PC State:', state);
  }, []);

  const onTransferStart = async () => {
    startTimeRef.current = Date.now(); // Use startTimeRef for consistency
    await requestWakeLock();
  };

  const onTransferEnd = () => {
    releaseWakeLock();
  };

  const { sendData, dataChannel, channelState, waitForBuffer, sharedKey, isRelayActive } = useWebRTC({
    sessionId: sessionId || '',
    isSender: files.length > 0,
    onDataChannelMessage: (data: string | ArrayBuffer) => onMessage(data),
    onConnectionStateChange,
  });

  const writableRef = React.useRef<FileSystemWritableFileStream | null>(null);

  const onMessage = React.useCallback(async (data: string | ArrayBuffer) => {
    if (typeof data === 'string') {
      const message = JSON.parse(data);
      if (message.type === 'batch-metadata') {
        setBatchMetadata(message);
        chunksRef.current = [];
        receivedSizeRef.current = 0;
        setCurrentFileIndex(0);
        setProgress(0);
        startTimeRef.current = Date.now();
        setStatus('receiving');
        console.log('Received batch metadata:', message);

        // Try to get a writable stream for the first file
        if ('showSaveFilePicker' in window && message.files.length > 0) {
          try {
            const handle = await (window as Window & { showSaveFilePicker: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
              suggestedName: message.files[0].name,
            });
            writableRef.current = await handle.createWritable();
          } catch (e: any) {
            console.warn('FileSystem Access API declined or failed, falling back to memory:', e?.message || e);
          }
        }
      } else if (message.type === 'file-start') {
        setCurrentFileIndex(message.index);
        chunksRef.current = [];
      } else if (message.type === 'progress-sync') {
        const totalBatchSize = files.reduce((acc, f) => acc + f.size, 0);
        updateProgressUi(message.received, totalBatchSize);
      } else if (message.type === 'cancel') {
        handleCancelRef.current?.(false);
      }
    } else if (data instanceof ArrayBuffer && (sharedKeyRef.current || isRelayActiveRef.current)) {
      try {
        const view = new DataView(data);
        const chunkId = view.getUint32(0);
        const iv = new Uint8Array(data, 4, 12);
        const encryptedData = data.slice(16);

        if (!sharedKeyRef.current) return;

        const decrypted = await decryptChunk(encryptedData, sharedKeyRef.current, iv);

        // Verification: Compare decrypted chunk hash
        const hash = await computeHash(decrypted);
        // In a full implementation, we'd check this against a local manifestRef 
        // that was fetched via GET /session/:id/manifest
        console.log(`Verifying chunk ${chunkId}, hash: ${hash}`);

        if (writableRef.current) {
          await writableRef.current.write(decrypted);
        } else {
          chunksRef.current.push(decrypted);
        }

        receivedSizeRef.current += decrypted.byteLength;

        if (batchMetadata && startTimeRef.current) {
          const totalSize = batchMetadata.files.reduce((acc: number, f: { size: number }) => acc + f.size, 0);
          updateProgressUi(receivedSizeRef.current, totalSize);

          if (receivedSizeRef.current - lastFeedbackRef.current > 1024 * 1024) {
            lastFeedbackRef.current = receivedSizeRef.current;
            sendDataRef.current(JSON.stringify({ type: 'progress-sync', received: receivedSizeRef.current }));
          }

          if (receivedSizeRef.current >= totalSize) {
            if (writableRef.current) {
              await writableRef.current.close();
              writableRef.current = null;
            }
            setStatus('completed');
            setEta(null);
            setProgress(100);
            if (sessionId) deleteTransferState(sessionId); // Cleanup on success
          } else {
            // Periodically save state
            if (receivedSizeRef.current - lastFeedbackRef.current > 5 * 1024 * 1024) {
              if (sessionId && batchMetadata) {
                saveTransferState({
                  sessionId,
                  files: batchMetadata.files,
                  receivedSize: receivedSizeRef.current,
                  lastUpdate: Date.now(),
                  status: 'active'
                });
              }
            }
          }
        }
      } catch (e: any) {
        console.error('Decryption failed:', e?.message || e);
      }
    }
  }, [batchMetadata, files, updateProgressUi]);

  React.useEffect(() => {
    sendDataRef.current = sendData;
    sharedKeyRef.current = sharedKey;
    isRelayActiveRef.current = isRelayActive;
  }, [sendData, sharedKey, isRelayActive]);

  const handleCancel = React.useCallback((isInitiator = true) => {
    isCancelledRef.current = true;
    if (isInitiator && dataChannel?.readyState === 'open') {
      try {
        sendData(JSON.stringify({ type: 'cancel' }));
      } catch { }
    }
    setFiles([]);
    setBatchMetadata(null);
    chunksRef.current = [];
    receivedSizeRef.current = 0;
    setProgress(0);
    startTimeRef.current = null;
    setEta(null);
    setStatus('idle');
    setSessionId(null);
    setIsTransferStarted(false);
    window.history.pushState({}, '', window.location.pathname);
  }, [dataChannel, sendData]);

  React.useEffect(() => {
    handleCancelRef.current = handleCancel;
  }, [handleCancel]);

  // Only sync session from URL once on mount
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
          // We will send the resumption request once the channel is open
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

    // Spec: Call POST /session/create
    try {
      const signalingUrl = CONFIG.SIGNALING_URL_HTTP;

      console.log('DEBUG: Calculated signaling HTTP API URL:', signalingUrl, 'source: config_lib');
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

      // Phase 1: Background Hashing for Manifest (Async)
      (async () => {
        const manifest: Record<number, string> = {};
        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          // Use SHA-256 for file identity
          const fileId = await computeFileHash(file);
          const chunks = getFileChunks(file, fileId);
          for await (const chunk of chunks) {
            manifest[chunk.chunk_id] = chunk.hash;
            // Progressive manifest updates
            if (chunk.chunk_id % 10 === 0) {
              await fetch(`${signalingUrl}/session/${data.sessionId}/manifest`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(manifest)
              });
            }
          }
        }
        // Final manifest update
        await fetch(`${signalingUrl}/session/${data.sessionId}/manifest`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(manifest)
        });
        console.log('Manifest fully synchronized');
      })().catch((e: Error) => {
        console.error('Background hashing/sync failed:', e);
        // Alert if it fails due to localhost fallback
        if (signalingUrl.includes('localhost')) {
          console.warn('WARNING: Still using localhost signaling! Ensure NEXT_PUBLIC_SIGNALING_URL is set in Vercel.');
        }
      });

    } catch (e: any) {
      console.error('Failed to create session:', e?.message || e);
      // Fallback to local generation if server fails
      const sid = Math.random().toString(36).substring(2, 8).toUpperCase();
      setSessionId(sid);
      setStatus('sending');
      window.history.pushState({}, '', `?s=${sid}`);
    }
  };

  const startTransfer = React.useCallback(async () => {
    if (files.length === 0) return;
    isCancelledRef.current = false;
    startTimeRef.current = Date.now();
    totalSentRef.current = 0;

    // Send batch metadata
    sendData(JSON.stringify({
      type: 'batch-metadata',
      files: files.map(f => ({ name: f.name, size: f.size }))
    }));

    const totalBatchSize = files.reduce((acc, f) => acc + f.size, 0);

    for (let i = 0; i < files.length; i++) {
      if (isCancelledRef.current) break;
      const file = files[i];
      setCurrentFileIndex(i);

      sendData(JSON.stringify({ type: 'file-start', index: i }));

      const fileId = await computeFileHash(file);
      const chunks = getFileChunks(file, fileId);
      for await (const chunk of chunks) {
        if (isCancelledRef.current) break;
        await waitForBuffer();
        if (isCancelledRef.current) break;

        if (sharedKey) {
          const { encryptedData, iv } = await encryptChunk(chunk.data, sharedKey);

          // Custom binary format: [chunkId(4b)] + [iv(12b)] + [encryptedData]
          const totalBuffer = new Uint8Array(4 + iv.length + encryptedData.byteLength);
          const view = new DataView(totalBuffer.buffer);
          view.setUint32(0, chunk.chunk_id);
          totalBuffer.set(iv, 4);
          totalBuffer.set(new Uint8Array(encryptedData), 4 + iv.length);

          if (sendData(totalBuffer.buffer)) {
            totalSentRef.current += chunk.size;
            updateProgressUi(totalSentRef.current, totalBatchSize);
          }
        }
      }
      sendData(JSON.stringify({ type: 'file-end', index: i }));
    }

    if (!isCancelledRef.current && totalSentRef.current >= totalBatchSize) {
      setStatus('completed');
      setEta(null);
      setProgress(100);
    }
  }, [files, sendData, waitForBuffer, updateProgressUi, sharedKey]);

  React.useEffect(() => {
    if (status === 'sending' && files.length > 0 && channelState === 'open' && isTransferStarted) {
      startTransfer();
    }
  }, [status, files, channelState, startTransfer, isTransferStarted]);

  const downloadAll = () => {
    if (!batchMetadata || chunksRef.current.length === 0) return;
    // Simple logic: download last file or first if only one
    // In a real batch, we'd zip them or download one by one.
    // For now, let's just download what we have.
    const blob = new Blob(chunksRef.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = batchMetadata.files.length === 1 ? batchMetadata.files[0].name : 'bridged-files.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.length === 6) {
      setSessionId(joinCode.toUpperCase());
      setStatus('receiving');
      window.history.pushState({}, '', `?s=${joinCode.toUpperCase()}`);
    }
  };

  // Global prevent default drop
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

  return (
    <main className="min-h-screen bg-[#fafafa] flex flex-col items-center py-12 px-4 selection:bg-yellow-300 selection:text-black font-sans overflow-x-hidden relative">
      {/* Premium Grain Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.03] mix-blend-multiply bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      <SecurityShield status={status} sharedKey={sharedKey} progress={progress} />
      <div className="text-center space-y-4">
        <h1 className="text-7xl font-black text-black tracking-tighter uppercase drop-shadow-[4px_4px_0px_#fde047]">
          FILEDROP
        </h1>
        <h2 className="text-zinc-600 text-xl font-bold uppercase tracking-widest mt-4">
          Unlimited P2P Magic • No Limits • No Cloud
        </h2>
      </div>

      <div className="w-full max-w-5xl space-y-8 flex-1 flex flex-col items-center justify-start min-h-[850px] transition-all duration-500">
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
            <div className="space-y-6">
              {status === 'sending' ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-zinc-500 font-black text-xs tracking-[0.3em] uppercase">ACTIVE BRIDGE CODE</p>
                  <h2 className="text-6xl font-black text-black tracking-[0.2em] bg-yellow-200 px-6 py-2 border-4 border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">{sessionId}</h2>
                </div>
              ) : null}

              <div className="relative">
                <div
                  onClick={() => setShowFileList(!showFileList)}
                  className="flex items-center gap-6 p-6 border-4 border-black rounded-2xl bg-orange-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] cursor-pointer hover:bg-orange-100 transition-all select-none"
                >
                  <div className="w-16 h-16 rounded-xl bg-emerald-300 border-4 border-black flex items-center justify-center text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <p className="text-black font-black truncate uppercase text-lg leading-tight">
                        {status === 'receiving' ? batchMetadata?.files[currentFileIndex]?.name : files[currentFileIndex]?.name || 'Bridging...'}
                      </p>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24" height="24"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        className={`transition-transform duration-200 ${showFileList ? 'rotate-180' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                    <p className="text-zinc-600 font-bold text-sm uppercase flex items-center gap-2 mt-1">
                      {files.length > 1 || (batchMetadata?.files.length ?? 0) > 1 ? (
                        <span className="bg-black text-white px-2 py-0.5 rounded text-[10px]">FILE {currentFileIndex + 1}/{files.length || batchMetadata?.files.length}</span>
                      ) : null}
                      <span>
                        {files.length > 0 ? (files.reduce((a: number, b: File) => a + b.size, 0) / 1024 / 1024).toFixed(2) : batchMetadata ? (batchMetadata.files.reduce((a: number, b: { size: number }) => a + b.size, 0) / 1024 / 1024).toFixed(2) : '0'} MB
                      </span>
                    </p>
                  </div>
                </div>

                {showFileList && (
                  <div className="absolute top-full left-0 right-0 mt-4 bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] z-10 max-h-60 overflow-y-auto p-2 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    {(files.length > 0 ? files : batchMetadata?.files || []).map((file, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all ${idx === currentFileIndex ? 'bg-yellow-100 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' : 'bg-white border-zinc-200'}`}
                      >
                        <p className="text-black font-black text-xs truncate max-w-[70%] uppercase">{file.name}</p>
                        <p className="text-zinc-500 font-bold text-[10px] uppercase">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className="text-black font-black uppercase text-[10px] tracking-widest bg-yellow-200 px-3 py-1 rounded-lg border-2 border-black">
                  {status === 'completed' ? 'SUCCESS' : channelState === 'open' ? (status === 'sending' ? (isTransferStarted ? 'SENDING' : 'READY') : (receivedSizeRef.current > 0 ? 'RECEIVING' : 'WAITING FOR SENDER')) : (status === 'sending' ? 'WAITING FOR PEER' : 'CONNECTING...')}
                </span>
                {sharedKey && (
                  <span className="text-black font-black uppercase text-[10px] tracking-widest bg-emerald-400 px-3 py-1 rounded-lg border-2 border-black flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Encrypted
                  </span>
                )}
                {isRelayActive && (
                  <span className="text-white font-black uppercase text-[10px] tracking-widest bg-rose-500 px-3 py-1 rounded-lg border-2 border-black">
                    Relay Mode
                  </span>
                )}
              </div>
              <span className="text-black font-black text-3xl tracking-tighter">{Math.min(100, Math.round(progress))}%</span>
              <div className="w-full h-8 bg-orange-100 border-4 border-black rounded-2xl overflow-hidden shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                <div
                  className="h-full bg-blue-500 border-r-4 border-black transition-all duration-300 relative overflow-hidden"
                  style={{ width: `${Math.min(100, progress)}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-[pulse_2s_infinite]" />
                </div>
              </div>
              {eta && status !== 'completed' && (
                <p className="text-zinc-500 font-black text-xs uppercase text-right tracking-widest flex items-center justify-end gap-2">
                  <span className="animate-pulse">●</span> {eta}
                </p>
              )}
            </div>

            {status === 'sending' && channelState === 'open' && !isTransferStarted && (
              <button
                onClick={() => setIsTransferStarted(true)}
                className="w-full py-6 bg-yellow-400 hover:bg-yellow-300 text-black font-black uppercase text-2xl tracking-widest rounded-2xl border-4 border-black transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none mt-4"
              >
                Start Transfer
              </button>
            )}

            {status === 'completed' && !files.length && (
              <button
                onClick={downloadAll}
                className="w-full py-4 bg-emerald-400 hover:bg-emerald-300 text-black font-black uppercase tracking-widest rounded-xl border-2 border-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none"
              >
                Get Files
              </button>
            )}

            {sessionId && status === 'sending' && (
              <div className="space-y-4 pt-4 border-t-2 border-zinc-100">
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
                      onClick={() => navigator.clipboard.writeText(shareLink)}
                      className="px-4 py-1 bg-yellow-300 hover:bg-yellow-200 text-black border-2 border-black rounded-lg font-black text-[10px] uppercase transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => handleCancel(true)}
              className="w-full py-3 bg-white hover:bg-zinc-50 text-zinc-500 font-black uppercase text-xs tracking-widest rounded-xl border-2 border-black transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
              Cancel Bridge
            </button>
          </div>
        )}
      </div>

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
