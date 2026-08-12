/**
 * Property-based tests for input validation and response structure.
 *
 * Feature: v2.4.2
 * Tests Properties 11 and 12 from the design document.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateBenchmarkRequest,
  handleBenchmark,
  type BenchmarkMode,
  type ValidatedBenchmarkParams,
} from "./benchmark.js";

const VALID_MODES: BenchmarkMode[] = ["standard", "conflict", "rooms", "breakdown", "snapshot"];

// Feature: v2.4.2, Property 11: Input Validation Rejection
describe("Property 11: Input Validation Rejection", () => {
  /**
   * **Validates: Requirements 1.7, 3.7, 4.6, 5.7, 7.1, 7.2, 7.5, 7.6, 7.7**
   *
   * For any request with a mode value not in {"standard", "conflict", "rooms",
   * "breakdown", "snapshot"}, OR with ops outside [100, 1,000,000], OR with
   * rooms outside [2, 50] when mode is "rooms", OR with batchSize outside
   * [1, ops], the benchmark endpoint SHALL return an error response without
   * executing any benchmark operations.
   */

  it("rejects requests with invalid mode values", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => !VALID_MODES.includes(s as BenchmarkMode)
        ),
        (invalidMode) => {
          const result = validateBenchmarkRequest({ mode: invalidMode, ops: 1000, batchSize: 100 });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.error).toContain("Invalid mode");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects requests with ops below minimum (< 100)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 99 }),
        (invalidOps) => {
          const result = validateBenchmarkRequest({ ops: invalidOps, batchSize: 10 });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.error).toContain("Invalid ops");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects requests with ops above maximum (> 1,000,000)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000001, max: 10000000 }),
        (invalidOps) => {
          const result = validateBenchmarkRequest({ ops: invalidOps, batchSize: 100 });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.error).toContain("Invalid ops");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects requests with batchSize < 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 0 }),
        fc.integer({ min: 100, max: 10000 }),
        (invalidBatchSize, validOps) => {
          const result = validateBenchmarkRequest({ ops: validOps, batchSize: invalidBatchSize });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.error).toContain("Invalid batch size");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects requests with batchSize > ops", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
        (validOps) => {
          const invalidBatchSize = validOps + fc.sample(fc.integer({ min: 1, max: 1000 }), 1)[0];
          const result = validateBenchmarkRequest({ ops: validOps, batchSize: invalidBatchSize });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.error).toContain("Invalid batch size");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects rooms mode requests with rooms < 2", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 1 }),
        (invalidRooms) => {
          const result = validateBenchmarkRequest({
            mode: "rooms",
            ops: 1000,
            batchSize: 100,
            rooms: invalidRooms,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.error).toContain("Invalid rooms");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects rooms mode requests with rooms > 50", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 51, max: 1000 }),
        (invalidRooms) => {
          const result = validateBenchmarkRequest({
            mode: "rooms",
            ops: 1000,
            batchSize: 100,
            rooms: invalidRooms,
          });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.error).toContain("Invalid rooms");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects requests with non-finite ops (NaN, Infinity)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(NaN, Infinity, -Infinity),
        (invalidOps) => {
          const result = validateBenchmarkRequest({ ops: invalidOps, batchSize: 100 });
          expect(result.valid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4.2, Property 12: Mode Field Presence in All Responses
describe("Property 12: Mode Field Presence in All Responses", () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.7**
   *
   * For any valid benchmark request (any mode), the response SHALL include a
   * mode field whose value matches the requested mode (or "standard" when mode
   * is omitted).
   */

  it("response includes mode field matching the requested mode", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_MODES),
        (mode) => {
          // Use small ops to avoid test timeouts since actual runners execute
          const params: ValidatedBenchmarkParams = {
            mode,
            ops: 100,
            batchSize: 100,
            rooms: 5,
          };

          const result = handleBenchmark(params);

          // Should not be an error response
          expect("mode" in result).toBe(true);

          if ("mode" in result) {
            expect(result.mode).toBe(mode);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("response mode defaults to 'standard' when mode is omitted from request", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 200 }),
        (ops) => {
          // Validate request without mode field — should default to "standard"
          const validationResult = validateBenchmarkRequest({ ops, batchSize: 100 });
          expect(validationResult.valid).toBe(true);

          if (validationResult.valid) {
            expect(validationResult.params.mode).toBe("standard");

            const result = handleBenchmark(validationResult.params);
            expect("mode" in result).toBe(true);
            if ("mode" in result) {
              expect(result.mode).toBe("standard");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
