import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact | FILEDROP',
  description: 'Get in touch with the FILEDROP team for questions, feedback, or support.',
};

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-(--bg) py-16 px-4">
      <div className="max-w-3xl mx-auto space-y-12">
        <div className="space-y-4">
          <h1 className="text-5xl font-black uppercase tracking-tighter text-(--text)">Contact</h1>
          <p className="text-xl text-(--text-secondary) font-medium">
            Questions, feedback, or just want to say hello?
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <a
            href="mailto:hello@filedrop.app"
            className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)] hover:shadow-[12px_12px_0px_0px_var(--shadow)] hover:-translate-y-1 transition-all block"
          >
            <p className="text-4xl mb-4">📧</p>
            <h2 className="text-xl font-black uppercase text-(--text) mb-2">Email</h2>
            <p className="text-(--text-secondary) font-medium">hello@filedrop.app</p>
          </a>

          <a
            href="https://github.com/Antriksh-ops/filestash"
            target="_blank"
            rel="noopener noreferrer"
            className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[8px_8px_0px_0px_var(--shadow)] hover:shadow-[12px_12px_0px_0px_var(--shadow)] hover:-translate-y-1 transition-all block"
          >
            <p className="text-4xl mb-4">💻</p>
            <h2 className="text-xl font-black uppercase text-(--text) mb-2">GitHub</h2>
            <p className="text-(--text-secondary) font-medium">Report bugs & contribute</p>
          </a>
        </div>

        <div className="p-8 rounded-3xl border-4 border-(--border) bg-(--surface) shadow-[4px_4px_0px_0px_var(--shadow)]">
          <h2 className="text-xl font-black uppercase text-(--text) mb-4">Common Issues</h2>
          <ul className="space-y-3 text-(--text-secondary) font-medium">
            <li className="flex items-start gap-3">
              <span className="font-black text-(--text)">→</span>
              <span><strong className="text-(--text)">Transfer stuck at 0%?</strong> Both devices need to be online and the sender&apos;s tab must stay open. Try refreshing both browsers.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="font-black text-(--text)">→</span>
              <span><strong className="text-(--text)">Can&apos;t connect?</strong> Some corporate firewalls block WebRTC. Filedrop will offer a relay mode as a fallback.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="font-black text-(--text)">→</span>
              <span><strong className="text-(--text)">Slow speeds?</strong> Speed is limited by the slower connection. For fastest transfers, use both devices on the same Wi-Fi network.</span>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}

