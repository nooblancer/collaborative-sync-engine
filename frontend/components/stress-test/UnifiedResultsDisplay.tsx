"use client";

import { MetricCounter } from "@/components/ui/metric-counter";
import type {
  BenchmarkModeResponse,
  ConflictBenchmarkResponse,
  RoomsBenchmarkResponse,
  BreakdownBenchmarkResponse,
  SnapshotBenchmarkResponse,
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
 * 3. Mode-specific extras (if any)
 * 
 * This ensures consistent visual structure regardless of which mode ran.
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

      {/* Core metrics — always the same 3 columns */}
      <div className="grid grid-cols-3 gap-4">
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
      </div>

      {/* Mode-specific extras */}
      <ModeExtras results={results} />
    </div>
  );
}

/** Mode-specific additional metrics, shown below the universal core */
function ModeExtras({ results }: { results: BenchmarkModeResponse }): JSX.Element | null {
  switch (results.mode) {
    case "conflict":
      return <ConflictExtras results={results} />;
    case "rooms":
      return <RoomsExtras results={results} />;
    case "breakdown":
      return <BreakdownExtras results={results} />;
    case "snapshot":
      return <SnapshotExtras results={results} />;
    case "standard":
    default:
      return null; // Standard mode has no extras — core metrics are enough
  }
}

function ConflictExtras({ results }: { results: ConflictBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">Conflict Resolution</h4>
      <div className="grid grid-cols-2 gap-4">
        <MetricCounter value={results.conflictResolutions} label="Conflicts Resolved" />
        <MetricCounter value={results.finalStateItemCount} label="Final Items" />
      </div>
    </div>
  );
}

function RoomsExtras({ results }: { results: RoomsBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">
        Room Performance ({results.roomCount} rooms)
      </h4>
      <div className="grid grid-cols-3 gap-4">
        <MetricCounter value={results.fastestRoomMs} label="Fastest" suffix="ms" decimals={1} />
        <MetricCounter value={results.slowestRoomMs} label="Slowest" suffix="ms" decimals={1} />
        <MetricCounter value={results.averageRoomMs} label="Average" suffix="ms" decimals={1} />
      </div>
    </div>
  );
}

function BreakdownExtras({ results }: { results: BreakdownBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">Per-Type Breakdown</h4>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-accent font-medium">Add</span>
          <span className="text-lg font-mono tabular-nums">{results.add.count.toLocaleString()}</span>
          <span className="text-[10px] text-foreground-muted">
            avg {results.add.averageMs.toFixed(4)}ms
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-accent font-medium">Update</span>
          <span className="text-lg font-mono tabular-nums">{results.update.count.toLocaleString()}</span>
          <span className="text-[10px] text-foreground-muted">
            avg {results.update.averageMs.toFixed(4)}ms
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-accent font-medium">Remove</span>
          <span className="text-lg font-mono tabular-nums">{results.remove.count.toLocaleString()}</span>
          <span className="text-[10px] text-foreground-muted">
            avg {results.remove.averageMs.toFixed(4)}ms
          </span>
        </div>
      </div>
    </div>
  );
}

function SnapshotExtras({ results }: { results: SnapshotBenchmarkResponse }): JSX.Element {
  return (
    <div className="border-t border-border/50 pt-4">
      <h4 className="text-xs font-medium text-foreground-muted mb-3">Snapshot Compaction</h4>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCounter value={results.snapshotDurationMs} label="Snapshot" suffix="ms" decimals={3} />
        <MetricCounter value={results.itemsBefore} label="Before" />
        <MetricCounter value={results.itemsAfter} label="After" />
        <MetricCounter value={results.tombstonesRemoved} label="Removed" />
      </div>
    </div>
  );
}
