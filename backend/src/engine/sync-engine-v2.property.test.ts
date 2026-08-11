/**
 * Property-based tests for SyncEngineV2 room management.
 * Tests verify room creation uniqueness, state isolation, and error handling.
 *
 * Feature: sync-platform-v2
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { SyncEngineV2 } from "./sync-engine-v2.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";

// --- Arbitraries (generators) ---

/** Generate a valid HLC timestamp */
function arbHLCTimestamp(): fc.Arbitrary<HLCTimestamp> {
  return fc.record({
    wallTime: fc.integer({ min: 1, max: 1_000_000_000_000 }),
    logical: fc.nat({ max: 1000 }),
    nodeId: fc.stringOf(
      fc.constantFrom("a", "b", "c", "d", "e", "f", "1", "2", "3"),
      { minLength: 1, maxLength: 8 }
    ),
  });
}

/** Generate a non-empty payload for operations */
function arbPayload(): fc.Arbitrary<Record<string, unknown>> {
  return fc.dictionary(
    fc.constantFrom("name", "qty", "price", "color", "desc"),
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.integer({ min: 0, max: 10000 }),
      fc.boolean()
    ),
    { minKeys: 1, maxKeys: 4 }
  );
}

/** Generate a valid CRDT "add" operation for a specific item */
function arbAddOperation(itemId: string): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: fc.stringOf(fc.constantFrom("r", "e", "p", "1", "2", "3"), {
      minLength: 1,
      maxLength: 8,
    }),
    type: fc.constant("add" as const),
    itemId: fc.constant(itemId),
    payload: arbPayload(),
    timestamp: arbHLCTimestamp(),
    version: fc.nat({ max: 100 }),
  });
}

/** Generate a valid CRDT "update" operation for a specific item */
function arbUpdateOperation(itemId: string): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: fc.stringOf(fc.constantFrom("r", "e", "p", "1", "2", "3"), {
      minLength: 1,
      maxLength: 8,
    }),
    type: fc.constant("update" as const),
    itemId: fc.constant(itemId),
    payload: arbPayload(),
    timestamp: arbHLCTimestamp(),
    version: fc.nat({ max: 100 }),
  });
}

/** Generate a random non-existent room ID (alphanumeric strings that won't collide with UUIDs) */
function arbNonExistentRoomId(): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.constantFrom(
      "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
      "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"
    ),
    { minLength: 3, maxLength: 36 }
  );
}

// --- Property Tests ---

describe("Feature: sync-platform-v2, Property 1: Room Creation Produces Unique Identifiers", () => {
  /**
   * **Validates: Requirements 1.1**
   *
   * For any sequence of N create-room commands sent to the Connection_Manager,
   * all N returned room IDs SHALL be distinct from each other.
   */
  it("creating N rooms always produces N distinct room IDs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 200 }),
        (n) => {
          const engine = new SyncEngineV2();
          const roomIds: string[] = [];

          for (let i = 0; i < n; i++) {
            const room = engine.createRoom();
            roomIds.push(room.id);
          }

          // All IDs must be unique
          const uniqueIds = new Set(roomIds);
          expect(uniqueIds.size).toBe(n);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 3: Room State Isolation", () => {
  /**
   * **Validates: Requirements 1.3, 1.7**
   *
   * For any two distinct rooms A and B, operations processed in room A
   * SHALL produce no change in room B's CRDT state, and vice versa.
   */
  it("operations in room A do not affect room B's CRDT state", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(arbAddOperation("item-a"), { minLength: 1, maxLength: 10 }),
        fc.array(arbAddOperation("item-b"), { minLength: 1, maxLength: 10 }),
        async (opsForA, opsForB) => {
          const engine = new SyncEngineV2();
          const roomA = engine.createRoom();
          const roomB = engine.createRoom();

          // Capture room B's state before any operations in room A
          const roomBStateBefore = JSON.stringify(engine.getState(roomB.id));

          // Process operations in room A
          for (const op of opsForA) {
            await engine.processOperation(roomA.id, op);
          }

          // Room B's state must be unchanged
          const roomBStateAfter = JSON.stringify(engine.getState(roomB.id));
          expect(roomBStateAfter).toBe(roomBStateBefore);

          // Now capture room A's state before operations in room B
          const roomAStateAfterOps = JSON.stringify(engine.getState(roomA.id));

          // Process operations in room B
          for (const op of opsForB) {
            await engine.processOperation(roomB.id, op);
          }

          // Room A's state must be unchanged after room B operations
          const roomAStateFinal = JSON.stringify(engine.getState(roomA.id));
          expect(roomAStateFinal).toBe(roomAStateAfterOps);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 4: Invalid Room Join Returns Error", () => {
  /**
   * **Validates: Requirements 1.6**
   *
   * For any room ID that does not correspond to an existing room,
   * a join-room command SHALL return an error with code "room_not_found".
   */
  it("processOperation on a non-existent room returns error code 'room_not_found'", () => {
    fc.assert(
      fc.asyncProperty(
        arbNonExistentRoomId(),
        arbAddOperation("any-item"),
        async (fakeRoomId, operation) => {
          const engine = new SyncEngineV2();

          // Ensure the room truly doesn't exist
          expect(engine.getRoom(fakeRoomId)).toBeUndefined();

          // Attempt to process an operation in a non-existent room
          const result = await engine.processOperation(fakeRoomId, operation);

          // Must fail with "room_not_found" error code
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe("room_not_found");
        }
      ),
      { numRuns: 100 }
    );
  });
});
