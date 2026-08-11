/**
 * Property-based tests for SyncEngineV2 Time-Travel API.
 * Tests verify operation persistence with HLC, state reconstruction,
 * and operation range query causal ordering.
 *
 * Feature: sync-platform-v2
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SyncEngineV2 } from "./sync-engine-v2.js";
import { compareTimestamps } from "./hlc.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";
import { mergeOperation } from "./merge.js";

// --- Arbitraries (generators) ---

/**
 * Generate a valid HLC timestamp with strictly controlled wall time range.
 * We keep wallTime values small but distinct to ensure operations have
 * a meaningful causal ordering.
 */
function arbHLCTimestamp(opts?: {
  minWallTime?: number;
  maxWallTime?: number;
}): fc.Arbitrary<HLCTimestamp> {
  const minWall = opts?.minWallTime ?? 1;
  const maxWall = opts?.maxWallTime ?? 100_000;
  return fc.record({
    wallTime: fc.integer({ min: minWall, max: maxWall }),
    logical: fc.nat({ max: 100 }),
    nodeId: fc.stringOf(
      fc.constantFrom("a", "b", "c", "d", "e", "f", "1", "2", "3"),
      { minLength: 1, maxLength: 6 }
    ),
  });
}

/**
 * Generate a non-empty payload for operations.
 */
function arbPayload(): fc.Arbitrary<Record<string, unknown>> {
  return fc.dictionary(
    fc.constantFrom("name", "qty", "price", "color", "desc"),
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.integer({ min: 0, max: 1000 }),
      fc.boolean()
    ),
    { minKeys: 1, maxKeys: 3 }
  );
}

/**
 * Generate a valid CRDT "add" operation with a given item ID and timestamp.
 */
function arbAddOperationWithTimestamp(
  itemId: string,
  timestamp: HLCTimestamp
): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: fc.stringOf(fc.constantFrom("r", "e", "p", "1", "2", "3"), {
      minLength: 1,
      maxLength: 6,
    }),
    type: fc.constant("add" as const),
    itemId: fc.constant(itemId),
    payload: arbPayload(),
    timestamp: fc.constant(timestamp),
    version: fc.nat({ max: 100 }),
  });
}

/**
 * Generate a valid CRDT "add" operation with a specific timestamp injected.
 */
function arbAddOperation(timestamp: HLCTimestamp): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.uuid(),
    sessionId: fc.constant("test-session"),
    replicaId: fc.stringOf(fc.constantFrom("r", "e", "p", "1", "2", "3"), {
      minLength: 1,
      maxLength: 6,
    }),
    type: fc.constant("add" as const),
    itemId: fc.uuid(),
    payload: arbPayload(),
    timestamp: fc.constant(timestamp),
    version: fc.nat({ max: 100 }),
  });
}

/**
 * Generate a sequence of operations with strictly increasing HLC timestamps.
 * This ensures a well-ordered operation history for testing time-travel.
 */
function arbOperationSequence(opts?: {
  minLength?: number;
  maxLength?: number;
}): fc.Arbitrary<CRDTOperation[]> {
  const minLen = opts?.minLength ?? 2;
  const maxLen = opts?.maxLength ?? 20;

  return fc
    .array(
      fc.record({
        id: fc.uuid(),
        sessionId: fc.constant("test-session"),
        replicaId: fc.stringOf(
          fc.constantFrom("r", "e", "p", "1", "2", "3"),
          { minLength: 1, maxLength: 6 }
        ),
        type: fc.constantFrom("add" as const),
        itemId: fc.uuid(),
        payload: arbPayload(),
        wallTime: fc.integer({ min: 1, max: 100_000 }),
        logical: fc.nat({ max: 50 }),
        nodeId: fc.stringOf(
          fc.constantFrom("a", "b", "c", "d", "e", "f"),
          { minLength: 1, maxLength: 4 }
        ),
        version: fc.nat({ max: 100 }),
      }),
      { minLength: minLen, maxLength: maxLen }
    )
    .map((records) => {
      // Ensure unique timestamps by sorting and deduplicating
      const sorted = records.sort((a, b) => {
        if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
        if (a.logical !== b.logical) return a.logical - b.logical;
        if (a.nodeId < b.nodeId) return -1;
        if (a.nodeId > b.nodeId) return 1;
        return 0;
      });

      // Assign strictly increasing timestamps by bumping logical counter on ties
      const ops: CRDTOperation[] = [];
      let lastWall = 0;
      let lastLogical = -1;

      for (const rec of sorted) {
        let wall = rec.wallTime;
        let logical = rec.logical;

        if (wall === lastWall && logical <= lastLogical) {
          logical = lastLogical + 1;
        } else if (wall < lastWall) {
          wall = lastWall;
          logical = lastLogical + 1;
        }

        lastWall = wall;
        lastLogical = logical;

        ops.push({
          id: rec.id,
          sessionId: rec.sessionId,
          replicaId: rec.replicaId,
          type: rec.type,
          itemId: rec.itemId,
          payload: rec.payload,
          timestamp: { wallTime: wall, logical, nodeId: rec.nodeId },
          version: rec.version,
        });
      }

      return ops;
    });
}

