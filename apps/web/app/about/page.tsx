import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About FILEDROP | Private P2P File Sharing',
  description: 'Learn about FILEDROP — a free, independent peer-to-peer file sharing service that prioritizes your privacy. No cloud, no limits, no tracking.',
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-(--bg) py-16 px-4">
      <div className="max-w-3xl mx-auto space-y-12">
        <div className="space-y-4">
          <h1 className="text-5xl font-black uppercase tracking-tighter text-(--text)">About Filedrop</h1>
          <p className="text-xl text-(--text-secondary) font-medium leading-relaxed">
            We believe your files are yours. Not ours. Not anyone else&apos;s.
          </p>
        </div>

        <div className="space-y-8">
          <section className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)]">
            <h2 className="text-2xl font-black uppercase tracking-tight text-(--text) mb-4">What is Filedrop?</h2>
            <p className="text-(--text-secondary) font-medium leading-relaxed">
              Filedrop is a free, peer-to-peer file sharing service. When you share a file, it travels directly from your device to the recipient&apos;s device. We never store, see, or have access to your files. The moment you close your browser tab, the sharing link stops working.
            </p>
          </section>

          <section className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)]">
            <h2 className="text-2xl font-black uppercase tracking-tight text-(--text) mb-4">How does it work?</h2>
            <div className="space-y-4 text-(--text-secondary) font-medium leading-relaxed">
              <p>Filedrop uses <strong className="text-(--text)">WebRTC</strong> — the same technology that powers video calls — to create a direct, encrypted tunnel between two browsers.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="p-4 rounded-2xl border-2 border-(--border) bg-(--bg) text-center">
                  <p className="text-3xl mb-2">📤</p>
                  <p className="font-black text-sm uppercase text-(--text)">1. Drop files</p>
                  <p className="text-xs mt-1">Get a unique 6-digit code</p>
                </div>
                <div className="p-4 rounded-2xl border-2 border-(--border) bg-(--bg) text-center">
                  <p className="text-3xl mb-2">🔗</p>
                  <p className="font-black text-sm uppercase text-(--text)">2. Share code</p>
                  <p className="text-xs mt-1">Send the code or QR to your peer</p>
                </div>
                <div className="p-4 rounded-2xl border-2 border-(--border) bg-(--bg) text-center">
                  <p className="text-3xl mb-2">⚡</p>
                  <p className="font-black text-sm uppercase text-(--text)">3. Direct transfer</p>
                  <p className="text-xs mt-1">Files flow directly, encrypted</p>
                </div>
              </div>
            </div>
          </section>

          <section className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)]">
            <h2 className="text-2xl font-black uppercase tracking-tight text-(--text) mb-4">Security</h2>
            <ul className="space-y-3 text-(--text-secondary) font-medium">
              <li className="flex items-start gap-3">
                <span className="text-(--accent-emerald) font-black">✓</span>
                <span><strong className="text-(--text)">AES-256-GCM</strong> encryption on every chunk of data</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-(--accent-emerald) font-black">✓</span>
                <span><strong className="text-(--text)">ECDH key exchange</strong> — perfect forward secrecy per session</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-(--accent-emerald) font-black">✓</span>
                <span><strong className="text-(--text)">SHA-256 integrity</strong> verification on every chunk</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-(--accent-emerald) font-black">✓</span>
                <span><strong className="text-(--text)">Zero knowledge</strong> — we never see your files or encryption keys</span>
              </li>
            </ul>
          </section>

          <section className="p-8 rounded-3xl border-4 border-(--border) bg-(--accent-yellow) bg-opacity-20 shadow-[8px_8px_0px_0px_var(--shadow)]">
            <h2 className="text-2xl font-black uppercase tracking-tight text-(--text) mb-4">🌍 Low Carbon Footprint</h2>
            <p className="text-(--text-secondary) font-medium leading-relaxed">
              Because we don&apos;t store data on servers, Filedrop has a dramatically smaller carbon footprint than cloud storage providers. No data centers hoarding your files. No energy wasted on redundant copies. Just a direct pipe between two devices.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

