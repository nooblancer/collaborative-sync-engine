/**
 * Property-based tests for the Persistence Layer: State Recovery via Replay.
 *
 * Feature: collaborative-sync-engine, Property 14: State Recovery via Replay
 *
 * Validates: Requirements 7.4
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { InMemoryPersistenceLayer } from "./persistence-layer.js";
import { SnapshotManager } from "./snapshot-manager.js";
import { mergeOperation } from "../engine/merge.js";
import type { CRDTState, CRDTOperation, HLCTimestamp } from "../types/index.js";

// --- Helpers ---

/** Create an empty CRDT state for a session */
function createEmptyState(sessionId: string): CRDTState {
  return {
    sessionId,
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "" },
  };
}

// --- Arbitraries (generators) ---

/** Generate a valid HLC timestamp with a specific wallTime base to control ordering */
function arbHLCTimestamp(baseWallTime: number): fc.Arbitrary<HLCTimestamp> {
  return fc.record({
    wallTime: fc.integer({ min: baseWallTime, max: baseWallTime + 100_000 }),
    logical: fc.nat({ max: 1000 }),
    nodeId: fc.stringOf(
      fc.constantFrom("a", "b", "c", "d", "e", "f", "1", "2", "3"),
      { minLength: 1, maxLength: 8 }
    ),
  });
}

/** Generate a non-empty payload */
function arbPayload(): fc.Arbitrary<Record<string, unknown>> {
  return fc.dictionary(
    fc.constantFrom("name", "qty", "price", "color", "desc"),
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.integer({ min: 0, max: 10000 }),
      fc.boolean()
    ),
    { minKeys: 1, maxKeys: 3 }
  );
}

/**
 * Generate a sequence of valid "add" operations.
 * We use only "add" operations with unique item IDs to guarantee that
 * every operation successfully merges (no "unknown item" errors from update/remove).
 * This isolates the property under test: recovery equivalence.
 */
function arbOperationSequence(
  sessionId: string,
  count: number,
  baseWallTime: number
): fc.Arbitrary<CRDTOperation[]> {
  return fc
    .array(
      fc.record({
        id: fc.uuid(),
        replicaId: fc.stringOf(
          fc.constantFrom("r", "e", "p", "1", "2", "3"),
          { minLength: 1, maxLength: 6 }
        ),
        itemId: fc.uuid(),
        payload: arbPayload(),
        timestamp: arbHLCTimestamp(baseWallTime),
        version: fc.nat({ max: 100 }),
      }),
      { minLength: count, maxLength: count }
    )
    .map((records) =>
      records.map((r) => ({
        ...r,
        sessionId,
        type: "add" as const,
      }))
    );
}

/**
 * Generate a sequence of mixed operations (add, update, remove) that
 * are valid in sequence: first generates adds to create items, then
 * generates updates/removes targeting those items.
 */
function arbMixedOperationSequence(
  sessionId: string,
  count: number,
  baseWallTime: number
): fc.Arbitrary<CRDTOperation[]> {
  // First half are adds (create items), second half can be any type targeting those items
  const addCount = Math.max(2, Math.ceil(count / 2));
  const mixedCount = count - addCount;

  return fc
    .record({
      adds: fc.array(
        fc.record({
          id: fc.uuid(),
          replicaId: fc.stringOf(
            fc.constantFrom("r", "e", "p", "1", "2", "3"),
            { minLength: 1, maxLength: 6 }
          ),
          itemId: fc.uuid(),
          payload: arbPayload(),
          timestamp: arbHLCTimestamp(baseWallTime),
          version: fc.nat({ max: 100 }),
        }),
        { minLength: addCount, maxLength: addCount }
      ),
      mixedOps: fc.array(
        fc.record({
          id: fc.uuid(),
          replicaId: fc.stringOf(
            fc.constantFrom("r", "e", "p", "1", "2", "3"),
            { minLength: 1, maxLength: 6 }
          ),
          type: fc.constantFrom("add", "update", "remove") as fc.Arbitrary<"add" | "update" | "remove">,
          payload: arbPayload(),
          timestamp: arbHLCTimestamp(baseWallTime),
          version: fc.nat({ max: 100 }),
        }),
        { minLength: mixedCount, maxLength: mixedCount }
      ),
    })
    .chain(({ adds, mixedOps }) => {
      // Extract created item IDs from the add operations
      const itemIds = adds.map((a) => a.itemId);

      // For mixed operations, pick random item IDs from the added items
      return fc
        .array(fc.constantFrom(...itemIds), {
          minLength: mixedOps.length,
          maxLength: mixedOps.length,
        })
        .map((selectedItemIds) => {
          const addOps: CRDTOperation[] = adds.map((a) => ({
            ...a,
            sessionId,
            type: "add" as const,
          }));

          const subsequentOps: CRDTOperation[] = mixedOps.map((op, i) => ({
            ...op,
            sessionId,
            itemId: selectedItemIds[i],
          }));

          return [...addOps, ...subsequentOps];
        });
    });
}

