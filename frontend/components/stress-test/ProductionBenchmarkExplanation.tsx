"use client";

import { GlassCard } from "@/components/ui/glass-card";

export function ProductionBenchmarkExplanation(): JSX.Element {
  return (
    <GlassCard variant="subtle" padding="default">
      <h2 className="text-lg font-semibold text-foreground mb-4">
        Three Benchmarks, Three Perspectives
      </h2>

      <div className="space-y-4">
        <section>
          <h3 className="text-sm font-medium text-accent mb-1">
            Pure Merge Speed (Server Benchmark — Standard)
          </h3>
          <p className="text-sm text-foreground-muted leading-relaxed">
            Measures raw Rust merge engine throughput. Operations are processed in a tight loop with no WebSocket, no network, no delta tracking. This is the theoretical ceiling: 345K+ ops/sec for conflict workloads.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium text-accent mb-1">
            Production Throughput (Server Benchmark — Conflict/Rooms/Snapshot)
          </h3>
          <p className="text-sm text-foreground-muted leading-relaxed">
            Measures the production-ready path: Rust-owned room state + full delta change tracking for real-time broadcast. State lives in Rust memory (never serialized between batches), but each operation's changes are recorded for broadcasting to connected clients. This is what actually runs in production: 226K+ ops/sec. The 35% difference from pure merge is the cost of knowing WHAT changed — necessary for real-time sync.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium text-accent mb-1">
            Browser → Server Round-Trip (Browser Benchmark)
          </h3>
          <p className="text-sm text-foreground-muted leading-relaxed">
            Measures the complete pipeline: JSON serialize in browser → WebSocket send → server receive → parse → Rust merge → persist → ACK → WebSocket send → browser receive. Includes network latency, serialization cost, and server processing. This is what users experience.
          </p>
        </section>
      </div>

      <p className="text-xs text-foreground-dim mt-4 pt-3 border-t border-border/50">
        All three measurements are valid. They answer different questions: &ldquo;How fast is the engine?&rdquo; vs &ldquo;How fast is production?&rdquo; vs &ldquo;How fast does the user experience it?&rdquo;
      </p>
    </GlassCard>
  );
}
