/**
 * Unit tests for SnapshotManagerV2.
 *
 * Tests snapshot creation at threshold, garbage collection,
 * tombstone removal, memory-based forced snapshots, and
 * client join data delivery.
 *
 * Requirements: 23.1-23.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SnapshotManagerV2 } from "./snapshot-manager-v2.js";
import type { CRDTState, CRDTOperation, HLCTimestamp } from "../types/index.js";

/** Helper to create a minimal CRDT state. */
function createState(sessionId: string, items: Record<string, any> = {}): CRDTState {
  return {
    sessionId,
    items,
    version: 0,
    lastUpdated: { wallTime: Date.now(), logical: 0, nodeId: "test" },
  };
}

/** Helper to create a CRDT operation. */
function createOperation(
  sessionId: string,
  itemId: string,
  type: "add" | "update" | "remove" = "update",
  wallTime?: number
): CRDTOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2, 10)}`,
    sessionId,
    replicaId: "replica-1",
    type,
    itemId,
    payload: { value: Math.random() },
    timestamp: {
      wallTime: wallTime ?? Date.now(),
      logical: 0,
      nodeId: "test-node",
    },
    version: 1,
  };
}

/** Helper to create state with tombstoned items. */
function createStateWithTombstones(sessionId: string): CRDTState {
  return {
    sessionId,
    items: {
      "item-1": {
        itemId: "item-1",
        fields: { x: { value: 10, timestamp: { wallTime: 100, logical: 0, nodeId: "n1" }, replicaId: "r1" } },
        addedAt: { wallTime: 50, logical: 0, nodeId: "n1" },
        removedAt: null,
      },
      "item-2": {
        itemId: "item-2",
        fields: { x: { value: 20, timestamp: { wallTime: 200, logical: 0, nodeId: "n1" }, replicaId: "r1" } },
        addedAt: { wallTime: 60, logical: 0, nodeId: "n1" },
        removedAt: { wallTime: 300, logical: 0, nodeId: "n1" }, // Tombstoned
      },
      "item-3": {
        itemId: "item-3",
        fields: { x: { value: 30, timestamp: { wallTime: 150, logical: 0, nodeId: "n1" }, replicaId: "r1" } },
        addedAt: { wallTime: 70, logical: 0, nodeId: "n1" },
        removedAt: null,
      },
    },
    version: 5,
    lastUpdated: { wallTime: 300, logical: 0, nodeId: "n1" },
  };
}

describe("SnapshotManagerV2", () => {
  let manager: SnapshotManagerV2;
  const roomId = "test-room";

  beforeEach(() => {
    manager = new SnapshotManagerV2({ snapshotThreshold: 5, maxRoomMemoryMb: 50 });
  });

  describe("registerRoom / unregisterRoom", () => {
    it("should register a room and track it", () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);
      expect(manager.getOpsSinceSnapshot(roomId)).toBe(0);
    });

    it("should unregister a room", () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);
      manager.unregisterRoom(roomId);
      expect(manager.getOpsSinceSnapshot(roomId)).toBe(0);
      expect(manager.getMemoryUsage(roomId)).toBe(0);
    });

    it("should not overwrite if already registered", () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);
      // Record some ops
      const op = createOperation(roomId, "item-1");
      manager.recordOperation(roomId, op, state);
      // Re-register should not reset
      manager.registerRoom(roomId, state);
      expect(manager.getOpsSinceSnapshot(roomId)).toBe(1);
    });
  });

  describe("recordOperation and automatic snapshot", () => {
    it("should not create snapshot below threshold", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      for (let i = 0; i < 4; i++) {
        const op = createOperation(roomId, `item-${i}`);
        const result = await manager.recordOperation(roomId, op, state);
        expect(result).toBeNull();
      }
      expect(manager.getOpsSinceSnapshot(roomId)).toBe(4);
    });

    it("should create snapshot when threshold is reached", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      let snapshot = null;
      for (let i = 0; i < 5; i++) {
        const op = createOperation(roomId, `item-${i}`);
        snapshot = await manager.recordOperation(roomId, op, state);
      }

      expect(snapshot).not.toBeNull();
      expect(snapshot!.sessionId).toBe(roomId);
      expect(manager.getOpsSinceSnapshot(roomId)).toBe(0);
    });

    it("should create multiple snapshots over time", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      let snapshotCount = 0;
      for (let i = 0; i < 15; i++) {
        const op = createOperation(roomId, `item-${i}`);
        const result = await manager.recordOperation(roomId, op, state);
        if (result) snapshotCount++;
      }

      expect(snapshotCount).toBe(3); // 5, 10, 15
    });
  });

  describe("checkAndSnapshot", () => {
    it("should return null if opCount below threshold", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);
      const result = await manager.checkAndSnapshot(roomId, 3);
      expect(result).toBeNull();
    });

    it("should create snapshot if opCount at threshold", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);
      const result = await manager.checkAndSnapshot(roomId, 5);
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe(roomId);
    });

    it("should return null for unregistered room", async () => {
      const result = await manager.checkAndSnapshot("unknown", 1000);
      expect(result).toBeNull();
    });
  });

  describe("forceSnapshot", () => {
    it("should create a snapshot immediately", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      const snapshot = await manager.forceSnapshot(roomId);
      expect(snapshot).toBeDefined();
      expect(snapshot.sessionId).toBe(roomId);
      expect(snapshot.id).toBeTruthy();
    });

    it("should reset ops counter after forced snapshot", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      // Record some ops
      for (let i = 0; i < 3; i++) {
        await manager.recordOperation(roomId, createOperation(roomId, `item-${i}`), state);
      }
      expect(manager.getOpsSinceSnapshot(roomId)).toBe(3);

      await manager.forceSnapshot(roomId);
      expect(manager.getOpsSinceSnapshot(roomId)).toBe(0);
    });

    it("should throw for unregistered room", async () => {
      await expect(manager.forceSnapshot("unknown")).rejects.toThrow(
        /not registered/
      );
    });
  });

  describe("getLatestSnapshot", () => {
    it("should return null when no snapshots exist", async () => {
      manager.registerRoom(roomId, createState(roomId));
      const result = await manager.getLatestSnapshot(roomId);
      expect(result).toBeNull();
    });

    it("should return latest snapshot after creation", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);
      await manager.forceSnapshot(roomId);

      const result = await manager.getLatestSnapshot(roomId);
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe(roomId);
    });

    it("should return null for unknown room", async () => {
      const result = await manager.getLatestSnapshot("unknown");
      expect(result).toBeNull();
    });
  });

  describe("garbageCollect", () => {
    it("should remove operations before snapshot", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      // Add operations with explicit wallTimes
      for (let i = 0; i < 5; i++) {
        const op = createOperation(roomId, `item-${i}`, "update", 100 + i);
        await manager.recordOperation(roomId, op, state);
      }

      // The snapshot is created automatically (threshold=5)
      const snapshot = await manager.getLatestSnapshot(roomId);
      expect(snapshot).not.toBeNull();

      // Add more ops after snapshot
      for (let i = 5; i < 8; i++) {
        const op = createOperation(roomId, `item-${i}`, "update", snapshot!.createdAt + i);
        await manager.recordOperation(roomId, op, state);
      }

      const removed = await manager.garbageCollect(roomId, snapshot!);
      expect(removed).toBe(5); // The 5 ops before snapshot
      expect(manager.getOperations(roomId).length).toBe(3); // Only 3 remain
    });

    it("should return 0 for unknown room", async () => {
      const fakeSnapshot = {
        id: "fake",
        sessionId: "unknown",
        state: createState("unknown"),
        createdAt: Date.now(),
        operationCount: 0,
      };
      const removed = await manager.garbageCollect("unknown", fakeSnapshot);
      expect(removed).toBe(0);
    });

    it("should remove tombstones from active state", async () => {
      const state = createStateWithTombstones(roomId);
      manager.registerRoom(roomId, state);

      const snapshot = await manager.forceSnapshot(roomId);
      await manager.garbageCollect(roomId, snapshot);

      // item-2 was tombstoned, should be removed
      expect(state.items["item-1"]).toBeDefined();
      expect(state.items["item-2"]).toBeUndefined();
      expect(state.items["item-3"]).toBeDefined();
    });
  });

  describe("getMemoryUsage", () => {
    it("should return 0 for unknown room", () => {
      expect(manager.getMemoryUsage("unknown")).toBe(0);
    });

    it("should return positive value for registered room with state", () => {
      const state = createState(roomId, {
        "item-1": {
          itemId: "item-1",
          fields: { x: { value: 42, timestamp: { wallTime: 100, logical: 0, nodeId: "n1" }, replicaId: "r1" } },
          addedAt: { wallTime: 50, logical: 0, nodeId: "n1" },
          removedAt: null,
        },
      });
      manager.registerRoom(roomId, state);
      expect(manager.getMemoryUsage(roomId)).toBeGreaterThan(0);
    });

    it("should grow with more operations", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      const before = manager.getMemoryUsage(roomId);
      await manager.recordOperation(roomId, createOperation(roomId, "item-1"), state);
      const after = manager.getMemoryUsage(roomId);

      expect(after).toBeGreaterThan(before);
    });
  });

  describe("checkMemoryAndSnapshot", () => {
    it("should not force snapshot when under threshold", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);
      const result = await manager.checkMemoryAndSnapshot(roomId);
      expect(result).toBeNull();
    });

    it("should force snapshot and GC when memory exceeds threshold", async () => {
      // Use a tiny memory threshold to trigger
      const tinyManager = new SnapshotManagerV2({
        snapshotThreshold: 10000,
        maxRoomMemoryMb: 0.0001, // ~100 bytes threshold
      });

      const state = createState(roomId, {
        "big-item": {
          itemId: "big-item",
          fields: {
            data: {
              value: "x".repeat(200),
              timestamp: { wallTime: 100, logical: 0, nodeId: "n1" },
              replicaId: "r1",
            },
          },
          addedAt: { wallTime: 50, logical: 0, nodeId: "n1" },
          removedAt: null,
        },
      });
      tinyManager.registerRoom(roomId, state);

      // Add operations to push over memory limit
      for (let i = 0; i < 5; i++) {
        const op = createOperation(roomId, `item-${i}`, "update", 100 + i);
        await tinyManager.recordOperation(roomId, op, state);
      }

      const result = await tinyManager.checkMemoryAndSnapshot(roomId);
      expect(result).not.toBeNull();
    });
  });

  describe("getClientJoinData", () => {
    it("should return all operations when no snapshot exists", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      // Add some ops
      for (let i = 0; i < 3; i++) {
        await manager.recordOperation(roomId, createOperation(roomId, `item-${i}`, "update", 100 + i), state);
      }

      const joinData = await manager.getClientJoinData(roomId);
      expect(joinData.snapshot).toBeNull();
      expect(joinData.tailOperations.length).toBe(3);
    });

    it("should return snapshot + tail ops after snapshot creation", async () => {
      const state = createState(roomId);
      manager.registerRoom(roomId, state);

      // Fill to threshold (5 ops creates snapshot)
      for (let i = 0; i < 5; i++) {
        await manager.recordOperation(
          roomId,
          createOperation(roomId, `item-${i}`, "update", 100 + i),
          state
        );
      }

      // Get the snapshot time
      const snapshot = await manager.getLatestSnapshot(roomId);
      expect(snapshot).not.toBeNull();

      // Add tail ops after snapshot
      for (let i = 5; i < 8; i++) {
        await manager.recordOperation(
          roomId,
          createOperation(roomId, `item-${i}`, "update", snapshot!.createdAt + 1000 + i),
          state
        );
      }

      const joinData = await manager.getClientJoinData(roomId);
      expect(joinData.snapshot).not.toBeNull();
      expect(joinData.snapshot!.id).toBe(snapshot!.id);
      // Tail ops should only include post-snapshot operations
      expect(joinData.tailOperations.length).toBe(3);
    });

    it("should return empty data for unknown room", async () => {
      const joinData = await manager.getClientJoinData("unknown");
      expect(joinData.snapshot).toBeNull();
      expect(joinData.tailOperations.length).toBe(0);
    });
  });

  describe("snapshot removes tombstones", () => {
    it("should remove tombstoned items from snapshot state", async () => {
      const state = createStateWithTombstones(roomId);
      manager.registerRoom(roomId, state);

      const snapshot = await manager.forceSnapshot(roomId);

      // Snapshot state should not contain tombstoned item-2
      expect(snapshot.state.items["item-1"]).toBeDefined();
      expect(snapshot.state.items["item-2"]).toBeUndefined();
      expect(snapshot.state.items["item-3"]).toBeDefined();
    });

    it("should also clean tombstones from live state on snapshot", async () => {
      const state = createStateWithTombstones(roomId);
      manager.registerRoom(roomId, state);

      await manager.forceSnapshot(roomId);

      // Live state should also have tombstones removed
      expect(state.items["item-2"]).toBeUndefined();
      expect(state.items["item-1"]).toBeDefined();
      expect(state.items["item-3"]).toBeDefined();
    });
  });

  describe("configure", () => {
    it("should update snapshot threshold", () => {
      manager.configure({ snapshotThreshold: 2000 });
      expect(manager.getConfig().snapshotThreshold).toBe(2000);
    });

    it("should update max room memory", () => {
      manager.configure({ maxRoomMemoryMb: 100 });
      expect(manager.getConfig().maxRoomMemoryMb).toBe(100);
    });
  });
});
