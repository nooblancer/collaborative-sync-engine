"use client";

import { MetricCounter } from "@/components/ui/metric-counter";
import type {
  BreakdownBenchmarkResponse,
  OperationTypeMetrics,
} from "@/lib/stress-test-types";

interface BreakdownResultsDisplayProps {
  results: BreakdownBenchmarkResponse;
}

function TypeColumn({
  label,
  metrics,
}: {
  label: string;
  metrics: OperationTypeMetrics;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-sm font-medium text-accent">{label}</span>
      <MetricCounter value={metrics.count} label="Count" suffix="ops" />
      <MetricCounter value={metrics.averageMs} label="Avg" suffix="ms" decimals={3} />
      <MetricCounter value={metrics.p50Ms} label="P50" suffix="ms" decimals={3} />
      <MetricCounter value={metrics.p99Ms} label="P99" suffix="ms" decimals={3} />
    </div>
  );
}

export function BreakdownResultsDisplay({
  results,
}: BreakdownResultsDisplayProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <h3 className="text-sm font-medium text-accent">
        Operation Breakdown Results
      </h3>

      {/* Aggregate metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MetricCounter
          value={results.totalOps}
          label="Total Ops"
          suffix="ops"
        />
        <MetricCounter
          value={results.elapsedMs}
          label="Elapsed"
          suffix="ms"
          decimals={results.elapsedMs >= 1000 ? 2 : 0}
        />
        <MetricCounter
          value={results.opsPerSecond}
          label="Ops/sec"
          suffix="ops/s"
        />
      </div>

      {/* Per-type comparative columns */}
      <div className="border-t border-border/50 pt-4">
        <h4 className="text-xs font-medium text-foreground-muted mb-3">
          Per-Type Timing Comparison
        </h4>
        <div className="grid grid-cols-3 gap-4">
          <TypeColumn label="Add" metrics={results.add} />
          <TypeColumn label="Update" metrics={results.update} />
          <TypeColumn label="Remove" metrics={results.remove} />
        </div>
      </div>

      {results.memoryPeakMb != null && results.memoryDeltaMb != null && (
        <div className="border-t border-border/50 pt-4">
          <h4 className="text-xs font-medium text-foreground-muted mb-3">
            Memory Usage
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <MetricCounter
              value={results.memoryPeakMb}
              label="Peak Heap"
              suffix="MB"
              decimals={2}
            />
            <MetricCounter
              value={results.memoryDeltaMb}
              label="Memory Delta"
              suffix="MB"
              decimals={2}
            />
          </div>
        </div>
      )}
    </div>
  );
}
