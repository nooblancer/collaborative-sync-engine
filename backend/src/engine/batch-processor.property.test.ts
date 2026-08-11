/**
 * Property-based tests for the BatchProcessor.
 *
 * Property 19: Batch Produces Single Broadcast Cycle
 * Property 20: Batch Causal Ordering
 *
 * Feature: collaborative-sync-engine (Sync Platform V2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { BatchProcessor, type BatchCycle } from "./batch-processor.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";

// --- Arbitraries (generators) ---

/** Generate a valid HLC timestamp */
function arbHLCTimestamp(wallTimeRange?: { min: number; max: number }): fc.Arbitrary<HLCTimestamp> {
  return fc.record({
    wallTime: fc.integer(wallTimeRange ?? { min: 1, max: 1_000_000_000_000 }),
    logical: fc.nat({ max: 1000 }),
    nodeId: fc.stringOf(
      fc.constantFrom("a", "b", "c", "d", "e", "f", "1", "2", "3"),
      { minLength: 1, maxLength: 8 }
    ),
  });
}

/** Generate a valid CRDTOperation with a given replicaId and timestamp */
function arbCRDTOperation(opts?: {
  replicaId?: string;
  timestamp?: HLCTimestamp;
}): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: fc.constant(opts?.replicaId ?? "replica-default"),
    type: fc.constantFrom("add" as const, "update" as const, "remove" as const),
    itemId: fc.stringOf(fc.constantFrom("i", "t", "e", "m", "1", "2", "3"), {
      minLength: 1,
      maxLength: 8,
    }),
    payload: fc.dictionary(
      fc.constantFrom("name", "x", "y", "width"),
      fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.integer({ min: 0, max: 1000 })),
      { minKeys: 1, maxKeys: 3 }
    ),
    timestamp: opts?.timestamp ? fc.constant(opts.timestamp) : arbHLCTimestamp(),
    version: fc.nat({ max: 100 }),
  });
}

/** Generate N operations (N > 1) for a single room */
function arbBatchOperations(minOps: number, maxOps: number): fc.Arbitrary<CRDTOperation[]> {
  return fc
    .integer({ min: minOps, max: maxOps })
    .chain((n) => fc.array(arbCRDTOperation(), { minLength: n, maxLength: n }));
}

/**
 * Generate a sequence of operations from the same replicaId with strictly
 * increasing wallTime timestamps to establish causal order.
 */
function arbCausallyOrderedOps(
  minOps: number,
  maxOps: number
): fc.Arbitrary<{ replicaId: string; operations: CRDTOperation[] }> {
  return fc
    .record({
      replicaId: fc.stringOf(fc.constantFrom("r", "e", "p", "1", "2"), {
        minLength: 2,
        maxLength: 6,
      }),
      count: fc.integer({ min: minOps, max: maxOps }),
      baseWallTime: fc.integer({ min: 1000, max: 1_000_000 }),
    })
    .chain(({ replicaId, count, baseWallTime }) => {
      // Generate strictly increasing timestamps
      const ops: fc.Arbitrary<CRDTOperation>[] = [];
      for (let i = 0; i < count; i++) {
        const timestamp: HLCTimestamp = {
          wallTime: baseWallTime + (i + 1) * 100,
          logical: i,
          nodeId: replicaId,
        };
        ops.push(arbCRDTOperation({ replicaId, timestamp }));
      }
      return fc.tuple(...ops).map((opArr) => ({ replicaId, operations: opArr }));
    });
}

// --- Property Tests ---

