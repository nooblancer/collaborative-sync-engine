/**
 * Unit tests for PersistenceLayerV2 (InMemory implementation).
 *
 * Validates: Requirements 7.1, 23.1-23.2
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPersistenceLayerV2 } from "./persistence-layer-v2.js";
import type { CRDTOperation, CRDTState, HLCTimestamp } from "../types/index.js";
import type { ConflictEvent } from "../types/conflict.js";

function makeOperation(overrides: Partial<CRDTOperation> = {}): CRDTOperation {
  return {
    id: overrides.id ?? `op-${Math.random().toString(36).slice(2)}`,
    sessionId: overrides.sessionId ?? "session-1",
    replicaId: overrides.replicaId ?? "replica-1",
    type: overrides.type ?? "add",
    itemId: overrides.itemId ?? "item-1",
    payload: overrides.payload ?? { x: 10, y: 20 },
    timestamp: overrides.timestamp ?? { wallTime: 1000, logical: 0, nodeId: "node-1" },
    version: overrides.version ?? 1,
  };
}

function makeState(roomId: string): CRDTState {
  return {
    sessionId: roomId,
    items: {
      "item-1": {
        itemId: "item-1",
        fields: {
          x: { value: 10, timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" }, replicaId: "replica-1" },
        },
        addedAt: { wallTime: 1000, logical: 0, nodeId: "node-1" },
        removedAt: null,
      },
    },
    version: 1,
    lastUpdated: { wallTime: 1000, logical: 0, nodeId: "node-1" },
  };
}

function makeConflictEvent(overrides: Partial<ConflictEvent> = {}): ConflictEvent {
  return {
    id: overrides.id ?? `conflict-${Math.random().toString(36).slice(2)}`,
    roomId: overrides.roomId ?? "room-1",
    timestamp: overrides.timestamp ?? { wallTime: 2000, logical: 0, nodeId: "node-1" },
    field: overrides.field ?? "position.x",
    operationA: overrides.operationA ?? { clientId: "client-a", value: 10, hlc: { wallTime: 1000, logical: 0, nodeId: "node-a" } },
    operationB: overrides.operationB ?? { clientId: "client-b", value: 20, hlc: { wallTime: 1001, logical: 0, nodeId: "node-b" } },
    winner: overrides.winner ?? "B",
    reason: overrides.reason ?? "Higher wall time",
  };
}

describe("InMemoryPersistenceLayerV2", () => {
  let persistence: InMemoryPersistenceLayerV2;

  beforeEach(() => {
    persistence = new InMemoryPersistenceLayerV2();
  });

  describe("Room Operations", () => {
    it("should append and retrieve operations for a room", async () => {
      const op = makeOperation({ id: "op-1" });
      await persistence.appendRoomOperation("room-1", op);

      const ops = await persistence.getRoomOperations("room-1");
      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe("op-1");
      expect(ops[0].roomId).toBe("room-1");
      expect(ops[0].replicaId).toBe("replica-1");
      expect(ops[0].operationType).toBe("add");
      expect(ops[0].itemId).toBe("item-1");
      expect(ops[0].hlcWallTime).toBe(1000);
      expect(ops[0].hlcLogical).toBe(0);
      expect(ops[0].hlcNodeId).toBe("node-1");
    });

    it("should return operations sorted by HLC order", async () => {
      await persistence.appendRoomOperation("room-1", makeOperation({
        id: "op-3", timestamp: { wallTime: 3000, logical: 0, nodeId: "n" },
      }));
      await persistence.appendRoomOperation("room-1", makeOperation({
        id: "op-1", timestamp: { wallTime: 1000, logical: 0, nodeId: "n" },
      }));
      await persistence.appendRoomOperation("room-1", makeOperation({
        id: "op-2", timestamp: { wallTime: 2000, logical: 0, nodeId: "n" },
      }));

      const ops = await persistence.getRoomOperations("room-1");
      expect(ops.map((o) => o.id)).toEqual(["op-1", "op-2", "op-3"]);
    });

    it("should filter operations after a given timestamp", async () => {
      await persistence.appendRoomOperation("room-1", makeOperation({
        id: "op-1", timestamp: { wallTime: 1000, logical: 0, nodeId: "n" },
      }));
      await persistence.appendRoomOperation("room-1", makeOperation({
        id: "op-2", timestamp: { wallTime: 2000, logical: 0, nodeId: "n" },
      }));
      await persistence.appendRoomOperation("room-1", makeOperation({
        id: "op-3", timestamp: { wallTime: 3000, logical: 0, nodeId: "n" },
      }));

      const ops = await persistence.getRoomOperations("room-1", {
        afterTimestamp: { wallTime: 1000, logical: 0, nodeId: "n" },
      });
      expect(ops.map((o) => o.id)).toEqual(["op-2", "op-3"]);
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await persistence.appendRoomOperation("room-1", makeOperation({
          id: `op-${i}`, timestamp: { wallTime: 1000 + i, logical: 0, nodeId: "n" },
        }));
      }

      const ops = await persistence.getRoomOperations("room-1", { limit: 3 });
      expect(ops).toHaveLength(3);
    });

    it("should return operations within an HLC range", async () => {
      for (let i = 1; i <= 5; i++) {
        await persistence.appendRoomOperation("room-1", makeOperation({
          id: `op-${i}`, timestamp: { wallTime: i * 1000, logical: 0, nodeId: "n" },
        }));
      }

      const ops = await persistence.getRoomOperationsByRange(
        "room-1",
        { wallTime: 2000, logical: 0, nodeId: "n" },
        { wallTime: 4000, logical: 0, nodeId: "n" }
      );
      expect(ops.map((o) => o.id)).toEqual(["op-2", "op-3", "op-4"]);
    });

    it("should delete operations before a given timestamp", async () => {
      for (let i = 1; i <= 5; i++) {
        await persistence.appendRoomOperation("room-1", makeOperation({
          id: `op-${i}`, timestamp: { wallTime: i * 1000, logical: 0, nodeId: "n" },
        }));
      }

      const deleted = await persistence.deleteRoomOperationsBefore("room-1", {
        wallTime: 3000, logical: 0, nodeId: "n",
      });
      expect(deleted).toBe(2); // op-1, op-2

      const remaining = await persistence.getRoomOperations("room-1");
      expect(remaining.map((o) => o.id)).toEqual(["op-3", "op-4", "op-5"]);
    });

    it("should isolate operations between rooms", async () => {
      await persistence.appendRoomOperation("room-1", makeOperation({ id: "op-a" }));
      await persistence.appendRoomOperation("room-2", makeOperation({ id: "op-b" }));

      const room1Ops = await persistence.getRoomOperations("room-1");
      const room2Ops = await persistence.getRoomOperations("room-2");

      expect(room1Ops).toHaveLength(1);
      expect(room1Ops[0].id).toBe("op-a");
      expect(room2Ops).toHaveLength(1);
      expect(room2Ops[0].id).toBe("op-b");
    });
  });

  describe("Room Snapshots", () => {
    it("should save and retrieve a room snapshot", async () => {
      const state = makeState("room-1");
      const id = await persistence.saveRoomSnapshot("room-1", state, 50);

      const snapshot = await persistence.getLatestRoomSnapshot("room-1");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.id).toBe(id);
      expect(snapshot!.roomId).toBe("room-1");
      expect(snapshot!.operationCount).toBe(50);
      expect(snapshot!.snapshotData).toEqual(state);
    });

    it("should return the latest snapshot when multiple exist", async () => {
      const state1 = makeState("room-1");
      await persistence.saveRoomSnapshot("room-1", state1, 50);

      // Small delay to ensure different timestamps
      const state2 = { ...makeState("room-1"), version: 2 };
      await persistence.saveRoomSnapshot("room-1", state2, 100);

      const snapshot = await persistence.getLatestRoomSnapshot("room-1");
      expect(snapshot!.operationCount).toBe(100);
    });

    it("should return null for non-existent room", async () => {
      const snapshot = await persistence.getLatestRoomSnapshot("non-existent");
      expect(snapshot).toBeNull();
    });

    it("should isolate snapshots between rooms", async () => {
      await persistence.saveRoomSnapshot("room-1", makeState("room-1"), 50);
      await persistence.saveRoomSnapshot("room-2", makeState("room-2"), 75);

      const snap1 = await persistence.getLatestRoomSnapshot("room-1");
      const snap2 = await persistence.getLatestRoomSnapshot("room-2");

      expect(snap1!.operationCount).toBe(50);
      expect(snap2!.operationCount).toBe(75);
    });
  });

  describe("Conflict Events", () => {
    it("should save and retrieve conflict events", async () => {
      const event = makeConflictEvent();
      const id = await persistence.saveConflictEvent(event);

      const events = await persistence.getConflictEvents("room-1");
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(id);
      expect(events[0].roomId).toBe("room-1");
      expect(events[0].fieldName).toBe("position.x");
      expect(events[0].winner).toBe("B");
      expect(events[0].reason).toBe("Higher wall time");
    });

    it("should return conflict events in descending order by created_at", async () => {
      for (let i = 0; i < 5; i++) {
        await persistence.saveConflictEvent(makeConflictEvent({
          id: `conflict-${i}`,
          field: `field-${i}`,
        }));
      }

      const events = await persistence.getConflictEvents("room-1");
      expect(events).toHaveLength(5);
      // Most recent should be first
      expect(events[0].fieldName).toBe("field-4");
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await persistence.saveConflictEvent(makeConflictEvent({ id: `c-${i}` }));
      }

      const events = await persistence.getConflictEvents("room-1", 3);
      expect(events).toHaveLength(3);
    });

    it("should isolate conflict events between rooms", async () => {
      await persistence.saveConflictEvent(makeConflictEvent({ roomId: "room-1", id: "c-1" }));
      await persistence.saveConflictEvent(makeConflictEvent({ roomId: "room-2", id: "c-2" }));

      const room1Events = await persistence.getConflictEvents("room-1");
      const room2Events = await persistence.getConflictEvents("room-2");

      expect(room1Events).toHaveLength(1);
      expect(room1Events[0].id).toBe("c-1");
      expect(room2Events).toHaveLength(1);
      expect(room2Events[0].id).toBe("c-2");
    });
  });

  describe("Reset", () => {
    it("should clear all data on reset", async () => {
      await persistence.appendRoomOperation("room-1", makeOperation());
      await persistence.saveRoomSnapshot("room-1", makeState("room-1"), 10);
      await persistence.saveConflictEvent(makeConflictEvent());

      persistence.reset();

      expect(await persistence.getRoomOperations("room-1")).toHaveLength(0);
      expect(await persistence.getLatestRoomSnapshot("room-1")).toBeNull();
      expect(await persistence.getConflictEvents("room-1")).toHaveLength(0);
    });
  });
});
