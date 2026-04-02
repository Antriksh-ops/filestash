import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "../components/Header";
import Footer from "../components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FILEDROP | Unlimited P2P File Sharing - Private, Fast & Safe",
  description: "Share large files of any size directly from your device to anywhere. Peer-to-peer, end-to-end encrypted, and no cloud storage required. The best ToffeeShare alternative.",
  keywords: ["file sharing", "p2p file transfer", "share large files", "no limit file sharing", "secure file transfer", "browser file sharing"],
  authors: [{ name: "Antriksh" }],
  openGraph: {
    title: "FILEDROP | Unlimited P2P File Sharing",
    description: "Fast, private, and unlimited file sharing directly between devices.",
    url: "https://filestash-web.vercel.app",
    siteName: "FILEDROP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FILEDROP | Unlimited P2P File Sharing",
    description: "Fast, private, and unlimited file sharing directly between devices.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent FOUC: apply dark mode before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('filedrop-theme');
                  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "FILEDROP",
              "operatingSystem": "Web Browser",
              "applicationCategory": "Utility",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "description": "Unlimited P2P file sharing directly from browser to browser."
            })
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
      >
        <Header />
        <div className="flex-1">
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
