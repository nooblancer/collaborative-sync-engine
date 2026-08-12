/**
 * Integration tests for POST `/benchmark` roundtrip.
 *
 * Tests the full validation → dispatch → response flow using direct function calls
 * to `validateBenchmarkRequest` and `handleBenchmark`, verifying correct response
 * shapes for each mode, backward compatibility, and large operation counts.
 *
 * Requirements: 7.1, 7.2, 7.7
 */

import { describe, it, expect } from "vitest";
import {
  validateBenchmarkRequest,
  handleBenchmark,
  type BenchmarkModeResponse,
  type ValidatedBenchmarkParams,
} from "./benchmark.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate + dispatch in one step, mirroring the HTTP handler logic */
function executeBenchmark(body: unknown): { status: number; body: unknown } {
  const validation = validateBenchmarkRequest(body);
  if (!validation.valid) {
    return { status: 400, body: validation.error };
  }
  const result = handleBenchmark(validation.params);
  if ("error" in result) {
    return { status: 400, body: result };
  }
  return { status: 200, body: result };
}

// ---------------------------------------------------------------------------
// Standard mode
// ---------------------------------------------------------------------------

describe("benchmark integration: standard mode", () => {
  it("returns correct response shape with explicit mode", () => {
    const { status, body } = executeBenchmark({ mode: "standard", ops: 500, batchSize: 100 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("standard");
    expect(res.totalOps).toBe(500);
    expect(res.batchesProcessed).toBe(5);
    expect(res.mergeEngine).toBe("rust-napi-rs");
    expect(typeof res.elapsedMs).toBe("number");
    expect(res.elapsedMs).toBeGreaterThan(0);
    expect(typeof res.opsPerSecond).toBe("number");
    expect(res.opsPerSecond).toBeGreaterThan(0);
    expect(typeof res.p50Ms).toBe("number");
    expect(typeof res.p99Ms).toBe("number");
    expect(typeof res.timestamp).toBe("string");
    expect(new Date(res.timestamp).toISOString()).toBe(res.timestamp);
    // Memory fields present
    if (res.mode === "standard") {
      expect("memoryPeakMb" in res).toBe(true);
      expect("memoryDeltaMb" in res).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility (Requirement 7.2)
// ---------------------------------------------------------------------------

describe("benchmark integration: backward compatibility", () => {
  it("omitting mode field defaults to standard with mode: \"standard\" in response", () => {
    const { status, body } = executeBenchmark({ ops: 200, batchSize: 50 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("standard");
    expect(res.totalOps).toBe(200);
    expect(res.batchesProcessed).toBe(4);
    expect(res.mergeEngine).toBe("rust-napi-rs");
    expect(typeof res.elapsedMs).toBe("number");
    expect(typeof res.opsPerSecond).toBe("number");
    expect(typeof res.timestamp).toBe("string");
  });

  it("empty body defaults to standard mode with default params", () => {
    const validation = validateBenchmarkRequest({});
    expect(validation.valid).toBe(true);
    if (validation.valid) {
      expect(validation.params.mode).toBe("standard");
      expect(validation.params.ops).toBe(50000);
      expect(validation.params.batchSize).toBe(1000);
    }
  });
});

// ---------------------------------------------------------------------------
// Conflict mode (Requirement 7.1)
// ---------------------------------------------------------------------------

describe("benchmark integration: conflict mode", () => {
  it("returns correct response shape", () => {
    const { status, body } = executeBenchmark({ mode: "conflict", ops: 500, batchSize: 100 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("conflict");
    expect(res.totalOps).toBe(500);
    expect(res.mergeEngine).toBe("rust-napi-rs");
    expect(typeof res.elapsedMs).toBe("number");
    expect(typeof res.opsPerSecond).toBe("number");
    expect(typeof res.p50Ms).toBe("number");
    expect(typeof res.p99Ms).toBe("number");
    expect(typeof res.timestamp).toBe("string");
    // Conflict-specific fields
    if (res.mode === "conflict") {
      expect(typeof res.conflictResolutions).toBe("number");
      expect(res.conflictResolutions).toBeGreaterThanOrEqual(0);
      expect(typeof res.finalStateItemCount).toBe("number");
      expect(res.finalStateItemCount).toBeGreaterThan(0);
    }
    // Memory fields
    expect("memoryPeakMb" in res).toBe(true);
    expect("memoryDeltaMb" in res).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rooms mode (Requirement 7.1, 7.3, 7.4)
// ---------------------------------------------------------------------------

describe("benchmark integration: rooms mode", () => {
  it("returns correct response shape with default rooms", () => {
    const { status, body } = executeBenchmark({ mode: "rooms", ops: 500, batchSize: 100 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("rooms");
    expect(res.totalOps).toBe(500);
    expect(res.mergeEngine).toBe("rust-napi-rs");
    expect(typeof res.elapsedMs).toBe("number");
    expect(typeof res.opsPerSecond).toBe("number");
    expect(typeof res.timestamp).toBe("string");
    // Rooms-specific fields
    if (res.mode === "rooms") {
      expect(res.roomCount).toBe(5); // default rooms
      expect(res.perRoom).toHaveLength(5);
      expect(typeof res.slowestRoomMs).toBe("number");
      expect(typeof res.fastestRoomMs).toBe("number");
      expect(typeof res.averageRoomMs).toBe("number");
      expect(res.slowestRoomMs).toBeGreaterThanOrEqual(res.fastestRoomMs);
      // Each room has expected fields
      for (const room of res.perRoom) {
        expect(typeof room.roomIndex).toBe("number");
        expect(typeof room.ops).toBe("number");
        expect(typeof room.elapsedMs).toBe("number");
        expect(typeof room.opsPerSecond).toBe("number");
      }
    }
    // Memory fields
    expect("memoryPeakMb" in res).toBe(true);
    expect("memoryDeltaMb" in res).toBe(true);
  });

  it("returns correct response shape with custom rooms parameter", () => {
    const { status, body } = executeBenchmark({ mode: "rooms", ops: 600, batchSize: 100, rooms: 3 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("rooms");
    if (res.mode === "rooms") {
      expect(res.roomCount).toBe(3);
      expect(res.perRoom).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Breakdown mode (Requirement 7.1)
// ---------------------------------------------------------------------------

describe("benchmark integration: breakdown mode", () => {
  it("returns correct response shape", () => {
    const { status, body } = executeBenchmark({ mode: "breakdown", ops: 500, batchSize: 100 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("breakdown");
    expect(res.totalOps).toBe(500);
    expect(res.mergeEngine).toBe("rust-napi-rs");
    expect(typeof res.elapsedMs).toBe("number");
    expect(typeof res.opsPerSecond).toBe("number");
    expect(typeof res.timestamp).toBe("string");
    // Breakdown-specific fields
    if (res.mode === "breakdown") {
      // Each type has metrics
      for (const typeKey of ["add", "update", "remove"] as const) {
        expect(typeof res[typeKey].count).toBe("number");
        expect(res[typeKey].count).toBeGreaterThan(0);
        expect(typeof res[typeKey].totalMs).toBe("number");
        expect(typeof res[typeKey].averageMs).toBe("number");
        expect(typeof res[typeKey].p50Ms).toBe("number");
        expect(typeof res[typeKey].p99Ms).toBe("number");
      }
      // Sum of type counts equals totalOps
      expect(res.add.count + res.update.count + res.remove.count).toBe(res.totalOps);
    }
    // Memory fields
    expect("memoryPeakMb" in res).toBe(true);
    expect("memoryDeltaMb" in res).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot mode (Requirement 7.1)
// ---------------------------------------------------------------------------

describe("benchmark integration: snapshot mode", () => {
  it("returns correct response shape", () => {
    const { status, body } = executeBenchmark({ mode: "snapshot", ops: 500 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("snapshot");
    expect(res.totalOps).toBe(500);
    expect(res.mergeEngine).toBe("rust-napi-rs");
    expect(typeof res.elapsedMs).toBe("number");
    expect(typeof res.opsPerSecond).toBe("number");
    expect(typeof res.timestamp).toBe("string");
    // Snapshot-specific fields
    if (res.mode === "snapshot") {
      expect(typeof res.snapshotDurationMs).toBe("number");
      expect(res.snapshotDurationMs).toBeGreaterThanOrEqual(0);
      expect(typeof res.itemsBefore).toBe("number");
      expect(res.itemsBefore).toBeGreaterThan(0);
      expect(typeof res.itemsAfter).toBe("number");
      expect(res.itemsAfter).toBeGreaterThanOrEqual(0);
      expect(typeof res.tombstonesRemoved).toBe("number");
      expect(res.tombstonesRemoved).toBeGreaterThanOrEqual(0);
      // Arithmetic invariant: tombstonesRemoved = itemsBefore - itemsAfter
      expect(res.tombstonesRemoved).toBe(res.itemsBefore - res.itemsAfter);
    }
    // Memory fields
    expect("memoryPeakMb" in res).toBe(true);
    expect("memoryDeltaMb" in res).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mode field presence in all responses (Requirement 7.7)
// ---------------------------------------------------------------------------

describe("benchmark integration: mode field in all responses", () => {
  it("all valid modes include mode field matching the request", () => {
    const modes = ["standard", "conflict", "rooms", "breakdown", "snapshot"] as const;

    for (const mode of modes) {
      const params: Record<string, unknown> = { mode, ops: 200, batchSize: 50 };
      if (mode === "rooms") params.rooms = 2;

      const { status, body } = executeBenchmark(params);
      expect(status).toBe(200);
      const res = body as BenchmarkModeResponse;
      expect(res.mode).toBe(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// Large operation counts
// Note: The bottleneck in tests is JSON operation buffer generation, not the
// native merge engine. 10,000 ops is 20x the basic tests and proves the
// full roundtrip completes without timeout under meaningful load.
// ---------------------------------------------------------------------------

describe("benchmark integration: large operation counts", () => {
  it("standard mode with 10,000 ops completes without timeout", () => {
    const { status, body } = executeBenchmark({ mode: "standard", ops: 10000, batchSize: 5000 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("standard");
    expect(res.totalOps).toBe(10000);
    expect(res.batchesProcessed).toBe(2);
    expect(res.elapsedMs).toBeGreaterThan(0);
    expect(res.opsPerSecond).toBeGreaterThan(0);
  }, 60000);

  it("conflict mode with 10,000 ops completes without timeout", () => {
    const { status, body } = executeBenchmark({ mode: "conflict", ops: 10000, batchSize: 5000 });

    expect(status).toBe(200);
    const res = body as BenchmarkModeResponse;
    expect(res.mode).toBe("conflict");
    expect(res.totalOps).toBe(10000);
    expect(res.elapsedMs).toBeGreaterThan(0);
    expect(res.opsPerSecond).toBeGreaterThan(0);
  }, 60000);
});
