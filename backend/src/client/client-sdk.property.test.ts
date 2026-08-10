/**
 * Property-based tests for Client SDK incoming operation application.
 *
 * Property 18: Incoming Operation Application
 * Validates: Requirements 9.4, 9.5
 *
 * Verifies:
 * - Valid operations update state and emit a state-change event with source "remote"
 * - Operations referencing collections not in the local schema leave state unchanged
 *   and emit an error event with code "SCHEMA_MISMATCH"
 * - Invalid operations (e.g., update on non-existent item) leave state unchanged
 *   and emit an error event
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ClientSDK } from "./client-sdk.js";
import type { CRDTOperation, HLCTimestamp, StateChangeEvent, SDKError } from "../types/index.js";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generates a valid HLC timestamp with positive wall time and non-negative logical counter. */
const arbHLCTimestamp = (nodeId?: string): fc.Arbitrary<HLCTimestamp> =>
  fc.record({
    wallTime: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
    logical: fc.nat({ max: 10000 }),
    nodeId: nodeId ? fc.constant(nodeId) : fc.string({ minLength: 1, maxLength: 20 }),
  });

/** Generates a non-empty alphanumeric string suitable for identifiers. */
const arbIdentifier = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 30, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) });

/** Generates a simple payload with string/number fields (valid for inventory). */
const arbPayload = (): fc.Arbitrary<Record<string, unknown>> =>
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    quantity: fc.integer({ min: 0, max: 10000 }),
  });

/** Generates a valid "add" CRDTOperation for a given sessionId. */
const arbAddOperation = (sessionId: string): fc.Arbitrary<CRDTOperation> =>
  fc.record({
    id: fc.uuid(),
    sessionId: fc.constant(sessionId),
    replicaId: arbIdentifier(),
    type: fc.constant("add" as const),
    itemId: arbIdentifier(),
    payload: arbPayload(),
    timestamp: arbHLCTimestamp(),
    version: fc.nat({ max: 1000 }),
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 18: Incoming Operation Application", () => {
  /**
   * **Validates: Requirements 9.4, 9.5**
   *
   * Valid operations (schema match or no schema set) update state and emit
   * a state-change event with source "remote".
   */
  it("valid operations update state and emit state-change event with source 'remote'", () => {
    fc.assert(
      fc.property(
        arbAddOperation("test-session"),
        (operation) => {
          // Create SDK and optionally set schema that includes the operation's sessionId
          const sdk = new ClientSDK("test-replica");
          sdk.setLocalSchema(["test-session"]); // Schema includes the collection

          const stateChanges: StateChangeEvent[] = [];
          const errors: SDKError[] = [];

          sdk.onStateChange((event) => stateChanges.push(event));
          sdk.onError((err) => errors.push(err));

          // Apply the remote operation
          sdk.applyRemoteOperation(operation);

          // Verify: state is updated (item exists in local state)
          const state = sdk.getLocalState();
          expect(state.items[operation.itemId]).toBeDefined();
          expect(state.items[operation.itemId].itemId).toBe(operation.itemId);

          // Verify: state-change event emitted with source "remote"
          expect(stateChanges.length).toBeGreaterThanOrEqual(1);
          const lastChange = stateChanges[stateChanges.length - 1];
          expect(lastChange.source).toBe("remote");
          expect(lastChange.itemId).toBe(operation.itemId);
          expect(lastChange.collection).toBe(operation.sessionId);

          // Verify: no error events
          expect(errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.4, 9.5**
   *
   * When no schema is set, valid operations still update state and emit events.
   */
  it("valid operations without schema set update state and emit event", () => {
    fc.assert(
      fc.property(
        arbAddOperation("any-session"),
        (operation) => {
          const sdk = new ClientSDK("test-replica");
          // No schema set — all collections are accepted

          const stateChanges: StateChangeEvent[] = [];
          const errors: SDKError[] = [];

          sdk.onStateChange((event) => stateChanges.push(event));
          sdk.onError((err) => errors.push(err));

          sdk.applyRemoteOperation(operation);

          // State should be updated
          const state = sdk.getLocalState();
          expect(state.items[operation.itemId]).toBeDefined();

          // State-change event emitted with source "remote"
          expect(stateChanges.length).toBeGreaterThanOrEqual(1);
          expect(stateChanges[stateChanges.length - 1].source).toBe("remote");

          // No errors
          expect(errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.4, 9.5**
   *
   * Schema mismatch: operations referencing collections NOT in the local schema
   * leave state unchanged and emit error event with code "SCHEMA_MISMATCH".
   */
  it("schema-mismatch operations leave state unchanged and emit SCHEMA_MISMATCH error", () => {
    fc.assert(
      fc.property(
        arbAddOperation("unknown-collection"),
        (operation) => {
          const sdk = new ClientSDK("test-replica");
          // Set schema that does NOT include the operation's sessionId
          sdk.setLocalSchema(["allowed-collection-1", "allowed-collection-2"]);

          const stateChanges: StateChangeEvent[] = [];
          const errors: SDKError[] = [];

          sdk.onStateChange((event) => stateChanges.push(event));
          sdk.onError((err) => errors.push(err));

          // Capture state before
          const stateBefore = JSON.stringify(sdk.getLocalState());

          // Apply the operation
          sdk.applyRemoteOperation(operation);

          // Verify: state unchanged
          const stateAfter = JSON.stringify(sdk.getLocalState());
          expect(stateAfter).toBe(stateBefore);

          // Verify: no state-change events
          expect(stateChanges.length).toBe(0);

          // Verify: error event emitted with code "SCHEMA_MISMATCH"
          expect(errors.length).toBe(1);
          expect(errors[0].code).toBe("SCHEMA_MISMATCH");
          expect(errors[0].operationId).toBe(operation.id);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.4, 9.5**
   *
   * Invalid operations (update on non-existent item) leave state unchanged
   * and emit an error event.
   */
  it("update on non-existent item leaves state unchanged and emits error", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          sessionId: fc.constant("test-session"),
          replicaId: arbIdentifier(),
          type: fc.constant("update" as const),
          itemId: arbIdentifier(),
          payload: arbPayload(),
          timestamp: arbHLCTimestamp(),
          version: fc.nat({ max: 1000 }),
        }),
        (operation) => {
          const sdk = new ClientSDK("test-replica");
          sdk.setLocalSchema(["test-session"]); // Schema matches

          const stateChanges: StateChangeEvent[] = [];
          const errors: SDKError[] = [];

          sdk.onStateChange((event) => stateChanges.push(event));
          sdk.onError((err) => errors.push(err));

          // Capture state before (no items exist)
          const stateBefore = JSON.stringify(sdk.getLocalState());

          // Apply update on non-existent item
          sdk.applyRemoteOperation(operation);

          // Verify: state unchanged (item was never added)
          const stateAfter = JSON.stringify(sdk.getLocalState());
          expect(stateAfter).toBe(stateBefore);

          // Verify: no state-change events emitted
          expect(stateChanges.length).toBe(0);

          // Verify: error event emitted
          expect(errors.length).toBe(1);
          expect(errors[0].operationId).toBe(operation.id);
          expect(errors[0].code).toBe("UNKNOWN_ITEM");
        }
      ),
      { numRuns: 100 }
    );
  });
});
