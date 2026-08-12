"use client";

import { useEffect, useState } from "react";

interface BenchmarkRunningIndicatorProps {
  ops: number;
  mode: string;
}

/**
 * Displays a pulsing animation, status text, and elapsed time counter
 * while a benchmark is running. Used by both Engine and Production sections.
 */
export function BenchmarkRunningIndicator({ ops, mode }: BenchmarkRunningIndicatorProps): JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      {/* Pulsing bar animation — uses Tailwind animate-pulse on a sliding gradient */}
      <div className="w-full max-w-xs h-1.5 rounded-full bg-background-surface border border-border overflow-hidden relative">
        <div
          className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-accent/40 via-accent to-accent/40 animate-bounce-x"
          style={{
            animation: "slide-x 1.5s ease-in-out infinite",
          }}
        />
      </div>

      {/* Inline keyframes for the sliding animation */}
      <style>{`
        @keyframes slide-x {
          0%, 100% { left: -10%; }
          50% { left: 77%; }
        }
      `}</style>

      {/* Status text */}
      <p className="text-sm text-foreground-muted font-mono">
        Processing {ops.toLocaleString()} operations in {mode} mode…
      </p>

      {/* Elapsed timer */}
      <span className="text-xs text-foreground-muted/70 font-mono tabular-nums">
        Elapsed: {formatElapsed(elapsed)}
      </span>
    </div>
  );
}
