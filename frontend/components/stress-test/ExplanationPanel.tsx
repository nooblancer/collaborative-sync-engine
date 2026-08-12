"use client";

import { GlassCard } from "@/components/ui/glass-card";

export function ExplanationPanel(): JSX.Element {
  return (
    <GlassCard variant="subtle" padding="default">
      <h2 className="text-lg font-semibold text-foreground mb-4">
        Why two benchmarks?
      </h2>

      <div className="space-y-4">
        <section>
          <h3 className="text-sm font-medium text-accent mb-1">
            Server Benchmark
          </h3>
          <p className="text-sm text-foreground-muted leading-relaxed">
            Measures raw Rust merge throughput. Operations are processed in a
            tight loop in the Rust/napi-rs addon with no WebSocket or network
            overhead — pure CRDT merge speed.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium text-accent mb-1">
            Browser Benchmark
          </h3>
          <p className="text-sm text-foreground-muted leading-relaxed">
            Measures the full round-trip pipeline: JSON serialize → network →
            parse → merge → ACK → network → parse. This captures real-world
            performance including serialization cost and network latency.
          </p>
        </section>
      </div>
    </GlassCard>
  );
}
