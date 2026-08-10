import { describe, it, expect } from "vitest";
import { validateOperation } from "./validation.js";
import type { CRDTOperation } from "../types/index.js";

/** Helper to create a valid operation for testing. */
function validOperation(overrides?: Partial<CRDTOperation>): CRDTOperation {
  return {
    id: "op-123",
    sessionId: "session-1",
    replicaId: "replica-1",
    type: "add",
    itemId: "item-1",
    payload: { name: "Widget" },
    timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" },
    version: 0,
    ...overrides,
  };
}

describe("validateOperation", () => {
  it("returns null for a valid add operation", () => {
    expect(validateOperation(validOperation())).toBeNull();
  });

  it("returns null for a valid update operation", () => {
    expect(
      validateOperation(validOperation({ type: "update", payload: { qty: 5 } }))
    ).toBeNull();
  });

  it("returns null for a valid remove operation with empty payload", () => {
    expect(
      validateOperation(validOperation({ type: "remove", payload: {} }))
    ).toBeNull();
  });

  // ID validation
  it("rejects missing id", () => {
    const result = validateOperation(validOperation({ id: "" }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("MISSING_ID");
  });

  it("rejects whitespace-only id", () => {
    const result = validateOperation(validOperation({ id: "   " }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("MISSING_ID");
  });

  // Timestamp validation
  it("rejects missing timestamp", () => {
    const op = validOperation();
    (op as any).timestamp = undefined;
    const result = validateOperation(op);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("MISSING_TIMESTAMP");
  });

  it("rejects null timestamp", () => {
    const op = validOperation();
    (op as any).timestamp = null;
    const result = validateOperation(op);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("MISSING_TIMESTAMP");
  });

  it("rejects timestamp with wallTime <= 0", () => {
    const result = validateOperation(
      validOperation({ timestamp: { wallTime: 0, logical: 0, nodeId: "n1" } })
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_TIMESTAMP");
  });

  it("rejects timestamp with negative logical", () => {
    const result = validateOperation(
      validOperation({ timestamp: { wallTime: 100, logical: -1, nodeId: "n1" } })
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_TIMESTAMP");
  });

  it("rejects timestamp with empty nodeId", () => {
    const result = validateOperation(
      validOperation({ timestamp: { wallTime: 100, logical: 0, nodeId: "" } })
    );
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_TIMESTAMP");
  });

  // SessionId validation
  it("rejects missing sessionId", () => {
    const result = validateOperation(validOperation({ sessionId: "" }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("MISSING_SESSION_ID");
  });

  // ReplicaId validation
  it("rejects missing replicaId", () => {
    const result = validateOperation(validOperation({ replicaId: "" }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("MISSING_REPLICA_ID");
  });

  // ItemId validation
  it("rejects missing itemId", () => {
    const result = validateOperation(validOperation({ itemId: "" }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("MISSING_ITEM_ID");
  });

  // Type validation
  it("rejects invalid operation type", () => {
    const op = validOperation();
    (op as any).type = "delete";
    const result = validateOperation(op);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_TYPE");
  });

  // Payload validation
  it("rejects null payload", () => {
    const op = validOperation();
    (op as any).payload = null;
    const result = validateOperation(op);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects array payload", () => {
    const op = validOperation();
    (op as any).payload = [1, 2, 3];
    const result = validateOperation(op);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects empty payload for add operation", () => {
    const result = validateOperation(validOperation({ type: "add", payload: {} }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_PAYLOAD");
  });

  it("rejects empty payload for update operation", () => {
    const result = validateOperation(validOperation({ type: "update", payload: {} }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_PAYLOAD");
  });

  it("allows empty payload for remove operation", () => {
    const result = validateOperation(validOperation({ type: "remove", payload: {} }));
    expect(result).toBeNull();
  });

  // Version validation
  it("rejects negative version", () => {
    const result = validateOperation(validOperation({ version: -1 }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_VERSION");
  });

  it("rejects non-integer version", () => {
    const result = validateOperation(validOperation({ version: 1.5 }));
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_VERSION");
  });

  it("accepts version 0", () => {
    expect(validateOperation(validOperation({ version: 0 }))).toBeNull();
  });

  // Error structure validation
  it("returns the operationId in the error", () => {
    const result = validateOperation(validOperation({ id: "abc", sessionId: "" }));
    expect(result).not.toBeNull();
    expect(result!.operationId).toBe("abc");
  });
});
