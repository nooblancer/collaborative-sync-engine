/**
 * LWW-Element-Set merge logic for the Collaborative Sync Engine.
 *
 * Implements deterministic conflict resolution using Hybrid Logical Clock
 * timestamps with field-level Last-Write-Wins semantics.
 *
 * Merge rules:
 * - Add: Creates or merges fields into an LWWElement using field-level LWW
 * - Remove: Sets removedAt on existing item; no-op if item doesn't exist
 * - Update: Field-level LWW using timestamp comparison
 *
 * All merge operations are commutative, associative, and idempotent.
 */

import type {
  CRDTState,
  CRDTOperation,
  MergeResult,
  StateDelta,
  ItemChange,
  LWWElement,
  LWWRegister,
  HLCTimestamp,
} from "../types/index.js";
import { compareTimestamps } from "./hlc.js";

/**
 * Returns the greater of two HLC timestamps (used to maintain lastUpdated
 * as the maximum timestamp seen, ensuring commutativity).
 */
function maxTimestamp(a: HLCTimestamp, b: HLCTimestamp): HLCTimestamp {
  return compareTimestamps(a, b) >= 0 ? a : b;
}

/**
 * Applies a single CRDT operation to the state using LWW-Element-Set merge rules.
 *
 * The function mutates the state in place and returns a MergeResult
 * describing the outcome including any delta for broadcasting.
 *
 * @param state - The current CRDT state (mutated in place)
 * @param operation - The operation to merge
 * @returns MergeResult indicating success/failure and the resulting delta
 */
export function mergeOperation(
  state: CRDTState,
  operation: CRDTOperation
): MergeResult {
  switch (operation.type) {
    case "add":
      return handleAdd(state, operation);
    case "remove":
      return handleRemove(state, operation);
    case "update":
      return handleUpdate(state, operation);
    default:
      return {
        success: false,
        operationId: operation.id,
        error: {
          operationId: operation.id,
          code: "INVALID_OPERATION_TYPE",
          message: `Unknown operation type: ${(operation as CRDTOperation).type}`,
        },
      };
  }
}

/**
 * Merges a field from an operation payload into the existing fields map
 * using LWW semantics with deterministic tiebreaking.
 *
 * Returns true if the field was updated.
 */
function mergeField(
  mergedFields: Record<string, LWWRegister>,
  key: string,
  value: unknown,
  timestamp: HLCTimestamp,
  replicaId: string
): boolean {
  const existingField = mergedFields[key];

  if (!existingField || compareTimestamps(timestamp, existingField.timestamp) > 0) {
    // New field or operation timestamp is strictly greater — update
    mergedFields[key] = { value, timestamp, replicaId };
    return true;
  }

  if (compareTimestamps(timestamp, existingField.timestamp) === 0) {
    // Same timestamp — deterministic tiebreaker:
    // 1. Higher replicaId wins
    // 2. If replicaId also equal, higher serialized value wins
    if (replicaId > existingField.replicaId) {
      mergedFields[key] = { value, timestamp, replicaId };
      return true;
    }
    if (replicaId === existingField.replicaId && JSON.stringify(value) > JSON.stringify(existingField.value)) {
      mergedFields[key] = { value, timestamp, replicaId };
      return true;
    }
  }

  return false;
}

/**
 * Handles an "add" operation.
 *
 * If the item doesn't exist, creates it with the payload fields.
 * If the item already exists, performs field-level LWW merge (never
 * discards existing fields that have higher timestamps). Updates
 * addedAt to max(existing, operation) for consistency.
 *
 * This approach ensures commutativity: the result is the same
 * regardless of the order add operations arrive.
 */
function handleAdd(
  state: CRDTState,
  operation: CRDTOperation
): MergeResult {
  const { itemId, payload, timestamp, replicaId } = operation;

  if (Object.hasOwn(state.items, itemId)) {
    const existing = state.items[itemId];
    // Merge field-by-field using LWW semantics for commutativity
    const mergedFields: Record<string, LWWRegister> = { ...existing.fields };
    const changedFields: Record<string, unknown> = {};
    let hasChanges = false;

    for (const [key, value] of Object.entries(payload)) {
      if (mergeField(mergedFields, key, value, timestamp, replicaId)) {
        changedFields[key] = value;
        hasChanges = true;
      }
    }

    // addedAt converges to max of existing and operation timestamp
    const newAddedAt = maxTimestamp(existing.addedAt, timestamp);
    const addedAtChanged = compareTimestamps(newAddedAt, existing.addedAt) !== 0;

    // Do NOT clear removedAt here. Both addedAt and removedAt converge
    // independently via max semantics. The "is removed" decision is made
    // by comparing them: item is removed iff removedAt >= addedAt.
    // This ensures commutativity between add and remove operations.
    const newRemovedAt = existing.removedAt;
    const removedAtChanged = false;

    if (!hasChanges && !addedAtChanged && !removedAtChanged) {
      return {
        success: true,
        operationId: operation.id,
        delta: {
          sessionId: state.sessionId,
          changes: [],
          timestamp,
        },
      };
    }

    const updatedElement: LWWElement = {
      ...existing,
      fields: mergedFields,
      addedAt: newAddedAt,
      removedAt: newRemovedAt,
    };

    state.items = { ...state.items, [itemId]: updatedElement };
    state.version = state.version + 1;
    state.lastUpdated = maxTimestamp(state.lastUpdated, timestamp);

    const change: ItemChange = {
      itemId,
      type: addedAtChanged || removedAtChanged ? "added" : "updated",
      fields: hasChanges ? changedFields : undefined,
    };

    return {
      success: true,
      operationId: operation.id,
      delta: {
        sessionId: state.sessionId,
        changes: [change],
        timestamp,
      },
    };
  }

  // Item doesn't exist — create it fresh
  const fields: Record<string, LWWRegister> = {};
  for (const [key, value] of Object.entries(payload)) {
    fields[key] = { value, timestamp, replicaId };
  }

  const newElement: LWWElement = {
    itemId,
    fields,
    addedAt: timestamp,
    removedAt: null,
  };

  state.items = { ...state.items, [itemId]: newElement };
  state.version = state.version + 1;
  state.lastUpdated = maxTimestamp(state.lastUpdated, timestamp);

  return {
    success: true,
    operationId: operation.id,
    delta: {
      sessionId: state.sessionId,
      changes: [{ itemId, type: "added", fields: payload }],
      timestamp,
    },
  };
}

