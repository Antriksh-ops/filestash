/**
 * StreamSaver — Mobile-safe file download via Service Worker proxy.
 * 
 * On browsers without showSaveFilePicker (all mobile browsers),
 * this module registers a Service Worker and creates a WritableStream
 * that pipes data through a MessageChannel to the SW, which responds
 * to a synthetic fetch with a streaming Response. The browser treats
 * this as a normal file download, writing directly to disk.
 */

let swRegistration: ServiceWorkerRegistration | null = null;
let swReady = false;

/** Register the Service Worker. Call once on app init. */
export async function registerStreamSW(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    
    // Wait for the SW to be active
    const sw = swRegistration.installing || swRegistration.waiting || swRegistration.active;
    if (sw && sw.state !== 'activated') {
      await new Promise<void>((resolve) => {
        sw.addEventListener('statechange', function handler() {
          if (sw.state === 'activated') {
            sw.removeEventListener('statechange', handler);
            resolve();
          }
        });
      });
    }
    
    swReady = true;
    console.log('[StreamSaver] Service Worker registered and active');
    return true;
  } catch (e) {
    console.warn('[StreamSaver] Failed to register SW:', e);
    return false;
  }
}

/** Check if stream downloads are supported (SW active, no showSaveFilePicker) */
export function needsStreamFallback(): boolean {
  return !('showSaveFilePicker' in window);
}

export function isStreamReady(): boolean {
  return swReady && !!navigator.serviceWorker?.controller;
}

interface StreamWriter {
  write(chunk: ArrayBuffer): void;
  close(): void;
  abort(): void;
}

/**
 * Create a streaming download via the Service Worker.
 * Returns a writer object to push chunks into, and triggers the
 * browser's native download dialog on mobile.
 */
export function createStreamDownload(filename: string, filesize?: number): StreamWriter | null {
  if (!navigator.serviceWorker?.controller) {
    console.warn('[StreamSaver] No active SW controller');
    return null;
  }

  const downloadId = crypto.randomUUID();
  const channel = new MessageChannel();

  // Register the stream with the SW
  navigator.serviceWorker.controller.postMessage(
    {
      type: 'register-stream',
      downloadId,
      filename,
      filesize,
      port: channel.port2,
    },
    [channel.port2]
  );

  // Small delay then trigger the download by navigating an iframe to the synthetic URL
  const triggerDownload = () => {
    const a = document.createElement('a');
    a.href = `/filedrop-download/${downloadId}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch { /* already removed */ }
    }, 1000);
  };

  // Give the SW a moment to register the stream before fetching
  setTimeout(triggerDownload, 100);

  return {
    write(chunk: ArrayBuffer) {
      channel.port1.postMessage(new Uint8Array(chunk), [chunk]);
    },
    close() {
      channel.port1.postMessage('end');
    },
    abort() {
      channel.port1.postMessage('abort');
    },
  };
}
