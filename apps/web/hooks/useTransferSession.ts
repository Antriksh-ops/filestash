import { useState, useRef, useCallback, useEffect } from 'react';
import { useWebRTC } from './useWebRTC';
import { readChunkBatch, CHUNK_SIZE } from '../lib/chunker';
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
  // Fix #1: Explicit role — set once at session creation, never re-derived
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const totalSentRef = useRef(0);
  const receivedSizeRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const finishTimeRef = useRef<number | null>(null);
  
  // Storage and sliding window pacing refs
  const lastAckSentRef = useRef(0);
  const peerAckSizeRef = useRef(0);
  const progressRef = useRef(0);
  const etaRef = useRef<string | null>(null);
  const totalSizeRef = useRef(0);
  
  // Real-time speed calculation refs
  const lastSpeedUpdateRef = useRef(0);
  const lastSpeedBytesRef = useRef(0);
  const currentSpeedRef = useRef(0);

  const sendDataRef = useRef<(data: string | ArrayBuffer) => boolean>(() => false);
  const isTransferringRef = useRef(false);
  const isPausedRef = useRef(false);
  const waitForBufferRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const fileChunksMapRef = useRef<Map<number, ArrayBuffer[]>>(new Map());
  const writableRef = useRef<FileSystemWritableFileStream | null>(null);
  const isCancelledRef = useRef(false);
  const handleCancelRef = useRef<(isInitiator?: boolean) => void>(null);

  // Receiver-ready handshake: sender waits for this before pumping data
  const receiverReadyResolveRef = useRef<(() => void) | null>(null);

  // Guard: ensure receiver completion fires exactly once
  const receiverCompleteRef = useRef(false);

  // Write queue: serializes concurrent writes from 16 channels
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  // --- Mobile stream download refs ---
  const streamWriterRef = useRef<StreamWriter | null>(null);

  // --- Chunk-level resume refs ---
  const completedChunksRef = useRef<boolean[]>([]);
  const transferStateRef = useRef<TransferState | null>(null);
  const peerCompletedChunksRef = useRef<Set<number>>(new Set());

  // --- Reorder buffer for unordered data channel ---
  // With ordered:false, chunks may arrive out of order. We buffer them and 
  // write sequentially to preserve file integrity.
  const nextExpectedChunkRef = useRef(0);
  const reorderBufferRef = useRef<Map<number, ArrayBuffer>>(new Map());

  // Ref to primary data channel — avoids stale closure bugs in multiPumpSend
  const primaryDcRef = useRef<RTCDataChannel | null>(null);

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

    const now = Date.now();
    // Initialize speed tracking
    if (!lastSpeedUpdateRef.current) {
      lastSpeedUpdateRef.current = now;
      lastSpeedBytesRef.current = current;
      return;
    }

    const elapsedMs = now - lastSpeedUpdateRef.current;
    
    // Update speed estimate every 500ms
    if (elapsedMs >= 500) {
      const bytesSinceLast = Math.max(0, current - lastSpeedBytesRef.current);
      const instantSpeed = bytesSinceLast / (elapsedMs / 1000);
      
      // Smooth the speed reading slightly (70% new, 30% old)
      const smoothedSpeed = currentSpeedRef.current === 0 ? 
          instantSpeed : 
          (instantSpeed * 0.7) + (currentSpeedRef.current * 0.3);
          
      currentSpeedRef.current = smoothedSpeed;
      lastSpeedUpdateRef.current = now;
      lastSpeedBytesRef.current = current;

      if (smoothedSpeed > 0) {
        const remaining = total - current;
        const timeRemaining = remaining / smoothedSpeed;

        if (timeRemaining >= 0 && isFinite(timeRemaining)) {
          const mins = Math.floor(timeRemaining / 60);
          const secs = Math.floor(timeRemaining % 60);
          const speedMB = (smoothedSpeed / (1024 * 1024)).toFixed(2);
          etaRef.current = `${mins > 0 ? `${mins}m ` : ''}${secs}s • ${speedMB} MB/s`;
        }
      } else {
        // Stalled
        etaRef.current = `Stalled • 0.00 MB/s`;
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
    // Early exit if transfer already completed (prevents writes to closed streams)
    if (receiverCompleteRef.current) return 0;

    const view = new DataView(data);
    const chunkId = view.getUint32(0);

    // Ignore SCTP warm-up packets (marker = 0xFFFFFFFF)
    if (chunkId === 0xFFFFFFFF) return 0;

    const chunkSize = data.byteLength - 4;
    const rawData = data.slice(4);

    // --- Write to the best available target ---
    if (writableRef.current) {
      // Desktop: FileSystem Access API — seek to exact byte offset
      // FSA stream serializes writes internally — no external queue needed
      const byteOffset = chunkId * CHUNK_SIZE;
      try {
        await writableRef.current.write({ type: 'write', position: byteOffset, data: new Uint8Array(rawData) });
      } catch (e) {
        console.error(`[WRITE] Error writing chunk ${chunkId} at offset ${byteOffset}:`, e);
      }
    } else if (streamWriterRef.current) {
      // Mobile: Service Worker stream proxy — must write in order
      // Buffer out-of-order chunks and flush sequentially
      if (chunkId === nextExpectedChunkRef.current) {
        streamWriterRef.current.write(rawData);
        nextExpectedChunkRef.current++;
        // Flush any buffered consecutive chunks
        while (reorderBufferRef.current.has(nextExpectedChunkRef.current)) {
          streamWriterRef.current.write(reorderBufferRef.current.get(nextExpectedChunkRef.current)!);
          reorderBufferRef.current.delete(nextExpectedChunkRef.current);
          nextExpectedChunkRef.current++;
        }
      } else {
        // Out of order — buffer it
        reorderBufferRef.current.set(chunkId, rawData);
      }
    } else {
      // Fallback: in-memory accumulation — buffer by chunkId for ordered assembly later
      if (chunkId === nextExpectedChunkRef.current) {
        const currentIdx = currentFileIndex;
        if (!fileChunksMapRef.current.has(currentIdx)) {
          fileChunksMapRef.current.set(currentIdx, []);
        }
        fileChunksMapRef.current.get(currentIdx)!.push(rawData);
        nextExpectedChunkRef.current++;
        // Flush buffered
        while (reorderBufferRef.current.has(nextExpectedChunkRef.current)) {
          fileChunksMapRef.current.get(currentIdx)!.push(reorderBufferRef.current.get(nextExpectedChunkRef.current)!);
          reorderBufferRef.current.delete(nextExpectedChunkRef.current);
          nextExpectedChunkRef.current++;
        }
      } else {
        reorderBufferRef.current.set(chunkId, rawData);
      }
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
        lastAckSentRef.current = 0;
        peerAckSizeRef.current = 0;
        completedChunksRef.current = [];
        nextExpectedChunkRef.current = 0;
        reorderBufferRef.current = new Map();
        receiverCompleteRef.current = false;
        writeQueueRef.current = Promise.resolve();
        setCurrentFileIndex(0);
        setProgress(0);
        startTimeRef.current = Date.now();
        setIsTransferStarted(true);
        setStatus('receiving');

        // Initialize transfer state for resume tracking
        const totalSize = message.files.reduce((a: number, f: { size: number }) => a + f.size, 0);
        // Estimate total chunks (we'll refine as we receive)
        const estChunks = Math.ceil(totalSize / CHUNK_SIZE);
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

        // On Safari/mobile: fall through to in-memory accumulation.
        // StreamSaver (SW-based streaming) is unreliable on Safari — the SW often
        // fails to intercept the fetch, causing Next.js to serve HTML as the file.
        // In-memory blob download works reliably on all browsers for files up to ~500MB.
        if (!gotWritable) {
          console.log('[RECEIVER] Using in-memory accumulation → blob download');
        }

        // Signal sender that we're ready to receive data
        try {
          sendDataRef.current(JSON.stringify({ type: 'receiver-ready' }));
          console.log('[RECEIVER] Sent receiver-ready signal');
        } catch {}

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
      } else if (message.type === 'receiver-ready') {
        // SENDER receives this: receiver's file writer is open, safe to pump data
        console.log('[SENDER] Received receiver-ready signal');
        if (receiverReadyResolveRef.current) {
          receiverReadyResolveRef.current();
          receiverReadyResolveRef.current = null;
        }
      } else if (message.type === 'ack') {
        // SENDER receives this: receiver pacing acknowledgment
        // Fix #5: Only update pacing ref — do NOT overwrite sender's local progress
        // (sender uses totalSentRef for its own progress bar)
        peerAckSizeRef.current = message.receivedSize;
      }
    } else if (data instanceof ArrayBuffer) {
      try {
        await processChunk(data);

        const meta = batchMetadataRef.current;
        if (meta && startTimeRef.current) {
          const totalSize = meta.files.reduce((acc: number, f: any) => acc + f.size, 0);
          updateProgressRef(receivedSizeRef.current, totalSize);

          // removed backwards progress sync
          if (receivedSizeRef.current >= totalSize && !receiverCompleteRef.current) {
            // Guard: ensure this runs exactly once (16 concurrent channels can hit this)
            receiverCompleteRef.current = true;

            // Check if data was written to a file stream or accumulated in memory
            const wasStreaming = !!writableRef.current || !!streamWriterRef.current;

            // Flush remaining reorder buffer to stream/memory before closing
            // With 16 unordered channels, the buffer may have chunks that haven't been flushed yet
            if (streamWriterRef.current && reorderBufferRef.current.size > 0) {
              console.log(`[RECEIVER] Flushing ${reorderBufferRef.current.size} buffered chunks to stream`);
              // Sort by chunkId and write in order
              const sortedIds = [...reorderBufferRef.current.keys()].sort((a, b) => a - b);
              for (const id of sortedIds) {
                // Fill any gaps with the buffered data
                while (nextExpectedChunkRef.current < id) {
                  // Gap — this chunk was already written or is missing
                  nextExpectedChunkRef.current++;
                }
                if (id >= nextExpectedChunkRef.current) {
                  streamWriterRef.current.write(reorderBufferRef.current.get(id)!);
                  nextExpectedChunkRef.current = id + 1;
                }
              }
              reorderBufferRef.current.clear();
            }

            finishTimeRef.current = Date.now();
            setStatus('completed');
            progressRef.current = 100;
            etaRef.current = null;
            setEta(null);
            setProgress(100);

            // Let in-flight writes from other channels settle before closing
            await new Promise(r => setTimeout(r, 300));

            if (writableRef.current) {
              try {
                await writableRef.current.close();
              } catch (e) {
                console.warn('[WRITE] Error closing writable:', e);
              }
              writableRef.current = null;
            }
            if (streamWriterRef.current) {
              streamWriterRef.current.close();
              streamWriterRef.current = null;
            }
            await flushPendingSave();
            if (sessionId) deleteTransferState(sessionId);

            // Auto-download if data was accumulated in memory (no file picker / SW stream)
            if (!wasStreaming && meta) {
              // Flush any remaining reorder buffer into fileChunksMap
              if (reorderBufferRef.current.size > 0) {
                console.log(`[RECEIVER] Flushing ${reorderBufferRef.current.size} buffered chunks to memory`);
                const currentIdx = 0; // Single file for now
                if (!fileChunksMapRef.current.has(currentIdx)) {
                  fileChunksMapRef.current.set(currentIdx, []);
                }
                const sortedIds = [...reorderBufferRef.current.keys()].sort((a, b) => a - b);
                for (const id of sortedIds) {
                  fileChunksMapRef.current.get(currentIdx)!.push(reorderBufferRef.current.get(id)!);
                }
                reorderBufferRef.current.clear();
              }

              if (fileChunksMapRef.current.size > 0) {
                setTimeout(() => {
                  if (meta.files.length === 1) {
                    const chunks = fileChunksMapRef.current.get(0);
                    if (chunks && chunks.length > 0) {
                      // Detect MIME type from extension for proper file handling
                      const ext = meta.files[0].name.split('.').pop()?.toLowerCase() || '';
                      const mimeMap: Record<string, string> = {
                        'pdf': 'application/pdf', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg',
                        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                        'gif': 'image/gif', 'webp': 'image/webp', 'zip': 'application/zip',
                        'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'txt': 'text/plain', 'csv': 'text/csv', 'json': 'application/json',
                        'mov': 'video/quicktime', 'avi': 'video/x-msvideo', 'mkv': 'video/x-matroska',
                      };
                      const mimeType = mimeMap[ext] || 'application/octet-stream';
                      const blob = new Blob(chunks, { type: mimeType });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = meta.files[0].name;
                      document.body.appendChild(a);
                      a.click();
                      setTimeout(() => {
                        URL.revokeObjectURL(url);
                        try { document.body.removeChild(a); } catch {}
                      }, 1000);
                    }
                  } else if (meta.files.length > 1) {
                    const zipData: Record<string, Uint8Array> = {};
                    for (let i = 0; i < meta.files.length; i++) {
                      const chunks = fileChunksMapRef.current.get(i);
                      if (!chunks || chunks.length === 0) continue;
                      const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
                      const buf = new Uint8Array(totalLen);
                      let offset = 0;
                      for (const c of chunks) {
                        buf.set(new Uint8Array(c), offset);
                        offset += c.byteLength;
                      }
                      zipData[meta.files[i].name] = buf;
                    }
                    const zipped = fflate.zipSync(zipData, { level: 0 });
                    const blob = new Blob([zipped as any], { type: 'application/zip' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'filedrop-files.zip';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                      URL.revokeObjectURL(url);
                      try { document.body.removeChild(a); } catch {}
                    }, 1000);
                  }
                }, 300);
              }
            }
          } else if (!receiverCompleteRef.current) {
            // Update transfer state for resume (debounced inside markChunkCompleted)
            if (transferStateRef.current) {
              transferStateRef.current.receivedSize = receivedSizeRef.current;
            }

            // Provide sliding window ACKs back to sender every ~2.5MB
            if (receivedSizeRef.current - lastAckSentRef.current >= 2.5 * 1024 * 1024) {
              lastAckSentRef.current = receivedSizeRef.current;
              try {
                sendDataRef.current(JSON.stringify({ type: 'ack', receivedSize: receivedSizeRef.current }));
              } catch {}
            }
          }
        }
      } catch (e) {
        console.error('Decryption failed', e);
      }
    }
  }, [updateProgressRef, sessionId, processChunk]);

  // --- Extra data lanes for multi-connection throughput ---
  const EXTRA_LANES = 3; // + 1 primary = 4 total connections (stable, ~5 MB/s)
  const extraPcsRef = useRef<RTCPeerConnection[]>([]);
  const extraDcsRef = useRef<RTCDataChannel[]>([]);
  const pendingExtraCandidatesRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());

  // Handle signaling for extra data lanes (slots 1-3)
  const handleSlotSignaling = useCallback(async (slot: number, message: any) => {
    const idx = slot - 1; // slot 1 → index 0

    if (message.offer) {
      // Receiver: create PC for this lane, set offer, send answer
      const config = iceConfigRef.current;
      if (!config) return;
      const pc = new RTCPeerConnection(config);
      extraPcsRef.current[idx] = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignalingRef.current({ candidate: e.candidate, slot });
        }
      };
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        dc.binaryType = 'arraybuffer';
        dc.onopen = () => console.log(`[LANE ${slot}] Data channel opened`);
        dc.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            messageHandlerRef.current?.(ev.data);
          }
        };
        extraDcsRef.current[idx] = dc;
      };

      await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignalingRef.current({ answer, slot });

      // Process any buffered candidates
      const pending = pendingExtraCandidatesRef.current.get(slot) || [];
      for (const c of pending) {
        await pc.addIceCandidate(c);
      }
      pendingExtraCandidatesRef.current.delete(slot);

    } else if (message.answer) {
      // Sender: set answer on the right PC
      const pc = extraPcsRef.current[idx];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
      // Process buffered candidates
      const pending = pendingExtraCandidatesRef.current.get(slot) || [];
      for (const c of pending) {
        await pc.addIceCandidate(c);
      }
      pendingExtraCandidatesRef.current.delete(slot);

    } else if (message.candidate) {
      const pc = extraPcsRef.current[idx];
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(message.candidate);
      } else {
        // Buffer candidate
        if (!pendingExtraCandidatesRef.current.has(slot)) {
          pendingExtraCandidatesRef.current.set(slot, []);
        }
        pendingExtraCandidatesRef.current.get(slot)!.push(message.candidate);
      }
    }
  }, []);

  const messageHandlerRef = useRef(handleRawMessage);
  useEffect(() => { messageHandlerRef.current = handleRawMessage; }, [handleRawMessage]);

  const { sendData, sendSignaling, dataChannel, channelState, waitForBuffer, pumpSend, isRelayActive, activateRelay, reconnectP2P, signalingState, candidateType, iceConfigRef } = useWebRTC({
    sessionId: sessionId || '',
    isSender: role === 'sender',
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
    },
    onSlotSignaling: handleSlotSignaling,
  });

  const sendSignalingRef = useRef(sendSignaling);
  const pumpSendRef = useRef(pumpSend);

  // Create extra data lanes (sender-initiated) — waits for channels to actually open
  const openExtraLanes = useCallback(async () => {
    const config = iceConfigRef.current;
    if (!config) {
      console.warn('[LANES] No ICE config available');
      return;
    }

    let openCount = 0;
    const laneReadyPromise = new Promise<void>((resolve) => {
      const checkDone = () => {
        openCount++;
        console.log(`[LANES] ${openCount}/${EXTRA_LANES} extra lanes ready`);
        if (openCount >= EXTRA_LANES) resolve(); // All open
      };

      // Timeout: don't wait forever — start with whatever we have
      const timeout = setTimeout(() => {
        console.log(`[LANES] Timeout — proceeding with ${openCount} extra lane(s)`);
        resolve();
      }, 8000);

      // Resolve early if all open before timeout
      const origResolve = resolve;
      const wrappedResolve = () => { clearTimeout(timeout); origResolve(); };

      for (let i = 0; i < EXTRA_LANES; i++) {
        const slot = i + 1;
        const pc = new RTCPeerConnection(config);
        extraPcsRef.current[i] = pc;

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            sendSignalingRef.current({ candidate: e.candidate, slot });
          }
        };

        const dc = pc.createDataChannel(`lane-${slot}`, { ordered: false });
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = 1 * 1024 * 1024;
        dc.onerror = (e) => console.warn(`[LANE ${slot}] Error:`, e);
        dc.onopen = () => {
          console.log(`[LANE ${slot}] Data channel opened`);
          // SCTP warm-up on this lane — ramp congestion window
          try {
            const warmup = new Uint8Array(64 * 1024);
            new DataView(warmup.buffer).setUint32(0, 0xFFFFFFFF);
            for (let w = 0; w < 8; w++) {
              if (dc.bufferedAmount > 1 * 1024 * 1024) break;
              dc.send(warmup.buffer);
            }
            console.log(`[LANE ${slot}] Warm-up sent`);
          } catch {}
          checkDone();
          if (openCount >= EXTRA_LANES) wrappedResolve();
        };
        extraDcsRef.current[i] = dc;

        // Create and send offer (don't await - send all in parallel)
        pc.createOffer().then(offer => {
          pc.setLocalDescription(offer).then(() => {
            sendSignalingRef.current({ offer, slot });
            console.log(`[LANE ${slot}] Offer sent`);
          });
        });
      }
    });

    await laneReadyPromise;
  }, [iceConfigRef]);

  const closeExtraLanes = useCallback(() => {
    for (const dc of extraDcsRef.current) {
      try { dc?.close(); } catch {}
    }
    for (const pc of extraPcsRef.current) {
      try { pc?.close(); } catch {}
    }
    extraDcsRef.current = [];
    extraPcsRef.current = [];
    pendingExtraCandidatesRef.current.clear();
  }, []);

  // Multi-channel pump: "least loaded" strategy across primary + extra channels
  // Uses refs (not React state) to avoid stale closure issues in long-running startTransfer
  const multiPumpSend = useCallback((
    packets: ArrayBuffer[],
    onChunkSent?: (index: number) => void,
    cancelledRef?: React.MutableRefObject<boolean>
  ): Promise<void> => {
    // Keep each channel's SCTP buffer well-fed to maintain congestion window
    // Higher = more consistent throughput (less idle time between refills)
    const HIGH_WATER = 4 * 1024 * 1024;

    // Dynamically gather open channels from REFS (not React state)
    const getOpenChannels = (): RTCDataChannel[] => {
      const channels: RTCDataChannel[] = [];
      const primary = primaryDcRef.current;
      if (primary && primary.readyState === 'open') {
        channels.push(primary);
      }
      for (const dc of extraDcsRef.current) {
        if (dc && dc.readyState === 'open') {
          channels.push(dc);
        }
      }
      return channels;
    };

    const initial = getOpenChannels();
    if (initial.length === 0) {
      console.error('[PUMP] No data channels open! primary:', primaryDcRef.current?.readyState, 'extras:', extraDcsRef.current.map(dc => dc?.readyState));
      return Promise.reject(new Error('No data channels open'));
    }

    console.log(`[PUMP] Sending ${packets.length} packets across ${initial.length} channel(s)`);

    return new Promise<void>((resolve, reject) => {
      let idx = 0;

      const drainListeners = new Map<RTCDataChannel, () => void>();

      const cleanup = () => {
        for (const [dc, listener] of drainListeners) {
          dc.removeEventListener('bufferedamountlow', listener);
        }
        drainListeners.clear();
      };

      const pump = () => {
        try {
          // Refresh channel list each pump cycle (picks up late-opening lanes)
          const channels = getOpenChannels();
          if (channels.length === 0) { cleanup(); reject(new Error('All channels closed')); return; }

          while (idx < packets.length) {
            if (cancelledRef?.current) { cleanup(); resolve(); return; }

            // "Least loaded" — pick the channel with the most room
            let bestDc: RTCDataChannel | null = null;
            let bestBuf = Infinity;
            for (const dc of channels) {
              if (dc.readyState !== 'open') continue;
              if (dc.bufferedAmount < bestBuf) {
                bestBuf = dc.bufferedAmount;
                bestDc = dc;
              }
            }

            if (bestDc && bestBuf <= HIGH_WATER) {
              bestDc.send(packets[idx]);
              onChunkSent?.(idx);
              idx++;
            } else {
              // All channels full — wait for ANY to drain
              for (const dc of channels) {
                if (dc.readyState !== 'open') continue;
                if (!drainListeners.has(dc)) {
                  const listener = () => {
                    cleanup();
                    pump();
                  };
                  drainListeners.set(dc, listener);
                  dc.addEventListener('bufferedamountlow', listener);
                }
              }
              return; // Exit sync loop, resumes via callback
            }
          }
          cleanup();
          resolve();
        } catch (e) {
          if (e instanceof DOMException && e.name === 'OperationError') {
            const channels = getOpenChannels();
            for (const dc of channels) {
              if (dc.readyState !== 'open') continue;
              if (!drainListeners.has(dc)) {
                const listener = () => { cleanup(); pump(); };
                drainListeners.set(dc, listener);
                dc.addEventListener('bufferedamountlow', listener);
              }
            }
          } else {
            cleanup();
            reject(e);
          }
        }
      };

      pump();
    });
  }, []); // No React state dependencies — uses refs only

  useEffect(() => {
    sendDataRef.current = sendData;
    sendSignalingRef.current = sendSignaling;
    waitForBufferRef.current = waitForBuffer;
    pumpSendRef.current = pumpSend;
    primaryDcRef.current = dataChannel;
  }, [sendData, sendSignaling, waitForBuffer, pumpSend, dataChannel]);



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
    // Clean up file writer
    if (writableRef.current) {
      try { writableRef.current.close(); } catch { }
      writableRef.current = null;
    }
    // DELETE persisted transfer state from IndexedDB so it doesn't resume
    if (sessionId) {
      deleteTransferState(sessionId).catch(() => {});
    }
    setFiles([]);
    setBatchMetadata(null);
    batchMetadataRef.current = null;
    fileChunksMapRef.current = new Map();
    completedChunksRef.current = [];
    transferStateRef.current = null;
    peerCompletedChunksRef.current = new Set();
    receivedSizeRef.current = 0;
    totalSentRef.current = 0;
    // Clear reorder buffer
    nextExpectedChunkRef.current = 0;
    reorderBufferRef.current = new Map();
    setProgress(0);
    progressRef.current = 0;
    startTimeRef.current = null;
    finishTimeRef.current = null;
    lastSpeedUpdateRef.current = 0;
    lastSpeedBytesRef.current = 0;
    currentSpeedRef.current = 0;
    etaRef.current = null;
    setEta(null);
    setStatus('idle');
    setSessionId(null);
    setRole(null);
    setError(null);
    setIsTransferStarted(false);
    closeExtraLanes();
    window.history.pushState({}, '', window.location.pathname);
  }, [dataChannel, sendData, sessionId, closeExtraLanes]);

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

  // --- Initialization: Handle ?s= Code on Mount ---
  useEffect(() => {
    const checkResumption = async () => {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get('s');

      if (sid) {
        if (!sessionId) {
          const savedState = await getTransferState(sid);
          if (savedState && savedState.status === 'active' && savedState.completedChunks?.length > 0) {
            console.log(`[RESUME] Found saved state for ${sid}: ${savedState.completedChunks.filter(Boolean).length} chunks completed`);
            setRole('receiver');
            setSessionId(sid);
            setBatchMetadata({ files: savedState.files, sessionId: sid });
            batchMetadataRef.current = { files: savedState.files, sessionId: sid };
            receivedSizeRef.current = savedState.receivedSize;
            completedChunksRef.current = savedState.completedChunks;
            transferStateRef.current = savedState;
            setStatus('receiving');
          } else if (files.length === 0) {
            setRole('receiver');
            setSessionId(sid);
            setStatus('receiving');
          }
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

  // handleFileSelect moved below startTransfer

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
    finishTimeRef.current = null;
    startTimeRef.current = Date.now();
    totalSentRef.current = 0;

    try {
      const send = (data: string | ArrayBuffer) => sendDataRef.current(data);

      // Set up receiver-ready listener BEFORE sending metadata (prevents race condition)
      // If receiver responds instantly (Safari, no file picker), we won't miss the signal
      const receiverReadyPromise = new Promise<void>((resolve) => {
        receiverReadyResolveRef.current = resolve;
        // Timeout: don't wait forever (receiver might not support handshake)
        setTimeout(() => {
          if (receiverReadyResolveRef.current) {
            console.warn('[SENDER] receiver-ready timeout — proceeding anyway');
            receiverReadyResolveRef.current = null;
            resolve();
          }
        }, 15000);
      });

      // Control messages use retrySend (rare, small)
      await retrySend(() => send(JSON.stringify({ type: 'batch-metadata', files: filesToSend.map(f => ({ name: f.name, size: f.size })) })));
      const totalBatchSize = filesToSend.reduce((acc, f) => acc + f.size, 0);

      // Wait for receiver to confirm file writer is open (file picker resolved)
      console.log('[SENDER] Waiting for receiver-ready...');
      await receiverReadyPromise;
      console.log('[SENDER] Receiver ready — opening lanes');

      // Open extra data lanes (15 more PeerConnections) for parallel throughput
      // Waits for channels to open + sends warm-up packets automatically
      await openExtraLanes();

      const skipChunks = peerCompletedChunksRef.current;
      if (skipChunks.size > 0) {
        console.log(`[RESUME] Skipping ${skipChunks.size} chunks already received by peer`);
      }

      for (let i = 0; i < filesToSend.length; i++) {
        if (isCancelledRef.current) break;
        setCurrentFileIndex(i);
        await retrySend(() => send(JSON.stringify({ type: 'file-start', index: i })));

        const file = filesToSend[i];
        const fileId = `${file.name}-${file.size}-${file.lastModified}`;
        let offset = 0;
        let chunkId = 0;

        // Batch-pump loop: read 8MB from disk, build packets, pump via zero-async callback
        while (offset < file.size) {
          if (isCancelledRef.current) break;

          while (isPausedRef.current && !isCancelledRef.current) {
            await new Promise(r => setTimeout(r, 100));
          }
          if (isCancelledRef.current) break;

          // 1. Read up to 8MB from disk in one await (~128 chunks at 64KB each)
          // 1. Read up to 8MB from disk in one await
          const batch = await readChunkBatch(file, fileId, offset, chunkId, 8 * 1024 * 1024);
          
          // 2. Build all packets synchronously (no awaits)
          const packets: ArrayBuffer[] = [];
          const chunkSizes: number[] = [];
          for (const chunk of batch.chunks) {
            if (skipChunks.has(chunk.chunk_id)) {
              totalSentRef.current += chunk.size;
              updateProgressRef(totalSentRef.current, totalBatchSize);
              continue;
            }
            const packet = new Uint8Array(4 + chunk.data.byteLength);
            new DataView(packet.buffer).setUint32(0, chunk.chunk_id);
            packet.set(new Uint8Array(chunk.data), 4);
            packets.push(packet.buffer);
            chunkSizes.push(chunk.size);
          }

          // 3. Multi-channel pump: distributes packets across ALL open data channels
          //    (primary + up to 15 extra lanes) for 8-16x throughput
          if (packets.length > 0) {
            // Helper: total bytes still in SCTP send buffers (not yet on the wire)
            const getTotalBuffered = (): number => {
              let total = 0;
              const primary = primaryDcRef.current;
              if (primary && primary.readyState === 'open') total += primary.bufferedAmount;
              for (const dc of extraDcsRef.current) {
                if (dc && dc.readyState === 'open') total += dc.bufferedAmount;
              }
              return total;
            };

            let sentInBatch = 0;
            await multiPumpSend(
              packets,
              (idx: number) => {
                totalSentRef.current += chunkSizes[idx];
                sentInBatch++;
                // Throttle: only compute buffered amount every 8th chunk
                if (sentInBatch % 8 === 0 || idx === packets.length - 1) {
                  const delivered = Math.max(0, totalSentRef.current - getTotalBuffered());
                  updateProgressRef(delivered, totalBatchSize);
                }
              },
              isCancelledRef
            );
          }
          
          offset = batch.nextOffset;
          chunkId = batch.nextChunkId;
        }
        await retrySend(() => send(JSON.stringify({ type: 'file-end', index: i })));
      }

      if (!isCancelledRef.current && totalSentRef.current >= totalBatchSize) {
        // Wait for ALL channel buffers to drain (primary + extra lanes)
        // This ensures every chunk is actually delivered before we close connections
        console.log('[TRANSFER] All chunks queued — waiting for SCTP buffers to drain...');
        const drainAll = async () => {
          const maxWait = 30000; // 30s max
          const start = Date.now();
          while (Date.now() - start < maxWait) {
            let totalBuffered = 0;
            const primary = primaryDcRef.current;
            if (primary && primary.readyState === 'open') totalBuffered += primary.bufferedAmount;
            for (const dc of extraDcsRef.current) {
              if (dc && dc.readyState === 'open') totalBuffered += dc.bufferedAmount;
            }
            // Update progress as buffers drain (prevents stall at ~80%)
            const delivered = Math.max(0, totalSentRef.current - totalBuffered);
            updateProgressRef(delivered, totalBatchSize);
            if (totalBuffered === 0) {
              console.log('[TRANSFER] All SCTP buffers drained');
              break;
            }
            // Poll every 100ms
            await new Promise(r => setTimeout(r, 100));
          }
        };
        await drainAll();

        send(JSON.stringify({ type: 'transfer-complete' }));
        // Grace period to ensure the control message is flushed
        await new Promise(r => setTimeout(r, 500));
        setStatus('completed');
        progressRef.current = 100;
        etaRef.current = null;
        setEta(null);
        setProgress(100);
        releaseWakeLock();
      }
    } catch (err) {
      console.error('[TRANSFER] Error during transfer:', err);
      if (!isCancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Transfer failed');
      }
    } finally {
      isTransferringRef.current = false;
      closeExtraLanes();
    }
  }, [updateProgressRef, requestWakeLock, releaseWakeLock, multiPumpSend, openExtraLanes, closeExtraLanes]);

  const handleFileSelect = useCallback(async (selectedFiles: File[]) => {
    isCancelledRef.current = false;

    // If there's an existing session but the connection is dead, reset fully first
    if (sessionId && channelState !== 'open') {
      // Fix #6: Clean up stale state and wait for React to flush
      // so useWebRTC's cleanup runs before we create a new session
      isTransferringRef.current = false;
      setFiles([]);
      setBatchMetadata(null);
      batchMetadataRef.current = null;
      fileChunksMapRef.current = new Map();
      completedChunksRef.current = [];
      transferStateRef.current = null;
      peerCompletedChunksRef.current = new Set();
      receivedSizeRef.current = 0;
      totalSentRef.current = 0;
      progressRef.current = 0;
      etaRef.current = null;
      setProgress(0);
      startTimeRef.current = null;
      setEta(null);
      setSessionId(null);
      setRole(null);
      setIsTransferStarted(false);
      setError(null);
      window.history.pushState({}, '', window.location.pathname);
      // Wait a tick so useWebRTC cleanup effect fires before we create new session
      await new Promise(r => setTimeout(r, 0));
      // Fall through to create a brand new session below
    }

    setFiles(selectedFiles);

    // If we are already connected to a session with an open channel, just start sending
    if (sessionId && channelState === 'open') {
      if (status !== 'receiving') setStatus('sending');
      startTransfer(selectedFiles);
      return;
    }

    try {
      const response = await fetch(`${CONFIG.SIGNALING_URL_HTTP}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: selectedFiles.map(f => ({ name: f.name, size: f.size })) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.sessionId) {
        throw new Error(data.error || "Signaling server is waking up. Please try again in 30 seconds.");
      }
      setRole('sender');
      setSessionId(data.sessionId);
      setStatus('sending');
      window.history.pushState({}, '', `?s=${data.sessionId}`);

    } catch (err: any) {
      console.error('[P2P] Failed to establish valid signaling session', err);
      // Reset state if we fail to get a true backend-backed session ID
      setSessionId(null);
      setStatus('idle');
      setFiles([]);
      setError(err?.message || "Unable to connect to signaling server.");
      window.history.pushState({}, '', window.location.pathname);
    }
  }, [sessionId, channelState, startTransfer, status]);



  // Trigger transfer — uses a ref for files to keep deps stable
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  useEffect(() => {
    if (status === 'sending' && files.length > 0 && channelState === 'open' && !isTransferringRef.current) {
      setIsTransferStarted(true);
      startTransfer(filesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, channelState]);

  const downloadAll = useCallback(() => {
    if (!batchMetadata) return;
    if (fileChunksMapRef.current.size === 0) return;

    if (batchMetadata.files.length === 1) {
      const chunks = fileChunksMapRef.current.get(0);
      if (!chunks || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: 'application/octet-stream' });
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
            setRole('receiver');
            setSessionId(data.sessionId);
            setStatus('receiving');
            window.history.pushState({}, '', `?s=${data.sessionId}`);
            return;
          }
        }
      } catch {}
      setError('Invalid or expired 4-digit code');
    } else if (joinCode.length === 6) {
      const code = joinCode.trim().toUpperCase();
      setRole('receiver');
      setSessionId(code);
      setStatus('receiving');
      window.history.pushState({}, '', `?s=${code}`);
    }
  };

  return {
    sessionId, files, batchMetadata, progress, status, joinCode, setJoinCode,
    isTransferStarted, setIsTransferStarted, showFileList, setShowFileList,
    error, setError, eta, showRelayPrompt, setShowRelayPrompt, currentFileIndex,
    receivedBytes: receivedSizeRef.current, channelState, signalingState,
    isRelayActive, handleFileSelect, handleJoinByCode, handleCancel, downloadAll,
    reconnectP2P, activateRelay, isPaused, togglePause, candidateType,
    transferStartTime: startTimeRef.current,
    transferFinishTime: finishTimeRef.current
  };
}