describe("Feature: collaborative-sync-engine, Property 19: Batch Produces Single Broadcast Cycle", () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any batch of N operations (N > 1) buffered within a single window
   * for the same room, they SHALL produce exactly one merge-persist-broadcast
   * cycle (one delta broadcast containing all changes).
   *
   * The BatchProcessor emits:
   *  1. One immediate passthrough cycle for the first operation
   *  2. One batched cycle for all subsequent operations in the window
   *
   * So for N operations enqueued rapidly, we expect exactly 2 cycles:
   * the initial passthrough + one batch containing the remaining N-1 ops.
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("N operations enqueued within one window produce exactly one batched cycle (plus initial passthrough)", () => {
    fc.assert(
      fc.property(
        arbBatchOperations(2, 20),
        fc.constantFrom("room-alpha", "room-beta", "room-gamma"),
        (operations, roomId) => {
          const processor = new BatchProcessor({ windowMs: 5, maxBatchSize: 1000, workerThreadThreshold: 50 });
          const cycles: BatchCycle[] = [];
          processor.onCycleComplete((cycle) => cycles.push(cycle));

          // Enqueue all operations rapidly (no timer advancement between them)
          for (const op of operations) {
            processor.enqueue(roomId, op);
          }

          // At this point, only the passthrough cycle for the first op should have fired
          expect(cycles.length).toBe(1);
          expect(cycles[0].operations.length).toBe(1);
          expect(cycles[0].roomId).toBe(roomId);

          // Advance time past the batch window to flush remaining ops
          vi.advanceTimersByTime(10);

          // Now we should have exactly 2 cycles total:
          // 1st: immediate passthrough (1 op)
          // 2nd: batched cycle (N-1 ops)
          expect(cycles.length).toBe(2);
          expect(cycles[1].roomId).toBe(roomId);
          expect(cycles[1].operations.length).toBe(operations.length - 1);

          // Verify all operations are accounted for
          const allCycleOps = [...cycles[0].operations, ...cycles[1].operations];
          expect(allCycleOps.length).toBe(operations.length);

          // Cleanup
          processor.shutdown();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the batched cycle contains all buffered operations as a single broadcast unit", () => {
    fc.assert(
      fc.property(
        arbBatchOperations(3, 30),
        (operations) => {
          const roomId = "test-room";
          const processor = new BatchProcessor({ windowMs: 5, maxBatchSize: 1000, workerThreadThreshold: 50 });
          const cycles: BatchCycle[] = [];
          processor.onCycleComplete((cycle) => cycles.push(cycle));

          // Enqueue all ops
          for (const op of operations) {
            processor.enqueue(roomId, op);
          }

          // Flush the batch window
          vi.advanceTimersByTime(10);

          // The second cycle (the batch) must be a single cycle with all remaining ops
          const batchCycle = cycles[1];
          expect(batchCycle).toBeDefined();
          expect(batchCycle.operations.length).toBe(operations.length - 1);

          // Verify each buffered op (index 1..N-1) appears exactly once in the batch cycle
          for (let i = 1; i < operations.length; i++) {
            expect(batchCycle.operations).toContainEqual(operations[i]);
          }

          processor.shutdown();
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe("Feature: collaborative-sync-engine, Property 20: Batch Causal Ordering", () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * For any batch containing multiple operations from the same client,
   * those operations SHALL be applied in their original submission order.
   *
   * We generate operations from the same replicaId with strictly increasing
   * timestamps, enqueue them within one window, and verify the batch cycle
   * preserves their submission (causal) order.
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("operations from the same client within a batch preserve their submission order", () => {
    fc.assert(
      fc.property(
        arbCausallyOrderedOps(3, 15),
        ({ replicaId, operations }) => {
          const roomId = "causal-room";
          const processor = new BatchProcessor({ windowMs: 5, maxBatchSize: 1000, workerThreadThreshold: 50 });
          const cycles: BatchCycle[] = [];
          processor.onCycleComplete((cycle) => cycles.push(cycle));

          // Enqueue all operations rapidly
          for (const op of operations) {
            processor.enqueue(roomId, op);
          }

          // Flush
          vi.advanceTimersByTime(10);

          // The batch cycle contains ops[1..N-1]
          expect(cycles.length).toBe(2);
          const batchCycle = cycles[1];

          // Filter to the specific replicaId (they all match in this test)
          const clientOps = batchCycle.operations.filter(
            (op) => op.replicaId === replicaId
          );

          // Verify strict submission order: each operation's timestamp should be
          // strictly greater than the previous one (wallTime is strictly increasing)
          for (let i = 1; i < clientOps.length; i++) {
            const prev = clientOps[i - 1];
            const curr = clientOps[i];

            // wallTime is strictly increasing by construction
            expect(curr.timestamp.wallTime).toBeGreaterThan(prev.timestamp.wallTime);
          }

          // Verify the order in the batch matches the original submission order
          // (operations[1..N-1] should appear in the same sequence)
          const expectedOps = operations.slice(1);
          expect(clientOps.length).toBe(expectedOps.length);
          for (let i = 0; i < clientOps.length; i++) {
            expect(clientOps[i].id).toBe(expectedOps[i].id);
          }

          processor.shutdown();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("interleaved operations from multiple clients preserve per-client causal order", () => {
    fc.assert(
      fc.property(
        arbCausallyOrderedOps(2, 8),
        arbCausallyOrderedOps(2, 8),
        (clientA, clientB) => {
          // Ensure distinct replicaIds — if they collide, force them distinct
          if (clientA.replicaId === clientB.replicaId) {
            clientB.replicaId = clientB.replicaId + "-B";
            for (const op of clientB.operations) {
              (op as { replicaId: string }).replicaId = clientB.replicaId;
            }
          }

          const roomId = "multi-client-room";
          const processor = new BatchProcessor({ windowMs: 5, maxBatchSize: 1000, workerThreadThreshold: 50 });
          const cycles: BatchCycle[] = [];
          processor.onCycleComplete((cycle) => cycles.push(cycle));

          // Interleave operations from both clients
          const allOps: CRDTOperation[] = [];
          const maxLen = Math.max(clientA.operations.length, clientB.operations.length);
          for (let i = 0; i < maxLen; i++) {
            if (i < clientA.operations.length) allOps.push(clientA.operations[i]);
            if (i < clientB.operations.length) allOps.push(clientB.operations[i]);
          }

          // Enqueue all
          for (const op of allOps) {
            processor.enqueue(roomId, op);
          }

          // Flush
          vi.advanceTimersByTime(10);

          expect(cycles.length).toBe(2);
          const batchCycle = cycles[1];

          // Check per-client ordering for client A within the batch
          const opsA = batchCycle.operations.filter(
            (op) => op.replicaId === clientA.replicaId
          );
          for (let i = 1; i < opsA.length; i++) {
            expect(opsA[i].timestamp.wallTime).toBeGreaterThanOrEqual(
              opsA[i - 1].timestamp.wallTime
            );
            // If wallTime is equal, logical counter must be greater (strict causal order)
            if (opsA[i].timestamp.wallTime === opsA[i - 1].timestamp.wallTime) {
              expect(opsA[i].timestamp.logical).toBeGreaterThan(
                opsA[i - 1].timestamp.logical
              );
            }
          }

          // Check per-client ordering for client B within the batch
          const opsB = batchCycle.operations.filter(
            (op) => op.replicaId === clientB.replicaId
          );
          for (let i = 1; i < opsB.length; i++) {
            expect(opsB[i].timestamp.wallTime).toBeGreaterThanOrEqual(
              opsB[i - 1].timestamp.wallTime
            );
            if (opsB[i].timestamp.wallTime === opsB[i - 1].timestamp.wallTime) {
              expect(opsB[i].timestamp.logical).toBeGreaterThan(
                opsB[i - 1].timestamp.logical
              );
            }
          }

          // Verify submission order is preserved: for each client, the ops
          // in the batch must appear in the same relative order as they were
          // submitted (filter original submission to only those in the batch)
          const batchOpIds = new Set(batchCycle.operations.map((op) => op.id));

          const expectedA = clientA.operations.filter((op) => batchOpIds.has(op.id));
          expect(opsA.length).toBe(expectedA.length);
          for (let i = 0; i < opsA.length; i++) {
            expect(opsA[i].id).toBe(expectedA[i].id);
          }

          const expectedB = clientB.operations.filter((op) => batchOpIds.has(op.id));
          expect(opsB.length).toBe(expectedB.length);
          for (let i = 0; i < opsB.length; i++) {
            expect(opsB[i].id).toBe(expectedB[i].id);
          }

          processor.shutdown();
        }
      ),
      { numRuns: 50 }
    );
  });
});
