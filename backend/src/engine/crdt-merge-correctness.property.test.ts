/**
 * Property-based tests for CRDT merge correctness.
 * Tests verify state convergence, tombstone rejection, conflict event
 * completeness, broadcast semantics, and conflict history bounding.
 *
 * Feature: sync-platform-v2
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { SyncEngineV2 } from "./sync-engine-v2.js";
import { mergeOperation } from "./merge.js";
import type {
  CRDTOperation,
  CRDTState,
  HLCTimestamp,
  LWWElement,
  LWWRegister,
  ConflictEvent,
} from "../types/index.js";

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

/** Generate a distinct replica ID from a set of possible values */
function arbReplicaId(): fc.Arbitrary<string> {
  return fc.constantFrom("replica-1", "replica-2", "replica-3", "replica-4", "replica-5");
}

/** Generate a valid CRDT "add" operation for a specific item */
function arbAddOperation(itemId: string): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: arbReplicaId(),
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
    replicaId: arbReplicaId(),
    type: fc.constant("update" as const),
    itemId: fc.constant(itemId),
    payload: arbPayload(),
    timestamp: arbHLCTimestamp(),
    version: fc.nat({ max: 100 }),
  });
}

/** Generate a valid CRDT "remove" operation for a specific item */
function arbRemoveOperation(itemId: string): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: arbReplicaId(),
    type: fc.constant("remove" as const),
    itemId: fc.constant(itemId),
    payload: fc.constant({}),
    timestamp: arbHLCTimestamp(),
    version: fc.nat({ max: 100 }),
  });
}

/** Generate a mixed operation (add, update, or remove) targeting one of the provided items */
function arbMixedOperation(itemIds: string[]): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: arbReplicaId(),
    type: fc.constantFrom("add" as const, "update" as const, "remove" as const),
    itemId: fc.constantFrom(...itemIds),
    payload: arbPayload(),
    timestamp: arbHLCTimestamp(),
    version: fc.nat({ max: 100 }),
  });
}

