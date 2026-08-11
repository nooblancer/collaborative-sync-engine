/**
 * Unit tests for SyncEngineV2 — multi-room CRDT orchestration engine.
 *
 * Tests cover:
 * - Room lifecycle (create, get, delete)
 * - Operation processing with conflict detection
 * - Batch processing
 * - Room state isolation
 * - Conflict history management
 *
 * Requirements: 1.1, 1.3, 1.7, 3.1-3.7
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SyncEngineV2 } from "./sync-engine-v2.js";
import type { CRDTOperation, ConflictEvent } from "../types/index.js";

function makeOperation(overrides: Partial<CRDTOperation> = {}): CRDTOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: "test-session",
    replicaId: "replica-1",
    type: "add",
    itemId: "item-1",
    payload: { x: 100, y: 200 },
    timestamp: { wallTime: Date.now(), logical: 0, nodeId: "node-1" },
    version: 1,
    ...overrides,
  };
}

describe("SyncEngineV2", () => {
  let engine: SyncEngineV2;

  beforeEach(() => {
    engine = new SyncEngineV2();
  });

  describe("createRoom", () => {
    it("creates a room with auto-generated UUID when no ID provided", () => {
      const room = engine.createRoom();
      expect(room.id).toBeDefined();
      expect(room.id.length).toBeGreaterThan(0);
      // UUID format check
      expect(room.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("creates a room with the provided ID", () => {
      const room = engine.createRoom("my-room");
      expect(room.id).toBe("my-room");
    });

    it("initializes room with empty CRDT state", () => {
      const room = engine.createRoom();
      expect(room.state.items).toEqual({});
      expect(room.state.version).toBe(0);
      expect(room.state.sessionId).toBe(room.id);
    });

    it("initializes room with empty participants", () => {
      const room = engine.createRoom();
      expect(room.participants.size).toBe(0);
    });

    it("initializes room with zero operation count", () => {
      const room = engine.createRoom();
      expect(room.operationCount).toBe(0);
    });

    it("initializes room with empty conflict history", () => {
      const room = engine.createRoom();
      expect(room.conflictHistory).toEqual([]);
    });

    it("generates unique IDs for multiple rooms", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const room = engine.createRoom();
        ids.add(room.id);
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("getRoom", () => {
    it("returns the room when it exists", () => {
      const created = engine.createRoom("room-1");
      const retrieved = engine.getRoom("room-1");
      expect(retrieved).toBe(created);
    });

    it("returns undefined for non-existent room", () => {
      const room = engine.getRoom("does-not-exist");
      expect(room).toBeUndefined();
    });
  });

  describe("deleteRoom", () => {
    it("removes the room from the engine", () => {
      engine.createRoom("room-to-delete");
      expect(engine.getRoom("room-to-delete")).toBeDefined();

      engine.deleteRoom("room-to-delete");
      expect(engine.getRoom("room-to-delete")).toBeUndefined();
    });

    it("does not throw when deleting non-existent room", () => {
      expect(() => engine.deleteRoom("not-here")).not.toThrow();
    });

    it("does not affect other rooms", () => {
      engine.createRoom("room-a");
      engine.createRoom("room-b");

      engine.deleteRoom("room-a");
      expect(engine.getRoom("room-b")).toBeDefined();
    });
  });

  describe("processOperation", () => {
    it("returns error for non-existent room", async () => {
      const op = makeOperation();
      const result = await engine.processOperation("no-room", op);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("room_not_found");
    });

    it("successfully adds an item to a room", async () => {
      engine.createRoom("room-1");
      const op = makeOperation({
        sessionId: "room-1",
        type: "add",
        itemId: "item-1",
        payload: { name: "rect-1" },
      });

      const result = await engine.processOperation("room-1", op);
      expect(result.success).toBe(true);
      expect(result.delta).toBeDefined();
      expect(result.delta!.changes.length).toBeGreaterThan(0);
    });

    it("increments operation count on successful merge", async () => {
      engine.createRoom("room-1");
      const op = makeOperation({ sessionId: "room-1" });

      await engine.processOperation("room-1", op);
      const room = engine.getRoom("room-1")!;
      expect(room.operationCount).toBe(1);
    });

    it("does not increment operation count on failed merge", async () => {
      engine.createRoom("room-1");
      // Update on non-existent item should fail
      const op = makeOperation({
        sessionId: "room-1",
        type: "update",
        itemId: "non-existent-item",
        payload: { x: 10 },
      });

      const result = await engine.processOperation("room-1", op);
      expect(result.success).toBe(false);
      const room = engine.getRoom("room-1")!;
      expect(room.operationCount).toBe(0);
    });

    it("rejects updates to tombstoned items with object_not_found", async () => {
      engine.createRoom("room-1");

      // Add item
      const addOp = makeOperation({
        sessionId: "room-1",
        type: "add",
        itemId: "item-1",
        payload: { x: 10 },
        timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" },
      });
      await engine.processOperation("room-1", addOp);

      // Remove item
      const removeOp = makeOperation({
        sessionId: "room-1",
        type: "remove",
        itemId: "item-1",
        payload: {},
        timestamp: { wallTime: 2000, logical: 0, nodeId: "node-1" },
      });
      await engine.processOperation("room-1", removeOp);

      // Try to update the removed item
      const updateOp = makeOperation({
        sessionId: "room-1",
        type: "update",
        itemId: "item-1",
        payload: { x: 20 },
        timestamp: { wallTime: 3000, logical: 0, nodeId: "node-1" },
      });

      const result = await engine.processOperation("room-1", updateOp);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("object_not_found");
    });
  });

  describe("processBatch", () => {
    it("returns error for non-existent room", async () => {
      const ops = [makeOperation(), makeOperation()];
      const result = await engine.processBatch("no-room", ops);

      expect(result.totalReceived).toBe(2);
      expect(result.merged).toBe(0);
      expect(result.failed.length).toBe(2);
    });

    it("processes all valid operations in a batch", async () => {
      engine.createRoom("room-1");
      const ops = [
        makeOperation({
          id: "op-1",
          sessionId: "room-1",
          type: "add",
          itemId: "item-1",
          payload: { x: 10 },
          timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" },
        }),
        makeOperation({
          id: "op-2",
          sessionId: "room-1",
          type: "add",
          itemId: "item-2",
          payload: { y: 20 },
          timestamp: { wallTime: 1001, logical: 0, nodeId: "node-1" },
        }),
      ];

      const result = await engine.processBatch("room-1", ops);
      expect(result.totalReceived).toBe(2);
      expect(result.merged).toBe(2);
      expect(result.failed.length).toBe(0);
    });

    it("reports both successes and failures in a batch", async () => {
      engine.createRoom("room-1");
      const ops = [
        makeOperation({
          id: "op-1",
          sessionId: "room-1",
          type: "add",
          itemId: "item-1",
          payload: { x: 10 },
          timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" },
        }),
        makeOperation({
          id: "op-2",
          sessionId: "room-1",
          type: "update",
          itemId: "non-existent",
          payload: { x: 20 },
          timestamp: { wallTime: 1001, logical: 0, nodeId: "node-1" },
        }),
      ];

      const result = await engine.processBatch("room-1", ops);
      expect(result.totalReceived).toBe(2);
      expect(result.merged).toBe(1);
      expect(result.failed.length).toBe(1);
    });

    it("maintains causal ordering in batch (same client ops applied in order)", async () => {
      engine.createRoom("room-1");
      const ops = [
        makeOperation({
          id: "op-1",
          sessionId: "room-1",
          replicaId: "client-a",
          type: "add",
          itemId: "item-1",
          payload: { x: 10 },
          timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
        }),
        makeOperation({
          id: "op-2",
          sessionId: "room-1",
          replicaId: "client-a",
          type: "update",
          itemId: "item-1",
          payload: { x: 50 },
          timestamp: { wallTime: 1001, logical: 0, nodeId: "node-a" },
        }),
      ];

      await engine.processBatch("room-1", ops);
      const state = engine.getState("room-1");
      // The item should exist with x=50 (second op overwrites first)
      expect(state.items["item-1"]).toBeDefined();
      expect(state.items["item-1"].fields["x"].value).toBe(50);
    });
  });

  describe("Room state isolation", () => {
    it("operations in room A do not affect room B", async () => {
      engine.createRoom("room-a");
      engine.createRoom("room-b");

      // Add item to room A
      const op = makeOperation({
        sessionId: "room-a",
        type: "add",
        itemId: "item-1",
        payload: { x: 100 },
      });
      await engine.processOperation("room-a", op);

      // Room B should still be empty
      const stateB = engine.getState("room-b");
      expect(Object.keys(stateB.items).length).toBe(0);

      // Room A should have the item
      const stateA = engine.getState("room-a");
      expect(Object.keys(stateA.items).length).toBe(1);
    });

    it("deleting room A does not affect room B state", async () => {
      engine.createRoom("room-a");
      engine.createRoom("room-b");

      const opB = makeOperation({
        sessionId: "room-b",
        type: "add",
        itemId: "item-b",
        payload: { val: 42 },
      });
      await engine.processOperation("room-b", opB);

      engine.deleteRoom("room-a");

      const stateB = engine.getState("room-b");
      expect(stateB.items["item-b"]).toBeDefined();
    });

    it("concurrent operations in different rooms produce independent states", async () => {
      engine.createRoom("room-1");
      engine.createRoom("room-2");

      // Add same itemId to both rooms with different values
      const op1 = makeOperation({
        sessionId: "room-1",
        type: "add",
        itemId: "shared-id",
        payload: { color: "red" },
        timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" },
      });
      const op2 = makeOperation({
        sessionId: "room-2",
        type: "add",
        itemId: "shared-id",
        payload: { color: "blue" },
        timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" },
      });

      await engine.processOperation("room-1", op1);
      await engine.processOperation("room-2", op2);

      const state1 = engine.getState("room-1");
      const state2 = engine.getState("room-2");

      expect(state1.items["shared-id"].fields["color"].value).toBe("red");
      expect(state2.items["shared-id"].fields["color"].value).toBe("blue");
    });
  });

  describe("Conflict detection and history", () => {
    it("emits ConflictEvent when different clients modify the same field", async () => {
      engine.createRoom("room-1");
      const conflicts: ConflictEvent[] = [];
      engine.onConflict((e) => conflicts.push(e));

      // Client A adds item with x=10
      const addOp = makeOperation({
        sessionId: "room-1",
        replicaId: "client-a",
        type: "add",
        itemId: "item-1",
        payload: { x: 10 },
        timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
      });
      await engine.processOperation("room-1", addOp);

      // Client B updates x=20 with higher timestamp (wins)
      const updateOp = makeOperation({
        sessionId: "room-1",
        replicaId: "client-b",
        type: "update",
        itemId: "item-1",
        payload: { x: 20 },
        timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
      });
      await engine.processOperation("room-1", updateOp);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].field).toBe("x");
      expect(conflicts[0].operationA.clientId).toBe("client-a");
      expect(conflicts[0].operationB.clientId).toBe("client-b");
      expect(conflicts[0].winner).toBe("B");
      expect(conflicts[0].reason).toContain("higher wall time");
    });

    it("does not emit conflict when same client modifies their own field", async () => {
      engine.createRoom("room-1");
      const conflicts: ConflictEvent[] = [];
      engine.onConflict((e) => conflicts.push(e));

      const addOp = makeOperation({
        sessionId: "room-1",
        replicaId: "client-a",
        type: "add",
        itemId: "item-1",
        payload: { x: 10 },
        timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
      });
      await engine.processOperation("room-1", addOp);

      // Same client updates
      const updateOp = makeOperation({
        sessionId: "room-1",
        replicaId: "client-a",
        type: "update",
        itemId: "item-1",
        payload: { x: 20 },
        timestamp: { wallTime: 2000, logical: 0, nodeId: "node-a" },
      });
      await engine.processOperation("room-1", updateOp);

      expect(conflicts.length).toBe(0);
    });

    it("does not emit conflict when values are the same", async () => {
      engine.createRoom("room-1");
      const conflicts: ConflictEvent[] = [];
      engine.onConflict((e) => conflicts.push(e));

      const addOp = makeOperation({
        sessionId: "room-1",
        replicaId: "client-a",
        type: "add",
        itemId: "item-1",
        payload: { x: 10 },
        timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
      });
      await engine.processOperation("room-1", addOp);

      // Different client sets same value
      const updateOp = makeOperation({
        sessionId: "room-1",
        replicaId: "client-b",
        type: "update",
        itemId: "item-1",
        payload: { x: 10 },
        timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
      });
      await engine.processOperation("room-1", updateOp);

      expect(conflicts.length).toBe(0);
    });

    it("conflict history is bounded at 100 events", async () => {
      engine.createRoom("room-1");

      // Add an item first
      const addOp = makeOperation({
        sessionId: "room-1",
        replicaId: "client-a",
        type: "add",
        itemId: "item-1",
        payload: { x: 0 },
        timestamp: { wallTime: 100, logical: 0, nodeId: "node-a" },
      });
      await engine.processOperation("room-1", addOp);

      // Generate 110 conflicts
      for (let i = 0; i < 110; i++) {
        const updateOp = makeOperation({
          sessionId: "room-1",
          replicaId: `client-${i % 2 === 0 ? "b" : "c"}`,
          type: "update",
          itemId: "item-1",
          payload: { x: i + 1 },
          timestamp: {
            wallTime: 200 + i,
            logical: 0,
            nodeId: `node-${i % 2 === 0 ? "b" : "c"}`,
          },
        });
        await engine.processOperation("room-1", updateOp);
      }

      const history = engine.getConflictHistory("room-1");
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it("getConflictHistory respects limit parameter", async () => {
      engine.createRoom("room-1");

      // Generate 10 conflicts by alternating between two different clients
      // Each pair creates a conflict because a different client wrote the field
      for (let i = 0; i < 10; i++) {
        const replica = i % 2 === 0 ? "client-a" : "client-b";
        const node = i % 2 === 0 ? "node-a" : "node-b";
        const opType = i === 0 ? "add" : "update";

        const op = makeOperation({
          sessionId: "room-1",
          replicaId: replica,
          type: opType as "add" | "update",
          itemId: "item-1",
          payload: { x: i },
          timestamp: {
            wallTime: 1000 + i,
            logical: 0,
            nodeId: node,
          },
        });
        await engine.processOperation("room-1", op);
      }

      // We should have conflicts: ops 1,2,3,4,5,6,7,8,9 each conflict
      // with the previous writer (alternating clients)
      const allHistory = engine.getConflictHistory("room-1");
      expect(allHistory.length).toBeGreaterThanOrEqual(5);

      const limited = engine.getConflictHistory("room-1", 5);
      expect(limited.length).toBe(5);
    });

    it("getConflictHistory returns empty array for non-existent room", () => {
      const history = engine.getConflictHistory("no-room");
      expect(history).toEqual([]);
    });
  });

  describe("getState", () => {
    it("returns empty state for non-existent room", () => {
      const state = engine.getState("unknown-room");
      expect(state.items).toEqual({});
      expect(state.version).toBe(0);
    });

    it("returns current state reflecting applied operations", async () => {
      engine.createRoom("room-1");
      const op = makeOperation({
        sessionId: "room-1",
        type: "add",
        itemId: "obj-1",
        payload: { name: "test" },
      });
      await engine.processOperation("room-1", op);

      const state = engine.getState("room-1");
      expect(state.items["obj-1"]).toBeDefined();
      expect(state.items["obj-1"].fields["name"].value).toBe("test");
    });
  });

  describe("getRoomCount", () => {
    it("returns 0 when no rooms exist", () => {
      expect(engine.getRoomCount()).toBe(0);
    });

    it("returns correct count after creating rooms", () => {
      engine.createRoom("a");
      engine.createRoom("b");
      engine.createRoom("c");
      expect(engine.getRoomCount()).toBe(3);
    });

    it("decrements after deleting a room", () => {
      engine.createRoom("a");
      engine.createRoom("b");
      engine.deleteRoom("a");
      expect(engine.getRoomCount()).toBe(1);
    });
  });
});
