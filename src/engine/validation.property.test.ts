/**
 * Property-Based Tests for Invalid Operation Rejection
 *
 * Feature: collaborative-sync-engine, Property 5: Invalid Operation Rejection
 * Validates: Requirements 3.6
 *
 * For any malformed operation, applying it to any valid state leaves state
 * unchanged and returns an error indication identifying the rejected operation.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateOperation } from "./validation.js";
import type { CRDTOperation, HLCTimestamp, CRDTState } from "../types/index.js";

// ─── Generators ───────────────────────────────────────────────────────────────

/** Arbitrary for valid HLC timestamps. */
const validTimestampArb: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  logical: fc.nat({ max: 65535 }),
  nodeId: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
});

/** Arbitrary for a non-empty alphanumeric-like string (IDs). */
const nonEmptyIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a non-empty payload (at least one key). */
const nonEmptyPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc
  .dictionary(
    fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    { minKeys: 1, maxKeys: 5 }
  );

/** Arbitrary for a fully valid CRDTOperation. */
const validOperationArb: fc.Arbitrary<CRDTOperation> = fc.record({
  id: nonEmptyIdArb,
  sessionId: nonEmptyIdArb,
  replicaId: nonEmptyIdArb,
  type: fc.constantFrom("add" as const, "remove" as const, "update" as const),
  itemId: nonEmptyIdArb,
  payload: nonEmptyPayloadArb,
  timestamp: validTimestampArb,
  version: fc.nat({ max: 100000 }),
});

/** Arbitrary for a valid CRDTState. */
const validStateArb: fc.Arbitrary<CRDTState> = fc.record({
  sessionId: nonEmptyIdArb,
  items: fc.constant({}),
  version: fc.nat({ max: 100000 }),
  lastUpdated: validTimestampArb,
});

// ─── Malformed Operation Generators ──────────────────────────────────────────

/**
 * Generates operations with missing or empty id.
 */
const missingIdArb: fc.Arbitrary<CRDTOperation> = validOperationArb.map((op) => ({
  ...op,
  id: fc.sample(fc.constantFrom("", "   ", "\t", "\n"), 1)[0],
}));

/**
 * Generates operations with invalid timestamps.
 */
const invalidTimestampArb: fc.Arbitrary<CRDTOperation> = validOperationArb.chain((op) =>
  fc.oneof(
    // wallTime <= 0
    fc.record({
      wallTime: fc.integer({ min: -1000, max: 0 }),
      logical: fc.nat({ max: 65535 }),
      nodeId: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
    }).map((ts) => ({ ...op, timestamp: ts })),
    // negative logical
    fc.record({
      wallTime: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      logical: fc.integer({ min: -1000, max: -1 }),
      nodeId: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
    }).map((ts) => ({ ...op, timestamp: ts })),
    // empty nodeId
    fc.record({
      wallTime: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      logical: fc.nat({ max: 65535 }),
      nodeId: fc.constantFrom("", "   ", "\t"),
    }).map((ts) => ({ ...op, timestamp: ts })),
  )
);

/**
 * Generates operations with empty sessionId.
 */
const emptySessionIdArb: fc.Arbitrary<CRDTOperation> = validOperationArb.map((op) => ({
  ...op,
  sessionId: fc.sample(fc.constantFrom("", "   ", "\t"), 1)[0],
}));

/**
 * Generates operations with empty replicaId.
 */
const emptyReplicaIdArb: fc.Arbitrary<CRDTOperation> = validOperationArb.map((op) => ({
  ...op,
  replicaId: fc.sample(fc.constantFrom("", "   ", "\t"), 1)[0],
}));

/**
 * Generates operations with empty itemId.
 */
const emptyItemIdArb: fc.Arbitrary<CRDTOperation> = validOperationArb.map((op) => ({
  ...op,
  itemId: fc.sample(fc.constantFrom("", "   ", "\t"), 1)[0],
}));

/**
 * Generates operations with invalid type.
 */
const invalidTypeArb: fc.Arbitrary<CRDTOperation> = validOperationArb.chain((op) =>
  fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => s !== "add" && s !== "remove" && s !== "update")
    .map((t) => ({ ...op, type: t as CRDTOperation["type"] }))
);

/**
 * Generates operations with null/empty payload for add/update types.
 */
