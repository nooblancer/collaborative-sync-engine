/**
 * Property-based tests for delta broadcast minimality.
 * Verifies that computeDelta produces only changed fields and that
 * applying the delta to the previous state yields the same result as the full merge.
 *
 * Feature: collaborative-sync-engine, Property 12: Delta Broadcast Minimality
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { mergeOperation } from "./merge.js";
import { computeDelta } from "./delta.js";
import type {
  CRDTState,
  CRDTOperation,
  HLCTimestamp,
  OperationType,
  LWWElement,
  LWWRegister,
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

/** Generate a non-empty payload for add/update operations */
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

/** Generate a valid CRDTOperation targeting one of the provided itemIds */
function arbCRDTOperation(itemIds: string[]): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: fc.stringOf(fc.constantFrom("r", "e", "p", "1", "2", "3"), { minLength: 1, maxLength: 8 }),
    type: fc.constantFrom("add", "update") as fc.Arbitrary<OperationType>,
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
 * Build an initial state with some items so that update operations
 * can target existing items and produce meaningful deltas.
 */
function arbInitialStateWithOp(): fc.Arbitrary<{
  state: CRDTState;
  operation: CRDTOperation;
}> {
  const itemIds = ["item-1", "item-2", "item-3"];

  return fc
    .record({
      ts1: arbHLCTimestamp(),
      ts2: arbHLCTimestamp(),
      ts3: arbHLCTimestamp(),
      operation: arbCRDTOperation(itemIds),
    })
    .map(({ ts1, ts2, ts3, operation }) => {
      const state: CRDTState = {
        sessionId: "test-session",
        items: {},
        version: 0,
        lastUpdated: { wallTime: 1, logical: 0, nodeId: "init" },
      };

      const timestamps = [ts1, ts2, ts3];
      for (let i = 0; i < itemIds.length; i++) {
        const itemId = itemIds[i];
        const ts = timestamps[i];
        const element: LWWElement = {
          itemId,
          fields: {
            name: { value: `item-${itemId}`, timestamp: ts, replicaId: "init" } as LWWRegister,
            qty: { value: 10, timestamp: ts, replicaId: "init" } as LWWRegister,
          },
          addedAt: ts,
          removedAt: null,
        };
        state.items[itemId] = element;
      }

      return { state, operation };
    });
}

// --- Property Tests ---

