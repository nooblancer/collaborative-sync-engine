/**
 * Property-Based Tests for Partial Batch Merge Correctness
 *
 * Feature: collaborative-sync-engine, Property 11: Partial Batch Merge Correctness
 * Validates: Requirements 5.6, 5.7
 *
 * For any batch of offline operations containing a mix of valid and invalid
 * operations, the Sync Engine SHALL merge all valid operations, skip all
 * invalid ones, and the response SHALL accurately report the count of merged
 * operations and identify each failed operation.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SyncEngine } from "./sync-engine.js";
import { InMemoryPersistenceLayer } from "../persistence/persistence-layer.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";

// ─── Generators ───────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-batch";
const REPLICA_ID = "replica-batch-1";

/** Arbitrary for valid HLC timestamps with wall time > 0. */
const validTimestampArb: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  logical: fc.nat({ max: 65535 }),
  nodeId: fc.constant("node-batch-test"),
});

/** Arbitrary for a non-empty payload. */
const nonEmptyPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    { minLength: 1, maxLength: 8 }
  ),
  fc.oneof(fc.string({ maxLength: 20 }), fc.integer(), fc.boolean()),
  { minKeys: 1, maxKeys: 3 }
);

/**
 * Generates a valid "add" operation with a unique itemId.
 * Valid operations always pass validation.
 */
function validAddOperationArb(index: number): fc.Arbitrary<CRDTOperation> {
  return fc.record({
    id: fc.constant(`valid-op-${index}-${Date.now()}`).chain((prefix) =>
      fc.uuid().map((uuid) => `${prefix}-${uuid}`)
    ),
    sessionId: fc.constant(SESSION_ID),
    replicaId: fc.constant(REPLICA_ID),
    type: fc.constant("add" as const),
    itemId: fc.constant(`item-${index}`).chain((prefix) =>
      fc.uuid().map((uuid) => `${prefix}-${uuid}`)
    ),
    payload: nonEmptyPayloadArb,
    timestamp: validTimestampArb,
    version: fc.constant(0),
  });
}

/**
 * Enum describing the kind of invalidity to inject.
 */
type InvalidKind =
  | "empty-id"
  | "missing-timestamp"
  | "invalid-walltime"
  | "empty-session"
  | "empty-item-id"
  | "empty-replica-id"
  | "invalid-type"
  | "empty-payload";

/** Arbitrary that picks one of the possible invalid operation kinds. */
const invalidKindArb: fc.Arbitrary<InvalidKind> = fc.constantFrom(
  "empty-id",
  "missing-timestamp",
  "invalid-walltime",
  "empty-session",
  "empty-item-id",
  "empty-replica-id",
  "invalid-type",
  "empty-payload"
);

/**
 * Creates an invalid operation based on the specified kind.
 * Each invalid operation has a unique non-empty id for tracking
 * (except "empty-id" which will have an empty id).
 */
function makeInvalidOperation(index: number, kind: InvalidKind): CRDTOperation {
  const baseOp: CRDTOperation = {
    id: `invalid-op-${index}-${kind}`,
    sessionId: SESSION_ID,
    replicaId: REPLICA_ID,
    type: "add",
    itemId: `invalid-item-${index}`,
    payload: { name: "test" },
    timestamp: {
      wallTime: 1_700_000_000_000 + index,
      logical: 0,
      nodeId: "node-batch-test",
    },
    version: 0,
  };

  switch (kind) {
    case "empty-id":
      return { ...baseOp, id: "" };
    case "missing-timestamp":
      return { ...baseOp, timestamp: null as unknown as HLCTimestamp };
    case "invalid-walltime":
      return {
        ...baseOp,
        timestamp: { wallTime: 0, logical: 0, nodeId: "node-batch-test" },
      };
    case "empty-session":
      return { ...baseOp, sessionId: "" };
    case "empty-item-id":
      return { ...baseOp, itemId: "" };
    case "empty-replica-id":
      return { ...baseOp, replicaId: "" };
    case "invalid-type":
      return { ...baseOp, type: "invalid" as unknown as CRDTOperation["type"] };
    case "empty-payload":
      return { ...baseOp, payload: {} };
  }
}

