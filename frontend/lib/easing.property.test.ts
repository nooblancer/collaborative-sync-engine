/**
 * Property Tests for Ease-Out Animation Function
 *
 * **Validates: Requirements 18.3**
 *
 * Property 43: Ease-Out Deceleration
 * - For any progress value t in [0,1], the ease-out animation function SHALL
 *   produce monotonically increasing output with decreasing rate of change
 *   (deceleration toward the final value).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { easeOut } from "@/lib/easing";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary progress value in the valid range [0, 1] */
const arbProgress = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Generate an ordered pair (t1, t2) where 0 <= t1 < t2 <= 1.
 * Used for testing monotonicity.
 */
const arbOrderedPair = fc
  .tuple(arbProgress, arbProgress)
  .filter(([a, b]) => a < b)
  .map(([a, b]) => ({ t1: a, t2: b }));

/**
 * Generate an ordered triple (t1, t2, t3) with equal spacing,
 * where 0 <= t1 < t2 < t3 <= 1 and t2 - t1 === t3 - t2.
 * Used for testing deceleration (decreasing rate of change).
 */
const arbEquallySpacedTriple = fc
  .tuple(
    fc.double({ min: 0, max: 0.49, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0.01, max: 0.5, noNaN: true, noDefaultInfinity: true })
  )
  .map(([start, step]) => ({
    t1: start,
    t2: start + step,
    t3: start + 2 * step,
  }))
  .filter(({ t1, t2, t3 }) => t1 >= 0 && t2 > t1 && t3 > t2 && t3 <= 1);

// ---------------------------------------------------------------------------
// Property 43: Ease-Out Deceleration
// ---------------------------------------------------------------------------

describe("Property 43: Ease-Out Deceleration", () => {
  /**
   * **Validates: Requirements 18.3**
   *
   * For any t in [0,1], the output of easeOut SHALL be in [0,1].
   */
  it("output is bounded in [0, 1] for any input t in [0, 1]", () => {
    fc.assert(
      fc.property(arbProgress, (t) => {
        const result = easeOut(t);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 18.3**
   *
   * For any t1 < t2 in [0,1], easeOut(t1) <= easeOut(t2) (monotonically increasing).
   */
  it("is monotonically increasing: easeOut(t1) <= easeOut(t2) for t1 < t2", () => {
    fc.assert(
      fc.property(arbOrderedPair, ({ t1, t2 }) => {
        expect(easeOut(t1)).toBeLessThanOrEqual(easeOut(t2));
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 18.3**
   *
   * For any equally-spaced t1 < t2 < t3, the increase from t1→t2 is greater
   * than from t2→t3 (decreasing rate of change / deceleration).
   */
  it("exhibits decreasing rate of change (deceleration): increase from t1→t2 >= increase from t2→t3 for equally spaced points", () => {
    fc.assert(
      fc.property(arbEquallySpacedTriple, ({ t1, t2, t3 }) => {
        const delta1 = easeOut(t2) - easeOut(t1);
        const delta2 = easeOut(t3) - easeOut(t2);
        // The rate of change should decrease (or stay equal at boundaries)
        expect(delta1).toBeGreaterThanOrEqual(delta2 - 1e-10); // small epsilon for floating point
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 18.3**
   *
   * Boundary conditions: easeOut(0) === 0 and easeOut(1) === 1.
   */
  it("satisfies boundary conditions: easeOut(0) = 0 and easeOut(1) = 1", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });
});
