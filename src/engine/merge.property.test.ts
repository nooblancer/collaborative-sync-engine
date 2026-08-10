/**
 * Property-based tests for CRDT merge operations.
 * Tests verify mathematical properties of the LWW-Element-Set merge.
 *
 * Feature: collaborative-sync-engine
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { mergeOperation } from "./merge.js";
import type {
  CRDTState,
  CRDTOperation,
  HLCTimestamp,
  OperationType,
  LWWElement,
  LWWRegister,
} from "../types/index.js";

// --- Arbitraries (generators) ---

/** Generate a valid HLC timestamp with wallTime > 0, logical >= 0, non-empty nodeId */
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

/** Generate a valid operation type */
function arbOperationType(): fc.Arbitrary<OperationType> {
  return fc.constantFrom("add", "remove", "update");
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
    sessionId: fc.stringOf(fc.constantFrom("s", "e", "1", "2"), { minLength: 1, maxLength: 8 }),
    replicaId: fc.stringOf(fc.constantFrom("r", "e", "p", "1", "2", "3"), { minLength: 1, maxLength: 8 }),
    type: arbOperationType(),
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
 * Generate an initial state with 1-3 existing items so that
 * remove and update operations can target existing items.
 * Returns the state and two operations for commutativity testing.
 */
function arbInitialStateWithOps(): fc.Arbitrary<{
  state: CRDTState;
  opA: CRDTOperation;
  opB: CRDTOperation;
}> {
  const itemIds = ["item-1", "item-2", "item-3"];

  return fc
    .record({
      ts1: arbHLCTimestamp(),
      ts2: arbHLCTimestamp(),
      ts3: arbHLCTimestamp(),
      opA: arbCRDTOperation(itemIds),
      opB: arbCRDTOperation(itemIds),
    })
    .map(({ ts1, ts2, ts3, opA, opB }) => {
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
          },
          addedAt: ts,
          removedAt: null,
        };
        state.items[itemId] = element;
      }

      return { state, opA, opB };
    });
}

// --- Property Tests ---

describe("Feature: collaborative-sync-engine, Property 1: Merge Commutativity", () => {
  /**
   * **Validates: Requirements 3.4, 3.7, 5.4**
   *
   * For any two valid operations A and B on the same initial state,
   * mergeOperation(state, A, B) produces identical items as mergeOperation(state, B, A).
   *
   * This ensures that the order in which operations arrive at the server
   * does not affect the final converged state (strong eventual consistency).
   */
  it("merge(state, A, B) should produce the same items as merge(state, B, A) for any two valid operations", () => {
    fc.assert(
      fc.property(arbInitialStateWithOps(), ({ state: initialState, opA, opB }) => {
        // Apply A then B
        const stateAB = deepCloneState(initialState);
        mergeOperation(stateAB, opA);
        mergeOperation(stateAB, opB);

        // Apply B then A
        const stateBA = deepCloneState(initialState);
        mergeOperation(stateBA, opB);
        mergeOperation(stateBA, opA);

        // The CRDT data (items) must be identical regardless of application order.
        expect(stateAB.items).toEqual(stateBA.items);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: collaborative-sync-engine, Property 2: Merge Associativity", () => {
  /**
   * **Validates: Requirements 3.7, 5.2**
   *
   * For any three valid operations A, B, C applied to the same initial state,
   * applying them in any order/grouping should produce the same final state.
   * All 6 permutations of [A, B, C] must converge to identical items.
   *
   * This proves both commutativity and associativity of the merge operation,
   * ensuring strong eventual consistency regardless of operation arrival order.
   */
  it("all permutations of three operations produce the same final state", () => {
    const itemIds = ["item-1", "item-2", "item-3"];

    const arb = fc
      .record({
        ts1: arbHLCTimestamp(),
        ts2: arbHLCTimestamp(),
        ts3: arbHLCTimestamp(),
        opA: arbCRDTOperation(itemIds),
        opB: arbCRDTOperation(itemIds),
        opC: arbCRDTOperation(itemIds),
      })
      .map(({ ts1, ts2, ts3, opA, opB, opC }) => {
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
            },
            addedAt: ts,
            removedAt: null,
          };
          state.items[itemId] = element;
        }

        return { state, opA, opB, opC };
      });

    fc.assert(
      fc.property(arb, ({ state: initialState, opA, opB, opC }) => {
        // All 6 permutations of [A, B, C]
        const permutations: [CRDTOperation, CRDTOperation, CRDTOperation][] = [
          [opA, opB, opC],
          [opA, opC, opB],
          [opB, opA, opC],
          [opB, opC, opA],
          [opC, opA, opB],
          [opC, opB, opA],
        ];

        // Apply each permutation to a deep-cloned copy of the base state
        const results = permutations.map(([first, second, third]) => {
          const s = deepCloneState(initialState);
          mergeOperation(s, first);
          mergeOperation(s, second);
          mergeOperation(s, third);
          return s;
        });

        // All permutations must produce identical items
        for (let i = 1; i < results.length; i++) {
          expect(results[i].items).toEqual(results[0].items);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("grouping of merges does not affect final state: ((S⊕A)⊕B)⊕C = ((S⊕C)⊕B)⊕A", () => {
    const itemIds = ["item-1", "item-2", "item-3"];

    const arb = fc
      .record({
        ts1: arbHLCTimestamp(),
        ts2: arbHLCTimestamp(),
        ts3: arbHLCTimestamp(),
        opA: arbCRDTOperation(itemIds),
        opB: arbCRDTOperation(itemIds),
        opC: arbCRDTOperation(itemIds),
      })
      .map(({ ts1, ts2, ts3, opA, opB, opC }) => {
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
            },
            addedAt: ts,
            removedAt: null,
          };
          state.items[itemId] = element;
        }

        return { state, opA, opB, opC };
      });

    fc.assert(
      fc.property(arb, ({ state: initialState, opA, opB, opC }) => {
        // Grouping 1: ((S ⊕ A) ⊕ B) ⊕ C
        const s1 = deepCloneState(initialState);
        mergeOperation(s1, opA);
        mergeOperation(s1, opB);
        mergeOperation(s1, opC);

        // Grouping 2: ((S ⊕ C) ⊕ B) ⊕ A
        const s2 = deepCloneState(initialState);
        mergeOperation(s2, opC);
        mergeOperation(s2, opB);
        mergeOperation(s2, opA);

        // Grouping 3: ((S ⊕ B) ⊕ C) ⊕ A
        const s3 = deepCloneState(initialState);
        mergeOperation(s3, opB);
        mergeOperation(s3, opC);
        mergeOperation(s3, opA);

        // All groupings must produce the same items state
        expect(s1.items).toEqual(s2.items);
        expect(s1.items).toEqual(s3.items);
      }),
      { numRuns: 100 }
    );
  });
});
