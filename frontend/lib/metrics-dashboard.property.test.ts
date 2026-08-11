/**
 * Property Tests for Metrics Dashboard - Latency Color Coding
 *
 * **Validates: Requirements 14.2**
 *
 * Property 40: Latency Color Coding
 * - For any latency value, the metrics dashboard SHALL display green when below
 *   target, yellow at target, and red above target thresholds.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getLatencyColor } from "@/components/MetricsDashboard";

// ---------------------------------------------------------------------------
// Constants (matching component thresholds)
// ---------------------------------------------------------------------------

/** P50 target latency in ms */
const P50_TARGET_MS = 5;
/** P99 target latency in ms */
const P99_TARGET_MS = 50;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary positive target value representing a latency target threshold */
const arbTarget = fc.double({
  min: 0.1,
  max: 10_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Arbitrary non-negative latency value */
const arbLatency = fc.double({
  min: 0,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Generate a latency value that is strictly below the green threshold (< 90% of target).
 * This guarantees the value falls in the "green" range.
 */
function arbGreenLatency(target: number): fc.Arbitrary<number> {
  const upperBound = target * 0.9;
  if (upperBound <= 0) return fc.constant(0);
  return fc.double({
    min: 0,
    max: upperBound,
    noNaN: true,
    noDefaultInfinity: true,
  }).filter((v) => v < upperBound);
}

/**
 * Generate a latency value that is in the "yellow" range (>= 90% and <= 110% of target).
 */
function arbYellowLatency(target: number): fc.Arbitrary<number> {
  const lower = target * 0.9;
  const upper = target * 1.1;
  return fc.double({
    min: lower,
    max: upper,
    noNaN: true,
    noDefaultInfinity: true,
  }).filter((v) => v >= lower && v <= upper);
}

/**
 * Generate a latency value that is strictly above the red threshold (> 110% of target).
 */
function arbRedLatency(target: number): fc.Arbitrary<number> {
  const lowerBound = target * 1.1;
  return fc.double({
    min: lowerBound,
    max: lowerBound + 100_000,
    noNaN: true,
    noDefaultInfinity: true,
  }).filter((v) => v > lowerBound);
}

// ---------------------------------------------------------------------------
// Property 40: Latency Color Coding
// ---------------------------------------------------------------------------

describe("Property 40: Latency Color Coding", () => {
  /**
   * **Validates: Requirements 14.2**
   *
   * For any latency value below 90% of target, the function SHALL return green (text-success).
   */
  it("returns green (text-success) for any latency below the target threshold", () => {
    fc.assert(
      fc.property(arbTarget, (target) => {
        return fc.assert(
          fc.property(arbGreenLatency(target), (value) => {
            expect(getLatencyColor(value, target)).toBe("text-success");
          }),
          { numRuns: 20 }
        );
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 14.2**
   *
   * For any latency value at target (within 10% of target), the function SHALL return yellow (text-warning).
   */
  it("returns yellow (text-warning) for any latency at the target threshold", () => {
    fc.assert(
      fc.property(arbTarget, (target) => {
        return fc.assert(
          fc.property(arbYellowLatency(target), (value) => {
            expect(getLatencyColor(value, target)).toBe("text-warning");
          }),
          { numRuns: 20 }
        );
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 14.2**
   *
   * For any latency value above 110% of target, the function SHALL return red (text-destructive).
   */
  it("returns red (text-destructive) for any latency above the target threshold", () => {
    fc.assert(
      fc.property(arbTarget, (target) => {
        return fc.assert(
          fc.property(arbRedLatency(target), (value) => {
            expect(getLatencyColor(value, target)).toBe("text-destructive");
          }),
          { numRuns: 20 }
        );
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 14.2**
   *
   * For any valid latency and target values, the output is always one of the
   * three valid color classes — the function never returns an unexpected value.
   */
  it("always returns one of the three valid color classes for any input", () => {
    const validColors = ["text-success", "text-warning", "text-destructive"];

    fc.assert(
      fc.property(arbLatency, arbTarget, (value, target) => {
        const color = getLatencyColor(value, target);
        expect(validColors).toContain(color);
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 14.2**
   *
   * Boundary test: The exact boundary at target * 0.9 should return yellow (>=),
   * and any value just below should return green (<).
   */
  it("correctly handles the green-to-yellow boundary at 90% of target", () => {
    fc.assert(
      fc.property(arbTarget, (target) => {
        const boundary = target * 0.9;
        // At boundary: should be yellow (value >= target * 0.9)
        expect(getLatencyColor(boundary, target)).toBe("text-warning");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.2**
   *
   * Boundary test: The exact boundary at target * 1.1 should return yellow (<=),
   * and any value just above should return red (>).
   */
  it("correctly handles the yellow-to-red boundary at 110% of target", () => {
    fc.assert(
      fc.property(arbTarget, (target) => {
        const boundary = target * 1.1;
        // At boundary: should be yellow (value <= target * 1.1)
        expect(getLatencyColor(boundary, target)).toBe("text-warning");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 14.2**
   *
   * For the known P50 target (5ms) and P99 target (50ms), verify color coding
   * holds for any latency value.
   */
  it("correctly color-codes for P50 target (5ms) across all latency ranges", () => {
    fc.assert(
      fc.property(arbLatency, (value) => {
        const color = getLatencyColor(value, P50_TARGET_MS);
        if (value < P50_TARGET_MS * 0.9) {
          expect(color).toBe("text-success");
        } else if (value <= P50_TARGET_MS * 1.1) {
          expect(color).toBe("text-warning");
        } else {
          expect(color).toBe("text-destructive");
        }
      }),
      { numRuns: 500 }
    );
  });

  it("correctly color-codes for P99 target (50ms) across all latency ranges", () => {
    fc.assert(
      fc.property(arbLatency, (value) => {
        const color = getLatencyColor(value, P99_TARGET_MS);
        if (value < P99_TARGET_MS * 0.9) {
          expect(color).toBe("text-success");
        } else if (value <= P99_TARGET_MS * 1.1) {
          expect(color).toBe("text-warning");
        } else {
          expect(color).toBe("text-destructive");
        }
      }),
      { numRuns: 500 }
    );
  });
});
