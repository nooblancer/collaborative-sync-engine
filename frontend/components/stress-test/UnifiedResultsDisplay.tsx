"use client";

import { MetricCounter } from "@/components/ui/metric-counter";
import type {
  BenchmarkModeResponse,
  ConflictBenchmarkResponse,
  RoomsBenchmarkResponse,
  BreakdownBenchmarkResponse,
  SnapshotBenchmarkResponse,
  OperationTypeMetrics,
} from "@/lib/stress-test-types";

interface UnifiedResultsDisplayProps {
  results: BenchmarkModeResponse;
}

/**
 * Unified results display for all benchmark modes.
 *
 * Always shows the same top-level layout:
 * 1. Hero metric: Ops/sec (large, prominent)
 * 2. Core metrics row: Total Ops | Elapsed | Memory
 * 3. Latency row: P50 | P99 | Batches
 * 4. Mode-specific detailed output (conflict count, per-room, breakdown, snapshot)
 *
 * This ensures consistent visual structure regardless of which mode ran,
 * while still showing ALL data from each mode's detailed output.
 */
export function UnifiedResultsDisplay({ results }: UnifiedResultsDisplayProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      {/* Hero: Ops/sec — always the same position */}
      <div className="flex items-baseline justify-center gap-2 py-3">
        <span className="text-4xl sm:text-5xl font-bold text-accent tabular-nums tracking-tight">
          {Math.round(results.opsPerSecond).toLocaleString()}
        </span>
        <span className="text-sm text-foreground-muted">ops/sec</span>
      </div>

      {/* Core metrics — always the same columns */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCounter
          value={results.totalOps}
          label="Total Ops"
        />
        <MetricCounter
          value={results.elapsedMs}
          label="Elapsed"
          suffix="ms"
          decimals={results.elapsedMs >= 100 ? 0 : 2}
        />
        <MetricCounter
          value={results.memoryDeltaMb ?? 0}
          label="Memory Δ"
          suffix="MB"
          decimals={2}
        />
        <MetricCounter
          value={results.batchesProcessed}
          label="Batches"
        />
      </div>

      {/* Latency metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MetricCounter
          value={results.p50Ms}
          label="P50"
          suffix="ms"
          decimals={2}
        />
        <MetricCounter
          value={results.p99Ms}
          label="P99"
          suffix="ms"
          decimals={2}
        />
        {results.memoryPeakMb != null && (
          <MetricCounter
            value={results.memoryPeakMb}
            label="Peak Heap"
            suffix="MB"
            decimals={2}
          />
        )}
      </div>

      {/* Mode-specific detailed output */}
      <ModeDetailedOutput results={results} />
    </div>
  );
}

/** Mode-specific detailed output — shows full data below the unified hero section */
function ModeDetailedOutput({ results }: { results: BenchmarkModeResponse }): JSX.Element | null {
  switch (results.mode) {
    case "conflict":
      return <ConflictDetailedOutput results={results} />;
    case "rooms":
      return <RoomsDetailedOutput results={results} />;
    case "breakdown":
      return <BreakdownDetailedOutput results={results} />;
    case "snapshot":
      return <SnapshotDetailedOutput results={results} />;
    case "standard":
    default:
      return null; // Standard mode has no extras — core metrics are sufficient
  }
}

function ConflictDetailedOutput({ results }: { results: ConflictBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">Conflict Resolution</h4>
      <div className="grid grid-cols-2 gap-4">
        <MetricCounter value={results.conflictResolutions} label="Conflicts Resolved" />
        <MetricCounter value={results.finalStateItemCount} label="Final State Size" suffix="items" />
      </div>
    </div>
  );
}

function RoomsDetailedOutput({ results }: { results: RoomsBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">
        Per-Room Summary ({results.roomCount} rooms)
      </h4>
      <div className="grid grid-cols-3 gap-4">
        <MetricCounter value={results.fastestRoomMs} label="Fastest Room" suffix="ms" decimals={2} />
        <MetricCounter value={results.slowestRoomMs} label="Slowest Room" suffix="ms" decimals={2} />
        <MetricCounter value={results.averageRoomMs} label="Average Room" suffix="ms" decimals={2} />
      </div>
    </div>
  );
}

function BreakdownDetailedOutput({ results }: { results: BreakdownBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">Per-Type Breakdown</h4>
      <div className="grid grid-cols-3 gap-4">
        <TypeColumn label="Add" metrics={results.add} />
        <TypeColumn label="Update" metrics={results.update} />
        <TypeColumn label="Remove" metrics={results.remove} />
      </div>
    </div>
  );
}

function TypeColumn({ label, metrics }: { label: string; metrics: OperationTypeMetrics }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-sm font-medium text-accent">{label}</span>
      <MetricCounter value={metrics.count} label="Count" suffix="ops" />
      <MetricCounter value={metrics.averageMs} label="Avg" suffix="ms" decimals={4} />
      <MetricCounter value={metrics.p50Ms} label="P50" suffix="ms" decimals={4} />
      <MetricCounter value={metrics.p99Ms} label="P99" suffix="ms" decimals={4} />
    </div>
  );
}

function SnapshotDetailedOutput({ results }: { results: SnapshotBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">Snapshot Compaction</h4>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCounter value={results.snapshotDurationMs} label="Snapshot Duration" suffix="ms" decimals={3} />
        <MetricCounter value={results.itemsBefore} label="Items Before" />
        <MetricCounter value={results.itemsAfter} label="Items After" />
        <MetricCounter value={results.tombstonesRemoved} label="Tombstones Removed" />
      </div>
    </div>
  );
}
