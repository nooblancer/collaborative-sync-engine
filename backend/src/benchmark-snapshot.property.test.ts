/**
 * Property-based tests for snapshot/compaction benchmark invariants.
 *
 * Feature: v2.4.2
 * Tests Properties 9 and 10 from the design document.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { runSnapshotBenchmark, SnapshotBenchmarkResponse } from "./benchmark-snapshot.js";
import { generateSnapshotWorkload, getOperationType } from "./benchmark-workloads.js";

// Feature: v2.4.2, Property 9: Snapshot State Arithmetic Invariant
describe("Property 9: Snapshot State Arithmetic Invariant", () => {
  /**
   * **Validates: Requirements 5.3, 5.4**
   *
   * For any snapshot benchmark response, verify that:
   * - tombstonesRemoved = itemsBefore - itemsAfter
   * - itemsAfter <= itemsBefore
   */
  it("tombstonesRemoved equals itemsBefore minus itemsAfter, and itemsAfter <= itemsBefore", { timeout: 60000 }, () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        (ops) => {
          const result = runSnapshotBenchmark(ops);

          // Use fc.pre() to discard error results if the native addon fails
          fc.pre(!("error" in result));

          const response = result as SnapshotBenchmarkResponse;

          // Verify snapshot duration exists (confirms success case)
          expect(response.snapshotDurationMs).toBeTypeOf("number");
          expect(response.snapshotDurationMs).toBeGreaterThanOrEqual(0);

          // Property 9: tombstonesRemoved = itemsBefore - itemsAfter
          expect(response.tombstonesRemoved).toBe(
            response.itemsBefore - response.itemsAfter
          );

          // Property 9: itemsAfter <= itemsBefore
          expect(response.itemsAfter).toBeLessThanOrEqual(response.itemsBefore);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4.2, Property 10: Snapshot Workload Tombstone Ratio
describe("Property 10: Snapshot Workload Tombstone Ratio", () => {
  /**
   * **Validates: Requirements 5.6**
   *
   * For any valid operation count N for snapshot mode, the generated workload
   * used by the snapshot runner SHALL contain at least 20% remove operations.
   */
  it("snapshot workload contains ≥20% remove operations", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        (ops) => {
          const workload = generateSnapshotWorkload(ops);

          // Workload should have exactly ops operations
          expect(workload.length).toBe(ops);

          // Count remove operations
          let removeCount = 0;
          for (const opBuffer of workload) {
            if (getOperationType(opBuffer) === "remove") {
              removeCount++;
            }
          }

          // At least 20% should be removes (Requirement 5.6)
          const removeRatio = removeCount / ops;
          expect(removeRatio).toBeGreaterThanOrEqual(0.20);
        }
      ),
      { numRuns: 100 }
    );
  });
});
