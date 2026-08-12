/**
 * Snapshot/Compaction Cost Benchmark Runner.
 *
 * Uses optimized `mergeBatchBenchmark` to accumulate state in O(n),
 * then measures the cost of `computeSnapshot`.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8
 */

import path from "path";
import { MemorySampler } from "./memory-sampler.js";
import { getCachedSnapshotWorkload } from "./benchmark-workload-cache.js";

// Load the native merge addon
const nativeMergePath = path.join(__dirname, "..", "native-merge", "native-merge.node");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMerge = require(nativeMergePath) as {
  mergeBatchBenchmark: (state: Buffer, operations: Buffer[]) => Buffer;
  computeSnapshot: (state: Buffer) => Buffer;
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SnapshotBenchmarkResponse {
  mode: "snapshot";
  totalOps: number;
  elapsedMs: number;
  opsPerSecond: number;
  p50Ms: number;
  p99Ms: number;
  batchesProcessed: number;
  mergeEngine: "rust-napi-rs";
  timestamp: string;
  memoryPeakMb: number | null;
  memoryDeltaMb: number | null;
  memoryError?: string;
  snapshotDurationMs: number;
  itemsBefore: number;
  itemsAfter: number;
  tombstonesRemoved: number;
}

export interface SnapshotBenchmarkError {
  error: string;
  mode: "snapshot";
  itemsBefore?: number;
  tombstoneCount?: number;
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

/**
 * Runs the snapshot/compaction cost benchmark.
 *
 * 1. Applies all operations via optimized `mergeBatchBenchmark` (O(n), no cloning)
 * 2. Extracts itemCount from the result
 * 3. Calls `computeSnapshot` on the accumulated state and measures duration
 * 4. Returns snapshot metrics alongside throughput metrics
 */
export function runSnapshotBenchmark(
  ops: number
): SnapshotBenchmarkResponse | SnapshotBenchmarkError {
  // Get cached snapshot workload with ≥20% removes
  const allOperations = getCachedSnapshotWorkload(ops);

  // Initialize empty CRDT state
  const initialState = Buffer.from(JSON.stringify({
    sessionId: "benchmark-snapshot",
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "benchmark-snapshot" },
  }));

  // Memory sampling
  const memorySampler = new MemorySampler();
  memorySampler.recordBaseline();

  // Phase 1: Apply all operations in one optimized Rust call
  const overallStart = process.hrtime.bigint();
  const mergeResultBuffer = nativeMerge.mergeBatchBenchmark(initialState, allOperations);
  const mergeEnd = process.hrtime.bigint();

  memorySampler.sample();

  const elapsedMs = Number(mergeEnd - overallStart) / 1_000_000;

  // Parse lightweight result to get itemCount and state
  const mergeResult = JSON.parse(mergeResultBuffer.toString()) as {
    totalReceived: number;
    merged: number;
    conflicts: number;
    failed: number;
    itemCount: number;
    state: unknown;
  };

  const itemsBefore = mergeResult.itemCount;

  // Extract just the state for computeSnapshot
  const stateBuffer = Buffer.from(JSON.stringify(mergeResult.state));

  // Phase 2: Measure computeSnapshot duration
  let snapshotDurationMs: number;
  let itemsAfter: number;

  try {
    const snapshotStart = process.hrtime.bigint();
    const snapshotResult = nativeMerge.computeSnapshot(stateBuffer);
    const snapshotEnd = process.hrtime.bigint();

    const snapshotDurationNs = snapshotEnd - snapshotStart;
    snapshotDurationMs = Math.round(Number(snapshotDurationNs) / 1_000) / 1_000;

    // Parse snapshot result to count live items
    const snapshotState = JSON.parse(snapshotResult.toString()) as {
      items: Record<string, unknown>;
    };
    itemsAfter = Object.keys(snapshotState.items).length;

    memorySampler.sample();
  } catch (err: unknown) {
    return {
      error: `Snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      mode: "snapshot",
      itemsBefore,
      tombstoneCount: itemsBefore,
    };
  }

  const tombstonesRemoved = itemsBefore - itemsAfter;

  // Get memory results
  const memoryResults = memorySampler.getResults();

  const response: SnapshotBenchmarkResponse = {
    mode: "snapshot",
    totalOps: ops,
    elapsedMs,
    opsPerSecond: ops / (elapsedMs / 1000),
    p50Ms: elapsedMs,
    p99Ms: elapsedMs,
    batchesProcessed: 1,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
    memoryPeakMb: memoryResults.memoryPeakMb,
    memoryDeltaMb: memoryResults.memoryDeltaMb,
    snapshotDurationMs,
    itemsBefore,
    itemsAfter,
    tombstonesRemoved,
  };

  if (memoryResults.memoryError) {
    response.memoryError = memoryResults.memoryError;
  }

  return response;
}
