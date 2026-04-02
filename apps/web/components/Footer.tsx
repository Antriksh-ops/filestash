'use client';

import React from 'react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="w-full border-t-4 border-(--border) bg-(--surface) mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-3">
            <h3 className="text-xl font-black uppercase tracking-tighter text-(--text)">FILEDROP</h3>
            <p className="text-(--text-secondary) text-sm font-medium leading-relaxed">
              Free, private, peer-to-peer file sharing. No cloud storage. No file size limits. Your data stays yours.
            </p>
          </div>

          {/* Product */}
          <div className="space-y-3">
            <h4 className="text-sm font-black uppercase tracking-wider text-(--text)">Product</h4>
            <div className="flex flex-col gap-2">
              <Link href="/" className="text-(--text-secondary) text-sm font-medium hover:text-(--text) transition-colors">Transfer Files</Link>
              <Link href="/nearby" className="text-(--text-secondary) text-sm font-medium hover:text-(--text) transition-colors">Nearby Devices</Link>
              <Link href="/faq" className="text-(--text-secondary) text-sm font-medium hover:text-(--text) transition-colors">FAQ</Link>
            </div>
          </div>

          {/* Company */}
          <div className="space-y-3">
            <h4 className="text-sm font-black uppercase tracking-wider text-(--text)">Company</h4>
            <div className="flex flex-col gap-2">
              <Link href="/about" className="text-(--text-secondary) text-sm font-medium hover:text-(--text) transition-colors">About</Link>
              <Link href="/privacy" className="text-(--text-secondary) text-sm font-medium hover:text-(--text) transition-colors">Privacy Policy</Link>
              <Link href="/contact" className="text-(--text-secondary) text-sm font-medium hover:text-(--text) transition-colors">Contact</Link>
            </div>
          </div>

          {/* Trust */}
          <div className="space-y-3">
            <h4 className="text-sm font-black uppercase tracking-wider text-(--text)">Trust &amp; Safety</h4>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-(--accent-emerald)" />
                <span className="text-(--text-secondary) text-sm font-medium">End-to-End Encrypted</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-(--accent-emerald)" />
                <span className="text-(--text-secondary) text-sm font-medium">Zero Cloud Storage</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-(--accent-emerald)" />
                <span className="text-(--text-secondary) text-sm font-medium">Open Source</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t-2 border-(--border) flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-(--text-secondary) text-xs font-bold uppercase tracking-[0.15em]">
            © {new Date().getFullYear()} Filedrop — Built for the open web
          </p>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 border-2 border-(--border) rounded-lg text-[10px] font-black uppercase text-(--text-secondary) bg-(--surface)">
              No servers
            </span>
            <span className="px-3 py-1 border-2 border-(--border) rounded-lg text-[10px] font-black uppercase text-(--text-secondary) bg-(--surface)">
              No cloud
            </span>
            <span className="px-3 py-1 border-2 border-(--border) rounded-lg text-[10px] font-black uppercase text-(--text-secondary) bg-(--surface)">
              No carbon
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