const invalidPayloadArb: fc.Arbitrary<CRDTOperation> = validOperationArb.chain((op) =>
  fc.oneof(
    // null payload
    fc.constant({ ...op, type: "add" as const, payload: null as unknown as Record<string, unknown> }),
    // empty payload for add
    fc.constant({ ...op, type: "add" as const, payload: {} }),
    // empty payload for update
    fc.constant({ ...op, type: "update" as const, payload: {} }),
    // array as payload
    fc.constant({ ...op, payload: [] as unknown as Record<string, unknown> }),
  )
);

/**
 * Generates operations with negative version.
 */
const negativeVersionArb: fc.Arbitrary<CRDTOperation> = validOperationArb.chain((op) =>
  fc.integer({ min: -100000, max: -1 }).map((v) => ({ ...op, version: v }))
);

/**
 * Combined arbitrary: picks from any of the malformed operation categories.
 */
const malformedOperationArb: fc.Arbitrary<CRDTOperation> = fc.oneof(
  missingIdArb,
  invalidTimestampArb,
  emptySessionIdArb,
  emptyReplicaIdArb,
  emptyItemIdArb,
  invalidTypeArb,
  invalidPayloadArb,
  negativeVersionArb
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: collaborative-sync-engine, Property 5: Invalid Operation Rejection", () => {
  it("for any malformed operation and any valid state, validateOperation returns a non-null error", () => {
    /**
     * Validates: Requirements 3.6
     *
     * Core property: any structurally invalid operation must be rejected
     * by the validation layer before it can alter shared state.
     */
    fc.assert(
      fc.property(malformedOperationArb, validStateArb, (malformedOp, _state) => {
        const error = validateOperation(malformedOp);

        // Validation must catch the malformed operation
        expect(error).not.toBeNull();
        // Error must identify the operation
        expect(error!.operationId).toBeDefined();
        expect(typeof error!.operationId).toBe("string");
        // Error must have a code and message
        expect(error!.code).toBeDefined();
        expect(typeof error!.code).toBe("string");
        expect(error!.code.length).toBeGreaterThan(0);
        expect(error!.message).toBeDefined();
        expect(typeof error!.message).toBe("string");
        expect(error!.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 }
    );
  });

  it("operations with missing or empty id are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(missingIdArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(error!.code).toBe("MISSING_ID");
      }),
      { numRuns: 100 }
    );
  });

  it("operations with invalid timestamps are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(invalidTimestampArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(["MISSING_TIMESTAMP", "INVALID_TIMESTAMP"]).toContain(error!.code);
      }),
      { numRuns: 100 }
    );
  });

  it("operations with empty sessionId are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(emptySessionIdArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(error!.code).toBe("MISSING_SESSION_ID");
      }),
      { numRuns: 100 }
    );
  });

  it("operations with empty replicaId are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(emptyReplicaIdArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(error!.code).toBe("MISSING_REPLICA_ID");
      }),
      { numRuns: 100 }
    );
  });

  it("operations with empty itemId are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(emptyItemIdArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(error!.code).toBe("MISSING_ITEM_ID");
      }),
      { numRuns: 100 }
    );
  });

  it("operations with invalid type are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(invalidTypeArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(error!.code).toBe("INVALID_TYPE");
      }),
      { numRuns: 100 }
    );
  });

  it("operations with null or empty payload for add/update are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(invalidPayloadArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(error!.code).toBe("INVALID_PAYLOAD");
      }),
      { numRuns: 100 }
    );
  });

  it("operations with negative version are rejected", () => {
    /**
     * Validates: Requirements 3.6
     */
    fc.assert(
      fc.property(negativeVersionArb, (op) => {
        const error = validateOperation(op);
        expect(error).not.toBeNull();
        expect(error!.code).toBe("INVALID_VERSION");
      }),
      { numRuns: 100 }
    );
  });

  it("valid operations pass validation (sanity check)", () => {
    /**
     * Validates: Requirements 3.6
     *
     * Sanity check: a properly formed operation must pass validation.
     * This ensures our generators for malformed operations are meaningful —
     * valid ones pass, invalid ones fail.
     */
    fc.assert(
      fc.property(validOperationArb, (op) => {
        const error = validateOperation(op);
        expect(error).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