/**
 * Generate a sequence of operations with potentially overlapping timestamps
 * from multiple nodes, suitable for testing causal ordering across nodes.
 */
function arbMultiNodeOperationSequence(opts?: {
  minLength?: number;
  maxLength?: number;
}): fc.Arbitrary<CRDTOperation[]> {
  const minLen = opts?.minLength ?? 3;
  const maxLen = opts?.maxLength ?? 15;

  return fc.array(
    fc.record({
      id: fc.uuid(),
      sessionId: fc.constant("test-session"),
      replicaId: fc.constantFrom("node-a", "node-b", "node-c"),
      type: fc.constant("add" as const),
      itemId: fc.uuid(),
      payload: arbPayload(),
      timestamp: fc.record({
        wallTime: fc.integer({ min: 1, max: 1000 }),
        logical: fc.nat({ max: 20 }),
        nodeId: fc.constantFrom("node-a", "node-b", "node-c"),
      }),
      version: fc.nat({ max: 100 }),
    }),
    { minLength: minLen, maxLength: maxLen }
  );
}

// --- Helper functions ---

/**
 * Creates a fresh CRDTState and replays ops up to timestamp T (inclusive).
 * This is the reference implementation for time-travel verification.
 */
function replayUpTo(
  ops: CRDTOperation[],
  targetTimestamp: HLCTimestamp,
  sessionId: string
): Record<string, unknown> {
  const state = {
    sessionId,
    items: {} as Record<string, unknown>,
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "server" },
  };

  for (const op of ops) {
    if (compareTimestamps(op.timestamp, targetTimestamp) <= 0) {
      mergeOperation(state as any, op);
    }
  }

  return state as unknown as Record<string, unknown>;
}

// --- Property Tests ---

