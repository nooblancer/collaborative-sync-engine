/**
 * Property-based tests for operation breakdown benchmark runner.
 *
 * Feature: v2.4.2, Property 8: Per-Type Metric Mathematical Consistency
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { runBreakdownBenchmark, BreakdownBenchmarkResponse } from "./benchmark-breakdown.js";

// Feature: v2.4.2, Property 8: Per-Type Metric Mathematical Consistency
describe("Property 8: Per-Type Metric Mathematical Consistency", () => {
  /**
   * **Validates: Requirements 4.2, 4.3**
   *
   * For any breakdown benchmark response, verify:
   * - add.count + update.count + remove.count = totalOps
   * - For each type: averageMs = totalMs / count
   */
  it("add.count + update.count + remove.count = totalOps and averageMs = totalMs / count for each type", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        (ops, batchSize) => {
          // Clamp batchSize to valid range [1, ops]
          const clampedBatchSize = Math.min(batchSize, ops);

          const result = runBreakdownBenchmark(ops, clampedBatchSize);

          // Skip error responses
          fc.pre(!("error" in result));

          const response = result as BreakdownBenchmarkResponse;

          // Verify: add.count + update.count + remove.count === totalOps
          expect(response.add.count + response.update.count + response.remove.count).toBe(
            response.totalOps
          );

          // Verify: for each type, averageMs === totalMs / count (within floating point tolerance)
          const tolerance = 0.0001;

          const expectedAddAvg = response.add.totalMs / response.add.count;
          expect(Math.abs(response.add.averageMs - expectedAddAvg)).toBeLessThan(tolerance);

          const expectedUpdateAvg = response.update.totalMs / response.update.count;
          expect(Math.abs(response.update.averageMs - expectedUpdateAvg)).toBeLessThan(tolerance);

          const expectedRemoveAvg = response.remove.totalMs / response.remove.count;
          expect(Math.abs(response.remove.averageMs - expectedRemoveAvg)).toBeLessThan(tolerance);
        }
      ),
      { numRuns: 100 }
    );
  });
});
