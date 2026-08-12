"use client";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRoomId } from "@/hooks/use-room-id";
import Navbar from "@/components/landing/navbar";
import { ServerBenchmarkSection } from "@/components/stress-test/ServerBenchmarkSection";
import { ProductionBenchmarkSection } from "@/components/stress-test/ProductionBenchmarkSection";
import { BrowserBenchmarkSection } from "@/components/stress-test/BrowserBenchmarkSection";

function LoadingSkeleton(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-foreground-muted text-sm">
        Loading stress test…
      </div>
    </div>
  );
}

function StressTestContent(): JSX.Element {
  const { roomId } = useRoomId({ prefix: "stress-test" });

  return (
    <main
      className="min-h-screen pt-28 pb-16 px-4 sm:px-6 lg:px-8"
      style={{
        background: "linear-gradient(to bottom, #050510, #0a0a1a)",
      }}
    >
      <div className="mx-auto max-w-7xl">
        {/* Page title */}
        <div className="mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Convergence
          </Link>

          <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            Performance Benchmarks
          </h1>
          <p className="text-foreground-muted mt-2 max-w-2xl">
            Measure the Convergence CRDT engine at three levels of the stack.
          </p>
        </div>

        {/* Three Benchmarks, Three Perspectives */}
        <div className="mb-12 rounded-xl border border-border/40 bg-background-surface/30 backdrop-blur-sm p-6 sm:p-8">
          <h2 className="text-base font-semibold text-foreground mb-5 tracking-tight">
            Three Benchmarks, Three Perspectives
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_6px_rgba(0,255,255,0.5)]" />
                <span className="text-sm font-medium text-foreground">Engine</span>
              </div>
              <p className="text-sm text-foreground-muted leading-relaxed pl-4">
                Raw Rust merge throughput in a tight loop. No WebSocket, no delta tracking,
                no serialization overhead. The theoretical ceiling of the merge engine.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                <span className="text-sm font-medium text-foreground">Production</span>
              </div>
              <p className="text-sm text-foreground-muted leading-relaxed pl-4">
                Rust-owned room state with full delta change tracking for real-time broadcast.
                This is what actually runs in production — slightly lower numbers, but broadcast-ready.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
                <span className="text-sm font-medium text-foreground">Browser</span>
              </div>
              <p className="text-sm text-foreground-muted leading-relaxed pl-4">
                Complete round-trip: JSON serialize → WebSocket → server merge → persist → ACK → receive.
                What users actually experience end-to-end.
              </p>
            </div>
          </div>

          <p className="text-xs text-foreground-muted/70 mt-5 pt-4 border-t border-border/30">
            All three measurements are valid. They answer different questions:
            "How fast is the engine?" vs "How fast is production?" vs "How fast does the user experience it?"
          </p>
        </div>

        {/* Benchmark sections */}
        <div className="flex flex-col gap-10">
          <ServerBenchmarkSection />
          <ProductionBenchmarkSection />
          <BrowserBenchmarkSection roomId={roomId} />
        </div>
      </div>
    </main>
  );
}

export default function StressTestPage(): JSX.Element {
  return (
    <>
      <Navbar />
      <Suspense fallback={<LoadingSkeleton />}>
        <StressTestContent />
      </Suspense>
    </>
  );
}
