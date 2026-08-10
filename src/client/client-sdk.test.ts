/**
 * Unit tests for the ClientSDK core (local replica management).
 * Validates Requirements 4.1, 4.2, 9.4.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { ClientSDK } from "./client-sdk.js";

/** Creates a local WebSocket server for testing and returns the server + URL. */
function createTestServer(): { wss: WebSocketServer; url: string; close: () => Promise<void> } {
  const wss = new WebSocketServer({ port: 0 });
  const address = wss.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `ws://127.0.0.1:${port}`;
  const close = () => new Promise<void>((resolve) => wss.close(() => resolve()));
  return { wss, url, close };
}

describe("ClientSDK core — local replica management", () => {
  it("initializes with an empty local CRDT state", () => {
    const sdk = new ClientSDK("replica-1");
    const state = sdk.getLocalState();

    expect(state.sessionId).toBe("");
    expect(state.items).toEqual({});
    expect(state.version).toBe(0);
    expect(state.lastUpdated.nodeId).toBe("replica-1");
  });

  it("exposes the replica ID", () => {
    const sdk = new ClientSDK("my-replica");
    expect(sdk.getReplicaId()).toBe("my-replica");
  });

  it("starts in disconnected state", () => {
    const sdk = new ClientSDK("replica-1");
    expect(sdk.getConnectionState()).toBe("disconnected");
  });

  describe("connect/disconnect stubs", () => {
    let server: { wss: WebSocketServer; url: string; close: () => Promise<void> };

    beforeEach(() => {
      server = createTestServer();
    });

    afterEach(async () => {
      await server.close();
    });

    it("sets connection state to connected on connect()", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token-123", "session-abc");

      expect(sdk.getConnectionState()).toBe("connected");
      await sdk.disconnect();
    });

    it("sets sessionId on the local state when connecting", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token-123", "session-abc");

      expect(sdk.getLocalState().sessionId).toBe("session-abc");
      await sdk.disconnect();
    });

    it("sets connection state to disconnected on disconnect()", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token-123", "session-abc");
      await sdk.disconnect();

      expect(sdk.getConnectionState()).toBe("disconnected");
    });
  });

  describe("event handlers", () => {
    let server: { wss: WebSocketServer; url: string; close: () => Promise<void> };

    beforeEach(() => {
      server = createTestServer();
    });

    afterEach(async () => {
      await server.close();
    });

    it("fires connected handler on connect()", async () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onConnected(handler);

      await sdk.connect(server.url, "token", "session-1");

      expect(handler).toHaveBeenCalledTimes(1);
      await sdk.disconnect();
    });

    it("fires disconnected handler on disconnect()", async () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onDisconnected(handler);

      await sdk.connect(server.url, "token", "session-1");
      await sdk.disconnect();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("supports multiple connected handlers", async () => {
      const sdk = new ClientSDK("replica-1");
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      sdk.onConnected(handler1);
      sdk.onConnected(handler2);

      await sdk.connect(server.url, "token", "session-1");

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      await sdk.disconnect();
    });

    it("registers state-change handlers without error", () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onStateChange(handler);
      // No error thrown; handler registered
    });

    it("registers error handlers without error", () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onError(handler);
      // No error thrown; handler registered
    });

    it("registers presence handlers without error", () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onPresence(handler);
      // No error thrown; handler registered
    });
  });

  describe("add/remove/update — high-level API (Requirements 8.1, 9.1, 9.2)", () => {
    it("add() returns accepted with a valid UUID operationId", () => {
      const sdk = new ClientSDK("replica-1");
      const result = sdk.add("inventory", "item-1", { name: "Widget", quantity: 5 });
      expect(result.accepted).toBe(true);
      expect(result.operationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("add() applies operation to local state", () => {
      const sdk = new ClientSDK("replica-1");
      sdk.add("inventory", "item-1", { name: "Widget", quantity: 5 });
      const state = sdk.getLocalState();
      expect(state.items["item-1"]).toBeDefined();
      expect(state.version).toBe(1);
    });

    it("add() emits a state-change event with source local", () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onStateChange(handler);
      sdk.add("inventory", "item-1", { name: "Widget" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: "inventory",
          itemId: "item-1",
          changeType: "added",
          source: "local",
        })
      );
    });

    it("add() enqueues operation to the operation queue", () => {
      const sdk = new ClientSDK("replica-1");
      sdk.add("inventory", "item-1", { name: "Widget" });
      expect(sdk.getOperationQueue().size()).toBe(1);
    });

    it("add() rejects name exceeding 100 characters", () => {
      const sdk = new ClientSDK("replica-1");
      const errorHandler = vi.fn();
      sdk.onError(errorHandler);

      const longName = "a".repeat(101);
      const result = sdk.add("inventory", "item-1", { name: longName });

      expect(result.accepted).toBe(false);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ code: "VALIDATION_ERROR" })
      );
    });

    it("add() rejects quantity outside 0-10,000 range", () => {
      const sdk = new ClientSDK("replica-1");
      const result = sdk.add("inventory", "item-1", { name: "Widget", quantity: 10_001 });
      expect(result.accepted).toBe(false);
    });

    it("add() rejects negative quantity", () => {
      const sdk = new ClientSDK("replica-1");
      const result = sdk.add("inventory", "item-1", { name: "Widget", quantity: -1 });
      expect(result.accepted).toBe(false);
    });

    it("add() accepts name at exactly 100 characters", () => {
      const sdk = new ClientSDK("replica-1");
      const name100 = "a".repeat(100);
      const result = sdk.add("inventory", "item-1", { name: name100, quantity: 50 });
      expect(result.accepted).toBe(true);
    });

    it("add() accepts quantity at boundary values 0 and 10,000", () => {
      const sdk = new ClientSDK("replica-1");
      const r1 = sdk.add("inventory", "item-1", { name: "A", quantity: 0 });
      const r2 = sdk.add("inventory", "item-2", { name: "B", quantity: 10_000 });
      expect(r1.accepted).toBe(true);
      expect(r2.accepted).toBe(true);
    });

    it("remove() returns accepted with a valid UUID operationId", () => {
      const sdk = new ClientSDK("replica-1");
      // Add item first so there's something to remove
      sdk.add("inventory", "item-1", { name: "Widget" });
      const result = sdk.remove("inventory", "item-1");
      expect(result.accepted).toBe(true);
      expect(result.operationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("remove() emits a state-change event with changeType removed", () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onStateChange(handler);
      sdk.remove("inventory", "item-1");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: "inventory",
          itemId: "item-1",
          changeType: "removed",
          source: "local",
        })
      );
    });

    it("remove() enqueues operation with empty payload", () => {
      const sdk = new ClientSDK("replica-1");
      sdk.remove("inventory", "item-1");
      const queue = sdk.getOperationQueue();
      const op = queue.peek();
      expect(op).not.toBeNull();
      expect(op!.type).toBe("remove");
      expect(op!.payload).toEqual({});
    });

    it("update() returns accepted with a valid UUID operationId", () => {
      const sdk = new ClientSDK("replica-1");
      sdk.add("inventory", "item-1", { name: "Widget", quantity: 5 });
      const result = sdk.update("inventory", "item-1", { quantity: 10 });
      expect(result.accepted).toBe(true);
      expect(result.operationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("update() emits a state-change event with changeType updated", () => {
      const sdk = new ClientSDK("replica-1");
      const handler = vi.fn();
      sdk.onStateChange(handler);
      sdk.add("inventory", "item-1", { name: "Widget" });
      sdk.update("inventory", "item-1", { quantity: 10 });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: "inventory",
          itemId: "item-1",
          changeType: "updated",
          source: "local",
        })
      );
    });

    it("update() rejects name exceeding 100 characters", () => {
      const sdk = new ClientSDK("replica-1");
      const longName = "a".repeat(101);
      const result = sdk.update("inventory", "item-1", { name: longName });
      expect(result.accepted).toBe(false);
    });

    it("update() rejects quantity outside valid range", () => {
      const sdk = new ClientSDK("replica-1");
      const result = sdk.update("inventory", "item-1", { quantity: -5 });
      expect(result.accepted).toBe(false);
    });
  });

  describe("operation queue access", () => {
    it("provides access to the operation queue", () => {
      const sdk = new ClientSDK("replica-1");
      const queue = sdk.getOperationQueue();
      expect(queue).toBeDefined();
      expect(queue.size()).toBe(0);
      expect(queue.maxCapacity()).toBe(10_000);
    });
  });

  describe("setLocalSchema", () => {
    it("accepts a list of valid collection names", () => {
      const sdk = new ClientSDK("replica-1");
      // Should not throw
      sdk.setLocalSchema(["inventory", "orders"]);
    });

    it("allows an empty schema (no collections accepted)", () => {
      const sdk = new ClientSDK("replica-1");
      sdk.setLocalSchema([]);
      // Any incoming operation should be rejected since no collections are valid
    });
  });

  describe("applyRemoteOperation", () => {
    let server: { wss: WebSocketServer; url: string; close: () => Promise<void> };

    beforeEach(() => {
      server = createTestServer();
    });

    afterEach(async () => {
      await server.close();
    });

    function makeOperation(overrides: Partial<import("../types/index.js").CRDTOperation> = {}): import("../types/index.js").CRDTOperation {
      return {
        id: "op-1",
        sessionId: "session-abc",
        replicaId: "remote-replica",
        type: "add",
        itemId: "item-1",
        payload: { name: "Widget", quantity: 5 },
        timestamp: { wallTime: 1000, logical: 1, nodeId: "remote-replica" },
        version: 0,
        ...overrides,
      };
    }

    it("applies a valid remote add operation and emits state-change event", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");

      const stateChanges: import("../types/index.js").StateChangeEvent[] = [];
      sdk.onStateChange((event) => stateChanges.push(event));

      const op = makeOperation();
      sdk.applyRemoteOperation(op);

      // State should be updated
      const state = sdk.getLocalState();
      expect(state.items["item-1"]).toBeDefined();
      expect(state.version).toBe(1);

      // State-change event should have been emitted
      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].collection).toBe("session-abc");
      expect(stateChanges[0].itemId).toBe("item-1");
      expect(stateChanges[0].changeType).toBe("added");
      expect(stateChanges[0].source).toBe("remote");
      await sdk.disconnect();
    });

    it("applies a valid remote update operation on an existing item", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");

      // First add the item
      const addOp = makeOperation();
      sdk.applyRemoteOperation(addOp);

      const stateChanges: import("../types/index.js").StateChangeEvent[] = [];
      sdk.onStateChange((event) => stateChanges.push(event));

      // Now update it
      const updateOp = makeOperation({
        id: "op-2",
        type: "update",
        payload: { quantity: 10 },
        timestamp: { wallTime: 2000, logical: 1, nodeId: "remote-replica" },
      });
      sdk.applyRemoteOperation(updateOp);

      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].changeType).toBe("updated");
      expect(stateChanges[0].source).toBe("remote");
      await sdk.disconnect();
    });

    it("emits error event when update references unknown item", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");

      const errors: import("../types/index.js").SDKError[] = [];
      sdk.onError((err) => errors.push(err));

      const updateOp = makeOperation({
        id: "op-fail",
        type: "update",
        itemId: "nonexistent-item",
        payload: { quantity: 99 },
      });
      sdk.applyRemoteOperation(updateOp);

      expect(errors).toHaveLength(1);
      expect(errors[0].operationId).toBe("op-fail");
      expect(errors[0].code).toBe("UNKNOWN_ITEM");
      await sdk.disconnect();
    });

    it("rejects operations referencing collections not in local schema", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");
      sdk.setLocalSchema(["inventory"]); // Only "inventory" is valid

      const errors: import("../types/index.js").SDKError[] = [];
      sdk.onError((err) => errors.push(err));

      // Operation has sessionId "session-abc" which is NOT in the schema
      const op = makeOperation({ sessionId: "session-abc" });
      sdk.applyRemoteOperation(op);

      // Should emit error and not modify state
      expect(errors).toHaveLength(1);
      expect(errors[0].operationId).toBe("op-1");
      expect(errors[0].code).toBe("SCHEMA_MISMATCH");
      expect(errors[0].message).toContain("session-abc");

      // State unchanged
      expect(sdk.getLocalState().items).toEqual({});
      await sdk.disconnect();
    });

    it("accepts operations when collection matches local schema", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");
      sdk.setLocalSchema(["session-abc", "inventory"]);

      const stateChanges: import("../types/index.js").StateChangeEvent[] = [];
      sdk.onStateChange((event) => stateChanges.push(event));

      const op = makeOperation({ sessionId: "session-abc" });
      sdk.applyRemoteOperation(op);

      // Should succeed
      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].source).toBe("remote");
      expect(sdk.getLocalState().items["item-1"]).toBeDefined();
      await sdk.disconnect();
    });

    it("accepts all operations when no schema is set", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");
      // No setLocalSchema called — all collections are valid

      const stateChanges: import("../types/index.js").StateChangeEvent[] = [];
      sdk.onStateChange((event) => stateChanges.push(event));

      const op = makeOperation({ sessionId: "any-collection" });
      sdk.applyRemoteOperation(op);

      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].collection).toBe("any-collection");
      await sdk.disconnect();
    });

    it("does not emit state-change when schema rejects the operation", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");
      sdk.setLocalSchema(["valid-only"]);

      const stateChanges: import("../types/index.js").StateChangeEvent[] = [];
      sdk.onStateChange((event) => stateChanges.push(event));

      const op = makeOperation({ sessionId: "invalid-collection" });
      sdk.applyRemoteOperation(op);

      expect(stateChanges).toHaveLength(0);
      await sdk.disconnect();
    });

    it("applies a remote remove operation", async () => {
      const sdk = new ClientSDK("replica-1");
      await sdk.connect(server.url, "token", "session-abc");

      // Add the item first
      const addOp = makeOperation();
      sdk.applyRemoteOperation(addOp);

      const stateChanges: import("../types/index.js").StateChangeEvent[] = [];
      sdk.onStateChange((event) => stateChanges.push(event));

      // Remove it
      const removeOp = makeOperation({
        id: "op-remove",
        type: "remove",
        payload: {},
        timestamp: { wallTime: 3000, logical: 1, nodeId: "remote-replica" },
      });
      sdk.applyRemoteOperation(removeOp);

      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].changeType).toBe("removed");
      expect(stateChanges[0].source).toBe("remote");
      await sdk.disconnect();
    });
  });
});
