"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Github, Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const sectionLinks = [
  { href: "#architecture", label: "Architecture" },
  { href: "#features", label: "Features" },
  { href: "#demos", label: "Demos" },
  { href: "#tech-stack", label: "Tech Stack" },
  { href: "/blog", label: "Blog" },
];

export default function Navbar() {
  const pathname = usePathname();
  const isStressTest = pathname === "/stress-test";
  const isWhiteboard = pathname === "/whiteboard";
  const showShareButton = isStressTest || isWhiteboard;
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    // On whiteboard: start collaboration first if not already in a room
    if (isWhiteboard && typeof window !== "undefined" && (window as any).__whiteboardStartCollab) {
      (window as any).__whiteboardStartCollab();
      // Small delay to let URL update
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [isWhiteboard]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold text-foreground">
          Convergence
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {sectionLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/nooblancer/collaborative-sync-engine"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="h-5 w-5" />
          </a>
          {showShareButton ? (
            <button
              onClick={() => void handleShare()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-background border border-accent shadow-[0_0_12px_rgba(0,255,255,0.3)] hover:bg-background-surface hover:text-foreground-muted hover:border-border hover:shadow-none transition-all duration-200"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </>
              )}
            </button>
          ) : (
            <Link href="#demos">
              <Button size="sm">Launch Demo</Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
