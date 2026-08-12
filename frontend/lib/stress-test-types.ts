// Shared types for the Stress Test Page (/stress-test)

// --- Benchmark Mode Types ---

/** Available benchmark modes for the server-side Rust merge engine */
export type BenchmarkMode = "standard" | "conflict" | "rooms" | "breakdown" | "snapshot";

/** Base response fields shared by all benchmark modes */
export interface BenchmarkResponseBase {
  mode: BenchmarkMode;
  totalOps: number;
  elapsedMs: number;
  opsPerSecond: number;
  p50Ms: number;
  p99Ms: number;
  batchesProcessed: number;
  mergeEngine: "rust-napi-rs";
  timestamp: string; // ISO 8601
  // Memory fields (present on all modes)
  memoryPeakMb: number | null;
  memoryDeltaMb: number | null;
  memoryError?: string;
}

/** Standard benchmark response (backward compatible) */
export interface StandardBenchmarkResponse extends BenchmarkResponseBase {
  mode: "standard";
}

/** Conflict resolution stress benchmark response */
export interface ConflictBenchmarkResponse extends BenchmarkResponseBase {
  mode: "conflict";
  conflictResolutions: number;
  finalStateItemCount: number;
}

/** Per-room metrics for the concurrent rooms benchmark */
export interface RoomMetrics {
  roomIndex: number;
  ops: number;
  elapsedMs: number;
  opsPerSecond: number;
}

/** Concurrent rooms benchmark response */
export interface RoomsBenchmarkResponse extends BenchmarkResponseBase {
  mode: "rooms";
  roomCount: number;
  perRoom: RoomMetrics[];
  slowestRoomMs: number;
  fastestRoomMs: number;
  averageRoomMs: number;
}

/** Per-operation-type timing metrics for the breakdown benchmark */
export interface OperationTypeMetrics {
  count: number;
  totalMs: number;
  averageMs: number;
  p50Ms: number;
  p99Ms: number;
}

/** Operation type breakdown benchmark response */
export interface BreakdownBenchmarkResponse extends BenchmarkResponseBase {
  mode: "breakdown";
  add: OperationTypeMetrics;
  update: OperationTypeMetrics;
  remove: OperationTypeMetrics;
}

/** Snapshot/compaction cost benchmark response */
export interface SnapshotBenchmarkResponse extends BenchmarkResponseBase {
  mode: "snapshot";
  snapshotDurationMs: number;
  itemsBefore: number;
  itemsAfter: number;
  tombstonesRemoved: number;
}

/** Discriminated union of all benchmark mode responses */
export type BenchmarkModeResponse =
  | StandardBenchmarkResponse
  | ConflictBenchmarkResponse
  | RoomsBenchmarkResponse
  | BreakdownBenchmarkResponse
  | SnapshotBenchmarkResponse;

// --- Benchmark Request Types ---

/** Base request parameters for all benchmark modes */
export interface BenchmarkRequestBase {
  ops?: number;        // 100–1,000,000, default 50,000
  batchSize?: number;  // 1–ops, default 1,000
  mode?: BenchmarkMode;
}

/** Request parameters specific to the rooms benchmark mode */
export interface RoomsBenchmarkRequest extends BenchmarkRequestBase {
  mode: "rooms";
  rooms?: number;      // 2–50, default 5
}

/** Union of all benchmark request types */
export type BenchmarkRequest = BenchmarkRequestBase | RoomsBenchmarkRequest;

// --- Frontend State Types ---

/** Mode-specific configurable parameters */
export interface ModeSpecificParams {
  rooms: number; // for "rooms" mode, default 5
}

// --- Legacy / Backward Compatible Types ---

/**
 * Response from the POST /benchmark endpoint (server-side Rust merge engine).
 * Maintains backward compatibility: mode and memory fields are optional here
 * since the existing standard benchmark may not yet include them.
 * New code should prefer the BenchmarkModeResponse discriminated union.
 */
export interface BenchmarkResponse {
  totalOps: number;
  elapsedMs: number;
  opsPerSecond: number;
  p50Ms: number;
  p99Ms: number;
  batchesProcessed: number;
  mergeEngine: "rust-napi-rs";
  timestamp: string; // ISO 8601
  // New fields (optional for backward compatibility)
  mode?: BenchmarkMode;
  memoryPeakMb?: number | null;
  memoryDeltaMb?: number | null;
  memoryError?: string;
}

/** Error response from the POST /benchmark endpoint */
export interface BenchmarkError {
  error: string;
  details?: string;
}

/** Valid browser benchmark operation counts */
export type OperationCount = 100 | 500 | 1000 | 5000;

/** Valid server benchmark operation counts */
export type ServerOperationCount = 10000 | 50000 | 100000 | 500000;

/** Current phase of a benchmark test */
export type TestPhase = "idle" | "running" | "completed";

/** WebSocket connection status */
export type WsStatus = "connected" | "disconnected" | "reconnecting";

/** Live metrics during a browser benchmark run */
export interface StressMetrics {
  submitted: number;
  confirmed: number;
  throughput: number; // current ops/sec
  peakThroughput: number;
  p50: number; // ms
  p99: number; // ms
  elapsed: number; // ms
}

/** A single throughput sample for the rolling chart */
export interface ThroughputSample {
  timestamp: number; // epoch ms
  opsPerSec: number;
}

/** An entry in the operation stream log */
export interface OperationLogEntry {
  id: string;
  type: "create" | "update" | "delete";
  timestamp: number;
  status: "submitted" | "confirmed";
}
