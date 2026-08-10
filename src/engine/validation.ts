/**
 * Operation validation for the Sync Engine.
 * Validates incoming CRDTOperations before they are merged into state.
 *
 * @module engine/validation
 */

import type { CRDTOperation, OperationType, OperationError } from "../types/index.js";

/** Valid operation types. */
const VALID_OPERATION_TYPES: ReadonlySet<OperationType> = new Set([
  "add",
  "remove",
  "update",
]);

/**
 * Validates a CRDT operation for structural correctness.
 *
 * Checks performed (in order):
 * 1. Operation must have a non-empty `id`
 * 2. Operation must have a valid `timestamp` (wallTime > 0, logical >= 0, non-empty nodeId)
 * 3. Operation must have a non-empty `sessionId`
 * 4. Operation must have a non-empty `replicaId`
 * 5. Operation must have a non-empty `itemId`
 * 6. Operation `type` must be one of: "add", "remove", "update"
 * 7. Operation must have a non-null object `payload` (for "add"/"update", at least one key required)
 * 8. Operation must have a `version` that is a non-negative integer
 *
 * @param operation - The operation to validate
 * @returns `null` if valid, or an `OperationError` describing the first violation found
 */
export function validateOperation(operation: CRDTOperation): OperationError | null {
  const operationId = operation.id ?? "";

  // 1. Non-empty id
  if (!operation.id || typeof operation.id !== "string" || operation.id.trim() === "") {
    return {
      operationId,
      code: "MISSING_ID",
      message: "Operation must have a non-empty id",
    };
  }

  // 2. Valid timestamp
  if (!operation.timestamp || typeof operation.timestamp !== "object") {
    return {
      operationId: operation.id,
      code: "MISSING_TIMESTAMP",
      message: "Operation must have a timestamp",
    };
  }

  if (
    typeof operation.timestamp.wallTime !== "number" ||
    operation.timestamp.wallTime <= 0 ||
    typeof operation.timestamp.logical !== "number" ||
    operation.timestamp.logical < 0 ||
    !operation.timestamp.nodeId ||
    typeof operation.timestamp.nodeId !== "string" ||
    operation.timestamp.nodeId.trim() === ""
  ) {
    return {
      operationId: operation.id,
      code: "INVALID_TIMESTAMP",
      message:
        "Operation timestamp must have wallTime > 0, logical >= 0, and a non-empty nodeId",
    };
  }

  // 3. Non-empty sessionId
  if (
    !operation.sessionId ||
    typeof operation.sessionId !== "string" ||
    operation.sessionId.trim() === ""
  ) {
    return {
      operationId: operation.id,
      code: "MISSING_SESSION_ID",
      message: "Operation must have a non-empty sessionId",
    };
  }

  // 4. Non-empty replicaId
  if (
    !operation.replicaId ||
    typeof operation.replicaId !== "string" ||
    operation.replicaId.trim() === ""
  ) {
    return {
      operationId: operation.id,
      code: "MISSING_REPLICA_ID",
      message: "Operation must have a non-empty replicaId",
    };
  }

  // 5. Non-empty itemId
  if (
    !operation.itemId ||
    typeof operation.itemId !== "string" ||
    operation.itemId.trim() === ""
  ) {
    return {
      operationId: operation.id,
      code: "MISSING_ITEM_ID",
      message: "Operation must have a non-empty itemId",
    };
  }

  // 6. Valid type
  if (!VALID_OPERATION_TYPES.has(operation.type as OperationType)) {
    return {
      operationId: operation.id,
      code: "INVALID_TYPE",
      message: 'Operation type must be one of: "add", "remove", "update"',
    };
  }

  // 7. Valid payload
  if (
    operation.payload === null ||
    operation.payload === undefined ||
    typeof operation.payload !== "object" ||
    Array.isArray(operation.payload)
  ) {
    return {
      operationId: operation.id,
      code: "INVALID_PAYLOAD",
      message: "Operation payload must be a non-null object",
    };
  }

  // For "add" and "update", payload must have at least one key
  if (
    (operation.type === "add" || operation.type === "update") &&
    Object.keys(operation.payload).length === 0
  ) {
    return {
      operationId: operation.id,
      code: "INVALID_PAYLOAD",
      message: 'Operation payload must have at least one key for "add" and "update" types',
    };
  }

  // 8. Valid version (non-negative integer)
  if (
    typeof operation.version !== "number" ||
    !Number.isInteger(operation.version) ||
    operation.version < 0
  ) {
    return {
      operationId: operation.id,
      code: "INVALID_VERSION",
      message: "Operation version must be a non-negative integer",
    };
  }

  return null;
}
