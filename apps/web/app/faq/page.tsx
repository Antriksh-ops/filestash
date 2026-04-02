import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FAQ | FILEDROP - Frequently Asked Questions',
  description: 'Common questions about FILEDROP P2P file sharing: how it works, browser support, file size limits, encryption, and troubleshooting.',
};

const faqs = [
  {
    q: 'How does peer-to-peer file sharing work?',
    a: 'Filedrop uses WebRTC to create a direct encrypted connection between your browser and the recipient\'s browser. Your files travel directly between devices without touching any server. Our signaling server only helps the two browsers find each other — it never sees your data.',
  },
  {
    q: 'Is there a file size limit?',
    a: 'No. Because we don\'t store files on any server, there are no artificial file size limits. You can share files of any size — 1MB or 100GB. The only limits are your internet speed and device storage.',
  },
  {
    q: 'How is my data encrypted?',
    a: 'Every session generates a unique ECDH key pair for perfect forward secrecy. Your files are split into chunks, and each chunk is encrypted with AES-256-GCM before transmission. Even if someone intercepts the data, they cannot read it without the session key.',
  },
  {
    q: 'Which browsers are supported?',
    a: 'Filedrop works on all modern browsers that support WebRTC: Google Chrome, Mozilla Firefox, Microsoft Edge, Safari (macOS/iOS), and Brave. For the best experience, we recommend the latest version of Chrome or Firefox.',
  },
  {
    q: 'Why is my transfer speed slower than expected?',
    a: 'Transfer speed depends on both the sender\'s upload speed and the receiver\'s download speed — the slower of the two is the bottleneck. If both devices are on the same local network, speeds can be much faster since data doesn\'t leave your building.',
  },
  {
    q: 'Do I need to keep the browser tab open?',
    a: 'Yes. Since files are shared directly from your device, you must keep the browser tab open until the transfer is complete. Closing the tab immediately ends the connection and the sharing link stops working.',
  },
  {
    q: 'What happens if the connection drops?',
    a: 'Filedrop tracks which chunks have been received. If the connection drops, you can reconnect using the same session code and the transfer will resume from where it left off — no need to start over.',
  },
  {
    q: 'Can I share entire folders?',
    a: 'Yes! You can drag and drop entire folders onto the Filedrop upload area. All files in the folder will be transferred. On the receiving end, multiple files are packaged into a zip archive for easy download.',
  },
  {
    q: 'What if P2P connection fails?',
    a: 'If a direct peer-to-peer connection can\'t be established (common on strict corporate networks), Filedrop will offer to relay your data through our server. The data is still encrypted end-to-end, so we can\'t read it even in relay mode.',
  },
  {
    q: 'Is Filedrop free?',
    a: 'Yes, Filedrop is completely free to use with no account required. We don\'t show ads, sell data, or impose usage limits.',
  },
];

export default function FAQPage() {
  return (
    <main className="min-h-screen bg-(--bg) py-16 px-4">
      <div className="max-w-3xl mx-auto space-y-12">
        <div className="space-y-4">
          <h1 className="text-5xl font-black uppercase tracking-tighter text-(--text)">FAQ</h1>
          <p className="text-xl text-(--text-secondary) font-medium">
            Everything you need to know about Filedrop.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <details
              key={i}
              className="group p-6 rounded-2xl border-4 border-(--border) bg-(--surface) shadow-[4px_4px_0px_0px_var(--shadow)] hover:shadow-[8px_8px_0px_0px_var(--shadow)] hover:-translate-y-0.5 transition-all"
            >
              <summary className="cursor-pointer list-none flex items-center justify-between">
                <h3 className="text-lg font-black uppercase tracking-tight text-(--text) pr-4">{faq.q}</h3>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-(--text-secondary) group-open:rotate-180 transition-transform shrink-0">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </summary>
              <p className="mt-4 text-(--text-secondary) font-medium leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </main>
  );
}

