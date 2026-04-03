import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebRTC } from './useWebRTC';
import { getFileChunks } from '../lib/chunker';
import { CONFIG } from '../lib/config';
import { saveTransferState, getTransferState, deleteTransferState, markChunkCompleted, flushPendingSave, type TransferState } from '../lib/db';
import { registerStreamSW, needsStreamFallback, isStreamReady, createStreamDownload } from '../lib/streamSaver';
import * as fflate from 'fflate';

interface BatchMetadata {
  files: { name: string; size: number }[];
  sessionId: string;
}

interface WakeLockSentinel {
  release(): Promise<void>;
  onrelease: ((this: WakeLockSentinel, ev: Event) => void) | null;
}

interface StreamWriter {
  write(chunk: ArrayBuffer): void;
  close(): void;
  abort(): void;
}

async function retrySend(sendFn: () => boolean, maxRetries = 3, baseDelay = 100): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (sendFn()) return true;
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  console.error('[SEND] Failed after retries');
  return false;
}

export function useTransferSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [batchMetadata, setBatchMetadata] = useState<BatchMetadata | null>(null);
  const batchMetadataRef = useRef<BatchMetadata | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'sending' | 'receiving' | 'completed'>('idle');
  const [joinCode, setJoinCode] = useState('');
  const [isTransferStarted, setIsTransferStarted] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [showRelayPrompt, setShowRelayPrompt] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const totalSentRef = useRef(0);
  const receivedSizeRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  // Progress refs — transfer loop writes here (zero cost), timer reads to update React state
  const progressRef = useRef(0);
  const etaRef = useRef<string | null>(null);
  const totalSizeRef = useRef(0);

  const sendDataRef = useRef<(data: string | ArrayBuffer) => boolean>(() => false);
  const isTransferringRef = useRef(false);
  const isPausedRef = useRef(false);
  const waitForBufferRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const fileChunksMapRef = useRef<Map<number, ArrayBuffer[]>>(new Map());
  const writableRef = useRef<FileSystemWritableFileStream | null>(null);
  const isCancelledRef = useRef(false);
  const handleCancelRef = useRef<(isInitiator?: boolean) => void>(null);

  // --- Mobile stream download refs ---
  const streamWriterRef = useRef<StreamWriter | null>(null);

  // --- Chunk-level resume refs ---
  const completedChunksRef = useRef<boolean[]>([]);
  const transferStateRef = useRef<TransferState | null>(null);
  const peerCompletedChunksRef = useRef<Set<number>>(new Set());

  // Register Service Worker on mount
  useEffect(() => {
    if (needsStreamFallback()) {
      registerStreamSW().then((ok) => {
        if (ok) console.log('[Mobile] Stream download SW ready');
      });
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (error) {
        console.error('Wake Lock error:', error);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // Write progress to refs only — NO React state updates here
  const updateProgressRef = useCallback((current: number, total: number) => {
    totalSizeRef.current = total;
    progressRef.current = total > 0 ? (current / total) * 100 : 0;

    if (startTimeRef.current) {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (elapsed > 0) {
        const speed = current / elapsed;
        const remaining = total - current;
        const timeRemaining = remaining / speed;

        if (timeRemaining >= 0 && isFinite(timeRemaining)) {
          const mins = Math.floor(timeRemaining / 60);
          const secs = Math.floor(timeRemaining % 60);
          const speedMB = (speed / (1024 * 1024)).toFixed(2);
          etaRef.current = `${mins > 0 ? `${mins}m ` : ''}${secs}s • ${speedMB} MB/s`;
        }
      }
    }
  }, []);

  // Separate timer reads refs and batches a single React state update every 500ms
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(progressRef.current);
      setEta(etaRef.current);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const processChunk = useCallback(async (data: ArrayBuffer) => {
    const view = new DataView(data);
    const chunkId = view.getUint32(0);
    const rawData = data.slice(4);
    const chunkSize = rawData.byteLength; // Cache size before transfer

    // --- Write to the best available target ---
    if (writableRef.current) {
      // Desktop: FileSystem Access API
      await writableRef.current.write(rawData);
    } else if (streamWriterRef.current) {
      // Mobile: Service Worker stream proxy — zero RAM accumulation
      streamWriterRef.current.write(rawData); // rawData is detached here!
    } else {
      // Fallback: in-memory accumulation (last resort)
      const currentIdx = currentFileIndex;
      if (!fileChunksMapRef.current.has(currentIdx)) {
        fileChunksMapRef.current.set(currentIdx, []);
      }
      fileChunksMapRef.current.get(currentIdx)!.push(rawData);
    }

    // --- Mark chunk as completed for resume ---
    completedChunksRef.current[chunkId] = true;
    if (transferStateRef.current) {
      markChunkCompleted(
        transferStateRef.current.sessionId,
        chunkId,
        transferStateRef.current
      );
    }

    receivedSizeRef.current += chunkSize;
    return chunkSize;
  }, [currentFileIndex]);

  const handleRawMessage = useCallback(async (data: string | ArrayBuffer) => {
    if (typeof data === 'string') {
      let message;
      try {
        message = JSON.parse(data);
      } catch { return; }

      if (message.type === 'batch-metadata') {
        setBatchMetadata(message);
        batchMetadataRef.current = message;
        fileChunksMapRef.current = new Map();
        receivedSizeRef.current = 0;
        completedChunksRef.current = [];
        setCurrentFileIndex(0);
        setProgress(0);
        startTimeRef.current = Date.now();
        setStatus('receiving');

        // Initialize transfer state for resume tracking
        const totalSize = message.files.reduce((a: number, f: { size: number }) => a + f.size, 0);
        // Estimate total chunks (we'll refine as we receive)
        const estChunks = Math.ceil(totalSize / (256 * 1024)); // conservative estimate
        transferStateRef.current = {
          sessionId: sessionId || '',
          files: message.files,
          receivedSize: 0,
          lastUpdate: Date.now(),
          status: 'active',
          totalChunks: estChunks,
          completedChunks: [],
        };

        // Try FileSystem Access API first (desktop)
        let gotWritable = false;
        if ('showSaveFilePicker' in window && message.files.length > 0) {
          try {
            const handle = await (window as any).showSaveFilePicker({ suggestedName: message.files[0].name });
            writableRef.current = await handle.createWritable();
            gotWritable = true;
          } catch {
            console.warn('FileSystem Access API declined');
          }
        }

        // Fallback: try Service Worker stream (mobile)
        if (!gotWritable && needsStreamFallback() && isStreamReady() && message.files.length === 1) {
          const writer = createStreamDownload(message.files[0].name, message.files[0].size);
          if (writer) {
            streamWriterRef.current = writer;
            gotWritable = true;
            console.log('[Mobile] Streaming download via SW for:', message.files[0].name);
          }
        }


      } else if (message.type === 'file-start') {
        setCurrentFileIndex(message.index);
        if (writableRef.current && message.index > 0) {
          await writableRef.current.close();
          writableRef.current = null;
          if ('showSaveFilePicker' in window) {
            const meta = batchMetadataRef.current?.files[message.index];
            if (meta) {
              try {
                const handle = await (window as any).showSaveFilePicker({ suggestedName: meta.name });
                writableRef.current = await handle.createWritable();
              } catch { }
            }
          }
        }
        // For SW streaming with multi-file: close old writer and start new one
        if (streamWriterRef.current && message.index > 0) {
          streamWriterRef.current.close();
          streamWriterRef.current = null;
          const meta = batchMetadataRef.current?.files[message.index];
          if (meta && isStreamReady()) {
            const writer = createStreamDownload(meta.name, meta.size);
            if (writer) {
              streamWriterRef.current = writer;
            }
          }
        }
      } else if (message.type === 'cancel') {
        // Clean up stream writer on cancel
        if (streamWriterRef.current) {
          streamWriterRef.current.abort();
          streamWriterRef.current = null;
        }
        handleCancelRef.current?.(false);
      } else if (message.type === 'error') {
        setError(message.message || 'Error occurred');
        setStatus('idle');
      } else if (message.type === 'resume-state') {
        // SENDER receives this: peer tells us which chunks they already have
        console.log(`[RESUME] Peer has ${message.completedChunks?.length || 0} completed chunks`);
        peerCompletedChunksRef.current = new Set(message.completedChunks || []);
      }
    } else if (data instanceof ArrayBuffer) {
      try {
        await processChunk(data);

        const meta = batchMetadataRef.current;
        if (meta && startTimeRef.current) {
          const totalSize = meta.files.reduce((acc: number, f: any) => acc + f.size, 0);
          updateProgressRef(receivedSizeRef.current, totalSize);

          // removed backwards progress sync
          if (receivedSizeRef.current >= totalSize) {
            setStatus('completed');
            progressRef.current = 100;
            etaRef.current = null;
            setEta(null);
            setProgress(100);
            if (writableRef.current) {
              await writableRef.current.close();
              writableRef.current = null;
            }
            if (streamWriterRef.current) {
              streamWriterRef.current.close();
              streamWriterRef.current = null;
            }
            await flushPendingSave();
            if (sessionId) deleteTransferState(sessionId);
          } else {
            // Update transfer state for resume (debounced inside markChunkCompleted)
            if (transferStateRef.current) {
              transferStateRef.current.receivedSize = receivedSizeRef.current;
            }
          }
        }
      } catch (e) {
        console.error('Decryption failed', e);
      }
    }
  }, [updateProgressRef, sessionId, processChunk]);

  const { sendData, sendSignaling, dataChannel, channelState, waitForBuffer, isRelayActive, activateRelay, reconnectP2P, signalingState } = useWebRTC({
    sessionId: sessionId || '',
    isSender: files.length > 0,
    onDataChannelMessage: handleRawMessage,
    onMessage: (msg: any) => {
      if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'force-relay') return;
      handleRawMessage(JSON.stringify(msg));
    },
    onConnectionStateChange: (state) => {
      if (state === 'failed') setShowRelayPrompt(true);
    },
    onStalled: () => setShowRelayPrompt(true),
    onComplete: () => {
      releaseWakeLock();
      setStatus('completed');
    }
  });

  const sendSignalingRef = useRef(sendSignaling);

  useEffect(() => {
    sendDataRef.current = sendData;
    sendSignalingRef.current = sendSignaling;
    waitForBufferRef.current = waitForBuffer;
  }, [sendData, sendSignaling, waitForBuffer]);



  const handleCancel = useCallback((isInitiator = true) => {
    isCancelledRef.current = true;
    isTransferringRef.current = false;
    if (isInitiator) {
      if (dataChannel?.readyState === 'open') {
        try { sendData(JSON.stringify({ type: 'cancel' })); } catch { }
      }
      try { sendSignalingRef.current({ type: 'cancel' }); } catch { }
    }
    // Clean up stream writer
    if (streamWriterRef.current) {
      streamWriterRef.current.abort();
      streamWriterRef.current = null;
    }
    setFiles([]);
    setBatchMetadata(null);
    batchMetadataRef.current = null;
    fileChunksMapRef.current = new Map();
    completedChunksRef.current = [];
    transferStateRef.current = null;
    peerCompletedChunksRef.current = new Set();
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

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      isPausedRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    handleCancelRef.current = handleCancel;
  }, [handleCancel]);

  // --- Resume: check for saved state on mount ---
  useEffect(() => {
    const checkResumption = async () => {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get('s');
      if (sid) {
        const savedState = await getTransferState(sid);
        if (savedState && savedState.status === 'active' && savedState.completedChunks?.length > 0) {
          console.log(`[RESUME] Found saved state for ${sid}: ${savedState.completedChunks.filter(Boolean).length} chunks completed`);
          setSessionId(sid);
          setBatchMetadata({ files: savedState.files, sessionId: sid });
          batchMetadataRef.current = { files: savedState.files, sessionId: sid };
          receivedSizeRef.current = savedState.receivedSize;
          completedChunksRef.current = savedState.completedChunks;
          transferStateRef.current = savedState;
          setStatus('receiving');
        } else if (files.length === 0 && !sessionId) {
          setSessionId(sid);
          setStatus('receiving');
        }
      }
    };
    checkResumption();
  }, [files.length, sessionId]);

  // --- Resume: send our completed chunks to sender when channel opens ---
  useEffect(() => {
    if (channelState === 'open' && status === 'receiving' && completedChunksRef.current.length > 0) {
      // Build list of completed chunk IDs to send to sender
      const completedIds: number[] = [];
      completedChunksRef.current.forEach((val, idx) => {
        if (val) completedIds.push(idx);
      });

      if (completedIds.length > 0) {
        console.log(`[RESUME] Sending resume-state with ${completedIds.length} completed chunks`);
        sendDataRef.current(JSON.stringify({
          type: 'resume-state',
          completedChunks: completedIds,
          receivedSize: receivedSizeRef.current,
        }));
      }
    }
  }, [channelState, status]);

  const handleFileSelect = async (selectedFiles: File[]) => {
    isCancelledRef.current = false;
    setFiles(selectedFiles);

    try {
      const response = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: selectedFiles.map(f => ({ name: f.name, size: f.size })) })
      });
      const data = await response.json();
      setSessionId(data.sessionId);
      setStatus('sending');
      window.history.pushState({}, '', `?s=${data.sessionId}`);

      // Register with nearby discovery (fire-and-forget)
      fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: data.sessionId }),
      }).catch(() => { /* nearby is optional */ });

      // Handle redirect for the /nearby pairing flow
      const params = new URLSearchParams(window.location.search);
      const sendTo = params.get('sendTo');
      if (sendTo) {
        try {
          const ws = new WebSocket(`${CONFIG.SIGNALING_URL}?sessionId=${sendTo}&role=sender`);
          ws.onopen = () => {
             ws.send(JSON.stringify({ type: 'redirect', newSessionId: data.sessionId }));
             setTimeout(() => ws.close(), 1000);
          };
        } catch (e) {
          console.warn('Failed to redirect nearby target', e);
        }
      }

      // No manifest construction needed for native DTLS flow
    } catch {
      const sid = Math.random().toString(36).substring(2, 8).toUpperCase();
      setSessionId(sid);
      setStatus('sending');
      window.history.pushState({}, '', `?s=${sid}`);
    }
  };

  const startTransfer = useCallback(async (filesToSend: File[]) => {
    // Concurrency guard — prevent multiple parallel transfer loops
    if (isTransferringRef.current) {
      console.warn('[TRANSFER] Already transferring, ignoring duplicate call');
      return;
    }
    if (filesToSend.length === 0) return;

    isTransferringRef.current = true;
    await requestWakeLock();
    isCancelledRef.current = false;
    startTimeRef.current = Date.now();
    totalSentRef.current = 0;

    try {
      const send = (data: string | ArrayBuffer) => sendDataRef.current(data);

      // Control messages use retrySend (rare, small)
      await retrySend(() => send(JSON.stringify({ type: 'batch-metadata', files: filesToSend.map(f => ({ name: f.name, size: f.size })) })));
      const totalBatchSize = filesToSend.reduce((acc, f) => acc + f.size, 0);

      const skipChunks = peerCompletedChunksRef.current;
      if (skipChunks.size > 0) {
        console.log(`[RESUME] Skipping ${skipChunks.size} chunks already received by peer`);
      }

      for (let i = 0; i < filesToSend.length; i++) {
        if (isCancelledRef.current) break;
        setCurrentFileIndex(i);
        await retrySend(() => send(JSON.stringify({ type: 'file-start', index: i })));

        // Fast file ID — no need to hash the file content
        const fileId = `${filesToSend[i].name}-${filesToSend[i].size}-${filesToSend[i].lastModified}`;
        const chunks = getFileChunks(filesToSend[i], fileId);
        for await (const chunk of chunks) {
          if (isCancelledRef.current) break;

          while (isPausedRef.current && !isCancelledRef.current) {
            await new Promise(r => setTimeout(r, 100));
          }
          if (isCancelledRef.current) break;

          if (skipChunks.has(chunk.chunk_id)) {
            totalSentRef.current += chunk.size;
            updateProgressRef(totalSentRef.current, totalBatchSize);
            continue;
          }

          // Backpressure: only wait when buffer is actually full
          await waitForBufferRef.current();
          if (isCancelledRef.current) break;

          // Build chunk packet: [4-byte chunkId][raw data]
          const totalBuffer = new Uint8Array(4 + chunk.data.byteLength);
          new DataView(totalBuffer.buffer).setUint32(0, chunk.chunk_id);
          totalBuffer.set(new Uint8Array(chunk.data), 4);

          // DIRECT send — no retrySend wrapper. If the channel is open, send() always succeeds.
          // Backpressure is handled by waitForBuffer above.
          send(totalBuffer.buffer);
          totalSentRef.current += chunk.size;
          updateProgressRef(totalSentRef.current, totalBatchSize);
        }
        await retrySend(() => send(JSON.stringify({ type: 'file-end', index: i })));
      }

      if (!isCancelledRef.current && totalSentRef.current >= totalBatchSize) {
        setStatus('completed');
        progressRef.current = 100;
        etaRef.current = null;
        setEta(null);
        setProgress(100);
        releaseWakeLock();
        send(JSON.stringify({ type: 'transfer-complete' }));
      }
    } finally {
      isTransferringRef.current = false;
    }
  }, [updateProgressRef, requestWakeLock, releaseWakeLock]);

  // Trigger transfer — uses a ref for files to keep deps stable
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  useEffect(() => {
    if (status === 'sending' && files.length > 0 && channelState === 'open' && isTransferStarted && !isTransferringRef.current) {
      startTransfer(filesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, channelState, isTransferStarted]);

  const downloadAll = useCallback(() => {
    if (!batchMetadata) return;
    if (fileChunksMapRef.current.size === 0) return;

    if (batchMetadata.files.length === 1) {
      const chunks = fileChunksMapRef.current.get(0);
      if (!chunks || chunks.length === 0) return;
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = batchMetadata.files[0].name;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const zipData: Record<string, Uint8Array> = {};
    for (let i = 0; i < batchMetadata.files.length; i++) {
      const chunks = fileChunksMapRef.current.get(i);
      if (!chunks || chunks.length === 0) continue;
      
      const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
      const buf = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        buf.set(new Uint8Array(c), offset);
        offset += c.byteLength;
      }
      zipData[batchMetadata.files[i].name] = buf;
    }

    const zipped = fflate.zipSync(zipData, { level: 0 });
    const blob = new Blob([zipped as any], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bridged-files.zip';
    a.click();
    URL.revokeObjectURL(url);
  }, [batchMetadata]);

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.length === 4) {
      try {
        const res = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/nearby/resolve?code=${joinCode}`);
        if (res.ok) {
          const data = await res.json();
          if (data.sessionId) {
            setSessionId(data.sessionId);
            setStatus('receiving');
            window.history.pushState({}, '', `?s=${data.sessionId}`);
            return;
          }
        }
      } catch {}
      setError('Invalid or expired 4-digit code');
    } else if (joinCode.length === 6) {
      setSessionId(joinCode.toUpperCase());
      setStatus('receiving');
      window.history.pushState({}, '', `?s=${joinCode.toUpperCase()}`);
    }
  };

  return {
    sessionId, files, batchMetadata, progress, status, joinCode, setJoinCode,
    isTransferStarted, setIsTransferStarted, showFileList, setShowFileList,
    error, setError, eta, showRelayPrompt, setShowRelayPrompt, currentFileIndex,
    receivedBytes: receivedSizeRef.current, channelState, signalingState,
    isRelayActive, handleFileSelect, handleJoinByCode, handleCancel, downloadAll,
    reconnectP2P, activateRelay, isPaused, togglePause
  };
}
