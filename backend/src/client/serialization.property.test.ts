/**
 * Property-Based Tests for Operation Serialization Round-Trip
 *
 * Feature: collaborative-sync-engine, Property 17: Operation Serialization Round-Trip
 * Validates: Requirements 9.3
 *
 * For any valid CRDT operation, serializing it to wire format and deserializing
 * it back SHALL produce an operation identical to the original. Additionally,
 * any single-field operation SHALL serialize to no more than 1 KB.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { serialize, deserialize } from "./serialization.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";

// ─── Generators ───────────────────────────────────────────────────────────────

/** Arbitrary for valid HLC timestamps. */
const validTimestampArb: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  logical: fc.nat({ max: 65535 }),
  nodeId: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
});

/** Arbitrary for non-empty alphanumeric IDs. */
const nonEmptyIdArb: fc.Arbitrary<string> = fc
  .stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("")
    ),
    { minLength: 1, maxLength: 30 }
  );

/**
 * Arbitrary for a small payload that keeps the serialized operation well under 1 KB.
 * Uses short keys and small values to ensure single-field ops stay within limits.
 */
const smallPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    { minLength: 1, maxLength: 8 }
  ),
  fc.oneof(
    fc.string({ maxLength: 30 }),
    fc.integer({ min: -10000, max: 10000 }),
    fc.boolean(),
    fc.constant(null)
  ),
  { minKeys: 1, maxKeys: 5 }
);

/** Arbitrary for a single-field payload (exactly one key) to test the 1 KB size constraint. */
const singleFieldPayloadArb: fc.Arbitrary<Record<string, unknown>> = fc.tuple(
  fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    { minLength: 1, maxLength: 8 }
  ),
  fc.oneof(
    fc.string({ maxLength: 50 }),
    fc.integer({ min: -10000, max: 10000 }),
    fc.boolean(),
    fc.constant(null)
  )
).map(([key, value]) => ({ [key]: value }));

/** Arbitrary for a valid CRDTOperation with a small payload. */
const validOperationArb: fc.Arbitrary<CRDTOperation> = fc.record({
  id: nonEmptyIdArb,
  sessionId: nonEmptyIdArb,
  replicaId: nonEmptyIdArb,
  type: fc.constantFrom("add" as const, "remove" as const, "update" as const),
  itemId: nonEmptyIdArb,
  payload: smallPayloadArb,
  timestamp: validTimestampArb,
  version: fc.nat({ max: 100000 }),
});

/** Arbitrary for a valid CRDTOperation with exactly one payload field. */
const singleFieldOperationArb: fc.Arbitrary<CRDTOperation> = fc.record({
  id: nonEmptyIdArb,
  sessionId: nonEmptyIdArb,
  replicaId: nonEmptyIdArb,
  type: fc.constantFrom("add" as const, "remove" as const, "update" as const),
  itemId: nonEmptyIdArb,
  payload: singleFieldPayloadArb,
  timestamp: validTimestampArb,
  version: fc.nat({ max: 100000 }),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: collaborative-sync-engine, Property 17: Operation Serialization Round-Trip", () => {
  it("serialize → deserialize produces an identical operation for any valid CRDTOperation", () => {
    /**
     * Validates: Requirements 9.3
     *
     * Core property: for any valid CRDT operation, serializing it to JSON
     * wire format and deserializing it back produces an operation that is
     * deep-equal to the original.
     */
    fc.assert(
      fc.property(validOperationArb, (operation) => {
        const serialized = serialize(operation);
        const deserialized = deserialize(serialized);

        // The deserialized operation must be deep-equal to the original
        expect(deserialized).toEqual(operation);
      }),
      { numRuns: 100 }
    );
  });

  it("single-field operations serialize to ≤ 1024 bytes", () => {
    /**
     * Validates: Requirements 9.3
     *
     * For any single-field operation (payload with exactly one key),
     * the serialized JSON string SHALL be no more than 1 KB (1024 bytes).
     */
    fc.assert(
      fc.property(singleFieldOperationArb, (operation) => {
        const serialized = serialize(operation);
        const byteLength = new TextEncoder().encode(serialized).length;

        // Single-field operation must serialize to ≤ 1024 bytes
        expect(byteLength).toBeLessThanOrEqual(1024);

        // Also verify round-trip still holds
        const deserialized = deserialize(serialized);
        expect(deserialized).toEqual(operation);
      }),
      { numRuns: 100 }
    );
  });

  it("serialize → deserialize preserves all individual fields exactly", () => {
    /**
     * Validates: Requirements 9.3
     *
     * Verify each field of the operation is individually preserved through
     * the serialization round-trip.
     */
    fc.assert(
      fc.property(validOperationArb, (operation) => {
        const serialized = serialize(operation);
        const deserialized = deserialize(serialized);

        expect(deserialized.id).toBe(operation.id);
        expect(deserialized.sessionId).toBe(operation.sessionId);
        expect(deserialized.replicaId).toBe(operation.replicaId);
        expect(deserialized.type).toBe(operation.type);
        expect(deserialized.itemId).toBe(operation.itemId);
        expect(deserialized.payload).toEqual(operation.payload);
        expect(deserialized.timestamp).toEqual(operation.timestamp);
        expect(deserialized.version).toBe(operation.version);
      }),
      { numRuns: 100 }
    );
  });
});
