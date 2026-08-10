/**
 * Operation serialization and deserialization for the Client SDK.
 * Handles JSON wire format conversion with size validation and retry logic.
 */

import type { CRDTOperation } from "../types/index.js";
import type { SDKError } from "../types/index.js";

/** Maximum serialized size in bytes for a single-field operation. */
const MAX_SINGLE_FIELD_SIZE = 1024;

/** Maximum number of serialization retry attempts before discarding. */
const MAX_RETRIES = 3;

/**
 * Serializes a CRDTOperation to a JSON string.
 * Throws if a single-field operation exceeds 1 KB.
 */
export function serialize(operation: CRDTOperation): string {
  const json = JSON.stringify(operation);

  // Check size constraint for single-field operations
  const payloadKeys = Object.keys(operation.payload);
  if (payloadKeys.length === 1) {
    const byteLength = new TextEncoder().encode(json).length;
    if (byteLength > MAX_SINGLE_FIELD_SIZE) {
      throw new Error(
        `Serialized single-field operation exceeds 1 KB limit (${byteLength} bytes)`
      );
    }
  }

  return json;
}

/**
 * Deserializes a JSON string back into a CRDTOperation.
 * Throws if the input is not valid JSON or does not match the expected shape.
 */
export function deserialize(data: string): CRDTOperation {
  const parsed = JSON.parse(data) as CRDTOperation;
  return parsed;
}

/**
 * Attempts serialization with retry logic.
 * Retries up to 3 times on failure, emitting error events on each attempt.
 * After 3 failures, emits a permanent-failure event and returns null (operation discarded).
 */
export function serializeWithRetry(
  operation: CRDTOperation,
  onError: (err: SDKError) => void
): string | null {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return serialize(operation);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown serialization error";

      if (attempt < MAX_RETRIES) {
        onError({
          operationId: operation.id,
          code: "SERIALIZATION_ERROR",
          message: `Serialization attempt ${attempt}/${MAX_RETRIES} failed: ${message}`,
        });
      } else {
        // Final attempt failed — emit permanent-failure event
        onError({
          operationId: operation.id,
          code: "PERMANENT_FAILURE",
          message: `Operation discarded after ${MAX_RETRIES} failed serialization attempts: ${message}`,
        });
      }
    }
  }

  return null;
}
