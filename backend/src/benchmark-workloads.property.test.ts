/**
 * Property-based tests for workload generators.
 *
 * Feature: v2.4.2
 * Tests Properties 1, 7, and 10 from the design document.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  generateContentionWorkload,
  generateBalancedWorkload,
  generateSnapshotWorkload,
  getOperationType,
  getOperationItemId,
  getOperationReplicaId,
} from "./benchmark-workloads.js";

// Feature: v2.4.2, Property 1: Contention Workload Generation Correctness
describe("Property 1: Contention Workload Generation Correctness", () => {
  /**
   * **Validates: Requirements 1.1**
   *
   * For any valid operation count N in [100, 10000], the generated contention
   * workload SHALL have at least 80% of operations targeting a key pool of no
   * more than 10 items, and SHALL use at least 3 distinct replica source IDs.
   */
  it("generates workload with ≥80% ops targeting ≤10 keys and ≥3 replica IDs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
        (ops) => {
          const workload = generateContentionWorkload(ops);

          // Workload should have exactly ops operations
          expect(workload.length).toBe(ops);

          // Count item ID frequencies
          const itemIdCounts = new Map<string, number>();
          for (const opBuffer of workload) {
            const itemId = getOperationItemId(opBuffer);
            itemIdCounts.set(itemId, (itemIdCounts.get(itemId) || 0) + 1);
          }

          // Sort item IDs by frequency descending and take top 10
          const sortedEntries = [...itemIdCounts.entries()].sort(
            (a, b) => b[1] - a[1]
          );
          const top10Keys = sortedEntries.slice(0, 10);
          const top10Total = top10Keys.reduce((sum, [, count]) => sum + count, 0);

          // At least 80% of operations target the top 10 keys
          const hotRatio = top10Total / ops;
          expect(hotRatio).toBeGreaterThanOrEqual(0.8);

          // The hot pool has no more than 10 distinct keys
          expect(top10Keys.length).toBeLessThanOrEqual(10);

          // At least 3 distinct replica source IDs
          const replicaIds = new Set<string>();
          for (const opBuffer of workload) {
            replicaIds.add(getOperationReplicaId(opBuffer));
          }
          expect(replicaIds.size).toBeGreaterThanOrEqual(3);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4.2, Property 7: Operation Type Distribution
describe("Property 7: Operation Type Distribution", () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * For any valid operation count N ≥ 100 in breakdown mode, the generated
   * workload SHALL have each operation type (add, update, remove) constituting
   * between 30% and 36% of the total operations.
   */
  it("generates balanced workload with each type between 30% and 36%", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
        (ops) => {
          const workload = generateBalancedWorkload(ops);

          // Workload should have exactly ops operations
          expect(workload.length).toBe(ops);

          // Count operations by type
          let addCount = 0;
          let updateCount = 0;
          let removeCount = 0;

          for (const opBuffer of workload) {
            const type = getOperationType(opBuffer);
            if (type === "add") addCount++;
            else if (type === "update") updateCount++;
            else if (type === "remove") removeCount++;
          }

          // Each type must be between 30% and 36%
          const addRatio = addCount / ops;
          const updateRatio = updateCount / ops;
          const removeRatio = removeCount / ops;

          expect(addRatio).toBeGreaterThanOrEqual(0.30);
          expect(addRatio).toBeLessThanOrEqual(0.36);

          expect(updateRatio).toBeGreaterThanOrEqual(0.30);
          expect(updateRatio).toBeLessThanOrEqual(0.36);

          expect(removeRatio).toBeGreaterThanOrEqual(0.30);
          expect(removeRatio).toBeLessThanOrEqual(0.36);

          // All ops accounted for
          expect(addCount + updateCount + removeCount).toBe(ops);
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
   * SHALL contain at least 20% remove operations.
   */
  it("generates snapshot workload with ≥20% remove operations", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
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

          // At least 20% should be removes
          const removeRatio = removeCount / ops;
          expect(removeRatio).toBeGreaterThanOrEqual(0.20);
        }
      ),
      { numRuns: 100 }
    );
  });
});
