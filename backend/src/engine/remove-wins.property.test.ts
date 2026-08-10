/**
 * Property-based tests for CRDT merge logic.
 *
 * Property 15: Remove Wins Over Concurrent Update
 * For any item with concurrent remove and update operations,
 * the final state SHALL show the item as removed regardless of
 * the order the operations are applied.
 *
 * **Validates: Requirements 8.6**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { mergeOperation } from "./merge.js";
import type {
  CRDTState,
  CRDTOperation,
  HLCTimestamp,
  LWWElement,
} from "../types/index.js";

// --- Arbitraries ---

/** Generate a valid HLC timestamp */
function arbHLCTimestamp(): fc.Arbitrary<HLCTimestamp> {
  return fc.record({
    wallTime: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
    logical: fc.nat({ max: 10000 }),
    nodeId: fc.string({ minLength: 1, maxLength: 20 }),
  });
}

/** Generate a safe field name that won't collide with Object.prototype properties */
function arbFieldName(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/);
}

/** Generate a non-empty payload for update operations */
function arbPayload(): fc.Arbitrary<Record<string, unknown>> {
  return fc.dictionary(
    arbFieldName(),
    fc.oneof(
      fc.string({ maxLength: 20 }),
      fc.integer(),
      fc.boolean()
    ),
    { minKeys: 1, maxKeys: 5 }
  );
}

/** Deep clone a CRDTState to avoid mutation side-effects */
function deepCloneState(state: CRDTState): CRDTState {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Generate a state containing one active item (not removed) along with
 * a concurrent remove and update operation targeting that item.
 */
function arbRemoveUpdateScenario(): fc.Arbitrary<{
  state: CRDTState;
  removeOp: CRDTOperation;
  updateOp: CRDTOperation;
  itemId: string;
}> {
  return fc
    .record({
      itemId: fc.string({ minLength: 1, maxLength: 10 }),
      addedTimestamp: arbHLCTimestamp(),
      removeTimestamp: arbHLCTimestamp(),
      updateTimestamp: arbHLCTimestamp(),
      updatePayload: arbPayload(),
      removeOpId: fc.uuid(),
      updateOpId: fc.uuid(),
      sessionId: fc.string({ minLength: 1, maxLength: 20 }),
      removeReplicaId: fc.string({ minLength: 1, maxLength: 20 }),
      updateReplicaId: fc.string({ minLength: 1, maxLength: 20 }),
    })
    .map(
      ({
        itemId,
        addedTimestamp,
        removeTimestamp,
        updateTimestamp,
        updatePayload,
        removeOpId,
        updateOpId,
        sessionId,
        removeReplicaId,
        updateReplicaId,
      }) => {
        // Build initial state with one active item
        const item: LWWElement = {
          itemId,
          fields: {
            name: {
              value: "test-item",
              timestamp: addedTimestamp,
              replicaId: "init-replica",
            },
          },
          addedAt: addedTimestamp,
          removedAt: null,
        };

        const state: CRDTState = {
          sessionId,
          items: { [itemId]: item },
          version: 1,
          lastUpdated: addedTimestamp,
        };

        // Build a remove operation targeting the item
        const removeOp: CRDTOperation = {
          id: removeOpId,
          sessionId,
          replicaId: removeReplicaId,
          type: "remove",
          itemId,
          payload: {},
          timestamp: removeTimestamp,
          version: 1,
        };

        // Build an update operation targeting the same item
        const updateOp: CRDTOperation = {
          id: updateOpId,
          sessionId,
          replicaId: updateReplicaId,
          type: "update",
          itemId,
          payload: updatePayload,
          timestamp: updateTimestamp,
          version: 1,
        };

        return { state, removeOp, updateOp, itemId };
      }
    );
}

// --- Property Tests ---

describe("Feature: collaborative-sync-engine, Property 15: Remove Wins Over Concurrent Update", () => {
  it("applying remove then update should leave the item as removed", () => {
    fc.assert(
      fc.property(arbRemoveUpdateScenario(), ({ state, removeOp, updateOp, itemId }) => {
        // Order 1: Remove first, then Update
        const stateRemoveFirst = deepCloneState(state);
        mergeOperation(stateRemoveFirst, removeOp);
        mergeOperation(stateRemoveFirst, updateOp);

        // The item must be removed (removedAt is not null)
        expect(stateRemoveFirst.items[itemId].removedAt).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("applying update then remove should leave the item as removed", () => {
    fc.assert(
      fc.property(arbRemoveUpdateScenario(), ({ state, removeOp, updateOp, itemId }) => {
        // Order 2: Update first, then Remove
        const stateUpdateFirst = deepCloneState(state);
        mergeOperation(stateUpdateFirst, updateOp);
        mergeOperation(stateUpdateFirst, removeOp);

        // The item must be removed (removedAt is not null)
        expect(stateUpdateFirst.items[itemId].removedAt).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("both orderings should converge to the same removed state", () => {
    fc.assert(
      fc.property(arbRemoveUpdateScenario(), ({ state, removeOp, updateOp, itemId }) => {
        // Order 1: Remove then Update
        const stateRemoveFirst = deepCloneState(state);
        mergeOperation(stateRemoveFirst, removeOp);
        mergeOperation(stateRemoveFirst, updateOp);

        // Order 2: Update then Remove
        const stateUpdateFirst = deepCloneState(state);
        mergeOperation(stateUpdateFirst, updateOp);
        mergeOperation(stateUpdateFirst, removeOp);

        // Both orderings should result in the item being removed
        expect(stateRemoveFirst.items[itemId].removedAt).not.toBeNull();
        expect(stateUpdateFirst.items[itemId].removedAt).not.toBeNull();

        // Both orderings should show the same removedAt timestamp
        expect(stateRemoveFirst.items[itemId].removedAt).toEqual(
          stateUpdateFirst.items[itemId].removedAt
        );
      }),
      { numRuns: 100 }
    );
  });
});
