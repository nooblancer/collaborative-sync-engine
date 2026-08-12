"use client";

import { MetricCounter } from "@/components/ui/metric-counter";
import type { SnapshotBenchmarkResponse } from "@/lib/stress-test-types";

interface SnapshotResultsDisplayProps {
  results: SnapshotBenchmarkResponse;
}

export function SnapshotResultsDisplay({
  results,
}: SnapshotResultsDisplayProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <h3 className="text-sm font-medium text-accent">
        Snapshot/Compaction Results
      </h3>

      {/* Operation application metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MetricCounter
          value={results.totalOps}
          label="Total Ops"
          suffix="ops"
        />
        <MetricCounter
          value={results.elapsedMs}
          label="Ops Elapsed"
          suffix="ms"
          decimals={results.elapsedMs >= 1000 ? 2 : 0}
        />
        <MetricCounter
          value={results.opsPerSecond}
          label="Ops/sec"
          suffix="ops/s"
        />
      </div>

      {/* Snapshot-specific metrics */}
      <div className="border-t border-border/50 pt-4">
        <h4 className="text-xs font-medium text-foreground-muted mb-3">
          Snapshot Metrics
        </h4>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCounter
            value={results.snapshotDurationMs}
            label="Snapshot Duration"
            suffix="ms"
            decimals={3}
          />
          <MetricCounter
            value={results.itemsBefore}
            label="Items Before"
          />
          <MetricCounter
            value={results.itemsAfter}
            label="Items After"
          />
          <MetricCounter
            value={results.tombstonesRemoved}
            label="Tombstones Removed"
          />
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
