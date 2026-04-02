import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | FILEDROP',
  description: 'FILEDROP privacy policy. We collect nothing. We store nothing. Your files never touch our servers.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-(--bg) py-16 px-4">
      <div className="max-w-3xl mx-auto space-y-12">
        <div className="space-y-4">
          <h1 className="text-5xl font-black uppercase tracking-tighter text-(--text)">Privacy Policy</h1>
          <p className="text-xl text-(--text-secondary) font-medium">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="space-y-8">
          <div className="p-8 rounded-3xl border-4 border-(--accent-emerald) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)]">
            <h2 className="text-2xl font-black uppercase text-(--text) mb-3">TL;DR</h2>
            <p className="text-lg text-(--text-secondary) font-bold">
              We don&apos;t collect, store, or process your files. Ever. Your data goes directly from your device to the recipient&apos;s device, encrypted end-to-end.
            </p>
          </div>

          {[
            {
              title: '1. Data We Do NOT Collect',
              content: 'We do not collect, store, or have access to: your files, file names, file contents, encryption keys, IP addresses (beyond the duration of a WebSocket session), personal information, or browsing history. We have no user accounts, no cookies for tracking, and no analytics that identify you.',
            },
            {
              title: '2. How File Transfers Work',
              content: 'Files are transferred directly between browsers using WebRTC peer-to-peer connections. Our signaling server facilitates the initial connection handshake only. Once the P2P connection is established, data flows directly between devices without passing through our infrastructure. All data is encrypted with AES-256-GCM using ephemeral ECDH keys that are never transmitted to or stored on our servers.',
            },
            {
              title: '3. Session Data',
              content: 'When you create a transfer session, a temporary 6-character session ID is generated and stored in memory (or Redis) for up to 24 hours. This session data contains only: the session ID, file metadata (names and sizes — NOT contents), and a chunk verification manifest (hashes). This data is automatically deleted when the session expires or completes.',
            },
            {
              title: '4. Relay Mode',
              content: 'If a direct P2P connection cannot be established, your data may be relayed through our signaling server. Even in relay mode, your data remains encrypted end-to-end — we cannot decrypt or inspect it. Relay data is never stored and is discarded immediately after forwarding.',
            },
            {
              title: '5. Third-Party Services',
              content: 'We use Metered.ca for TURN server credentials (ICE negotiation only — no file data passes through). We use Vercel for frontend hosting and Render for signaling server hosting. Neither service has access to your transferred files.',
            },
            {
              title: '6. Your Rights',
              content: 'Since we don\'t collect personal data, there is nothing to request, modify, or delete. You are in complete control. Close your browser tab and the transfer ends immediately.',
            },
          ].map((section, i) => (
            <section key={i} className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[4px_4px_0px_0px_var(--shadow)]">
              <h2 className="text-xl font-black uppercase tracking-tight text-(--text) mb-3">{section.title}</h2>
              <p className="text-(--text-secondary) font-medium leading-relaxed">{section.content}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

