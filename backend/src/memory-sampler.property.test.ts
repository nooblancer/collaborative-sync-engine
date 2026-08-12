/**
 * Property-based tests for MemorySampler utility.
 *
 * Feature: v2.4.2, Property 3: Memory Measurement Computation
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import { MemorySampler } from "./memory-sampler.js";

// Feature: v2.4.2, Property 3: Memory Measurement Computation
describe("Property 3: Memory Measurement Computation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 2.3, 2.4**
   *
   * For any pair (baseline, peak) where peak >= baseline, verify:
   * - memoryDeltaMb = round((peak - baseline) / (1024*1024), 2)
   * - memoryPeakMb = round(peak / (1024*1024), 2)
   */
  it("computes correct memoryDeltaMb and memoryPeakMb for any (baseline, peak) pair where peak >= baseline", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 * 1024 * 1024 * 1024 }).chain((baseline) =>
          fc.tuple(
            fc.constant(baseline),
            fc.integer({ min: baseline, max: 2 * 1024 * 1024 * 1024 })
          )
        ),
        ([baseline, peak]) => {
          // Mock process.memoryUsage to return baseline first, then peak
          let callCount = 0;
          vi.spyOn(process, "memoryUsage").mockImplementation(() => {
            callCount++;
            const heapUsed = callCount === 1 ? baseline : peak;
            return {
              rss: 0,
              heapTotal: 0,
              heapUsed,
              external: 0,
              arrayBuffers: 0,
            };
          });

          const sampler = new MemorySampler();
          sampler.recordBaseline();
          sampler.sample();
          const results = sampler.getResults();

          // Expected values using the same rounding formula as the implementation
          const expectedDeltaMb = Math.round(((peak - baseline) / (1024 * 1024)) * 100) / 100;
          const expectedPeakMb = Math.round((peak / (1024 * 1024)) * 100) / 100;

          expect(results.memoryPeakMb).toBe(expectedPeakMb);
          expect(results.memoryDeltaMb).toBe(expectedDeltaMb);
          expect(results.memoryError).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
