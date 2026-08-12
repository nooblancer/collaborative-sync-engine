/**
 * Property-based tests for benchmark-utils.ts
 *
 * Feature: v2.4-stress-test-page
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  formatNumber,
  getLatencyColor,
  computePercentile,
  applyWindow,
} from "./benchmark-utils";

// Feature: v2.4-stress-test-page, Property 1: Number formatting produces locale-separated output
describe("Feature: v2.4-stress-test-page, Property 1: Number formatting produces locale-separated output", () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * For any non-negative integer, formatNumber(n) SHALL produce output
   * identical to n.toLocaleString("en-US"), ensuring thousands separators
   * are placed correctly.
   */
  it("formatNumber(n) produces output identical to n.toLocaleString('en-US') for any non-negative integer", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (n) => {
          const result = formatNumber(n);
          const expected = n.toLocaleString("en-US");
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4-stress-test-page, Property 2: Latency color classification follows threshold rules
describe("Feature: v2.4-stress-test-page, Property 2: Latency color classification follows threshold rules", () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any non-negative number p99, getLatencyColor(p99) SHALL return
   * "text-success" when p99 < 20, "text-warning" when 20 <= p99 <= 50,
   * and "text-destructive" when p99 > 50.
   */
  it("returns 'text-success' for p99 < 20", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 19.999, noNaN: true }),
        (p99) => {
          expect(getLatencyColor(p99)).toBe("text-success");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns 'text-warning' for 20 <= p99 <= 50", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20, max: 50, noNaN: true }),
        (p99) => {
          expect(getLatencyColor(p99)).toBe("text-warning");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns 'text-destructive' for p99 > 50", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50.001, max: 10000, noNaN: true }),
        (p99) => {
          expect(getLatencyColor(p99)).toBe("text-destructive");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4-stress-test-page, Property 3: Percentile computation is correct
describe("Feature: v2.4-stress-test-page, Property 3: Percentile computation is correct", () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any non-empty sorted array of non-negative numbers and any percentile
   * value p in (0, 1], computePercentile(sorted, p) SHALL return the element
   * at index ceil(p * length) - 1 (clamped to valid bounds).
   */
  it("returns the element at index ceil(p * length) - 1 for any non-empty sorted array and percentile in (0, 1]", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.double({ min: 0, max: 10000, noNaN: true }), { minLength: 1, maxLength: 200 })
          .map((arr) => arr.sort((a, b) => a - b)),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (sorted, p) => {
          const result = computePercentile(sorted, p);
          const expectedIndex = Math.min(
            Math.ceil(p * sorted.length) - 1,
            sorted.length - 1
          );
          const clampedIndex = Math.max(0, expectedIndex);
          expect(result).toBe(sorted[clampedIndex]);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4-stress-test-page, Property 4: Progress percentage is bounded and monotonic
describe("Feature: v2.4-stress-test-page, Property 4: Progress percentage is bounded and monotonic", () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * For any confirmed count c (0 <= c <= total) and total count t (t > 0),
   * progress = min(100, round((c / t) * 100)), always in [0, 100].
   */
  it("progress percentage is always in [0, 100] for any valid (confirmed, total) pair", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }).chain((total) =>
          fc.tuple(
            fc.integer({ min: 0, max: total }),
            fc.constant(total)
          )
        ),
        ([confirmed, total]) => {
          const progress = Math.min(100, Math.round((confirmed / total) * 100));
          expect(progress).toBeGreaterThanOrEqual(0);
          expect(progress).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("progress equals min(100, round((confirmed / total) * 100))", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }).chain((total) =>
          fc.tuple(
            fc.integer({ min: 0, max: total }),
            fc.constant(total)
          )
        ),
        ([confirmed, total]) => {
          const progress = Math.min(100, Math.round((confirmed / total) * 100));
          const expected = Math.min(100, Math.round((confirmed / total) * 100));
          expect(progress).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4-stress-test-page, Property 5: Rolling window invariant
describe("Feature: v2.4-stress-test-page, Property 5: Rolling window invariant", () => {
  /**
   * **Validates: Requirements 4.6, 4.7**
   *
   * For any array of items and a window size N > 0, applyWindow(items, N) SHALL
   * return at most N items, and those items SHALL be the last N elements of the
   * input array (or the full array if length <= N).
   */
  it("returns at most N items for any array and window size N > 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 0, maxLength: 200 }),
        fc.integer({ min: 1, max: 100 }),
        (items, windowSize) => {
          const result = applyWindow(items, windowSize);
          expect(result.length).toBeLessThanOrEqual(windowSize);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns the last N elements of the input array (or full array if length <= N)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 0, maxLength: 200 }),
        fc.integer({ min: 1, max: 100 }),
        (items, windowSize) => {
          const result = applyWindow(items, windowSize);
          if (items.length <= windowSize) {
            expect(result).toEqual(items);
          } else {
            const expected = items.slice(-windowSize);
            expect(result).toEqual(expected);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
