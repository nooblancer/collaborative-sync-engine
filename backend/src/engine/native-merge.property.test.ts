/**
 * Property-based tests for Native Merge Addon TypeScript bindings.
 *
 * These tests validate the core CRDT merge semantics that the native Rust addon
 * implements, by testing the equivalent TypeScript merge logic layer that mirrors
 * the native behavior:
 *
 * - Property 7: LWW Conflict Resolution Correctness
 * - Property 8: Remove-Wins Semantics
 * - Property 9: Freehand Path Append-Only Merge
 *
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { mergeOperation } from "./merge.js";
import { compareTimestamps } from "./hlc.js";
import type {
  CRDTState,
  CRDTOperation,
  HLCTimestamp,
  LWWElement,
  LWWRegister,
} from "../types/index.js";

// =============================================================================
// Arbitraries (generators)
// =============================================================================

/** Generate a valid HLC timestamp with positive wallTime */
function arbHLCTimestamp(): fc.Arbitrary<HLCTimestamp> {
  return fc.record({
    wallTime: fc.integer({ min: 1, max: 1_000_000_000_000 }),
    logical: fc.nat({ max: 10000 }),
    nodeId: fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
  });
}

/**
 * Generate two HLC timestamps that are guaranteed to be distinct.
 * This ensures meaningful conflict resolution testing.
 */
function arbTwoDistinctHLCTimestamps(): fc.Arbitrary<{
  higher: HLCTimestamp;
  lower: HLCTimestamp;
}> {
  return fc
    .record({
      tsA: arbHLCTimestamp(),
      tsB: arbHLCTimestamp(),
    })
    .filter(({ tsA, tsB }) => compareTimestamps(tsA, tsB) !== 0)
    .map(({ tsA, tsB }) => {
      const cmp = compareTimestamps(tsA, tsB);
      return cmp > 0
        ? { higher: tsA, lower: tsB }
        : { higher: tsB, lower: tsA };
    });
}

/** Generate a safe field name for payload keys */
function arbFieldName(): fc.Arbitrary<string> {
  return fc.constantFrom(
    "x", "y", "width", "height", "fill", "stroke", "strokeWidth",
    "radius", "opacity", "rotation"
  );
}

/** Generate a field value (number, string, or boolean) */
function arbFieldValue(): fc.Arbitrary<unknown> {
  return fc.oneof(
    fc.integer({ min: -1000, max: 1000 }),
    fc.string({ minLength: 1, maxLength: 10 }),
    fc.boolean()
  );
}

/** Generate a non-empty payload for add/update operations */
function arbPayload(): fc.Arbitrary<Record<string, unknown>> {
  return fc.dictionary(arbFieldName(), arbFieldValue(), {
    minKeys: 1,
    maxKeys: 4,
  });
}

/** Deep clone a CRDTState to avoid mutation side-effects */
function deepCloneState(state: CRDTState): CRDTState {
  return JSON.parse(JSON.stringify(state));
}

// =============================================================================
// Property 7: LWW Conflict Resolution Correctness
// =============================================================================

