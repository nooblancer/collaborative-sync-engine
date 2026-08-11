/**
 * Property Tests for Stress Test Operation Generation
 *
 * Validates: Requirements 21.2, 21.7
 *
 * Property 35: Stress Test Operation Generation
 * - For any configured operation count C (100, 500, 1000, 5000),
 *   the stress test generator SHALL produce exactly C valid CRDT operations.
 *
 * Property 36: No Operations Dropped Under Backpressure
 * - For any operation submitted during backpressure conditions,
 *   the operation SHALL be queued and eventually processed —
 *   the system SHALL NOT silently drop operations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  generateOperations,
  BackpressureQueue,
  type StressOperation,
  type OperationType,
} from "./stress-test-operations";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary for the allowed operation counts */
const arbOperationCount = fc.constantFrom(100, 500, 1000, 5000);

/** Arbitrary for valid operation types */
const arbOperationType = fc.constantFrom<OperationType>("create", "update", "delete");

/** Arbitrary for a valid stress operation */
const arbStressOperation: fc.Arbitrary<StressOperation> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  type: arbOperationType,
  itemId: fc.string({ minLength: 1, maxLength: 20 }),
  payload: fc.constant({}),
  timestamp: fc.nat({ max: Date.now() + 1_000_000 }),
});

/** Arbitrary for a batch of operations (simulating backpressure scenarios) */
const arbOperationBatch = fc.array(arbStressOperation, {
  minLength: 1,
  maxLength: 200,
});

// ---------------------------------------------------------------------------
// Property 35: Stress Test Operation Generation
// ---------------------------------------------------------------------------

describe("Property 35: Stress Test Operation Generation", () => {
  /**
   * **Validates: Requirements 21.2**
   *
   * For any configured operation count C (100, 500, 1000, 5000),
   * the generator SHALL produce exactly C valid CRDT operations.
   */
  it("produces exactly the requested count of operations for all valid counts", () => {
    fc.assert(
      fc.property(arbOperationCount, (count) => {
        const ops = generateOperations(count);
        expect(ops).toHaveLength(count);
      }),
      { numRuns: 50 }
    );
  });

  it("every generated operation has required fields: id, type, itemId, payload, timestamp", () => {
    fc.assert(
      fc.property(arbOperationCount, (count) => {
        const ops = generateOperations(count);
        const validTypes = ["create", "update", "delete"];

        for (const op of ops) {
          if (typeof op.id !== "string" || op.id.length === 0) return false;
          if (!validTypes.includes(op.type)) return false;
          if (typeof op.itemId !== "string" || op.itemId.length === 0) return false;
          if (typeof op.payload !== "object" || op.payload === null) return false;
          if (typeof op.timestamp !== "number" || op.timestamp <= 0) return false;
        }
        return true;
      }),
      { numRuns: 30 }
    );
  });

  it("all generated operation types are valid CRDT types (create/update/delete)", () => {
    fc.assert(
      fc.property(arbOperationCount, (count) => {
        const ops = generateOperations(count);
        const validTypes: OperationType[] = ["create", "update", "delete"];

        return ops.every((op) => validTypes.includes(op.type));
      }),
      { numRuns: 30 }
    );
  });

  it("all generated operation IDs are unique within a batch", () => {
    fc.assert(
      fc.property(arbOperationCount, (count) => {
        const ops = generateOperations(count);
        const ids = ops.map((op) => op.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(count);
      }),
      { numRuns: 30 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 36: No Operations Dropped Under Backpressure
// ---------------------------------------------------------------------------

describe("Property 36: No Operations Dropped Under Backpressure", () => {
  /**
   * **Validates: Requirements 21.7**
   *
   * For any operation submitted during backpressure conditions,
   * the operation SHALL be queued and eventually processed —
   * the system SHALL NOT silently drop operations.
   */
  it("all submitted operations are eventually processed — none are dropped", () => {
    fc.assert(
      fc.property(arbOperationBatch, (operations) => {
        const queue = new BackpressureQueue();

        // Submit all operations (simulates burst / backpressure)
        for (const op of operations) {
          queue.submit(op);
        }

        // Verify all are queued
        expect(queue.getTotalSubmitted()).toBe(operations.length);

        // Process all
        const processedCount = queue.processAll();

        // Verify none dropped
        expect(processedCount).toBe(operations.length);
        expect(queue.getQueueDepth()).toBe(0);
        expect(queue.getProcessed()).toHaveLength(operations.length);
      }),
      { numRuns: 100 }
    );
  });

  it("operations submitted during active processing are not dropped", () => {
    fc.assert(
      fc.property(
        arbOperationBatch,
        arbOperationBatch,
        (firstBatch, secondBatch) => {
          const queue = new BackpressureQueue();

          // Submit first batch
          for (const op of firstBatch) {
            queue.submit(op);
          }

          // Process half of the first batch (simulates slow consumer)
          const halfSize = Math.ceil(firstBatch.length / 2);
          queue.processBatch(halfSize);

          // Now submit second batch while backpressure exists
          expect(queue.isUnderBackpressure() || firstBatch.length - halfSize === 0).toBe(
            true
          );
          for (const op of secondBatch) {
            queue.submit(op);
          }

          // Process everything remaining
          queue.processAll();

          // Verify total processed = first batch + second batch
          const totalExpected = firstBatch.length + secondBatch.length;
          expect(queue.getProcessed()).toHaveLength(totalExpected);
          expect(queue.getQueueDepth()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("queue depth reflects backpressure — grows when submitting faster than processing", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        fc.integer({ min: 1, max: 9 }),
        (submitCount, processRate) => {
          const queue = new BackpressureQueue();
          const ops = generateOperations(submitCount);

          // Submit all at once (simulates burst)
          for (const op of ops) {
            queue.submit(op);
          }

          // Queue depth should equal the number submitted
          expect(queue.getQueueDepth()).toBe(submitCount);

          // Process only some (simulates slower consumer)
          queue.processBatch(processRate);

          // Remaining depth should be submitCount - processRate
          expect(queue.getQueueDepth()).toBe(submitCount - processRate);

          // Process all remaining
          queue.processAll();

          // All ops eventually processed — none dropped
          expect(queue.getProcessed()).toHaveLength(submitCount);
          expect(queue.getQueueDepth()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("operations preserve identity through the queue — same ops go in and come out", () => {
    fc.assert(
      fc.property(arbOperationBatch, (operations) => {
        const queue = new BackpressureQueue();

        for (const op of operations) {
          queue.submit(op);
        }

        queue.processAll();

        const processed = queue.getProcessed();
        expect(processed).toHaveLength(operations.length);

        // Each processed operation should match the submitted one (in order)
        for (let i = 0; i < operations.length; i++) {
          expect(processed[i].id).toBe(operations[i].id);
          expect(processed[i].type).toBe(operations[i].type);
          expect(processed[i].itemId).toBe(operations[i].itemId);
        }
      }),
      { numRuns: 100 }
    );
  });
});
