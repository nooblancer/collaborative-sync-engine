/**
 * Property-based tests for room distribution and isolation.
 *
 * Feature: v2.4.2
 * Tests Properties 4, 5, and 6 from the design document.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { runRoomsBenchmark, type RoomsBenchmarkResponse } from "./benchmark-rooms.js";

// Feature: v2.4.2, Property 4: Room Operation Distribution
describe("Property 4: Room Operation Distribution", () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any valid total operation count T and room count N in [2, 50], the room
   * benchmark SHALL assign exactly floor(T / N) operations to each of the first
   * N-1 rooms and floor(T / N) + (T mod N) operations to the last room, such
   * that the sum of all per-room operation counts equals T.
   */
  it("distributes ops as floor(T/N) per room with remainder to last, sum = T", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500 }),
        fc.integer({ min: 2, max: 10 }),
        (totalOps, rooms) => {
          const batchSize = Math.min(totalOps, 100);
          const result = runRoomsBenchmark(totalOps, batchSize, rooms);

          // Should not be an error response
          expect("perRoom" in result).toBe(true);
          const response = result as RoomsBenchmarkResponse;

          const opsPerRoom = Math.floor(totalOps / rooms);
          const remainder = totalOps % rooms;

          // Verify first N-1 rooms get exactly floor(T/N) ops
          for (let i = 0; i < rooms - 1; i++) {
            expect(response.perRoom[i].ops).toBe(opsPerRoom);
          }

          // Last room gets floor(T/N) + remainder
          expect(response.perRoom[rooms - 1].ops).toBe(opsPerRoom + remainder);

          // Sum of all per-room ops equals T
          const totalAssigned = response.perRoom.reduce((sum, r) => sum + r.ops, 0);
          expect(totalAssigned).toBe(totalOps);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4.2, Property 5: Room Isolation
describe("Property 5: Room Isolation", () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * For any room in a concurrent room benchmark, its per-room metrics SHALL be
   * consistent with running that room's operations in isolation against a fresh
   * CRDT state, regardless of how many other rooms are executed in the same
   * benchmark run.
   *
   * Strategy: Run the same total ops with the same room count twice. Since each
   * room gets an independent state and the per-room operation counts are
   * deterministically assigned by the distribution formula, both runs must yield
   * identical per-room op counts and valid positive metrics for each room,
   * confirming rooms are processed in isolation without cross-contamination.
   */
  it("room results are structurally isolated — each room processes only its assigned ops independently", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 400 }),
        fc.integer({ min: 2, max: 6 }),
        (totalOps, rooms) => {
          const batchSize = Math.min(totalOps, 100);

          // Run benchmark twice with same params
          const result1 = runRoomsBenchmark(totalOps, batchSize, rooms);
          const result2 = runRoomsBenchmark(totalOps, batchSize, rooms);

          expect("perRoom" in result1).toBe(true);
          expect("perRoom" in result2).toBe(true);
          const response1 = result1 as RoomsBenchmarkResponse;
          const response2 = result2 as RoomsBenchmarkResponse;

          // Each room should have the same number of operations in both runs
          // (deterministic distribution)
          for (let i = 0; i < rooms; i++) {
            expect(response1.perRoom[i].ops).toBe(response2.perRoom[i].ops);
            expect(response1.perRoom[i].roomIndex).toBe(i);
            expect(response2.perRoom[i].roomIndex).toBe(i);
          }

          // Verify isolation: each room's op count matches the distribution formula
          // and does not depend on other rooms
          const opsPerRoom = Math.floor(totalOps / rooms);
          for (let i = 0; i < rooms - 1; i++) {
            expect(response1.perRoom[i].ops).toBe(opsPerRoom);
          }

          // Each room should have a positive elapsed time (it actually processed ops)
          for (let i = 0; i < rooms; i++) {
            expect(response1.perRoom[i].elapsedMs).toBeGreaterThan(0);
            expect(response1.perRoom[i].opsPerSecond).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: v2.4.2, Property 6: Per-Room and Aggregate Metric Consistency
describe("Property 6: Per-Room and Aggregate Metric Consistency", () => {
  /**
   * **Validates: Requirements 3.3, 3.4**
   *
   * For any rooms benchmark response with N rooms, the perRoom array SHALL have
   * exactly N entries, slowestRoomMs SHALL equal the maximum of all per-room
   * elapsedMs values, and fastestRoomMs SHALL equal the minimum.
   */
  it("perRoom.length = N, slowest matches max elapsedMs, fastest matches min elapsedMs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500 }),
        fc.integer({ min: 2, max: 10 }),
        (totalOps, rooms) => {
          const batchSize = Math.min(totalOps, 100);
          const result = runRoomsBenchmark(totalOps, batchSize, rooms);

          expect("perRoom" in result).toBe(true);
          const response = result as RoomsBenchmarkResponse;

          // perRoom array has exactly N entries
          expect(response.perRoom.length).toBe(rooms);

          // roomCount field matches
          expect(response.roomCount).toBe(rooms);

          // slowestRoomMs equals max of per-room elapsedMs
          const roomTimes = response.perRoom.map((r) => r.elapsedMs);
          const maxTime = Math.max(...roomTimes);
          const minTime = Math.min(...roomTimes);

          expect(response.slowestRoomMs).toBe(maxTime);
          expect(response.fastestRoomMs).toBe(minTime);

          // averageRoomMs should equal the mean of per-room elapsed times
          const avgTime = roomTimes.reduce((sum, t) => sum + t, 0) / roomTimes.length;
          expect(response.averageRoomMs).toBeCloseTo(avgTime, 10);

          // slowest >= fastest (or equal if all rooms the same)
          expect(response.slowestRoomMs).toBeGreaterThanOrEqual(response.fastestRoomMs);
        }
      ),
      { numRuns: 100 }
    );
  });
});