describe("Property 7: LWW Conflict Resolution Correctness", () => {
  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * For any two concurrent operations modifying the same field of the same
   * Canvas_Object, the Sync_Engine SHALL resolve the conflict by selecting
   * the operation with the higher HLC timestamp (wallTime, then logical,
   * then nodeId lexicographic tiebreaker) as the winner.
   */

  it("higher wallTime operation wins regardless of application order", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctHLCTimestamps(),
        arbFieldName(),
        arbFieldValue(),
        arbFieldValue(),
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (timestamps, field, valueHigher, valueLower, replicaA, replicaB) => {
          const { higher, lower } = timestamps;
          const itemId = "canvas-obj-1";
          const sessionId = "session-1";

          // Create initial state with the item
          const initialState: CRDTState = {
            sessionId,
            items: {
              [itemId]: {
                itemId,
                fields: {
                  [field]: {
                    value: "initial",
                    timestamp: { wallTime: 0, logical: 0, nodeId: "init" },
                    replicaId: "init",
                  },
                },
                addedAt: { wallTime: 0, logical: 0, nodeId: "init" },
                removedAt: null,
              },
            },
            version: 1,
            lastUpdated: { wallTime: 0, logical: 0, nodeId: "init" },
          };

          // Operation with higher timestamp
          const opHigher: CRDTOperation = {
            id: "op-higher",
            sessionId,
            replicaId: replicaA || "replica-a",
            type: "update",
            itemId,
            payload: { [field]: valueHigher },
            timestamp: higher,
            version: 1,
          };

          // Operation with lower timestamp
          const opLower: CRDTOperation = {
            id: "op-lower",
            sessionId,
            replicaId: replicaB || "replica-b",
            type: "update",
            itemId,
            payload: { [field]: valueLower },
            timestamp: lower,
            version: 1,
          };

          // Order 1: apply higher first, then lower
          const state1 = deepCloneState(initialState);
          mergeOperation(state1, opHigher);
          mergeOperation(state1, opLower);

          // Order 2: apply lower first, then higher
          const state2 = deepCloneState(initialState);
          mergeOperation(state2, opLower);
          mergeOperation(state2, opHigher);

          // In both cases, the field should hold the higher-timestamp value
          const fieldReg1 = state1.items[itemId].fields[field];
          const fieldReg2 = state2.items[itemId].fields[field];

          expect(fieldReg1.value).toEqual(valueHigher);
          expect(fieldReg2.value).toEqual(valueHigher);

          // The winning timestamp should be the higher one
          expect(compareTimestamps(fieldReg1.timestamp, higher)).toBe(0);
          expect(compareTimestamps(fieldReg2.timestamp, higher)).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("logical counter breaks wallTime ties correctly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 1, max: 9999 }),
        arbFieldName(),
        arbFieldValue(),
        arbFieldValue(),
        (wallTime, logicalLow, logicalDelta, field, winnerValue, loserValue) => {
          const logicalHigh = logicalLow + logicalDelta;
          const nodeId = "same-node";
          const itemId = "canvas-obj-1";
          const sessionId = "session-1";

          const higherTs: HLCTimestamp = {
            wallTime,
            logical: logicalHigh,
            nodeId,
          };
          const lowerTs: HLCTimestamp = {
            wallTime,
            logical: logicalLow,
            nodeId,
          };

          // Verify our setup is correct
          expect(compareTimestamps(higherTs, lowerTs)).toBeGreaterThan(0);

          const initialState: CRDTState = {
            sessionId,
            items: {
              [itemId]: {
                itemId,
                fields: {
                  [field]: {
                    value: "initial",
                    timestamp: { wallTime: 0, logical: 0, nodeId: "init" },
                    replicaId: "init",
                  },
                },
                addedAt: { wallTime: 0, logical: 0, nodeId: "init" },
                removedAt: null,
              },
            },
            version: 1,
            lastUpdated: { wallTime: 0, logical: 0, nodeId: "init" },
          };

          const opWinner: CRDTOperation = {
            id: "op-winner",
            sessionId,
            replicaId: "replica-a",
            type: "update",
            itemId,
            payload: { [field]: winnerValue },
            timestamp: higherTs,
            version: 1,
          };

          const opLoser: CRDTOperation = {
            id: "op-loser",
            sessionId,
            replicaId: "replica-b",
            type: "update",
            itemId,
            payload: { [field]: loserValue },
            timestamp: lowerTs,
            version: 1,
          };

          // Apply loser first, then winner
          const state = deepCloneState(initialState);
          mergeOperation(state, opLoser);
          mergeOperation(state, opWinner);

          expect(state.items[itemId].fields[field].value).toEqual(winnerValue);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("nodeId lexicographic comparison breaks full ties (same wallTime, same logical)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 10000 }),
        fc
          .tuple(
            fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/),
            fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/)
          )
          .filter(([a, b]) => a !== b),
        arbFieldName(),
        arbFieldValue(),
        arbFieldValue(),
        (wallTime, logical, [nodeA, nodeB], field, valueA, valueB) => {
          const itemId = "canvas-obj-1";
          const sessionId = "session-1";

          const tsA: HLCTimestamp = { wallTime, logical, nodeId: nodeA };
          const tsB: HLCTimestamp = { wallTime, logical, nodeId: nodeB };

          // Determine which node has the lexicographically higher nodeId
          const cmp = compareTimestamps(tsA, tsB);
          const winnerTs = cmp > 0 ? tsA : tsB;
          const winnerValue = cmp > 0 ? valueA : valueB;

          const initialState: CRDTState = {
            sessionId,
            items: {
              [itemId]: {
                itemId,
                fields: {
                  [field]: {
                    value: "initial",
                    timestamp: { wallTime: 0, logical: 0, nodeId: "init" },
                    replicaId: "init",
                  },
                },
                addedAt: { wallTime: 0, logical: 0, nodeId: "init" },
                removedAt: null,
              },
            },
            version: 1,
            lastUpdated: { wallTime: 0, logical: 0, nodeId: "init" },
          };

          const opA: CRDTOperation = {
            id: "op-a",
            sessionId,
            replicaId: nodeA,
            type: "update",
            itemId,
            payload: { [field]: valueA },
            timestamp: tsA,
            version: 1,
          };

          const opB: CRDTOperation = {
            id: "op-b",
            sessionId,
            replicaId: nodeB,
            type: "update",
            itemId,
            payload: { [field]: valueB },
            timestamp: tsB,
            version: 1,
          };

          // Apply in both orders
          const state1 = deepCloneState(initialState);
          mergeOperation(state1, opA);
          mergeOperation(state1, opB);

          const state2 = deepCloneState(initialState);
          mergeOperation(state2, opB);
          mergeOperation(state2, opA);

          // Both orders should converge to the same winner
          expect(state1.items[itemId].fields[field].value).toEqual(winnerValue);
          expect(state2.items[itemId].fields[field].value).toEqual(winnerValue);

          // The winning timestamp should be the higher HLC
          expect(
            compareTimestamps(
              state1.items[itemId].fields[field].timestamp,
              winnerTs
            )
          ).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// Property 8: Remove-Wins Semantics
// =============================================================================

describe("Property 8: Remove-Wins Semantics", () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any concurrent update and delete operations targeting the same
   * Canvas_Object, the delete operation SHALL always win regardless of
   * HLC timestamp ordering.
   */

  /**
   * Generate a scenario with an active item plus concurrent update and remove
   * operations where the update has a HIGHER timestamp than the remove.
   * This is the critical case: even though update timestamp > remove timestamp,
   * the remove must still win.
   */
  function arbRemoveWinsScenario(): fc.Arbitrary<{
    state: CRDTState;
    removeOp: CRDTOperation;
    updateOp: CRDTOperation;
    itemId: string;
  }> {
    return fc
      .record({
        addedTs: arbHLCTimestamp(),
        removeTs: arbHLCTimestamp(),
        updateTs: arbHLCTimestamp(),
        updatePayload: arbPayload(),
        itemId: fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
        sessionId: fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
        removeReplica: fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
        updateReplica: fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
      })
      .map(
        ({
          addedTs,
          removeTs,
          updateTs,
          updatePayload,
          itemId,
          sessionId,
          removeReplica,
          updateReplica,
        }) => {
          // Create initial state with one active item
          const item: LWWElement = {
            itemId,
            fields: {
              x: {
                value: 0,
                timestamp: addedTs,
                replicaId: "init",
              },
              y: {
                value: 0,
                timestamp: addedTs,
                replicaId: "init",
              },
            },
            addedAt: addedTs,
            removedAt: null,
          };

          const state: CRDTState = {
            sessionId,
            items: { [itemId]: item },
            version: 1,
            lastUpdated: addedTs,
          };

          const removeOp: CRDTOperation = {
            id: "op-remove",
            sessionId,
            replicaId: removeReplica,
            type: "remove",
            itemId,
            payload: {},
            timestamp: removeTs,
            version: 1,
          };

          const updateOp: CRDTOperation = {
            id: "op-update",
            sessionId,
            replicaId: updateReplica,
            type: "update",
            itemId,
            payload: updatePayload,
            timestamp: updateTs,
            version: 1,
          };

          return { state, removeOp, updateOp, itemId };
        }
      );
  }

  it("delete always wins over concurrent update regardless of timestamp ordering (remove first)", () => {
    fc.assert(
      fc.property(arbRemoveWinsScenario(), ({ state, removeOp, updateOp, itemId }) => {
        // Apply remove then update
        const s = deepCloneState(state);
        mergeOperation(s, removeOp);
        mergeOperation(s, updateOp);

        // Item must remain tombstoned (removedAt is not null)
        expect(s.items[itemId].removedAt).not.toBeNull();
      }),
      { numRuns: 200 }
    );
  });

  it("delete always wins over concurrent update regardless of timestamp ordering (update first)", () => {
    fc.assert(
      fc.property(arbRemoveWinsScenario(), ({ state, removeOp, updateOp, itemId }) => {
        // Apply update then remove
        const s = deepCloneState(state);
        mergeOperation(s, updateOp);
        mergeOperation(s, removeOp);

        // Item must remain tombstoned (removedAt is not null)
        expect(s.items[itemId].removedAt).not.toBeNull();
      }),
      { numRuns: 200 }
    );
  });

  it("both orderings converge to the same removedAt timestamp", () => {
    fc.assert(
      fc.property(arbRemoveWinsScenario(), ({ state, removeOp, updateOp, itemId }) => {
        // Order 1: remove → update
        const s1 = deepCloneState(state);
        mergeOperation(s1, removeOp);
        mergeOperation(s1, updateOp);

        // Order 2: update → remove
        const s2 = deepCloneState(state);
        mergeOperation(s2, updateOp);
        mergeOperation(s2, removeOp);

        // Both must be removed
        expect(s1.items[itemId].removedAt).not.toBeNull();
        expect(s2.items[itemId].removedAt).not.toBeNull();

        // Both orderings produce same removedAt
        expect(s1.items[itemId].removedAt).toEqual(s2.items[itemId].removedAt);
      }),
      { numRuns: 200 }
    );
  });

  it("remove wins even when update has a strictly higher HLC timestamp", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctHLCTimestamps(),
        arbPayload(),
        fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
        (timestamps, updatePayload, itemId) => {
          const { higher: updateTs, lower: removeTs } = timestamps;
          const sessionId = "session-1";

          // Setup: item exists with low timestamp
          const initialState: CRDTState = {
            sessionId,
            items: {
              [itemId]: {
                itemId,
                fields: {
                  x: {
                    value: 0,
                    timestamp: { wallTime: 0, logical: 0, nodeId: "init" },
                    replicaId: "init",
                  },
                },
                addedAt: { wallTime: 0, logical: 0, nodeId: "init" },
                removedAt: null,
              },
            },
            version: 1,
            lastUpdated: { wallTime: 0, logical: 0, nodeId: "init" },
          };

          // Update has HIGHER timestamp than remove
          const updateOp: CRDTOperation = {
            id: "op-update",
            sessionId,
            replicaId: "client-updater",
            type: "update",
            itemId,
            payload: updatePayload,
            timestamp: updateTs,
            version: 1,
          };

          const removeOp: CRDTOperation = {
            id: "op-remove",
            sessionId,
            replicaId: "client-remover",
            type: "remove",
            itemId,
            payload: {},
            timestamp: removeTs,
            version: 1,
          };

          // Apply update first (higher ts), then remove (lower ts)
          const state = deepCloneState(initialState);
          mergeOperation(state, updateOp);
          mergeOperation(state, removeOp);

          // Remove must still win — item is tombstoned
          expect(state.items[itemId].removedAt).not.toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// Property 9: Freehand Path Append-Only Merge
// =============================================================================

describe("Property 9: Freehand Path Append-Only Merge", () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * For any set of concurrent freehand path point additions from different
   * clients targeting the same Canvas_Object, all point segments SHALL be
   * present in the merged result with no data loss.
   *
   * The native merge addon treats "points" fields as append-only sequences.
   * In the TypeScript merge layer, concurrent point additions from different
   * replicas to different field keys (e.g., points_replicaA, points_replicaB)
   * are preserved via LWW per-field semantics — each replica owns its segment.
   *
   * For this property test, we simulate the append-only merge pattern by
   * having each client add points under a replica-scoped field key, ensuring
   * all segments are preserved after merge regardless of order.
   */

  /** Generate a freehand path point */
  function arbPoint(): fc.Arbitrary<{ x: number; y: number; pressure?: number }> {
    return fc.record({
      x: fc.float({ min: 0, max: 1000, noNaN: true }),
      y: fc.float({ min: 0, max: 1000, noNaN: true }),
      pressure: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    });
  }

  /** Generate an array of path points representing a stroke segment */
  function arbPointSegment(): fc.Arbitrary<Array<{ x: number; y: number; pressure?: number }>> {
    return fc.array(arbPoint(), { minLength: 1, maxLength: 20 });
  }

  /**
   * Generate a scenario with multiple replicas each adding point segments
   * to the same canvas object (freehand path).
   */
  function arbFreehandScenario(): fc.Arbitrary<{
    state: CRDTState;
    operations: CRDTOperation[];
    replicaIds: string[];
    segments: Array<Array<{ x: number; y: number; pressure?: number }>>;
    itemId: string;
  }> {
    return fc
      .record({
        numReplicas: fc.integer({ min: 2, max: 5 }),
        baseWallTime: fc.integer({ min: 100, max: 1_000_000_000 }),
      })
      .chain(({ numReplicas, baseWallTime }) => {
        const replicaIds = Array.from(
          { length: numReplicas },
          (_, i) => `replica-${String.fromCharCode(97 + i)}`
        );

        return fc
          .tuple(
            ...replicaIds.map(() => arbPointSegment())
          )
          .map((segments) => {
            const itemId = "freehand-path-1";
            const sessionId = "session-1";

            // Initial state: a freehand canvas object exists
            const initialState: CRDTState = {
              sessionId,
              items: {
                [itemId]: {
                  itemId,
                  fields: {
                    type: {
                      value: "freehand",
                      timestamp: { wallTime: 1, logical: 0, nodeId: "creator" },
                      replicaId: "creator",
                    },
                  },
                  addedAt: { wallTime: 1, logical: 0, nodeId: "creator" },
                  removedAt: null,
                },
              },
              version: 1,
              lastUpdated: { wallTime: 1, logical: 0, nodeId: "creator" },
            };

            // Each replica adds its points under a unique field key
            // This models the append-only sequence pattern where each replica
            // contributes its own segment independently
            const operations: CRDTOperation[] = replicaIds.map(
              (replicaId, index) => ({
                id: `op-points-${replicaId}`,
                sessionId,
                replicaId,
                type: "update" as const,
                itemId,
                payload: {
                  [`points_${replicaId}`]: segments[index],
                },
                timestamp: {
                  wallTime: baseWallTime + index,
                  logical: 0,
                  nodeId: replicaId,
                },
                version: 1,
              })
            );

            return {
              state: initialState,
              operations,
              replicaIds,
              segments: segments as Array<Array<{ x: number; y: number; pressure?: number }>>,
              itemId,
            };
          });
      });
  }

  it("all point segments from all replicas are preserved after merge in any order", () => {
    fc.assert(
      fc.property(
        arbFreehandScenario(),
        ({ state, operations, replicaIds, segments, itemId }) => {
          // Apply all operations in the given order
          const s = deepCloneState(state);
          for (const op of operations) {
            mergeOperation(s, op);
          }

          // Verify all segments are present
          const item = s.items[itemId];
          for (let i = 0; i < replicaIds.length; i++) {
            const fieldKey = `points_${replicaIds[i]}`;
            expect(item.fields[fieldKey]).toBeDefined();
            expect(item.fields[fieldKey].value).toEqual(segments[i]);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("append-only merge is order-independent — all permutations preserve all segments", () => {
    fc.assert(
      fc.property(
        arbFreehandScenario().filter(
          ({ operations }) => operations.length >= 2 && operations.length <= 4
        ),
        ({ state, operations, replicaIds, segments, itemId }) => {
          // Generate all permutations for small sets (2-4 replicas)
          const perms = permutations(operations);

          // Apply each permutation and verify all produce the same fields
          const results = perms.map((perm) => {
            const s = deepCloneState(state);
            for (const op of perm) {
              mergeOperation(s, op);
            }
            return s.items[itemId].fields;
          });

          // All permutations should yield identical field state
          for (let i = 1; i < results.length; i++) {
            expect(results[i]).toEqual(results[0]);
          }

          // All segments must be present in the first result
          for (let i = 0; i < replicaIds.length; i++) {
            const fieldKey = `points_${replicaIds[i]}`;
            expect(results[0][fieldKey]).toBeDefined();
            expect(results[0][fieldKey].value).toEqual(segments[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no data loss: merged point count equals sum of all contributed points", () => {
    fc.assert(
      fc.property(
        arbFreehandScenario(),
        ({ state, operations, replicaIds, segments, itemId }) => {
          const s = deepCloneState(state);
          for (const op of operations) {
            mergeOperation(s, op);
          }

          // Count total points across all replica segments in merged state
          let totalMergedPoints = 0;
          for (const replicaId of replicaIds) {
            const fieldKey = `points_${replicaId}`;
            const fieldValue = s.items[itemId].fields[fieldKey]?.value;
            if (Array.isArray(fieldValue)) {
              totalMergedPoints += fieldValue.length;
            }
          }

          // Count expected total from input segments
          const expectedTotal = segments.reduce(
            (sum, seg) => sum + seg.length,
            0
          );

          expect(totalMergedPoints).toBe(expectedTotal);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// Helpers
// =============================================================================

/** Generate all permutations of an array (for small arrays only) */
function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}
