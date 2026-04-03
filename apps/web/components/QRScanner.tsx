'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface QRScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // scanner already stopped
      }
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    let mounted = true;

    const startScanner = async () => {
      try {
        // Dynamic import to avoid SSR issues
        const { Html5Qrcode } = await import('html5-qrcode');

        if (!mounted) return;

        const scannerId = 'qr-reader-' + Date.now();
        if (containerRef.current) {
          // Create the element dynamically
          const el = document.createElement('div');
          el.id = scannerId;
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(el);
        }

        const html5QrCode = new Html5Qrcode(scannerId);
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1,
          },
          (decodedText: string) => {
            // Extract session code from Filedrop URL or use raw text
            let code = decodedText;
            try {
              const url = new URL(decodedText);
              const sessionParam = url.searchParams.get('s');
              if (sessionParam) {
                code = sessionParam;
              }
            } catch {
              // Not a URL — use as-is (might be a raw session code)
            }
            onScan(code);
          },
          () => {
            // QR code not found in frame — expected, keep scanning
          }
        );

        if (mounted) setScanning(true);
      } catch (err) {
        if (!mounted) return;
        console.error('[QR] Scanner error:', err);
        if (err instanceof Error) {
          if (err.message.includes('NotAllowedError') || err.message.includes('Permission')) {
            setError('Camera permission denied. Please allow camera access and try again.');
          } else if (err.message.includes('NotFoundError')) {
            setError('No camera found on this device.');
          } else {
            setError(`Camera error: ${err.message}`);
          }
        } else {
          setError('Could not access camera. Make sure you are using HTTPS.');
        }
      }
    };

    startScanner();

    return () => {
      mounted = false;
      stopScanner();
    };
  }, [onScan, stopScanner]);

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={handleClose}>
      <div
        className="w-full max-w-sm bg-(--surface) border-4 border-(--border) rounded-3xl shadow-[12px_12px_0px_0px_var(--shadow)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-4 border-(--border)">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-(--accent-violet) border-2 border-(--border) flex items-center justify-center shadow-[2px_2px_0px_0px_var(--shadow)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <rect width="7" height="5" x="7" y="7" rx="1" /><rect width="7" height="5" x="10" y="12" rx="1" />
              </svg>
            </div>
            <h3 className="font-black text-(--text) uppercase text-sm tracking-wider">Scan QR Code</h3>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-(--accent-rose) border-2 border-(--border) shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Scanner Area */}
        <div className="relative aspect-square bg-black">
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-(--accent-rose) border-2 border-(--border) flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
                </svg>
              </div>
              <p className="text-white font-bold text-sm">{error}</p>
              <button
                onClick={handleClose}
                className="px-6 py-2 bg-(--accent-yellow) text-black font-black uppercase text-xs rounded-xl border-2 border-(--border) shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
              >
                Close
              </button>
            </div>
          ) : !scanning ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-(--accent-yellow) border-t-transparent rounded-full animate-spin" />
            </div>
          ) : null}
          <div ref={containerRef} className="w-full h-full" />
        </div>

        {/* Footer hint */}
        <div className="p-3 text-center border-t-4 border-(--border)">
          <p className="text-(--text-secondary) font-bold text-[10px] uppercase tracking-widest">
            Point camera at a Filedrop QR code
          </p>
        </div>
      </div>
    </div>
  );
}
