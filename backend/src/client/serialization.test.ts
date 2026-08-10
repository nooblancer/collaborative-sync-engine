import { describe, it, expect, vi } from "vitest";
import { serialize, deserialize, serializeWithRetry } from "./serialization.js";
import type { CRDTOperation } from "../types/index.js";
import type { SDKError } from "../types/index.js";

function makeOperation(
  payload: Record<string, unknown> = { name: "Widget" }
): CRDTOperation {
  return {
    id: "op-001",
    sessionId: "session-abc",
    replicaId: "replica-1",
    type: "update",
    itemId: "item-123",
    payload,
    timestamp: { wallTime: 1700000000000, logical: 0, nodeId: "node-1" },
    version: 1,
  };
}

describe("serialize", () => {
  it("should serialize a valid operation to a JSON string", () => {
    const op = makeOperation();
    const result = serialize(op);

    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("op-001");
    expect(parsed.payload).toEqual({ name: "Widget" });
  });

  it("should serialize operations with multiple payload fields without size check", () => {
    const op = makeOperation({ name: "Widget", quantity: 5, category: "tools" });
    const result = serialize(op);

    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result);
    expect(parsed.payload).toEqual({ name: "Widget", quantity: 5, category: "tools" });
  });

  it("should throw if a single-field operation exceeds 1 KB", () => {
    // Create a payload with a single field that has a very long value
    const longValue = "x".repeat(2000);
    const op = makeOperation({ name: longValue });

    expect(() => serialize(op)).toThrow("exceeds 1 KB limit");
  });

  it("should allow single-field operations under 1 KB", () => {
    const op = makeOperation({ name: "short value" });
    const result = serialize(op);

    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(1024);
  });

  it("should not throw for multi-field operations even if large", () => {
    const longValue = "x".repeat(2000);
    const op = makeOperation({ field1: longValue, field2: "other" });

    // Should not throw because payload has more than 1 key
    expect(() => serialize(op)).not.toThrow();
  });
});

describe("deserialize", () => {
  it("should deserialize a valid JSON string back to CRDTOperation", () => {
    const op = makeOperation();
    const json = JSON.stringify(op);
    const result = deserialize(json);

    expect(result).toEqual(op);
  });

  it("should round-trip correctly through serialize and deserialize", () => {
    const op = makeOperation({ quantity: 42 });
    const serialized = serialize(op);
    const deserialized = deserialize(serialized);

    expect(deserialized).toEqual(op);
  });

  it("should throw on invalid JSON input", () => {
    expect(() => deserialize("not valid json")).toThrow();
  });

  it("should throw on empty string", () => {
    expect(() => deserialize("")).toThrow();
  });
});

describe("serializeWithRetry", () => {
  it("should return serialized string on first successful attempt", () => {
    const op = makeOperation();
    const onError = vi.fn();

    const result = serializeWithRetry(op, onError);

    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(onError).not.toHaveBeenCalled();
  });

  it("should return null and emit permanent-failure after 3 failed attempts", () => {
    // Create an operation that always fails (single-field, too large)
    const longValue = "x".repeat(2000);
    const op = makeOperation({ name: longValue });
    const errors: SDKError[] = [];
    const onError = (err: SDKError) => errors.push(err);

    const result = serializeWithRetry(op, onError);

    expect(result).toBeNull();
    expect(errors).toHaveLength(3);
    // First two are retry errors
    expect(errors[0].code).toBe("SERIALIZATION_ERROR");
    expect(errors[1].code).toBe("SERIALIZATION_ERROR");
    // Last is permanent failure
    expect(errors[2].code).toBe("PERMANENT_FAILURE");
  });

  it("should include operation ID in all error events", () => {
    const longValue = "x".repeat(2000);
    const op = makeOperation({ name: longValue });
    const errors: SDKError[] = [];
    const onError = (err: SDKError) => errors.push(err);

    serializeWithRetry(op, onError);

    for (const err of errors) {
      expect(err.operationId).toBe("op-001");
    }
  });

  it("should include attempt number in error messages", () => {
    const longValue = "x".repeat(2000);
    const op = makeOperation({ name: longValue });
    const errors: SDKError[] = [];
    const onError = (err: SDKError) => errors.push(err);

    serializeWithRetry(op, onError);

    expect(errors[0].message).toContain("1/3");
    expect(errors[1].message).toContain("2/3");
  });

  it("should emit exactly 3 error events for a permanently failing operation", () => {
    const longValue = "x".repeat(2000);
    const op = makeOperation({ name: longValue });
    const onError = vi.fn();

    serializeWithRetry(op, onError);

    expect(onError).toHaveBeenCalledTimes(3);
  });
});
