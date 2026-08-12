"use client";

import Link from "next/link";
import { ArrowLeft, Share2, Check } from "lucide-react";
import { GlowButton } from "@/components/ui/glow-button";

interface PageHeaderProps {
  onShare: () => Promise<void>;
  shareStatus: "idle" | "copied";
}

export function PageHeader({ onShare, shareStatus }: PageHeaderProps): JSX.Element {
  return (
    <header className="flex items-center justify-between gap-4 mb-8">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          aria-label="Back to home"
          className="flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          Stress Test Engine Benchmark
        </h1>
      </div>

      <div className="relative flex items-center gap-2">
        <GlowButton
          variant="secondary"
          size="sm"
          onClick={() => void onShare()}
          aria-label="Share stress test URL"
        >
          {shareStatus === "copied" ? (
            <>
              <Check className="h-4 w-4 text-green-400" />
              <span className="hidden sm:inline">Share</span>
            </>
          ) : (
            <>
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Share</span>
            </>
          )}
        </GlowButton>

        <span aria-live="polite" className="text-sm text-green-400">
          {shareStatus === "copied" ? "Copied!" : ""}
        </span>
      </div>
    </header>
  );
}