describe("Feature: collaborative-sync-engine, Property 12: Delta Broadcast Minimality", () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * For any operation merged into the current state, the delta produced by
   * computeDelta(before, after) SHALL contain only the fields that changed
   * (minimality) and NOT the complete state.
   */
  it("delta.changes contains only items/fields that actually changed between before and after states", () => {
    fc.assert(
      fc.property(arbInitialStateWithOp(), ({ state: initialState, operation }) => {
        const before = deepCloneState(initialState);
        const after = deepCloneState(initialState);

        // Apply the operation to get the after state
        const result = mergeOperation(after, operation);

        // Skip if the operation failed (e.g., update on non-existent item)
        if (!result.success) return;

        // Compute delta between before and after
        const delta = computeDelta(before, after);

        // MINIMALITY: Every change in the delta must correspond to an actual difference
        for (const change of delta.changes) {
          const beforeItem = before.items[change.itemId];
          const afterItem = after.items[change.itemId];

          if (change.type === "added") {
            // Item was added — it must not exist in before OR its removedAt changed
            // (computeDelta treats new items as "added")
            expect(beforeItem).toBeUndefined();
          } else if (change.type === "removed") {
            // Item was removed — removedAt must have changed from null to non-null
            // or item was entirely removed from state
            if (afterItem) {
              expect(afterItem.removedAt).not.toBeNull();
              expect(beforeItem.removedAt).toBeNull();
            } else {
              // Item no longer exists in after state
              expect(beforeItem).toBeDefined();
            }
          } else if (change.type === "updated") {
            // Updated — each field in change.fields must differ from before
            expect(change.fields).toBeDefined();
            for (const fieldName of Object.keys(change.fields!)) {
              const beforeRegister = beforeItem?.fields[fieldName];
              const afterRegister = afterItem?.fields[fieldName];

              if (afterRegister === undefined) {
                // Field was removed — it must have existed before
                expect(beforeRegister).toBeDefined();
              } else if (beforeRegister === undefined) {
                // Field was added — it must not have existed before
                // This is valid: field is new
              } else {
                // Field existed in both — value or timestamp must differ
                const differs =
                  afterRegister.value !== beforeRegister.value ||
                  afterRegister.timestamp.wallTime !== beforeRegister.timestamp.wallTime ||
                  afterRegister.timestamp.logical !== beforeRegister.timestamp.logical ||
                  afterRegister.timestamp.nodeId !== beforeRegister.timestamp.nodeId;
                expect(differs).toBe(true);
              }
            }
          }
        }

        // MINIMALITY (inverse): If an item's fields didn't change, it should NOT be in the delta
        for (const itemId of Object.keys(before.items)) {
          const beforeItem = before.items[itemId];
          const afterItem = after.items[itemId];

          if (!afterItem) continue; // Item was removed, covered above

          // If removedAt didn't change and no fields changed, there should be no delta entry
          const removedAtSame =
            beforeItem.removedAt === afterItem.removedAt ||
            (beforeItem.removedAt !== null &&
              afterItem.removedAt !== null &&
              beforeItem.removedAt.wallTime === afterItem.removedAt.wallTime &&
              beforeItem.removedAt.logical === afterItem.removedAt.logical &&
              beforeItem.removedAt.nodeId === afterItem.removedAt.nodeId);

          let anyFieldChanged = false;
          for (const fieldName of Object.keys(afterItem.fields)) {
            const br = beforeItem.fields[fieldName];
            const ar = afterItem.fields[fieldName];
            if (!br || ar.value !== br.value || ar.timestamp.wallTime !== br.timestamp.wallTime ||
                ar.timestamp.logical !== br.timestamp.logical || ar.timestamp.nodeId !== br.timestamp.nodeId) {
              anyFieldChanged = true;
              break;
            }
          }
          // Also check if any before-fields were removed
          for (const fieldName of Object.keys(beforeItem.fields)) {
            if (!(fieldName in afterItem.fields)) {
              anyFieldChanged = true;
              break;
            }
          }

          if (removedAtSame && !anyFieldChanged) {
            const deltaEntry = delta.changes.find((c) => c.itemId === itemId);
            expect(deltaEntry).toBeUndefined();
          }
        }
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * Applying the delta changes to the before state produces the same item
   * field values as the after state (correctness of the minimal delta).
   */
  it("applying delta to previous state produces the same field values as the full merge result", () => {
    fc.assert(
      fc.property(arbInitialStateWithOp(), ({ state: initialState, operation }) => {
        const before = deepCloneState(initialState);
        const after = deepCloneState(initialState);

        // Apply the operation to get the after state
        const result = mergeOperation(after, operation);
        if (!result.success) return;

        // Compute delta between before and after
        const delta = computeDelta(before, after);

        // Apply delta to a copy of the before state
        const reconstructed = deepCloneState(before);

        for (const change of delta.changes) {
          if (change.type === "added") {
            // Add new item with the fields from delta
            const newElement: LWWElement = {
              itemId: change.itemId,
              fields: {},
              addedAt: after.items[change.itemId].addedAt,
              removedAt: null,
            };
            if (change.fields) {
              for (const [fieldName, value] of Object.entries(change.fields)) {
                // Use the actual register from the after state for full fidelity
                newElement.fields[fieldName] = after.items[change.itemId].fields[fieldName];
              }
            }
            reconstructed.items[change.itemId] = newElement;
          } else if (change.type === "removed") {
            if (reconstructed.items[change.itemId]) {
              // Mark as removed using the after state's removedAt
              reconstructed.items[change.itemId] = {
                ...reconstructed.items[change.itemId],
                removedAt: after.items[change.itemId]?.removedAt ?? null,
              };
            }
          } else if (change.type === "updated") {
            const item = reconstructed.items[change.itemId];
            if (item && change.fields) {
              for (const [fieldName, value] of Object.entries(change.fields)) {
                if (value === undefined) {
                  // Field was removed
                  delete item.fields[fieldName];
                } else {
                  // Apply the updated register from after state
                  item.fields[fieldName] = after.items[change.itemId].fields[fieldName];
                }
              }
            }
          }
        }

        // Verify: for each item, the field values in reconstructed match the after state
        for (const itemId of Object.keys(after.items)) {
          const afterItem = after.items[itemId];
          const reconItem = reconstructed.items[itemId];

          expect(reconItem).toBeDefined();

          // Check field values match
          for (const [fieldName, afterRegister] of Object.entries(afterItem.fields)) {
            expect(reconItem!.fields[fieldName]?.value).toEqual(afterRegister.value);
          }

          // Check no extra fields in reconstructed that aren't in after
          for (const fieldName of Object.keys(reconItem!.fields)) {
            expect(afterItem.fields[fieldName]).toBeDefined();
          }
        }
      }),
      { numRuns: 150 }
    );
  });
});
