'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export default function Header() {
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('filedrop-theme');
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('filedrop-theme', next ? 'dark' : 'light');
  };

  const navLinks = [
    { href: '/', label: 'Transfer' },
    { href: '/about', label: 'About' },
    { href: '/faq', label: 'FAQ' },
    { href: '/privacy', label: 'Privacy' },
  ];

  return (
    <header className="w-full border-b-4 border-(--border) bg-(--surface) sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-10 h-10 rounded-xl bg-(--accent-yellow) border-2 border-(--border) flex items-center justify-center shadow-[2px_2px_0px_0px_var(--shadow)] group-hover:shadow-[4px_4px_0px_0px_var(--shadow)] group-hover:-translate-y-0.5 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-(--text)">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />
            </svg>
          </div>
          <span className="text-2xl font-black tracking-tighter uppercase text-(--text)">FILEDROP</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2 text-(--text-secondary) font-bold text-sm uppercase tracking-wider hover:text-(--text) hover:bg-(--card-hover) rounded-xl transition-all"
            >
              {link.label}
            </Link>
          ))}
          <button
            onClick={toggleTheme}
            className="ml-2 w-10 h-10 flex items-center justify-center rounded-xl border-2 border-(--border) bg-(--surface) hover:bg-(--card-hover) transition-all shadow-[2px_2px_0px_0px_var(--shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            aria-label="Toggle dark mode"
          >
            {dark ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-(--accent-yellow)"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-(--text)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
        </nav>

        {/* Mobile Menu Button */}
        <div className="flex md:hidden items-center gap-2">
          <button onClick={toggleTheme} className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-(--border) bg-(--surface)" aria-label="Toggle dark mode">
            {dark ? '☀️' : '🌙'}
          </button>
          <button onClick={() => setMenuOpen(!menuOpen)} className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-(--border) bg-(--surface)" aria-label="Menu">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-(--text)">
              {menuOpen ? <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></> : <><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></>}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Dropdown */}
      {menuOpen && (
        <nav className="md:hidden border-t-2 border-(--border) bg-(--surface) px-4 py-3 space-y-1">
          {navLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-3 text-(--text) font-bold text-sm uppercase tracking-wider hover:bg-(--card-hover) rounded-xl transition-all"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

