/**
 * Property-Based Tests for HLC Timestamp Comparison
 *
 * Feature: collaborative-sync-engine, Property 4: Deterministic Conflict Resolution
 * Validates: Requirements 3.2, 3.3
 *
 * Verifies that compareTimestamps produces a total order and uses
 * deterministic lexicographic nodeId tiebreaker when wallTime and logical are equal.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { compareTimestamps } from "../engine/hlc.js";
import type { HLCTimestamp } from "../types/index.js";

/**
 * Arbitrary generator for HLCTimestamp values.
 * Uses realistic ranges for wallTime and logical counters,
 * and short alphanumeric strings for nodeId.
 */
const hlcTimestampArb: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.nat({ max: Number.MAX_SAFE_INTEGER }),
  logical: fc.nat({ max: 65535 }),
  nodeId: fc.string({ minLength: 1, maxLength: 20 }),
});

describe("Feature: collaborative-sync-engine, Property 4: Deterministic Conflict Resolution", () => {
  describe("Total Order: compareTimestamps produces exactly one of <, >, or =", () => {
    it("for any two timestamps, exactly one of <, >, = holds (trichotomy)", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * A total order requires trichotomy: for any two elements a and b,
       * exactly one of a < b, a > b, or a = b must hold.
       */
      fc.assert(
        fc.property(hlcTimestampArb, hlcTimestampArb, (a, b) => {
          const result = compareTimestamps(a, b);

          // Result must be a number (negative, zero, or positive)
          expect(typeof result).toBe("number");
          expect(Number.isFinite(result)).toBe(true);

          // Exactly one of the three conditions holds
          const isLess = result < 0;
          const isGreater = result > 0;
          const isEqual = result === 0;

          const conditionsTrue = [isLess, isGreater, isEqual].filter(Boolean).length;
          expect(conditionsTrue).toBe(1);
        }),
        { numRuns: 200 }
      );
    });

    it("antisymmetry: if a <= b and b <= a then a = b", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * Antisymmetry is a required property of a total order.
       */
      fc.assert(
        fc.property(hlcTimestampArb, hlcTimestampArb, (a, b) => {
          const ab = compareTimestamps(a, b);
          const ba = compareTimestamps(b, a);

          if (ab <= 0 && ba <= 0) {
            // Both a <= b and b <= a implies a = b
            expect(ab).toBe(0);
            expect(ba).toBe(0);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("transitivity: if a < b and b < c then a < c", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * Transitivity is a required property of a total order.
       */
      fc.assert(
        fc.property(hlcTimestampArb, hlcTimestampArb, hlcTimestampArb, (a, b, c) => {
          const ab = compareTimestamps(a, b);
          const bc = compareTimestamps(b, c);
          const ac = compareTimestamps(a, c);

          if (ab < 0 && bc < 0) {
            expect(ac).toBeLessThan(0);
          }
          if (ab > 0 && bc > 0) {
            expect(ac).toBeGreaterThan(0);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("consistency: compare(a, b) = -compare(b, a) in sign", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * The comparison must be consistent when arguments are swapped.
       */
      fc.assert(
        fc.property(hlcTimestampArb, hlcTimestampArb, (a, b) => {
          const ab = compareTimestamps(a, b);
          const ba = compareTimestamps(b, a);

          if (ab < 0) {
            expect(ba).toBeGreaterThan(0);
          } else if (ab > 0) {
            expect(ba).toBeLessThan(0);
          } else {
            expect(ba).toBe(0);
          }
        }),
        { numRuns: 200 }
      );
    });

    it("reflexivity: compare(a, a) = 0", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * Any timestamp compared to itself must return 0.
       */
      fc.assert(
        fc.property(hlcTimestampArb, (a) => {
          expect(compareTimestamps(a, a)).toBe(0);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe("Deterministic tiebreaker: lexicographic nodeId when wallTime and logical are equal", () => {
    it("when wallTime and logical are equal, ordering is determined by nodeId lexicographic comparison", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * The design specifies: Compare wallTime first; if equal, compare logical counter;
       * if still equal, compare nodeId lexicographically (deterministic tiebreaker).
       */
      const sharedTimeArb = fc.record({
        wallTime: fc.nat({ max: Number.MAX_SAFE_INTEGER }),
        logical: fc.nat({ max: 65535 }),
      });

      fc.assert(
        fc.property(
          sharedTimeArb,
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (shared, nodeIdA, nodeIdB) => {
            const a: HLCTimestamp = { ...shared, nodeId: nodeIdA };
            const b: HLCTimestamp = { ...shared, nodeId: nodeIdB };

            const result = compareTimestamps(a, b);

            // With same wallTime and logical, result should match nodeId comparison
            if (nodeIdA < nodeIdB) {
              expect(result).toBeLessThan(0);
            } else if (nodeIdA > nodeIdB) {
              expect(result).toBeGreaterThan(0);
            } else {
              expect(result).toBe(0);
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it("higher wallTime always wins regardless of logical counter or nodeId", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * wallTime is the primary comparison key.
       */
      fc.assert(
        fc.property(
          hlcTimestampArb,
          hlcTimestampArb,
          fc.nat({ max: 1000000 }).filter((n) => n > 0),
          (a, b, offset) => {
            const higher: HLCTimestamp = { ...a, wallTime: b.wallTime + offset };
            const lower: HLCTimestamp = { ...b };

            expect(compareTimestamps(higher, lower)).toBeGreaterThan(0);
            expect(compareTimestamps(lower, higher)).toBeLessThan(0);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("when wallTime is equal, higher logical counter wins regardless of nodeId", () => {
      /**
       * Validates: Requirements 3.2, 3.3
       *
       * logical counter is the secondary comparison key.
       */
      fc.assert(
        fc.property(
          fc.nat({ max: Number.MAX_SAFE_INTEGER }),
          fc.nat({ max: 65534 }),
          fc.nat({ max: 65534 }).filter((n) => n > 0),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (wallTime, baseLogi, offset, nodeIdA, nodeIdB) => {
            const higher: HLCTimestamp = { wallTime, logical: baseLogi + offset, nodeId: nodeIdA };
            const lower: HLCTimestamp = { wallTime, logical: baseLogi, nodeId: nodeIdB };

            expect(compareTimestamps(higher, lower)).toBeGreaterThan(0);
            expect(compareTimestamps(lower, higher)).toBeLessThan(0);
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
