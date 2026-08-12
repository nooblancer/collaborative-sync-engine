"use client";

import { MetricCounter } from "@/components/ui/metric-counter";
import type { RoomsBenchmarkResponse } from "@/lib/stress-test-types";

interface RoomsResultsDisplayProps {
  results: RoomsBenchmarkResponse;
}

export function RoomsResultsDisplay({
  results,
}: RoomsResultsDisplayProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <h3 className="text-sm font-medium text-accent">
        Concurrent Rooms Results
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
          label="Total Elapsed"
          suffix="ms"
          decimals={results.elapsedMs >= 1000 ? 2 : 0}
        />
        <MetricCounter
          value={results.opsPerSecond}
          label="Combined Ops/sec"
          suffix="ops/s"
        />
        <MetricCounter
          value={results.roomCount}
          label="Rooms"
        />
        <MetricCounter
          value={results.batchesProcessed}
          label="Batches"
        />
      </div>

      {/* Per-room summary */}
      <div className="border-t border-border/50 pt-4">
        <h4 className="text-xs font-medium text-foreground-muted mb-3">
          Per-Room Summary
        </h4>
        <div className="grid grid-cols-3 gap-4">
          <MetricCounter
            value={results.fastestRoomMs}
            label="Fastest Room"
            suffix="ms"
            decimals={2}
          />
          <MetricCounter
            value={results.slowestRoomMs}
            label="Slowest Room"
            suffix="ms"
            decimals={2}
          />
          <MetricCounter
            value={results.averageRoomMs}
            label="Average Room"
            suffix="ms"
            decimals={2}
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
