/**
 * Property-based tests for Snapshot Manager V2.
 *
 * Property 37: Snapshot Creation at Threshold
 * Property 38: Snapshot Garbage Collection
 * Property 39: New Client Receives Snapshot Plus Tail
 *
 * Validates: Requirements 23.1, 23.2, 23.3, 23.4
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SnapshotManagerV2 } from "./snapshot-manager-v2.js";
import type {
  CRDTState,
  CRDTOperation,
  HLCTimestamp,
  LWWElement,
} from "../types/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create an empty CRDT state for a room. */
function createEmptyState(roomId: string): CRDTState {
  return {
    sessionId: roomId,
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "" },
  };
}

/** Create a CRDT state with the given items (some may be tombstoned). */
function createStateWithItems(
  roomId: string,
  items: Record<string, LWWElement>
): CRDTState {
  return {
    sessionId: roomId,
    items,
    version: Object.keys(items).length,
    lastUpdated: { wallTime: Date.now(), logical: 0, nodeId: "test-node" },
  };
}

/** Apply an "add" operation to a state (simplified merge for test). */
function applyOperation(state: CRDTState, op: CRDTOperation): void {
  if (op.type === "add") {
    state.items[op.itemId] = {
      itemId: op.itemId,
      fields: Object.fromEntries(
        Object.entries(op.payload).map(([key, value]) => [
          key,
          { value, timestamp: op.timestamp, replicaId: op.replicaId },
        ])
      ),
      addedAt: op.timestamp,
      removedAt: null,
    };
  } else if (op.type === "remove") {
    if (state.items[op.itemId]) {
      state.items[op.itemId].removedAt = op.timestamp;
    }
  } else if (op.type === "update") {
    if (state.items[op.itemId]) {
      for (const [key, value] of Object.entries(op.payload)) {
        state.items[op.itemId].fields[key] = {
          value,
          timestamp: op.timestamp,
          replicaId: op.replicaId,
        };
      }
    }
  }
  state.version++;
  state.lastUpdated = op.timestamp;
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a valid HLC timestamp with wall time in a given range. */
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

/** Generate a non-empty payload. */
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

/** Generate a sequence of "add" operations with monotonically increasing wallTimes. */
function arbAddOperations(
  roomId: string,
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
        logical: fc.nat({ max: 1000 }),
        nodeId: fc.stringOf(
          fc.constantFrom("a", "b", "c", "d", "e", "f"),
          { minLength: 1, maxLength: 6 }
        ),
        version: fc.nat({ max: 100 }),
      }),
      { minLength: count, maxLength: count }
    )
    .map((records) =>
      records.map((r, index) => ({
        id: r.id,
        sessionId: roomId,
        replicaId: r.replicaId,
        type: "add" as const,
        itemId: r.itemId,
        payload: r.payload,
        timestamp: {
          wallTime: baseWallTime + index, // Monotonically increasing
          logical: r.logical,
          nodeId: r.nodeId,
        },
        version: r.version,
      }))
    );
}

/**
 * Generate a sequence of operations where some items get tombstoned (removed).
 * First half are "add" operations, then some get "remove" operations applied.
 */
