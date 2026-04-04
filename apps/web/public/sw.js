/**
 * Filedrop Service Worker — Stream Download Proxy
 * 
 * On mobile browsers that lack FileSystem Access API (showSaveFilePicker),
 * this SW intercepts fetch requests to /filedrop-download/* and responds
 * with a ReadableStream piped from the main thread via MessageChannel.
 * This allows streaming large files directly to disk without accumulating
 * them in RAM.
 */

// Map of active download streams: downloadId -> ReadableStream
const streamMap = new Map();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for messages from the main thread to register streams
self.addEventListener('message', (event) => {
  const { type, downloadId, filename, filesize, port } = event.data;

  if (type === 'register-stream') {
    // Create a ReadableStream that reads chunks from the MessagePort
    const stream = new ReadableStream({
      start(controller) {
        port.onmessage = (evt) => {
          if (evt.data === 'end') {
            try { controller.close(); } catch { /* already closed */ }
            streamMap.delete(downloadId);
          } else if (evt.data === 'abort') {
            try { controller.error('Download aborted'); } catch { /* already errored */ }
            streamMap.delete(downloadId);
          } else {
            // evt.data is a Uint8Array chunk
            controller.enqueue(evt.data);
          }
        };
      },
      cancel() {
        port.postMessage('cancel');
        streamMap.delete(downloadId);
      }
    });

    streamMap.set(downloadId, { stream, filename, filesize });
    port.postMessage('registered');
  }
});

// Intercept fetch requests matching our download URL pattern
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept our synthetic download URLs
  if (!url.pathname.startsWith('/filedrop-download/')) return;

  const pathParts = url.pathname.split('/');
  const downloadId = pathParts[2]; // /filedrop-download is at index 1, ID is at 2!
  const entry = streamMap.get(downloadId);

  if (!entry) {
    event.respondWith(new Response('Download not found', { status: 404 }));
    return;
  }

  const { stream, filename, filesize } = entry;

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
  });

  if (filesize) {
    headers.set('Content-Length', String(filesize));
  }

  event.respondWith(new Response(stream, { headers }));
});
