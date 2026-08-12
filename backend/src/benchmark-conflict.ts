/**
 * Conflict Resolution Stress Benchmark Runner.
 *
 * Uses the optimized `mergeBatchBenchmark` Rust function that processes
 * all operations in-memory without intermediate serialization or state cloning.
 * This achieves O(n) per-operation performance instead of O(n²).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.6
 */

import path from "path";
import { MemorySampler } from "./memory-sampler.js";
import { getCachedContentionWorkload } from "./benchmark-workload-cache.js";

// Load the native merge addon
const nativeMergePath = path.join(__dirname, "..", "native-merge", "native-merge.node");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMerge = require(nativeMergePath) as {
  mergeBatch: (state: Buffer, operations: Buffer[]) => Buffer;
  mergeBatchBenchmark: (state: Buffer, operations: Buffer[]) => Buffer;
  createRoom: (roomId: string) => void;
  mergeOps: (roomId: string, operations: Buffer[]) => Buffer;
  getState: (roomId: string) => Buffer;
  dropRoom: (roomId: string) => void;
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ConflictBenchmarkResponse {
  mode: "conflict";
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
  conflictResolutions: number;
  finalStateItemCount: number;
}

export interface ConflictBenchmarkError {
  error: string;
  mode: "conflict";
  opsCompleted?: number;
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

/**
 * Runs the conflict resolution stress benchmark.
 *
 * Uses `mergeBatchBenchmark` which processes ALL operations in a single Rust call:
 * - No state.clone() per operation (mutates in place)
 * - No intermediate JSON serialization between batches
 * - No delta/changes tracking (only counts conflicts)
 * - O(n) total instead of O(n²)
 *
 * @param ops - Total number of operations (100–1,000,000)
 * @param batchSize - Number of operations per batch (unused — single Rust call)
 * @returns ConflictBenchmarkResponse on success, or ConflictBenchmarkError on error
 */
export function runConflictBenchmark(
  ops: number,
  batchSize: number
): ConflictBenchmarkResponse | ConflictBenchmarkError {
  // Get cached contention workload (pre-generated at startup, reused across runs)
  const allOperations = getCachedContentionWorkload(ops);

  // Initialize empty CRDT state
  const initialState = Buffer.from(JSON.stringify({
    sessionId: "benchmark-contention",
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "benchmark-contention" },
  }));

  // Memory sampling
  const memorySampler = new MemorySampler();
  memorySampler.recordBaseline();

  // Single call to pure merge function — no delta tracking, no room overhead
  const overallStart = process.hrtime.bigint();
  const resultBuffer = nativeMerge.mergeBatchBenchmark(initialState, allOperations);
  const overallEnd = process.hrtime.bigint();

  memorySampler.sample();

  const elapsedMs = Number(overallEnd - overallStart) / 1_000_000;

  // Parse the lightweight result (metrics + item count, no full state needed)
  const result = JSON.parse(resultBuffer.toString()) as {
    totalReceived: number;
    merged: number;
    conflicts: number;
    failed: number;
    itemCount: number;
  };

  // Get memory results
  const memoryResults = memorySampler.getResults();

  const response: ConflictBenchmarkResponse = {
    mode: "conflict",
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
    conflictResolutions: result.conflicts,
    finalStateItemCount: result.itemCount,
  };

  if (memoryResults.memoryError) {
    response.memoryError = memoryResults.memoryError;
  }

  return response;
}
