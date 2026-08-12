/**
 * Property-based tests for the Benchmark module.
 *
 * Feature: v2.3-server-benchmark
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { runBenchmark, generateOperationBatch, validateBenchmarkInput } from "./benchmark.js";

// Feature: v2.3-server-benchmark, Property 1: Benchmark response field correctness
describe("Property 1: Benchmark response field correctness", () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.4, 1.6, 1.7, 1.10, 1.11**
   *
   * For any valid (ops, batchSize) pair where 100 <= ops <= 500 and
   * 1 <= batchSize <= ops, running the benchmark SHALL produce a response where:
   * - totalOps equals the input ops value
   * - batchesProcessed equals Math.ceil(ops / batchSize)
   * - opsPerSecond equals totalOps / (elapsedMs / 1000) within floating-point tolerance
   * - timestamp is a valid ISO 8601 string
   * - mergeEngine equals "rust-napi-rs"
   * - elapsedMs is a positive number
   */
  it("produces correct response fields for any valid (ops, batchSize) pair", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500 }).chain((ops) =>
          fc.tuple(fc.constant(ops), fc.integer({ min: Math.max(1, Math.floor(ops / 10)), max: ops }))
        ),
        ([ops, batchSize]) => {
          const result = runBenchmark(ops, batchSize);

          // totalOps equals the input ops value (Req 1.1, 1.2)
          expect(result.totalOps).toBe(ops);

          // batchesProcessed equals Math.ceil(ops / batchSize) (Req 1.10)
          expect(result.batchesProcessed).toBe(Math.ceil(ops / batchSize));

          // opsPerSecond equals totalOps / (elapsedMs / 1000) within floating-point tolerance (Req 1.7)
          const expectedOpsPerSecond = result.totalOps / (result.elapsedMs / 1000);
          expect(result.opsPerSecond).toBeCloseTo(expectedOpsPerSecond, 5);

          // timestamp is a valid ISO 8601 string (Req 1.11)
          const parsedDate = new Date(result.timestamp);
          expect(parsedDate.toISOString()).toBe(result.timestamp);
          expect(isNaN(parsedDate.getTime())).toBe(false);

          // mergeEngine equals "rust-napi-rs" (Req 1.6)
          expect(result.mergeEngine).toBe("rust-napi-rs");

          // elapsedMs is a positive number (Req 1.4)
          expect(typeof result.elapsedMs).toBe("number");
          expect(result.elapsedMs).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Benchmark Property Tests", () => {
  // Feature: v2.3-server-benchmark, Property 4: Operation generation produces realistic mix
  describe("Property 4: Operation generation produces realistic mix", () => {
    /**
     * **Validates: Requirements 1.16**
     *
     * For any batch size >= 10, the generated operation set SHALL contain
     * at least one operation of each type (add, update, remove), and
     * operations SHALL target multiple distinct item IDs.
     */
    it("generates at least one add, one update, one remove, and multiple distinct item IDs for batch sizes >= 10", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 500 }),
          (batchSize) => {
            // Provide seed item IDs for update/remove to target
            const existingItemIds = ["seed-1", "seed-2", "seed-3"];
            const operations = generateOperationBatch(batchSize, [...existingItemIds]);

            // Parse each operation to check type and itemId
            const types = new Set<string>();
            const itemIds = new Set<string>();

            for (const opBuffer of operations) {
              const op = JSON.parse(opBuffer.toString());
              types.add(op.type);
              itemIds.add(op.itemId);
            }

            // Assert: has at least one "add", one "update", one "remove"
            expect(types.has("add")).toBe(true);
            expect(types.has("update")).toBe(true);
            expect(types.has("remove")).toBe(true);

            // Assert: number of distinct itemIds > 1
            expect(itemIds.size).toBeGreaterThan(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// Feature: v2.3-server-benchmark, Property 3: Invalid input rejection
describe("Feature: v2.3-server-benchmark, Property 3: Invalid input rejection", () => {
  /**
   * **Validates: Requirements 1.13, 1.14**
   *
   * For any (ops, batchSize) pair where ops < 100 OR ops > 1000000
   * OR batchSize < 1 OR batchSize > ops, the benchmark validation
   * SHALL reject the input.
   */
  it("rejects any invalid (ops, batchSize) combination", () => {
    const invalidInput = fc.oneof(
      // ops below 100
      fc.record({
        ops: fc.integer({ min: -1000, max: 99 }),
        batchSize: fc.integer({ min: 1, max: 99 }),
      }),
      // ops above 1000000
      fc.record({
        ops: fc.integer({ min: 1000001, max: 5000000 }),
        batchSize: fc.integer({ min: 1, max: 1000 }),
      }),
      // batchSize below 1
      fc.record({
        ops: fc.integer({ min: 100, max: 1000000 }),
        batchSize: fc.integer({ min: -100, max: 0 }),
      }),
      // batchSize greater than ops
      fc.integer({ min: 100, max: 1000000 }).chain((ops) =>
        fc.record({
          ops: fc.constant(ops),
          batchSize: fc.integer({ min: ops + 1, max: ops + 1000 }),
        })
      )
    );

    fc.assert(
      fc.property(invalidInput, ({ ops, batchSize }) => {
        const result = validateBenchmarkInput(ops, batchSize);
        expect(result).not.toBeNull();
        expect(result!.error).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: v2.3-server-benchmark, Property 2: Percentile ordering invariant
describe("Feature: v2.3-server-benchmark, Property 2: Percentile ordering invariant", () => {
  /**
   * **Validates: Requirements 1.8**
   *
   * For any benchmark run producing per-batch timing data, `p50Ms` SHALL be
   * less than or equal to `p99Ms`, and both values SHALL be non-negative numbers.
   */
  it("p50Ms <= p99Ms and both are non-negative for all valid inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500 }),
        (ops) => {
          // Use a reasonable batchSize derived from ops to produce multiple batches
          const batchSize = Math.max(1, Math.floor(ops / 5));
          const result = runBenchmark(ops, batchSize);

          // Both percentiles must be non-negative
          expect(result.p50Ms).toBeGreaterThanOrEqual(0);
          expect(result.p99Ms).toBeGreaterThanOrEqual(0);

          // p50 must be less than or equal to p99
          expect(result.p50Ms).toBeLessThanOrEqual(result.p99Ms);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("p50Ms <= p99Ms holds across varying batch sizes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500 }).chain((ops) =>
          fc.tuple(fc.constant(ops), fc.integer({ min: 1, max: ops }))
        ),
        ([ops, batchSize]) => {
          const result = runBenchmark(ops, batchSize);

          // Both percentiles must be non-negative
          expect(result.p50Ms).toBeGreaterThanOrEqual(0);
          expect(result.p99Ms).toBeGreaterThanOrEqual(0);

          // Percentile ordering invariant
          expect(result.p50Ms).toBeLessThanOrEqual(result.p99Ms);
        }
      ),
      { numRuns: 100 }
    );
  });
});
