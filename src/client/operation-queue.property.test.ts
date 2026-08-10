/**
 * Property-Based Tests for Operation Queue Order Preservation
 *
 * Feature: collaborative-sync-engine, Property 6: Operation Queue Order Preservation
 * Validates: Requirements 4.3, 4.5, 4.6
 *
 * For any sequence of user actions generating operations while offline,
 * the local queue SHALL maintain generation order, the persisted queue
 * SHALL round-trip to identical order on restore, and transmission upon
 * reconnection SHALL preserve that same order.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fc from "fast-check";
import { unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { FileOperationQueue } from "./operation-queue.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";

// ─── Generators ───────────────────────────────────────────────────────────────

/** Arbitrary for valid HLC timestamps. */
const validTimestampArb: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  logical: fc.nat({ max: 65535 }),
  nodeId: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
});

/** Arbitrary for a non-empty alphanumeric-like string (IDs). */
const nonEmptyIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a non-empty payload (at least one key). */
const nonEmptyPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { minKeys: 1, maxKeys: 5 }
);

/** Arbitrary for a fully valid CRDTOperation. */
const validOperationArb: fc.Arbitrary<CRDTOperation> = fc.record({
  id: nonEmptyIdArb,
  sessionId: nonEmptyIdArb,
  replicaId: nonEmptyIdArb,
  type: fc.constantFrom("add" as const, "remove" as const, "update" as const),
  itemId: nonEmptyIdArb,
  payload: nonEmptyPayloadArb,
  timestamp: validTimestampArb,
  version: fc.nat({ max: 100000 }),
});

