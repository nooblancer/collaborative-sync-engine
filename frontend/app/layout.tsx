import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convergence — Real-Time Collaborative Sync Engine",
  description:
    "Portfolio-grade real-time collaboration engine demonstrating distributed systems engineering at scale. 50,000+ ops/sec with CRDT conflict resolution, fault tolerance, and sub-5ms latency.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
