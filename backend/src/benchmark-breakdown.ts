/**
 * Operation Breakdown Benchmark Runner.
 *
 * Uses optimized `mergeBatchBenchmark` to process all ops at once,
 * then uses `mergeOperation` on a small sample per type for per-op timing.
 * This gives accurate per-type percentiles without O(n²) full-run overhead.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5, 4.6
 */

import path from "path";
import { getOperationType } from "./benchmark-workloads.js";
import { getCachedBalancedWorkload } from "./benchmark-workload-cache.js";
import { MemorySampler } from "./memory-sampler.js";

// Load the native merge addon
const nativeMergePath = path.join(__dirname, "..", "native-merge", "native-merge.node");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMerge = require(nativeMergePath) as {
  mergeBatchBenchmark: (state: Buffer, operations: Buffer[]) => Buffer;
  mergeOperation: (state: Buffer, operation: Buffer) => Buffer;
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface OperationTypeMetrics {
  count: number;
  totalMs: number;
  averageMs: number;
  p50Ms: number;
  p99Ms: number;
}

export interface BreakdownBenchmarkResponse {
  mode: "breakdown";
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
  add: OperationTypeMetrics;
  update: OperationTypeMetrics;
  remove: OperationTypeMetrics;
}

export interface BreakdownBenchmarkError {
  error: string;
  mode: "breakdown";
  details?: string;
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

const MIN_OPS_PER_TYPE = 10;

/**
 * Runs the operation breakdown benchmark.
 *
 * Strategy: Run mergeBatchBenchmark on all ops for the overall timing,
 * then run mergeOperation individually on a representative sample
 * (up to 1000 per type) to get accurate per-type percentiles.
 */
export function runBreakdownBenchmark(
  ops: number,
  batchSize: number
): BreakdownBenchmarkResponse | BreakdownBenchmarkError {
  const allOperations = getCachedBalancedWorkload(ops);

  // Classify operations by type
  const addOps: Buffer[] = [];
  const updateOps: Buffer[] = [];
  const removeOps: Buffer[] = [];

  for (const buf of allOperations) {
    const t = getOperationType(buf);
    if (t === "add") addOps.push(buf);
    else if (t === "update") updateOps.push(buf);
    else removeOps.push(buf);
  }

  // Validate minimum per type (Requirement 4.5)
  if (addOps.length < MIN_OPS_PER_TYPE) {
    return { error: "Insufficient operations for meaningful per-type measurement", mode: "breakdown", details: `'add' has ${addOps.length}, min is ${MIN_OPS_PER_TYPE}` };
  }
  if (updateOps.length < MIN_OPS_PER_TYPE) {
    return { error: "Insufficient operations for meaningful per-type measurement", mode: "breakdown", details: `'update' has ${updateOps.length}, min is ${MIN_OPS_PER_TYPE}` };
  }
  if (removeOps.length < MIN_OPS_PER_TYPE) {
    return { error: "Insufficient operations for meaningful per-type measurement", mode: "breakdown", details: `'remove' has ${removeOps.length}, min is ${MIN_OPS_PER_TYPE}` };
  }

  // Initialize state
  const initialState = Buffer.from(JSON.stringify({
    sessionId: "benchmark-breakdown",
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "benchmark-breakdown" },
  }));

  const memorySampler = new MemorySampler();
  memorySampler.recordBaseline();

  // Phase 1: Overall timing with optimized batch
  const overallStart = process.hrtime.bigint();
  nativeMerge.mergeBatchBenchmark(initialState, allOperations);
  const overallEnd = process.hrtime.bigint();

  memorySampler.sample();

  const elapsedMs = Number(overallEnd - overallStart) / 1_000_000;

  // Phase 2: Per-type timing with individual mergeOperation calls
  // Use a sample of up to 500 per type for percentile accuracy
  const sampleSize = Math.min(500, Math.min(addOps.length, updateOps.length, removeOps.length));

  const addTimings = timeOperations(initialState, addOps.slice(0, sampleSize));
  const updateTimings = timeOperations(initialState, updateOps.slice(0, sampleSize));
  const removeTimings = timeOperations(initialState, removeOps.slice(0, sampleSize));

  // Scale timing metrics to represent full counts
  const add = buildTypeMetrics(addOps.length, addTimings);
  const update = buildTypeMetrics(updateOps.length, updateTimings);
  const remove = buildTypeMetrics(removeOps.length, removeTimings);

  // Overall percentiles from combined samples
  const allTimings = [...addTimings, ...updateTimings, ...removeTimings].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const p50Ms = percentileMs(allTimings, 0.5);
  const p99Ms = percentileMs(allTimings, 0.99);

  const memoryResults = memorySampler.getResults();

  const response: BreakdownBenchmarkResponse = {
    mode: "breakdown",
    totalOps: ops,
    elapsedMs,
    opsPerSecond: ops / (elapsedMs / 1000),
    p50Ms,
    p99Ms,
    batchesProcessed: 1,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
    memoryPeakMb: memoryResults.memoryPeakMb,
    memoryDeltaMb: memoryResults.memoryDeltaMb,
    add,
    update,
    remove,
  };

  if (memoryResults.memoryError) {
    response.memoryError = memoryResults.memoryError;
  }

  return response;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Time individual operations against a fresh state, return ns durations */
function timeOperations(baseState: Buffer, ops: Buffer[]): bigint[] {
  const durations: bigint[] = new Array(ops.length);
  let state = baseState;

  for (let i = 0; i < ops.length; i++) {
    const start = process.hrtime.bigint();
    const result = nativeMerge.mergeOperation(state, ops[i]);
    const end = process.hrtime.bigint();
    durations[i] = end - start;

    // Extract state for next op (fast substring extraction)
    const resultStr = result.toString();
    const stateIdx = resultStr.lastIndexOf('"state":');
    if (stateIdx !== -1) {
      state = Buffer.from(resultStr.substring(stateIdx + 8, resultStr.length - 1));
    } else {
      state = result;
    }
  }

  return durations;
}

/** Build OperationTypeMetrics from sample timings, using actual total count */
function buildTypeMetrics(totalCount: number, sampleTimings: bigint[]): OperationTypeMetrics {
  if (sampleTimings.length === 0) {
    return { count: totalCount, totalMs: 0, averageMs: 0, p50Ms: 0, p99Ms: 0 };
  }

  const sorted = [...sampleTimings].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sampleTotalNs = sampleTimings.reduce((sum, d) => sum + d, BigInt(0));
  const sampleAvgMs = Number(sampleTotalNs) / sampleTimings.length / 1_000_000;

  // Extrapolate totalMs from sample average × full count
  const totalMs = sampleAvgMs * totalCount;
  const averageMs = sampleAvgMs;
  const p50Ms = percentileMs(sorted, 0.5);
  const p99Ms = percentileMs(sorted, 0.99);

  return { count: totalCount, totalMs, averageMs, p50Ms, p99Ms };
}

function percentileMs(sortedNs: bigint[], p: number): number {
  if (sortedNs.length === 0) return 0;
  const idx = Math.max(0, Math.min(Math.ceil(p * sortedNs.length) - 1, sortedNs.length - 1));
  return Number(sortedNs[idx]) / 1_000_000;
}
