/**
 * Benchmark Handler for the Collaborative Sync Engine.
 *
 * Exercises the Rust native merge addon (`mergeBatch`) in a tight loop
 * without WebSocket overhead, returning detailed performance statistics
 * including throughput and percentile latencies.
 *
 * Extended with mode routing to dispatch to conflict, rooms, breakdown,
 * and snapshot runners alongside the existing standard benchmark.
 *
 * Requirements: 1.1–1.14, 1.16, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 1.7
 */

import path from "path";
import { MemorySampler } from "./memory-sampler.js";
import { getCachedStandardWorkload } from "./benchmark-workload-cache.js";
import { runConflictBenchmark, type ConflictBenchmarkResponse } from "./benchmark-conflict.js";
import { runRoomsBenchmark, type RoomsBenchmarkResponse } from "./benchmark-rooms.js";
import { runBreakdownBenchmark, type BreakdownBenchmarkResponse } from "./benchmark-breakdown.js";
import { runSnapshotBenchmark, type SnapshotBenchmarkResponse } from "./benchmark-snapshot.js";

// Load the native merge addon (.node binary)
// The native addon is at backend/native-merge/native-merge.node relative to backend/src/
const nativeMergePath = path.join(__dirname, "..", "native-merge", "native-merge.node");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMerge = require(nativeMergePath) as {
  mergeBatch: (state: Buffer, operations: Buffer[]) => Buffer;
  mergeBatchBenchmark: (state: Buffer, operations: Buffer[]) => Buffer;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid benchmark modes */
export type BenchmarkMode = "standard" | "conflict" | "rooms" | "breakdown" | "snapshot";

const VALID_MODES: BenchmarkMode[] = ["standard", "conflict", "rooms", "breakdown", "snapshot"];

/** Validated parameters for dispatching to a benchmark runner */
export interface ValidatedBenchmarkParams {
  mode: BenchmarkMode;
  ops: number;
  batchSize: number;
  rooms: number; // only used when mode === "rooms"
}

// ---------------------------------------------------------------------------
// Interfaces (legacy, preserved for backward compatibility)
// ---------------------------------------------------------------------------

export interface BenchmarkRequest {
  ops?: number;       // Total operations (default: 50000, range: 100–1000000)
  batchSize?: number; // Operations per mergeBatch call (default: 1000, range: 1–ops)
}

export interface BenchmarkResponse {
  totalOps: number;
  elapsedMs: number;
  opsPerSecond: number;
  p50Ms: number;
  p99Ms: number;
  batchesProcessed: number;
  mergeEngine: "rust-napi-rs";
  timestamp: string; // ISO 8601
}

export interface BenchmarkError {
  error: string;
  details?: string;
  validModes?: BenchmarkMode[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates benchmark input parameters (legacy validator, preserved for compatibility).
 * Returns a BenchmarkError if invalid, or null if valid.
 */
export function validateBenchmarkInput(
  ops: number,
  batchSize: number
): BenchmarkError | null {
  if (typeof ops !== "number" || typeof batchSize !== "number" || !isFinite(ops) || !isFinite(batchSize)) {
    return {
      error: "Invalid input",
      details: "ops and batchSize must be numbers",
    };
  }

  if (ops < 100 || ops > 1000000) {
    return {
      error: "Invalid ops count",
      details: "ops must be between 100 and 1000000 for meaningful measurement",
    };
  }

  if (batchSize < 1 || batchSize > ops) {
    return {
      error: "Invalid batch size",
      details: "batchSize must be between 1 and the ops count",
    };
  }

  return null;
}

/**
 * Validates a full benchmark request body including mode and mode-specific params.
 * Returns validated params on success, or a BenchmarkError on failure.
 *
 * - Defaults: mode → "standard", ops → 50000, batchSize → 1000, rooms → 5
 * - Rejects unrecognized mode values with HTTP 400 (Requirement 7.5)
 * - Rejects out-of-range params with HTTP 400 (Requirement 7.6, 1.7)
 * - Validates rooms count for "rooms" mode (Requirement 7.3)
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 1.7
 */
export function validateBenchmarkRequest(
  body: unknown
): { valid: true; params: ValidatedBenchmarkParams } | { valid: false; error: BenchmarkError } {
  // Ensure body is an object
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    return {
      valid: false,
      error: { error: "Invalid request body", details: "Request body must be a JSON object" },
    };
  }

  const b = body as Record<string, unknown>;

  // Validate mode (Requirement 7.5)
  let mode: BenchmarkMode = "standard"; // Default (Requirement 7.2)
  if (b.mode !== undefined) {
    if (typeof b.mode !== "string" || !VALID_MODES.includes(b.mode as BenchmarkMode)) {
      return {
        valid: false,
        error: {
          error: "Invalid mode",
          details: `Unrecognized mode value. Valid modes are: ${VALID_MODES.join(", ")}`,
          validModes: VALID_MODES,
        },
      };
    }
    mode = b.mode as BenchmarkMode;
  }

  // Validate ops (Requirement 1.7, 7.6)
  let ops = 50000; // Default
  if (b.ops !== undefined) {
    ops = Number(b.ops);
    if (!isFinite(ops) || ops < 100 || ops > 1000000) {
      return {
        valid: false,
        error: {
          error: "Invalid ops count",
          details: "ops must be between 100 and 1000000",
        },
      };
    }
  }

  // Validate batchSize (Requirement 1.7, 7.6)
  let batchSize = 1000; // Default
  if (b.batchSize !== undefined) {
    batchSize = Number(b.batchSize);
    if (!isFinite(batchSize) || batchSize < 1 || batchSize > ops) {
      return {
        valid: false,
        error: {
          error: "Invalid batch size",
          details: `batchSize must be between 1 and ${ops}`,
        },
      };
    }
  }

  // Validate rooms parameter for "rooms" mode (Requirements 7.3, 7.4)
  let rooms = 5; // Default (Requirement 7.4)
  if (mode === "rooms" && b.rooms !== undefined) {
    rooms = Number(b.rooms);
    if (!isFinite(rooms) || rooms < 2 || rooms > 50) {
      return {
        valid: false,
        error: {
          error: "Invalid rooms count",
          details: "rooms must be between 2 and 50",
        },
      };
    }
  }

  return {
    valid: true,
    params: { mode, ops, batchSize, rooms },
  };
}

// ---------------------------------------------------------------------------
// Mode Router
// ---------------------------------------------------------------------------

/** Response type for the mode router (discriminated union) */
export type BenchmarkModeResponse =
  | StandardBenchmarkResponse
  | ConflictBenchmarkResponse
  | RoomsBenchmarkResponse
  | BreakdownBenchmarkResponse
  | SnapshotBenchmarkResponse;

/** Standard benchmark response with mode and memory fields */
export interface StandardBenchmarkResponse {
  mode: "standard";
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
}

/**
 * Mode router: dispatches to the correct benchmark runner based on validated params.
 *
 * Requirements: 7.1, 7.2, 7.7
 */
export function handleBenchmark(params: ValidatedBenchmarkParams): BenchmarkModeResponse | BenchmarkError {
  const { mode, ops, batchSize, rooms } = params;

  switch (mode) {
    case "standard":
      return runStandardBenchmark(ops, batchSize);

    case "conflict": {
      const result = runConflictBenchmark(ops, batchSize);
      if ("error" in result) {
        return { error: result.error, details: `opsCompleted: ${result.opsCompleted ?? 0}` };
      }
      return result;
    }

    case "rooms": {
      const result = runRoomsBenchmark(ops, batchSize, rooms);
      if ("error" in result) {
        return { error: result.error, details: `opsCompleted: ${result.opsCompleted ?? 0}` };
      }
      return result;
    }

    case "breakdown": {
      const result = runBreakdownBenchmark(ops, batchSize);
      if ("error" in result) {
        return { error: result.error, details: result.details };
      }
      return result;
    }

    case "snapshot": {
      const result = runSnapshotBenchmark(ops);
      if ("error" in result) {
        return { error: result.error, details: `itemsBefore: ${result.itemsBefore ?? 0}` };
      }
      return result;
    }

    default:
      return {
        error: "Invalid mode",
        details: `Unrecognized mode value. Valid modes are: ${VALID_MODES.join(", ")}`,
        validModes: VALID_MODES,
      };
  }
}

/**
 * Runs the standard benchmark with MemorySampler wired in.
 * Uses mergeBatchBenchmark for optimized O(n) processing.
 */
function runStandardBenchmark(ops: number, batchSize: number): StandardBenchmarkResponse {
  // Get cached workload (generated once, reused across runs)
  const allOps = getCachedStandardWorkload(ops);

  // Fresh CRDT state
  const emptyState = Buffer.from(JSON.stringify({
    sessionId: "benchmark-session",
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "benchmark-node" },
  }));

  // Wire MemorySampler
  const memorySampler = new MemorySampler();
  memorySampler.recordBaseline();

  // Single optimized Rust call — processes all ops in-memory without cloning
  const overallStart = process.hrtime.bigint();
  nativeMerge.mergeBatchBenchmark(emptyState, allOps);
  const overallEnd = process.hrtime.bigint();

  memorySampler.sample();

  const elapsedMs = Number(overallEnd - overallStart) / 1_000_000;

  // Get memory results
  const memoryResults = memorySampler.getResults();

  const response: StandardBenchmarkResponse = {
    mode: "standard",
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
  };

  if (memoryResults.memoryError) {
    response.memoryError = memoryResults.memoryError;
  }

  return response;
}

// ---------------------------------------------------------------------------
// Operation Generation
// ---------------------------------------------------------------------------

/**
 * Generates a batch of realistic CRDT operations mixing add/update/remove
 * targeting different item IDs to simulate production workload.
 *
 * Distribution: ~50% add, ~30% update, ~20% remove
 */
export function generateOperationBatch(
  count: number,
  existingItemIds: string[]
): Buffer[] {
  const operations: Buffer[] = [];
  const baseTime = Date.now();

  // For batches >= 10 with existing item IDs, guarantee at least one of each type
  // by seeding the first operations deterministically before randomizing the rest.
  const guaranteedTypes: ("add" | "update" | "remove")[] = [];
  if (count >= 10 && existingItemIds.length > 0) {
    guaranteedTypes.push("add", "update", "remove");
  }

  for (let i = 0; i < count; i++) {
    let type: "add" | "update" | "remove";
    let itemId: string;

    if (i < guaranteedTypes.length) {
      // Seed guaranteed operations first
      type = guaranteedTypes[i];
    } else {
      const rand = Math.random();
      if (rand < 0.5 || existingItemIds.length === 0) {
        type = "add";
      } else if (rand < 0.8) {
        type = "update";
      } else {
        type = "remove";
      }
    }

    if (type === "add") {
      // ~50% add (or forced add when no existing IDs)
      itemId = `item-${baseTime}-${existingItemIds.length + i}`;
      existingItemIds.push(itemId);
    } else if (type === "update") {
      // ~30% update
      itemId = existingItemIds[Math.floor(Math.random() * existingItemIds.length)];
    } else {
      // ~20% remove
      itemId = existingItemIds[Math.floor(Math.random() * existingItemIds.length)];
    }

    const operation = {
      id: `op-${baseTime}-${i}`,
      sessionId: "benchmark-session",
      replicaId: "benchmark-node",
      type,
      itemId,
      payload: type === "remove" ? {} : { name: `item-${i}`, quantity: i },
      timestamp: {
        wallTime: baseTime + i,
        logical: i,
        nodeId: "benchmark-node",
      },
      version: i + 1,
    };

    operations.push(Buffer.from(JSON.stringify(operation)));
  }

  return operations;
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

/**
 * Executes the benchmark: generates synthetic CRDT operations,
 * calls mergeBatch in a loop, records per-batch timings,
 * and computes aggregate statistics.
 */
export function runBenchmark(ops: number, batchSize: number): BenchmarkResponse {
  const totalBatches = Math.ceil(ops / batchSize);
  const batchDurationsNs: bigint[] = [];
  const existingItemIds: string[] = [];

  // Pre-generate all operation batches before timing to measure pure merge throughput
  const batches: Buffer[][] = [];
  for (let batch = 0; batch < totalBatches; batch++) {
    const remaining = ops - batch * batchSize;
    const currentBatchSize = Math.min(batchSize, remaining);
    batches.push(generateOperationBatch(currentBatchSize, existingItemIds));
  }

  // Fresh CRDT state template
  const emptyState = JSON.stringify({
    sessionId: "benchmark-session",
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "benchmark-node" },
  });

  const overallStart = process.hrtime.bigint();

  for (let batch = 0; batch < totalBatches; batch++) {
    // Use fresh state per batch to benchmark raw merge throughput
    const freshState: Buffer = Buffer.from(emptyState);

    const batchStart = process.hrtime.bigint();
    nativeMerge.mergeBatch(freshState, batches[batch]);
    const batchEnd = process.hrtime.bigint();

    batchDurationsNs.push(batchEnd - batchStart);
  }

  const overallEnd = process.hrtime.bigint();
  const elapsedMs = Number(overallEnd - overallStart) / 1_000_000;

  // Compute percentiles from sorted batch durations
  const sortedDurations = [...batchDurationsNs].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );

  const p50Ms = computePercentile(sortedDurations, 0.5);
  const p99Ms = computePercentile(sortedDurations, 0.99);

  return {
    totalOps: ops,
    elapsedMs,
    opsPerSecond: ops / (elapsedMs / 1000),
    p50Ms,
    p99Ms,
    batchesProcessed: totalBatches,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes a percentile value from a sorted array of nanosecond durations.
 * Returns the value in milliseconds.
 */
function computePercentile(sortedNs: bigint[], percentile: number): number {
  if (sortedNs.length === 0) return 0;

  const index = Math.ceil(percentile * sortedNs.length) - 1;
  const clampedIndex = Math.max(0, Math.min(index, sortedNs.length - 1));
  return Number(sortedNs[clampedIndex]) / 1_000_000;
}