/**
 * Arbitrary that generates a batch of N operations (5-20) where some are valid
 * and some are deliberately invalid. Returns the batch along with metadata
 * about which are valid and which are invalid.
 */
interface BatchInput {
  operations: CRDTOperation[];
  validCount: number;
  invalidCount: number;
  invalidIds: string[];
}

const batchInputArb: fc.Arbitrary<BatchInput> = fc
  .record({
    validCount: fc.integer({ min: 1, max: 15 }),
    invalidCount: fc.integer({ min: 1, max: 10 }),
    invalidKinds: fc.array(invalidKindArb, { minLength: 1, maxLength: 10 }),
  })
  .chain(({ validCount, invalidCount, invalidKinds }) => {
    // Ensure we don't exceed 20 total ops
    const actualInvalidCount = Math.min(invalidCount, 20 - validCount);
    const actualTotal = validCount + actualInvalidCount;

    // Generate valid operations
    const validOpsArbs = Array.from({ length: validCount }, (_, i) =>
      validAddOperationArb(i)
    );

    return fc.tuple(...validOpsArbs).map((validOps) => {
      // Generate invalid operations
      const invalidOps: CRDTOperation[] = [];
      for (let i = 0; i < actualInvalidCount; i++) {
        const kind = invalidKinds[i % invalidKinds.length];
        invalidOps.push(makeInvalidOperation(i, kind));
      }

      // Interleave valid and invalid operations deterministically
      // Place all valid ops first, then invalid (we can also shuffle, but
      // the property should hold regardless of order)
      const allOps: CRDTOperation[] = [];
      let vi = 0;
      let ii = 0;

      // Interleave: alternate placing valid and invalid
      while (vi < validOps.length || ii < invalidOps.length) {
        if (vi < validOps.length) {
          allOps.push(validOps[vi]);
          vi++;
        }
        if (ii < invalidOps.length) {
          allOps.push(invalidOps[ii]);
          ii++;
        }
      }

      const invalidIds = invalidOps.map((op) => op.id);

      return {
        operations: allOps,
        validCount: validOps.length,
        invalidCount: actualInvalidCount,
        invalidIds,
      };
    });
  })
  .filter((batch) => batch.operations.length >= 5 && batch.operations.length <= 20);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: collaborative-sync-engine, Property 11: Partial Batch Merge Correctness", () => {
  /**
   * **Validates: Requirements 5.6, 5.7**
   *
   * For any batch of offline operations containing a mix of valid and invalid
   * operations, the Sync Engine SHALL:
   * - Report totalReceived === batch length
   * - Merge all valid operations (merged count matches valid count)
   * - Skip all invalid operations (failed count matches invalid count)
   * - Identify each failed operation correctly
   * - Persist valid operations into state
   */
  it("valid ops are merged, invalid ops are skipped, response accurately reports results", async () => {
    await fc.assert(
      fc.asyncProperty(batchInputArb, async (batch) => {
        const persistence = new InMemoryPersistenceLayer();
        const engine = new SyncEngine(persistence);

        const { operations, validCount, invalidCount, invalidIds } = batch;

        // Process the batch
        const result = await engine.processBatch(operations);

        // 1. totalReceived equals the batch size
        expect(result.totalReceived).toBe(operations.length);

        // 2. merged equals the count of valid operations
        expect(result.merged).toBe(validCount);

        // 3. failed.length equals the count of invalid operations
        expect(result.failed.length).toBe(invalidCount);

        // 4. Each failed entry identifies the correct operation ID
        const failedIds = result.failed.map((f) => f.operationId);
        for (const invalidId of invalidIds) {
          expect(failedIds).toContain(invalidId);
        }

        // 5. The state contains all items from valid operations
        const state = await engine.getState(SESSION_ID);
        const validOps = operations.filter(
          (op) => !invalidIds.includes(op.id)
        );
        for (const validOp of validOps) {
          expect(state.items[validOp.itemId]).toBeDefined();
        }
      }),
      { numRuns: 100 }
    );
  });
});