/** Arbitrary for a list of valid operations (up to 100). */
const operationListArb: fc.Arbitrary<CRDTOperation[]> = fc.array(validOperationArb, {
  minLength: 1,
  maxLength: 100,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a unique temp file path for each test run to avoid conflicts. */
function uniqueTempPath(): string {
  return join(tmpdir(), `queue-test-${randomUUID()}.json`);
}

/** Tracks temp files for cleanup. */
const tempFiles: string[] = [];

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  for (const file of tempFiles) {
    try {
      await unlink(file);
    } catch {
      // Ignore if file doesn't exist
    }
  }
  tempFiles.length = 0;
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: collaborative-sync-engine, Property 6: Operation Queue Order Preservation", () => {
  it("flush returns operations in the exact same order they were enqueued (generation order)", () => {
    /**
     * Validates: Requirements 4.3, 4.6
     *
     * Core property: for any sequence of operations enqueued in order,
     * flush() must return them in the exact same generation order.
     */
    fc.assert(
      fc.property(operationListArb, (operations) => {
        const tempPath = uniqueTempPath();
        tempFiles.push(tempPath);
        const queue = new FileOperationQueue("test-replica", tempPath);

        // Enqueue all operations in sequence
        for (const op of operations) {
          queue.enqueue(op);
        }

        // Flush should return them in the exact same order
        const flushed = queue.flush();

        expect(flushed).toHaveLength(operations.length);
        for (let i = 0; i < operations.length; i++) {
          expect(flushed[i].id).toBe(operations[i].id);
          expect(flushed[i].sessionId).toBe(operations[i].sessionId);
          expect(flushed[i].replicaId).toBe(operations[i].replicaId);
          expect(flushed[i].type).toBe(operations[i].type);
          expect(flushed[i].itemId).toBe(operations[i].itemId);
          expect(flushed[i].timestamp).toEqual(operations[i].timestamp);
          expect(flushed[i].version).toBe(operations[i].version);
          expect(flushed[i].payload).toEqual(operations[i].payload);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("persisted queue round-trips to identical order after persist and restore", async () => {
    /**
     * Validates: Requirements 4.5, 4.6
     *
     * Core property: after persist() + restore() on a new instance,
     * the operation order is preserved exactly.
     */
    await fc.assert(
      fc.asyncProperty(operationListArb, async (operations) => {
        const tempPath = uniqueTempPath();
        tempFiles.push(tempPath);

        // Enqueue and persist on original queue
        const originalQueue = new FileOperationQueue("test-replica", tempPath);
        for (const op of operations) {
          originalQueue.enqueue(op);
        }
        await originalQueue.persist();

        // Restore on a new instance
        const restoredQueue = new FileOperationQueue("test-replica", tempPath);
        const restored = await restoredQueue.restore();

        // Verify identical order and content
        expect(restored).toHaveLength(operations.length);
        for (let i = 0; i < operations.length; i++) {
          expect(restored[i].id).toBe(operations[i].id);
          expect(restored[i].sessionId).toBe(operations[i].sessionId);
          expect(restored[i].replicaId).toBe(operations[i].replicaId);
          expect(restored[i].type).toBe(operations[i].type);
          expect(restored[i].itemId).toBe(operations[i].itemId);
          expect(restored[i].timestamp).toEqual(operations[i].timestamp);
          expect(restored[i].version).toBe(operations[i].version);
          expect(restored[i].payload).toEqual(operations[i].payload);
        }

        // Also verify flush on the restored instance preserves order
        const flushed = restoredQueue.flush();
        expect(flushed).toHaveLength(operations.length);
        for (let i = 0; i < operations.length; i++) {
          expect(flushed[i]).toEqual(operations[i]);
        }
      }),
      { numRuns: 100 }
    );
  });
});


describe("Feature: collaborative-sync-engine, Property 10: Reconnection Transmission Cap", () => {
  /**
   * **Validates: Requirements 5.1, 5.8**
   *
   * For any client with more than 1000 queued operations, upon reconnection
   * the Client SDK SHALL transmit exactly the 1000 most recent operations
   * in generation order and discard the remainder.
   */
  it("should return exactly 1000 most recent operations in generation order when queue has > 1000 ops", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1001, max: 3000 }),
        fc.uuid(),
        (n, replicaId) => {
          const queue = new FileOperationQueue(replicaId, `/tmp/test-reconnection-${replicaId}.json`);

          // Generate N operations with sequential versions for ordering verification
          const operations: CRDTOperation[] = [];
          for (let i = 0; i < n; i++) {
            const op: CRDTOperation = {
              id: `op-${i}-${replicaId}`,
              sessionId: "session-1",
              replicaId,
              type: "update",
              itemId: `item-${i}`,
              payload: { name: `item-${i}`, quantity: i },
              timestamp: {
                wallTime: 1_700_000_000_000 + i,
                logical: i,
                nodeId: replicaId,
              },
              version: i + 1,
            };
            operations.push(op);
            queue.enqueue(op);
          }

          const { operations: batch, discardedCount } = queue.getReconnectionBatch();

          // Verify: returned operations has length exactly 1000
          expect(batch).toHaveLength(1000);

          // Verify: discardedCount equals N - 1000
          expect(discardedCount).toBe(n - 1000);

          // Verify: the returned 1000 operations are the MOST RECENT ones
          // (i.e., the last 1000 that were enqueued)
          const expectedMostRecent = operations.slice(n - 1000);
          for (let i = 0; i < 1000; i++) {
            expect(batch[i].id).toBe(expectedMostRecent[i].id);
            expect(batch[i].version).toBe(expectedMostRecent[i].version);
          }

          // Verify: the operations are in generation order
          // (same order as they were originally enqueued)
          for (let i = 1; i < batch.length; i++) {
            expect(batch[i].version).toBeGreaterThan(batch[i - 1].version);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.8**
   *
   * When N <= 1000, all operations are returned with discardedCount = 0.
   */
  it("should return all operations with discardedCount 0 when queue has <= 1000 ops", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.uuid(),
        (n, replicaId) => {
          const queue = new FileOperationQueue(replicaId, `/tmp/test-reconnection-${replicaId}.json`);

          const operations: CRDTOperation[] = [];
          for (let i = 0; i < n; i++) {
            const op: CRDTOperation = {
              id: `op-${i}-${replicaId}`,
              sessionId: "session-1",
              replicaId,
              type: "add",
              itemId: `item-${i}`,
              payload: { name: `item-${i}`, quantity: i },
              timestamp: {
                wallTime: 1_700_000_000_000 + i,
                logical: i,
                nodeId: replicaId,
              },
              version: i + 1,
            };
            operations.push(op);
            queue.enqueue(op);
          }

          const { operations: batch, discardedCount } = queue.getReconnectionBatch();

          // All operations returned
          expect(batch).toHaveLength(n);
          expect(discardedCount).toBe(0);

          // Operations match and are in generation order
          for (let i = 0; i < batch.length; i++) {
            expect(batch[i].id).toBe(operations[i].id);
            expect(batch[i].version).toBe(operations[i].version);
          }

          // Verify generation order is preserved
          for (let i = 1; i < batch.length; i++) {
            expect(batch[i].version).toBeGreaterThan(batch[i - 1].version);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 7: Queue Persistence Round-Trip ─────────────────────────────────

/** Character generator for alphanumeric strings */
const alphaNumCharP7 = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")
);

/**
 * Arbitrary generator for HLCTimestamp (Property 7 - richer variation).
 */
const arbHLCTimestampP7: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  logical: fc.integer({ min: 0, max: 1000 }),
  nodeId: fc.stringOf(alphaNumCharP7, { minLength: 1, maxLength: 20 }),
});

/**
 * Arbitrary generator for CRDTOperation (Property 7 - richer payloads).
 */
const arbCRDTOperationP7: fc.Arbitrary<CRDTOperation> = fc.record({
  id: fc.uuid(),
  sessionId: fc.stringOf(alphaNumCharP7, { minLength: 1, maxLength: 30 }),
  replicaId: fc.stringOf(alphaNumCharP7, { minLength: 1, maxLength: 30 }),
  type: fc.constantFrom("add" as const, "remove" as const, "update" as const),
  itemId: fc.stringOf(alphaNumCharP7, { minLength: 1, maxLength: 30 }),
  payload: fc.dictionary(
    fc.stringOf(alphaNumCharP7, { minLength: 1, maxLength: 10 }),
    fc.oneof(fc.string({ maxLength: 50 }), fc.integer(), fc.boolean()),
    { minKeys: 0, maxKeys: 5 }
  ),
  timestamp: arbHLCTimestampP7,
  version: fc.integer({ min: 0, max: 10000 }),
});

describe("Feature: collaborative-sync-engine, Property 7: Queue Persistence Round-Trip", () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * For any set of operations stored in the local operation queue,
   * persisting the queue to non-volatile storage and restoring it
   * SHALL produce an identical set of operations with identical
   * ordering, timestamps, and payloads.
   */
  it("persisting and restoring produces identical operations with same ordering, timestamps, and payloads", async () => {
    const cleanupFiles: string[] = [];

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbCRDTOperationP7, { minLength: 0, maxLength: 50 }),
          async (operations) => {
            const storagePath = join(tmpdir(), `queue-prop7-${randomUUID()}.json`);
            cleanupFiles.push(storagePath);

            // Create queue and enqueue all operations
            const queue1 = new FileOperationQueue("test-replica", storagePath);
            for (const op of operations) {
              queue1.enqueue(op);
            }

            // Persist to disk
            await queue1.persist();

            // Create a NEW queue instance with the same storage path
            const queue2 = new FileOperationQueue("test-replica", storagePath);

            // Restore from disk
            const restored = await queue2.restore();

            // Verify: restored length matches original
            expect(restored).toHaveLength(operations.length);

            // Verify: deep equality of the entire array (ordering + content)
            expect(restored).toEqual(operations);

            // Verify: each individual field is preserved
            for (let i = 0; i < operations.length; i++) {
              expect(restored[i].id).toBe(operations[i].id);
              expect(restored[i].sessionId).toBe(operations[i].sessionId);
              expect(restored[i].replicaId).toBe(operations[i].replicaId);
              expect(restored[i].type).toBe(operations[i].type);
              expect(restored[i].itemId).toBe(operations[i].itemId);
              expect(restored[i].timestamp).toEqual(operations[i].timestamp);
              expect(restored[i].payload).toEqual(operations[i].payload);
              expect(restored[i].version).toBe(operations[i].version);
            }
          }
        ),
        { numRuns: 100 }
      );
    } finally {
      // Clean up temp files
      for (const f of cleanupFiles) {
        try {
          await unlink(f);
        } catch {
          // ignore if file doesn't exist
        }
      }
    }
  });
});

describe("Feature: collaborative-sync-engine, Property 8: Offline Queue Capacity", () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any N ≤ 10,000 operations, all N operations SHALL be accepted
   * and stored in the local queue without loss.
   * Uses a smaller range (1-500) for fast property test runs with 100 iterations.
   */
  it("accepts and stores N operations without loss for N in [1, 500]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.array(validOperationArb, { minLength: 500, maxLength: 500 }),
        (n, ops) => {
          const tempPath = uniqueTempPath();
          tempFiles.push(tempPath);
          const queue = new FileOperationQueue("capacity-test", tempPath);

          // Enqueue exactly n operations
          const opsToEnqueue = ops.slice(0, n);
          for (const op of opsToEnqueue) {
            queue.enqueue(op);
          }

          // Verify size equals n (no loss)
          expect(queue.size()).toBe(n);

          // Verify flush returns exactly n operations
          const flushed = queue.flush();
          expect(flushed).toHaveLength(n);

          // Verify queue is empty after flush
          expect(queue.size()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * Boundary test: enqueueing exactly 10,000 operations succeeds without error.
   */
  it("accepts exactly 10,000 operations at max capacity", () => {
    const tempPath = uniqueTempPath();
    tempFiles.push(tempPath);
    const queue = new FileOperationQueue("boundary-test", tempPath);

    // Create and enqueue 10,000 operations
    for (let i = 0; i < 10_000; i++) {
      const op: CRDTOperation = {
        id: `op-${i}`,
        sessionId: "session-1",
        replicaId: "replica-1",
        type: "add",
        itemId: `item-${i}`,
        payload: { name: `item${i}` },
        timestamp: { wallTime: Date.now() + i, logical: 0, nodeId: "node-1" },
        version: i,
      };
      queue.enqueue(op);
    }

    // All 10,000 stored without loss
    expect(queue.size()).toBe(10_000);

    // Flush returns all 10,000
    const flushed = queue.flush();
    expect(flushed).toHaveLength(10_000);
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * Boundary test: enqueueing the 10,001st operation throws an error.
   * The queue rejects new operations once at max capacity.
   */
  it("rejects the 10,001st operation with an error", () => {
    const tempPath = uniqueTempPath();
    tempFiles.push(tempPath);
    const queue = new FileOperationQueue("overflow-test", tempPath);

    // Fill to capacity
    for (let i = 0; i < 10_000; i++) {
      const op: CRDTOperation = {
        id: `op-${i}`,
        sessionId: "session-1",
        replicaId: "replica-1",
        type: "update",
        itemId: `item-${i}`,
        payload: { qty: i },
        timestamp: { wallTime: Date.now() + i, logical: 0, nodeId: "node-1" },
        version: i,
      };
      queue.enqueue(op);
    }

    expect(queue.size()).toBe(10_000);

    // The 10,001st enqueue should throw
    const extraOp: CRDTOperation = {
      id: "op-overflow",
      sessionId: "session-1",
      replicaId: "replica-1",
      type: "add",
      itemId: "item-overflow",
      payload: { name: "overflow" },
      timestamp: { wallTime: Date.now() + 10_001, logical: 0, nodeId: "node-1" },
      version: 10_001,
    };

    expect(() => queue.enqueue(extraOp)).toThrow(
      /queue is full|maximum capacity/i
    );

    // Size remains at 10,000 — the overflow was rejected
    expect(queue.size()).toBe(10_000);
  });
});