describe("Feature: sync-platform-v2, Property 21: Operation Persistence with HLC", () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * For any validated operation processed by the Sync_Engine, it SHALL appear
   * in the append-only operation log with its exact HLC timestamp preserved.
   */
  it("every validated operation appears in the operation log with its exact HLC timestamp", () => {
    fc.assert(
      fc.asyncProperty(
        arbOperationSequence({ minLength: 1, maxLength: 30 }),
        async (operations) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process all operations
          const successfulOps: CRDTOperation[] = [];
          for (const op of operations) {
            const result = await engine.processOperation(room.id, op);
            if (result.success) {
              successfulOps.push(op);
            }
          }

          // Get the operation log
          const opLog = engine.getOperationLog(room.id);

          // Every successful operation must be in the log
          expect(opLog.length).toBe(successfulOps.length);

          // Each operation must preserve its exact HLC timestamp
          for (let i = 0; i < successfulOps.length; i++) {
            const logEntry = opLog[i];
            const original = successfulOps[i];

            // Exact HLC timestamp preservation
            expect(logEntry.timestamp.wallTime).toBe(
              original.timestamp.wallTime
            );
            expect(logEntry.timestamp.logical).toBe(
              original.timestamp.logical
            );
            expect(logEntry.timestamp.nodeId).toBe(original.timestamp.nodeId);

            // Operation identity preserved
            expect(logEntry.id).toBe(original.id);
            expect(logEntry.itemId).toBe(original.itemId);
            expect(logEntry.type).toBe(original.type);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("operation log is append-only — new operations never alter previous entries", () => {
    fc.assert(
      fc.asyncProperty(
        arbOperationSequence({ minLength: 3, maxLength: 20 }),
        async (operations) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process first half and capture log
          const midpoint = Math.floor(operations.length / 2);
          for (let i = 0; i < midpoint; i++) {
            await engine.processOperation(room.id, operations[i]);
          }
          const logAfterFirstHalf = [...engine.getOperationLog(room.id)];

          // Process second half
          for (let i = midpoint; i < operations.length; i++) {
            await engine.processOperation(room.id, operations[i]);
          }
          const fullLog = engine.getOperationLog(room.id);

          // The first half of the log must be unchanged
          for (let i = 0; i < logAfterFirstHalf.length; i++) {
            expect(fullLog[i].id).toBe(logAfterFirstHalf[i].id);
            expect(fullLog[i].timestamp.wallTime).toBe(
              logAfterFirstHalf[i].timestamp.wallTime
            );
            expect(fullLog[i].timestamp.logical).toBe(
              logAfterFirstHalf[i].timestamp.logical
            );
            expect(fullLog[i].timestamp.nodeId).toBe(
              logAfterFirstHalf[i].timestamp.nodeId
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 22: Time-Travel State Reconstruction", () => {
  /**
   * **Validates: Requirements 7.2**
   *
   * For any valid HLC timestamp T within the operation history, the
   * Time_Travel_API SHALL return a CRDT state equivalent to replaying
   * all operations with timestamp ≤ T from the initial state.
   */
  it("queryTimeTravelState returns state equivalent to replaying ops up to T", () => {
    fc.assert(
      fc.asyncProperty(
        arbOperationSequence({ minLength: 2, maxLength: 25 }),
        fc.nat(),
        async (operations, indexSeed) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process all operations
          for (const op of operations) {
            await engine.processOperation(room.id, op);
          }

          // Pick a timestamp from the operations to query
          const targetIndex = indexSeed % operations.length;
          const targetTimestamp = operations[targetIndex].timestamp;

          // Query time-travel state
          const result = await engine.queryTimeTravelState(
            room.id,
            targetTimestamp
          );

          // Compute expected state by manually replaying
          const expectedState = replayUpTo(
            operations,
            targetTimestamp,
            room.id
          );

          // Compare the items - the time-travel result should match the replay
          const resultItems = result.state.items;
          const expectedItems = (expectedState as any).items;

          // Same set of item IDs
          expect(Object.keys(resultItems).sort()).toEqual(
            Object.keys(expectedItems).sort()
          );

          // Same field values for each item
          for (const itemId of Object.keys(expectedItems)) {
            const resultItem = resultItems[itemId];
            const expectedItem = expectedItems[itemId];
            expect(resultItem).toBeDefined();

            // Compare field values
            for (const fieldName of Object.keys(expectedItem.fields)) {
              expect(resultItem.fields[fieldName].value).toEqual(
                expectedItem.fields[fieldName].value
              );
              expect(resultItem.fields[fieldName].timestamp).toEqual(
                expectedItem.fields[fieldName].timestamp
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("querying a timestamp before all operations returns empty state", () => {
    fc.assert(
      fc.asyncProperty(
        arbOperationSequence({ minLength: 1, maxLength: 15 }),
        async (operations) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process operations
          for (const op of operations) {
            await engine.processOperation(room.id, op);
          }

          // Create a timestamp strictly before all operation timestamps
          const minWallTime = Math.min(
            ...operations.map((op) => op.timestamp.wallTime)
          );
          const beforeAllTimestamp: HLCTimestamp = {
            wallTime: minWallTime - 1,
            logical: 0,
            nodeId: "zzz", // Ensures it's before even with same wallTime
          };

          const result = await engine.queryTimeTravelState(
            room.id,
            beforeAllTimestamp
          );

          // Should return empty state (no items)
          expect(Object.keys(result.state.items)).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("querying the last operation timestamp returns full current state", () => {
    fc.assert(
      fc.asyncProperty(
        arbOperationSequence({ minLength: 1, maxLength: 20 }),
        async (operations) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process all operations
          for (const op of operations) {
            await engine.processOperation(room.id, op);
          }

          // Get the latest timestamp from the operations
          const lastOp = operations[operations.length - 1];
          const latestTimestamp = lastOp.timestamp;

          // Query time-travel at the last timestamp
          const result = await engine.queryTimeTravelState(
            room.id,
            latestTimestamp
          );

          // Compare with current state
          const currentState = engine.getState(room.id);

          expect(Object.keys(result.state.items).sort()).toEqual(
            Object.keys(currentState.items).sort()
          );

          for (const itemId of Object.keys(currentState.items)) {
            const resultItem = result.state.items[itemId];
            const currentItem = currentState.items[itemId];
            for (const fieldName of Object.keys(currentItem.fields)) {
              expect(resultItem.fields[fieldName].value).toEqual(
                currentItem.fields[fieldName].value
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 23: Operation Range Query Causal Order", () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any timestamp range [from, to], the returned operation sequence
   * SHALL be sorted in HLC causal order (wallTime, logical, nodeId).
   */
  it("queryOperationRange returns operations sorted in HLC causal order", () => {
    fc.assert(
      fc.asyncProperty(
        arbMultiNodeOperationSequence({ minLength: 3, maxLength: 20 }),
        async (operations) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process all operations (some may fail, that's fine)
          for (const op of operations) {
            await engine.processOperation(room.id, op);
          }

          // Query the full range
          const minTimestamp: HLCTimestamp = {
            wallTime: 0,
            logical: 0,
            nodeId: "",
          };
          const maxTimestamp: HLCTimestamp = {
            wallTime: Number.MAX_SAFE_INTEGER,
            logical: Number.MAX_SAFE_INTEGER,
            nodeId: "\uffff",
          };

          const result = await engine.queryOperationRange(
            room.id,
            minTimestamp,
            maxTimestamp
          );

          // Verify causal ordering: each consecutive pair must be in HLC order
          for (let i = 1; i < result.length; i++) {
            const prev = result[i - 1].timestamp;
            const curr = result[i].timestamp;
            const cmp = compareTimestamps(prev, curr);
            expect(cmp).toBeLessThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("queryOperationRange returns only operations within the specified range", () => {
    fc.assert(
      fc.asyncProperty(
        arbOperationSequence({ minLength: 4, maxLength: 20 }),
        fc.nat(),
        fc.nat(),
        async (operations, fromSeed, toSeed) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process all operations
          for (const op of operations) {
            await engine.processOperation(room.id, op);
          }

          // Pick a valid range from the operations
          const fromIdx = fromSeed % operations.length;
          const toIdx = toSeed % operations.length;
          const [startIdx, endIdx] = fromIdx <= toIdx
            ? [fromIdx, toIdx]
            : [toIdx, fromIdx];

          const fromTimestamp = operations[startIdx].timestamp;
          const toTimestamp = operations[endIdx].timestamp;

          const result = await engine.queryOperationRange(
            room.id,
            fromTimestamp,
            toTimestamp
          );

          // Every returned operation must have timestamp within [from, to]
          for (const op of result) {
            expect(compareTimestamps(op.timestamp, fromTimestamp)).toBeGreaterThanOrEqual(0);
            expect(compareTimestamps(op.timestamp, toTimestamp)).toBeLessThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("queryOperationRange with a range containing all operations returns them all in order", () => {
    fc.assert(
      fc.asyncProperty(
        arbOperationSequence({ minLength: 2, maxLength: 15 }),
        async (operations) => {
          const engine = new SyncEngineV2();
          const room = engine.createRoom();

          // Process all operations
          const successfulOps: CRDTOperation[] = [];
          for (const op of operations) {
            const result = await engine.processOperation(room.id, op);
            if (result.success) {
              successfulOps.push(op);
            }
          }

          // Query the full range using extreme bounds
          const minTimestamp: HLCTimestamp = {
            wallTime: 0,
            logical: 0,
            nodeId: "",
          };
          const maxTimestamp: HLCTimestamp = {
            wallTime: Number.MAX_SAFE_INTEGER,
            logical: Number.MAX_SAFE_INTEGER,
            nodeId: "\uffff",
          };

          const result = await engine.queryOperationRange(
            room.id,
            minTimestamp,
            maxTimestamp
          );

          // Should contain exactly the successful operations
          expect(result.length).toBe(successfulOps.length);

          // Verify each operation ID is present
          const resultIds = new Set(result.map((op) => op.id));
          for (const op of successfulOps) {
            expect(resultIds.has(op.id)).toBe(true);
          }

          // Verify causal ordering
          for (let i = 1; i < result.length; i++) {
            const cmp = compareTimestamps(
              result[i - 1].timestamp,
              result[i].timestamp
            );
            expect(cmp).toBeLessThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