/** Deep clone a CRDTState to avoid mutation side-effects */
function deepCloneState(state: CRDTState): CRDTState {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Normalize a CRDTState for comparison purposes.
 * Strips metadata fields (version, lastUpdated) that differ across replicas
 * but focuses on the items convergence which is the CRDT guarantee.
 */
function normalizeItems(state: CRDTState): Record<string, LWWElement> {
  return JSON.parse(JSON.stringify(state.items));
}

// --- Property Tests ---

describe("Feature: sync-platform-v2, Property 10: CRDT State Convergence", () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * For any set of operations applied in different orders across multiple replicas,
   * all replicas SHALL converge to an identical final state.
   */
  it("all permutations of operations converge to the same final state", () => {
    const itemIds = ["item-1", "item-2", "item-3"];

    fc.assert(
      fc.property(
        fc.array(arbMixedOperation(itemIds), { minLength: 2, maxLength: 6 }),
        (operations) => {
          // Create initial state with existing items so updates/removes have targets
          const baseState: CRDTState = {
            sessionId: "test-session",
            items: {},
            version: 0,
            lastUpdated: { wallTime: 1, logical: 0, nodeId: "init" },
          };

          for (const itemId of itemIds) {
            const element: LWWElement = {
              itemId,
              fields: {
                name: {
                  value: `initial-${itemId}`,
                  timestamp: { wallTime: 1, logical: 0, nodeId: "init" },
                  replicaId: "init",
                } as LWWRegister,
              },
              addedAt: { wallTime: 1, logical: 0, nodeId: "init" },
              removedAt: null,
            };
            baseState.items[itemId] = element;
          }

          // Apply operations in original order (replica 1)
          const state1 = deepCloneState(baseState);
          for (const op of operations) {
            mergeOperation(state1, op);
          }

          // Apply operations in reverse order (replica 2)
          const state2 = deepCloneState(baseState);
          const reversed = [...operations].reverse();
          for (const op of reversed) {
            mergeOperation(state2, op);
          }

          // Apply operations in a shuffled order (replica 3)
          // Use a deterministic shuffle based on operation IDs
          const state3 = deepCloneState(baseState);
          const shuffled = [...operations].sort((a, b) => a.id.localeCompare(b.id));
          for (const op of shuffled) {
            mergeOperation(state3, op);
          }

          // All replicas must converge to identical item state
          const items1 = normalizeItems(state1);
          const items2 = normalizeItems(state2);
          const items3 = normalizeItems(state3);

          expect(items1).toEqual(items2);
          expect(items1).toEqual(items3);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("convergence holds across multiple replicas with interleaved operations", () => {
    const itemIds = ["item-a", "item-b"];

    fc.assert(
      fc.property(
        fc.array(arbMixedOperation(itemIds), { minLength: 3, maxLength: 8 }),
        fc.array(arbMixedOperation(itemIds), { minLength: 3, maxLength: 8 }),
        (opsGroupA, opsGroupB) => {
          // Initial state with existing items
          const baseState: CRDTState = {
            sessionId: "test-session",
            items: {},
            version: 0,
            lastUpdated: { wallTime: 1, logical: 0, nodeId: "init" },
          };

          for (const itemId of itemIds) {
            baseState.items[itemId] = {
              itemId,
              fields: {
                name: {
                  value: `initial-${itemId}`,
                  timestamp: { wallTime: 1, logical: 0, nodeId: "init" },
                  replicaId: "init",
                } as LWWRegister,
              },
              addedAt: { wallTime: 1, logical: 0, nodeId: "init" },
              removedAt: null,
            };
          }

          // Replica 1: apply groupA then groupB
          const replica1 = deepCloneState(baseState);
          for (const op of [...opsGroupA, ...opsGroupB]) {
            mergeOperation(replica1, op);
          }

          // Replica 2: apply groupB then groupA
          const replica2 = deepCloneState(baseState);
          for (const op of [...opsGroupB, ...opsGroupA]) {
            mergeOperation(replica2, op);
          }

          // Replica 3: interleave ops from both groups
          const replica3 = deepCloneState(baseState);
          const allOps = [...opsGroupA, ...opsGroupB];
          allOps.sort((a, b) => a.timestamp.wallTime - b.timestamp.wallTime);
          for (const op of allOps) {
            mergeOperation(replica3, op);
          }

          // All replicas must converge
          expect(normalizeItems(replica1)).toEqual(normalizeItems(replica2));
          expect(normalizeItems(replica1)).toEqual(normalizeItems(replica3));
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 11: Reject Operations on Deleted Objects", () => {
  /**
   * **Validates: Requirements 3.7**
   *
   * For any operation referencing a Canvas_Object that has been deleted (tombstoned),
   * the Sync_Engine SHALL reject the operation and return an error with code "object_not_found".
   */
  it("update operations on tombstoned items are rejected with 'object_not_found'", () => {
    fc.assert(
      fc.asyncProperty(
        arbAddOperation("target-item"),
        arbRemoveOperation("target-item"),
        arbUpdateOperation("target-item"),
        async (addOp, removeOp, updateOp) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // First add the item
          const addResult = await engine.processOperation(room.id, addOp);
          expect(addResult.success).toBe(true);

          // Then delete it
          const removeResult = await engine.processOperation(room.id, removeOp);
          expect(removeResult.success).toBe(true);

          // Now attempt to update the deleted item
          const updateResult = await engine.processOperation(room.id, updateOp);

          // Must be rejected with "object_not_found"
          expect(updateResult.success).toBe(false);
          expect(updateResult.error).toBeDefined();
          expect(updateResult.error!.code).toBe("object_not_found");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("multiple updates on a tombstoned item all return 'object_not_found'", () => {
    fc.assert(
      fc.asyncProperty(
        arbAddOperation("multi-item"),
        arbRemoveOperation("multi-item"),
        fc.array(arbUpdateOperation("multi-item"), { minLength: 1, maxLength: 5 }),
        async (addOp, removeOp, updateOps) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Add then remove the item
          await engine.processOperation(room.id, addOp);
          await engine.processOperation(room.id, removeOp);

          // All subsequent updates must be rejected
          for (const updateOp of updateOps) {
            const result = await engine.processOperation(room.id, updateOp);
            expect(result.success).toBe(false);
            expect(result.error!.code).toBe("object_not_found");
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 24: Conflict Event Completeness", () => {
  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * For any conflict between two concurrent operations on the same field,
   * the emitted Conflict_Event SHALL contain both operations with their HLC timestamps,
   * client IDs, competing values, the winning operation identifier, and a
   * human-readable explanation of the resolution logic.
   */
  it("conflict events contain all required fields for any concurrent field modifications", () => {
    fc.assert(
      fc.asyncProperty(
        arbHLCTimestamp(),
        arbHLCTimestamp(),
        fc.constantFrom("name", "qty", "price", "color", "desc"),
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 0, max: 10000 })
        ),
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 0, max: 10000 })
        ),
        async (ts1, ts2, fieldName, valueA, valueB) => {
          // Ensure different values to trigger conflict detection
          if (JSON.stringify(valueA) === JSON.stringify(valueB)) return;

          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Collect emitted conflict events
          const conflictEvents: ConflictEvent[] = [];
          engine.onConflict((event) => conflictEvents.push(event));

          const itemId = "conflict-item";
          const replicaA = "client-alpha";
          const replicaB = "client-beta";

          // Add the item with replicaA writing a field
          const addOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: replicaA,
            type: "add",
            itemId,
            payload: { [fieldName]: valueA },
            timestamp: ts1,
            version: 0,
          };
          await engine.processOperation(room.id, addOp);

          // Now replicaB updates the same field with a different value
          const updateOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: replicaB,
            type: "update",
            itemId,
            payload: { [fieldName]: valueB },
            timestamp: ts2,
            version: 0,
          };
          await engine.processOperation(room.id, updateOp);

          // A conflict event should have been emitted
          expect(conflictEvents.length).toBeGreaterThanOrEqual(1);

          const event = conflictEvents[conflictEvents.length - 1];

          // Verify completeness: both operations present
          expect(event.operationA).toBeDefined();
          expect(event.operationB).toBeDefined();

          // Both operations have HLC timestamps
          expect(event.operationA.hlc).toBeDefined();
          expect(event.operationA.hlc.wallTime).toBeTypeOf("number");
          expect(event.operationA.hlc.logical).toBeTypeOf("number");
          expect(event.operationA.hlc.nodeId).toBeTypeOf("string");
          expect(event.operationB.hlc).toBeDefined();
          expect(event.operationB.hlc.wallTime).toBeTypeOf("number");
          expect(event.operationB.hlc.logical).toBeTypeOf("number");
          expect(event.operationB.hlc.nodeId).toBeTypeOf("string");

          // Both operations have client IDs
          expect(event.operationA.clientId).toBeTypeOf("string");
          expect(event.operationA.clientId.length).toBeGreaterThan(0);
          expect(event.operationB.clientId).toBeTypeOf("string");
          expect(event.operationB.clientId.length).toBeGreaterThan(0);

          // Both operations have competing values
          expect(event.operationA.value).toBeDefined();
          expect(event.operationB.value).toBeDefined();

          // Winner is identified
          expect(event.winner).toMatch(/^[AB]$/);

          // Human-readable explanation is present
          expect(event.reason).toBeTypeOf("string");
          expect(event.reason.length).toBeGreaterThan(0);

          // Field name is present
          expect(event.field).toBe(fieldName);

          // Room ID is present
          expect(event.roomId).toBe(room.id);

          // Event has a unique ID
          expect(event.id).toBeTypeOf("string");
          expect(event.id.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("conflict reason explains the resolution logic using HLC comparison terms", () => {
    fc.assert(
      fc.asyncProperty(
        arbHLCTimestamp(),
        arbHLCTimestamp(),
        async (ts1, ts2) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          const conflictEvents: ConflictEvent[] = [];
          engine.onConflict((event) => conflictEvents.push(event));

          const itemId = "reason-item";

          // Add item with replicaA
          const addOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "alpha",
            type: "add",
            itemId,
            payload: { name: "original" },
            timestamp: ts1,
            version: 0,
          };
          await engine.processOperation(room.id, addOp);

          // Update from replicaB with different value
          const updateOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "beta",
            type: "update",
            itemId,
            payload: { name: "modified" },
            timestamp: ts2,
            version: 0,
          };
          await engine.processOperation(room.id, updateOp);

          if (conflictEvents.length > 0) {
            const event = conflictEvents[conflictEvents.length - 1];
            // Reason must mention resolution logic:
            // Either "wall time", "logical counter", or "nodeId tiebreaker"
            const reasonLower = event.reason.toLowerCase();
            const hasResolutionExplanation =
              reasonLower.includes("wall time") ||
              reasonLower.includes("logical") ||
              reasonLower.includes("nodeid") ||
              reasonLower.includes("tiebreaker");
            expect(hasResolutionExplanation).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 25: Conflict Event Broadcast to All Room Clients", () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * For any Conflict_Event emitted in a room with N connected clients,
   * all N clients SHALL receive the event on the Operations_Channel.
   */
  it("all registered conflict listeners receive every conflict event", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        arbHLCTimestamp(),
        arbHLCTimestamp(),
        async (numListeners, ts1, ts2) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Register N listeners simulating N connected clients
          const receivedEvents: ConflictEvent[][] = [];
          for (let i = 0; i < numListeners; i++) {
            receivedEvents.push([]);
            const idx = i;
            engine.onConflict((event) => {
              receivedEvents[idx].push(event);
            });
          }

          const itemId = "broadcast-item";

          // Create a conflict scenario
          const addOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "sender-a",
            type: "add",
            itemId,
            payload: { color: "red" },
            timestamp: ts1,
            version: 0,
          };
          await engine.processOperation(room.id, addOp);

          const updateOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "sender-b",
            type: "update",
            itemId,
            payload: { color: "blue" },
            timestamp: ts2,
            version: 0,
          };
          await engine.processOperation(room.id, updateOp);

          // All listeners should have received the same conflict events
          // (at least the conflict from the update if values differ)
          const firstListenerCount = receivedEvents[0].length;
          for (let i = 1; i < numListeners; i++) {
            expect(receivedEvents[i].length).toBe(firstListenerCount);
          }

          // If a conflict was detected, verify all listeners got the same event
          if (firstListenerCount > 0) {
            const referenceEvent = receivedEvents[0][0];
            for (let i = 1; i < numListeners; i++) {
              expect(receivedEvents[i][0].id).toBe(referenceEvent.id);
              expect(receivedEvents[i][0].field).toBe(referenceEvent.field);
              expect(receivedEvents[i][0].winner).toBe(referenceEvent.winner);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it("listener failures do not prevent other listeners from receiving events", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        arbHLCTimestamp(),
        arbHLCTimestamp(),
        async (numListeners, failingIdx, ts1, ts2) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          const actualFailIdx = failingIdx % numListeners;
          const receivedEvents: ConflictEvent[][] = [];

          for (let i = 0; i < numListeners; i++) {
            receivedEvents.push([]);
            const idx = i;
            engine.onConflict((event) => {
              if (idx === actualFailIdx) {
                throw new Error("Listener failure");
              }
              receivedEvents[idx].push(event);
            });
          }

          const itemId = "fault-item";

          const addOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "client-x",
            type: "add",
            itemId,
            payload: { desc: "hello" },
            timestamp: ts1,
            version: 0,
          };
          await engine.processOperation(room.id, addOp);

          const updateOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "client-y",
            type: "update",
            itemId,
            payload: { desc: "world" },
            timestamp: ts2,
            version: 0,
          };
          await engine.processOperation(room.id, updateOp);

          // Non-failing listeners should still receive events
          for (let i = 0; i < numListeners; i++) {
            if (i === actualFailIdx) {
              // Failing listener gets nothing (it threw)
              expect(receivedEvents[i].length).toBe(0);
            }
          }

          // At least one non-failing listener should have received events if conflict occurred
          const nonFailingCounts = receivedEvents
            .filter((_, i) => i !== actualFailIdx)
            .map((events) => events.length);

          // All non-failing listeners should have the same count
          if (nonFailingCounts.length > 1) {
            for (let i = 1; i < nonFailingCounts.length; i++) {
              expect(nonFailingCounts[i]).toBe(nonFailingCounts[0]);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 26: Conflict History Bounded at 100", () => {
  /**
   * **Validates: Requirements 8.4**
   *
   * For any room, the conflict history SHALL retain at most the 100 most recent
   * Conflict_Events, discarding oldest entries when the limit is exceeded.
   */
  it("conflict history never exceeds 100 entries regardless of conflict count", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 101, max: 200 }),
        async (totalConflicts) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          const itemId = "bounded-item";

          // Create the item first
          const addOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "init-client",
            type: "add",
            itemId,
            payload: { name: "initial" },
            timestamp: { wallTime: 1, logical: 0, nodeId: "init" },
            version: 0,
          };
          await engine.processOperation(room.id, addOp);

          // Generate many conflicts by having different clients update the same field
          for (let i = 0; i < totalConflicts; i++) {
            const updateOp: CRDTOperation = {
              id: crypto.randomUUID(),
              sessionId: "test-session",
              replicaId: `client-${i % 50}`,
              type: "update",
              itemId,
              payload: { name: `value-${i}` },
              timestamp: { wallTime: 100 + i, logical: 0, nodeId: `node-${i}` },
              version: 0,
            };
            await engine.processOperation(room.id, updateOp);
          }

          // Conflict history must be bounded at 100
          const history = engine.getConflictHistory(room.id);
          expect(history.length).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("bounded history retains the most recent conflicts (not oldest)", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 110, max: 150 }),
        async (totalConflicts) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          const itemId = "recent-item";
          const emittedEvents: ConflictEvent[] = [];

          engine.onConflict((event) => emittedEvents.push(event));

          // Create the item
          const addOp: CRDTOperation = {
            id: crypto.randomUUID(),
            sessionId: "test-session",
            replicaId: "setup-client",
            type: "add",
            itemId,
            payload: { color: "initial" },
            timestamp: { wallTime: 1, logical: 0, nodeId: "setup" },
            version: 0,
          };
          await engine.processOperation(room.id, addOp);

          // Generate many conflicts
          for (let i = 0; i < totalConflicts; i++) {
            const updateOp: CRDTOperation = {
              id: crypto.randomUUID(),
              sessionId: "test-session",
              replicaId: `writer-${i % 30}`,
              type: "update",
              itemId,
              payload: { color: `color-${i}` },
              timestamp: { wallTime: 200 + i, logical: 0, nodeId: `n-${i}` },
              version: 0,
            };
            await engine.processOperation(room.id, updateOp);
          }

          const history = engine.getConflictHistory(room.id);

          // If there were more than 100 conflicts emitted, history must be exactly 100
          if (emittedEvents.length > 100) {
            expect(history.length).toBe(100);

            // The retained events should be the most recent ones
            // The last emitted event should be in the history
            const lastEmitted = emittedEvents[emittedEvents.length - 1];
            const historyIds = history.map((e) => e.id);
            expect(historyIds).toContain(lastEmitted.id);

            // The very first emitted event should NOT be in the history
            // (it was discarded as oldest)
            const firstEmitted = emittedEvents[0];
            expect(historyIds).not.toContain(firstEmitted.id);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