// --- Property Tests ---

describe("Feature: collaborative-sync-engine, Property 14: State Recovery via Replay", () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any operation log and any snapshot taken at an intermediate point,
   * replaying operations from the snapshot forward SHALL produce an identical
   * state to applying the entire operation log from scratch.
   */
  it("recovering from snapshot + subsequent ops produces the same state as full log replay", async () => {
    // Use a large base wallTime that's always in the future to avoid timing issues
    // with Date.now() used in snapshot.createdAt
    const BASE_WALL_TIME = Date.now() + 1_000_000;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        fc.integer({ min: 1000, max: 50000 }),
        async (totalOps, wallTimeOffset) => {
          const sessionId = "test-session";
          const baseWallTime = BASE_WALL_TIME + wallTimeOffset;

          // Generate operations using a seeded approach
          const ops = fc.sample(
            arbMixedOperationSequence(sessionId, totalOps, baseWallTime),
            1
          )[0];

          // Step 1: Full replay — apply all operations from empty state
          const fullReplayState = createEmptyState(sessionId);
          for (const op of ops) {
            mergeOperation(fullReplayState, op);
          }

          // Step 2: Pick a split point K (1 ≤ K < N)
          const splitPoint = fc.sample(
            fc.integer({ min: 1, max: ops.length - 1 }),
            1
          )[0];

          const beforeOps = ops.slice(0, splitPoint);
          const afterOps = ops.slice(splitPoint);

          // Step 3: Set up persistence and snapshot manager
          const persistence = new InMemoryPersistenceLayer();
          const snapshotManager = new SnapshotManager(persistence);

          // Step 4: Append operations 1..K
          for (const op of beforeOps) {
            await persistence.appendOperation(op);
          }

          // Step 5: Build state at split point and save snapshot
          const stateAtSplit = createEmptyState(sessionId);
          for (const op of beforeOps) {
            mergeOperation(stateAtSplit, op);
          }
          await snapshotManager.saveSnapshot(sessionId, stateAtSplit);

          // Step 6: Append operations K+1..N
          // These must have wallTime > snapshot.createdAt for getOperationsSince to find them
          // We ensure this by using afterOps whose wallTime is baseWallTime + offset,
          // which is always > Date.now() (the snapshot's createdAt)
          for (const op of afterOps) {
            await persistence.appendOperation(op);
          }

          // Step 7: Recover state using SnapshotManager
          const recoveredState = await snapshotManager.recoverState(sessionId);

          // Step 8: Verify recovered state matches full replay state
          expect(recoveredState.items).toEqual(fullReplayState.items);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("recovery with no snapshot replays full log and produces correct state", async () => {
    const BASE_WALL_TIME = Date.now() + 1_000_000;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        fc.integer({ min: 1000, max: 50000 }),
        async (totalOps, wallTimeOffset) => {
          const sessionId = "test-session";
          const baseWallTime = BASE_WALL_TIME + wallTimeOffset;

          const ops = fc.sample(
            arbOperationSequence(sessionId, totalOps, baseWallTime),
            1
          )[0];

          // Full replay manually
          const expectedState = createEmptyState(sessionId);
          for (const op of ops) {
            mergeOperation(expectedState, op);
          }

          // Set up persistence with no snapshot, only operations
          const persistence = new InMemoryPersistenceLayer();
          const snapshotManager = new SnapshotManager(persistence);

          for (const op of ops) {
            await persistence.appendOperation(op);
          }

          // Recover state (no snapshot — should replay full log)
          const recoveredState = await snapshotManager.recoverState(sessionId);

          // Must match the expected state
          expect(recoveredState.items).toEqual(expectedState.items);
        }
      ),
      { numRuns: 100 }
    );
  });
});