function arbOpsWithTombstones(
  roomId: string,
  addCount: number,
  removeCount: number,
  baseWallTime: number
): fc.Arbitrary<CRDTOperation[]> {
  return arbAddOperations(roomId, addCount, baseWallTime).chain((addOps) => {
    // Pick items to remove (up to removeCount, from the added items)
    const toRemove = Math.min(removeCount, addOps.length);
    return fc
      .shuffledSubarray(addOps, { minLength: toRemove, maxLength: toRemove })
      .map((removedOps) => {
        const removeOps: CRDTOperation[] = removedOps.map((addOp, i) => ({
          id: `remove-${addOp.itemId}`,
          sessionId: roomId,
          replicaId: addOp.replicaId,
          type: "remove" as const,
          itemId: addOp.itemId,
          payload: {},
          timestamp: {
            wallTime: baseWallTime + addCount + i, // After all adds
            logical: 0,
            nodeId: addOp.timestamp.nodeId,
          },
          version: 0,
        }));
        return [...addOps, ...removeOps];
      });
  });
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Property 37: Snapshot Creation at Threshold", () => {
  /**
   * **Validates: Requirements 23.1**
   *
   * For any room reaching 1,000 operations since the last snapshot (or since creation),
   * the Sync_Engine SHALL compute and persist a new state Snapshot.
   */
  it("a snapshot is created exactly when the operation count reaches the configured threshold", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Use a small threshold (3-20) for test efficiency instead of 1000
        fc.integer({ min: 3, max: 20 }),
        // Generate extra operations beyond the threshold to verify behavior
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (threshold, extraOps, baseWallTime) => {
          const roomId = "test-room";
          const manager = new SnapshotManagerV2({
            snapshotThreshold: threshold,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          const totalOps = threshold + extraOps;
          const ops = fc.sample(
            arbAddOperations(roomId, totalOps, baseWallTime),
            1
          )[0];

          let snapshotCreated = false;
          let snapshotCreatedAtOp = -1;

          // Record operations one by one
          for (let i = 0; i < totalOps; i++) {
            applyOperation(state, ops[i]);
            const result = await manager.recordOperation(
              roomId,
              ops[i],
              state
            );

            if (result !== null && !snapshotCreated) {
              snapshotCreated = true;
              snapshotCreatedAtOp = i + 1; // 1-indexed operation count
            }
          }

          // A snapshot MUST have been created
          expect(snapshotCreated).toBe(true);

          // The snapshot MUST be created at exactly the threshold operation
          expect(snapshotCreatedAtOp).toBe(threshold);

          // The latest snapshot MUST exist
          const latest = await manager.getLatestSnapshot(roomId);
          expect(latest).not.toBeNull();
          expect(latest!.state).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no snapshot is created before reaching the threshold", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 30 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (threshold, baseWallTime) => {
          const roomId = "test-room";
          const manager = new SnapshotManagerV2({
            snapshotThreshold: threshold,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          // Record threshold - 1 operations (just below the threshold)
          const ops = fc.sample(
            arbAddOperations(roomId, threshold - 1, baseWallTime),
            1
          )[0];

          for (const op of ops) {
            applyOperation(state, op);
            const result = await manager.recordOperation(roomId, op, state);
            // No snapshot should be created before reaching threshold
            expect(result).toBeNull();
          }

          // Verify no snapshot exists
          const latest = await manager.getLatestSnapshot(roomId);
          expect(latest).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("after a snapshot, the counter resets and a new snapshot is created at the next threshold", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 15 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (threshold, baseWallTime) => {
          const roomId = "test-room";
          const manager = new SnapshotManagerV2({
            snapshotThreshold: threshold,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          // Generate enough operations for 2 full snapshot cycles
          const totalOps = threshold * 2;
          const ops = fc.sample(
            arbAddOperations(roomId, totalOps, baseWallTime),
            1
          )[0];

          let snapshotCount = 0;
          for (const op of ops) {
            applyOperation(state, op);
            const result = await manager.recordOperation(roomId, op, state);
            if (result !== null) {
              snapshotCount++;
            }
          }

          // Exactly 2 snapshots should be created across 2*threshold operations
          expect(snapshotCount).toBe(2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 38: Snapshot Garbage Collection", () => {
  /**
   * **Validates: Requirements 23.2, 23.3**
   *
   * For any Snapshot created, all operations prior to that Snapshot SHALL be marked
   * as eligible for garbage collection, and all tombstoned (deleted) entries SHALL
   * be removed from the active in-memory state.
   */
  it("garbage collection removes all pre-snapshot operations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 15 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (threshold, postSnapshotOps, baseWallTime) => {
          const roomId = "test-room";
          const manager = new SnapshotManagerV2({
            snapshotThreshold: threshold,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          // Generate threshold ops to trigger a snapshot, then extra ops after
          const totalOps = threshold + postSnapshotOps;
          const ops = fc.sample(
            arbAddOperations(roomId, totalOps, baseWallTime),
            1
          )[0];

          let snapshot = null;
          for (const op of ops) {
            applyOperation(state, op);
            const result = await manager.recordOperation(roomId, op, state);
            if (result !== null && snapshot === null) {
              snapshot = result;
            }
          }

          expect(snapshot).not.toBeNull();

          // Operations before GC should include all recorded ops
          const opsBeforeGC = manager.getOperations(roomId);
          expect(opsBeforeGC.length).toBe(totalOps);

          // Perform garbage collection
          const removedCount = await manager.garbageCollect(roomId, snapshot!);

          // After GC, pre-snapshot operations should be removed
          const opsAfterGC = manager.getOperations(roomId);

          // All remaining ops should have wallTime >= snapshot's createdAt
          for (const op of opsAfterGC) {
            expect(op.timestamp.wallTime).toBeGreaterThanOrEqual(
              snapshot!.createdAt
            );
          }

          // The number removed should equal the total minus remaining
          expect(removedCount).toBe(totalOps - opsAfterGC.length);
          expect(removedCount).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("garbage collection removes all tombstoned entries from active state", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (addCount, baseWallTime) => {
          const roomId = "test-room";
          // Remove between 1 and addCount items
          const removeCount = Math.max(1, Math.floor(addCount / 2));

          // Use a threshold above our op count so we control snapshotting manually
          const manager = new SnapshotManagerV2({
            snapshotThreshold: addCount + removeCount + 100,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          // Generate operations with some items getting tombstoned
          const ops = fc.sample(
            arbOpsWithTombstones(roomId, addCount, removeCount, baseWallTime),
            1
          )[0];

          // Apply all operations
          for (const op of ops) {
            applyOperation(state, op);
            await manager.recordOperation(roomId, op, state);
          }

          // Verify that tombstoned items exist in state before GC
          const tombstonedBefore = Object.values(state.items).filter(
            (item) => item.removedAt !== null
          );
          expect(tombstonedBefore.length).toBeGreaterThan(0);

          // Force a snapshot and GC
          const snapshot = await manager.forceSnapshot(roomId);
          await manager.garbageCollect(roomId, snapshot);

          // After GC, NO tombstoned items should remain in active state
          const tombstonedAfter = Object.values(state.items).filter(
            (item) => item.removedAt !== null
          );
          expect(tombstonedAfter.length).toBe(0);

          // Active (non-tombstoned) items should still be present
          const activeItems = Object.values(state.items);
          expect(activeItems.length).toBe(addCount - removeCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 39: New Client Receives Snapshot Plus Tail", () => {
  /**
   * **Validates: Requirements 23.4**
   *
   * For any room with at least one Snapshot, a newly joining client SHALL receive
   * the most recent Snapshot plus only operations created after that Snapshot,
   * not the full operation history.
   */
  it("client join data contains latest snapshot plus only post-snapshot operations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 15 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (threshold, postSnapshotOps, baseWallTime) => {
          const roomId = "test-room";
          const manager = new SnapshotManagerV2({
            snapshotThreshold: threshold,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          // Ensure postSnapshotOps is strictly less than threshold to avoid a second snapshot
          const effectivePostOps = Math.min(postSnapshotOps, threshold - 1);
          const totalOps = threshold + effectivePostOps;
          const ops = fc.sample(
            arbAddOperations(roomId, totalOps, baseWallTime),
            1
          )[0];

          let snapshot = null;
          for (const op of ops) {
            applyOperation(state, op);
            const result = await manager.recordOperation(roomId, op, state);
            if (result !== null && snapshot === null) {
              snapshot = result;
            }
          }

          expect(snapshot).not.toBeNull();

          // Get client join data (simulating a new client joining)
          const joinData = await manager.getClientJoinData(roomId);

          // Must include the latest snapshot (which is the only one in this case)
          expect(joinData.snapshot).not.toBeNull();
          expect(joinData.snapshot!.id).toBe(snapshot!.id);

          // Tail operations must only contain operations AFTER the snapshot
          for (const tailOp of joinData.tailOperations) {
            expect(tailOp.timestamp.wallTime).toBeGreaterThanOrEqual(
              joinData.snapshot!.createdAt
            );
          }

          // Tail operations should NOT include all operations from history
          // (they should be fewer than the total operations)
          expect(joinData.tailOperations.length).toBeLessThan(totalOps);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("client join data without any snapshot returns all operations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (opCount, baseWallTime) => {
          const roomId = "test-room";
          // Set threshold high so no snapshot is triggered
          const manager = new SnapshotManagerV2({
            snapshotThreshold: opCount + 100,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          const ops = fc.sample(
            arbAddOperations(roomId, opCount, baseWallTime),
            1
          )[0];

          for (const op of ops) {
            applyOperation(state, op);
            await manager.recordOperation(roomId, op, state);
          }

          // Get client join data — no snapshot exists
          const joinData = await manager.getClientJoinData(roomId);

          // No snapshot should be present
          expect(joinData.snapshot).toBeNull();

          // ALL operations should be returned as tail operations
          expect(joinData.tailOperations.length).toBe(opCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("after GC, client join data still provides correct snapshot plus remaining tail", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 15 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1_000_000, max: 9_000_000 }),
        async (threshold, postSnapshotOps, baseWallTime) => {
          const roomId = "test-room";
          const manager = new SnapshotManagerV2({
            snapshotThreshold: threshold,
          });

          const state = createEmptyState(roomId);
          manager.registerRoom(roomId, state);

          const totalOps = threshold + postSnapshotOps;
          const ops = fc.sample(
            arbAddOperations(roomId, totalOps, baseWallTime),
            1
          )[0];

          let snapshot = null;
          for (const op of ops) {
            applyOperation(state, op);
            const result = await manager.recordOperation(roomId, op, state);
            if (result !== null && snapshot === null) {
              snapshot = result;
            }
          }

          expect(snapshot).not.toBeNull();

          // Perform GC to remove pre-snapshot operations
          await manager.garbageCollect(roomId, snapshot!);

          // Get client join data AFTER GC
          const joinData = await manager.getClientJoinData(roomId);

          // Must still have the snapshot
          expect(joinData.snapshot).not.toBeNull();

          // Tail operations should still be the post-snapshot operations only
          for (const tailOp of joinData.tailOperations) {
            expect(tailOp.timestamp.wallTime).toBeGreaterThanOrEqual(
              joinData.snapshot!.createdAt
            );
          }

          // After GC, the tail operations should still be valid
          // (only remaining operations after GC are post-snapshot)
          expect(joinData.tailOperations.length).toBeLessThanOrEqual(
            postSnapshotOps
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