/**
 * Handles a "remove" operation: sets removedAt on an existing item.
 *
 * For commutativity with add operations:
 * - removedAt converges to max of all remove timestamps
 * - But if addedAt > removedAt, the item is considered active (add wins)
 *
 * The removedAt is always stored as max(existing removedAt, operation timestamp).
 * Whether the item is "logically removed" depends on comparing addedAt vs removedAt
 * at read time. This ensures order-independence.
 *
 * If the item doesn't exist, it's a no-op (not an error).
 */
function handleRemove(
  state: CRDTState,
  operation: CRDTOperation
): MergeResult {
  const { itemId, timestamp } = operation;

  // If item doesn't exist, no-op
  // Use Object.hasOwn to avoid prototype pollution (e.g., "constructor", "toString")
  if (!Object.hasOwn(state.items, itemId)) {
    return {
      success: true,
      operationId: operation.id,
      delta: { sessionId: state.sessionId, changes: [], timestamp },
    };
  }

  const existing = state.items[itemId];

  // removedAt converges to max of all remove timestamps seen
  const newRemovedAt = existing.removedAt
    ? maxTimestamp(existing.removedAt, timestamp)
    : timestamp;

  // If removedAt didn't actually change, it's idempotent
  if (existing.removedAt !== null && compareTimestamps(newRemovedAt, existing.removedAt) === 0) {
    return {
      success: true,
      operationId: operation.id,
      delta: { sessionId: state.sessionId, changes: [], timestamp },
    };
  }

  const updatedElement: LWWElement = {
    ...existing,
    removedAt: newRemovedAt,
  };

  state.items = { ...state.items, [itemId]: updatedElement };
  state.version = state.version + 1;
  state.lastUpdated = maxTimestamp(state.lastUpdated, timestamp);

  return {
    success: true,
    operationId: operation.id,
    delta: {
      sessionId: state.sessionId,
      changes: [{ itemId, type: "removed" }],
      timestamp,
    },
  };
}

/**
 * Handles an "update" operation: applies field-level LWW to an existing item.
 *
 * Rules:
 * - If item doesn't exist, returns error (unknown item reference)
 * - Fields are always merged using LWW regardless of removedAt status
 *   (this ensures commutativity with concurrent remove operations —
 *   the item remains removed but field values converge)
 * - For each field in payload, update only if operation.timestamp > existing field timestamp
 */
function handleUpdate(
  state: CRDTState,
  operation: CRDTOperation
): MergeResult {
  const { itemId, payload, timestamp, replicaId } = operation;

  // If item doesn't exist, this is an error (unknown item reference)
  // Use Object.hasOwn to avoid prototype pollution (e.g., "constructor", "toString")
  if (!Object.hasOwn(state.items, itemId)) {
    return {
      success: false,
      operationId: operation.id,
      error: {
        operationId: operation.id,
        code: "UNKNOWN_ITEM",
        message: `Item "${itemId}" does not exist`,
      },
    };
  }

  const existing = state.items[itemId];

  // Apply field-level LWW regardless of removedAt status for commutativity.
  // The item's removed status is tracked separately; field convergence
  // must happen independently to ensure order-independent results.
  const updatedFields: Record<string, LWWRegister> = { ...existing.fields };
  const changedFields: Record<string, unknown> = {};
  let hasChanges = false;

  for (const [key, value] of Object.entries(payload)) {
    if (mergeField(updatedFields, key, value, timestamp, replicaId)) {
      changedFields[key] = value;
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return {
      success: true,
      operationId: operation.id,
      delta: { sessionId: state.sessionId, changes: [], timestamp },
    };
  }

  const updatedElement: LWWElement = {
    ...existing,
    fields: updatedFields,
  };

  state.items = { ...state.items, [itemId]: updatedElement };
  state.version = state.version + 1;
  state.lastUpdated = maxTimestamp(state.lastUpdated, timestamp);

  return {
    success: true,
    operationId: operation.id,
    delta: {
      sessionId: state.sessionId,
      changes: [{ itemId, type: "updated", fields: changedFields }],
      timestamp,
    },
  };
}
