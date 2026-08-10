/**
 * Unit tests for SnapshotManager.
 *
 * Uses InMemoryPersistenceLayer to verify:
 * - Snapshot creation and recovery
 * - Recovery from snapshot + replay of subsequent operations
 * - Recovery from full operation log when no snapshot exists
 * - Periodic snapshot scheduling
 * - Configurable interval constraints (≤ 10 minutes)
 *
 * Requirements: 7.4, 7.5, 7.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SnapshotManager } from "./snapshot-manager.js";
import { InMemoryPersistenceLayer } from "./persistence-layer.js";
import type { CRDTState, CRDTOperation, HLCTimestamp } from "../types/index.js";

function makeTimestamp(wallTime: number, logical = 0, nodeId = "node-1"): HLCTimestamp {
  return { wallTime, logical, nodeId };
}

function makeOperation(
  sessionId: string,
  itemId: string,
  type: "add" | "remove" | "update",
  payload: Record<string, unknown>,
  wallTime: number,
  replicaId = "replica-1"
): CRDTOperation {
  return {
    id: `op-${itemId}-${wallTime}`,
    sessionId,
    replicaId,
    type,
    itemId,
    payload,
    timestamp: makeTimestamp(wallTime, 0, replicaId),
    version: 0,
  };
}

function createEmptyState(sessionId: string): CRDTState {
  return {
    sessionId,
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "" },
  };
}

describe("SnapshotManager", () => {
  let persistence: InMemoryPersistenceLayer;
  let manager: SnapshotManager;
  const sessionId = "test-session";

  beforeEach(() => {
    persistence = new InMemoryPersistenceLayer();
    manager = new SnapshotManager(persistence);
  });

  afterEach(() => {
    manager.stopPeriodicSnapshots();
  });

  describe("constructor", () => {
    it("should accept default interval (10 minutes)", () => {
      const m = new SnapshotManager(persistence);
      expect(m).toBeDefined();
    });

    it("should accept interval less than 10 minutes", () => {
      const m = new SnapshotManager(persistence, 60_000);
      expect(m).toBeDefined();
    });

    it("should accept interval of exactly 10 minutes", () => {
      const m = new SnapshotManager(persistence, 600_000);
      expect(m).toBeDefined();
    });

    it("should reject interval greater than 10 minutes", () => {
      expect(() => new SnapshotManager(persistence, 600_001)).toThrow(
        /Snapshot interval must be ≤ 600000ms/
      );
    });
  });

  describe("saveSnapshot", () => {
    it("should save a snapshot and return an ID", async () => {
      const state = createEmptyState(sessionId);
      const id = await manager.saveSnapshot(sessionId, state);
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
    });

    it("should persist the state in the snapshot", async () => {
      const state: CRDTState = {
        sessionId,
        items: {
          "item-1": {
            itemId: "item-1",
            fields: {
              name: { value: "Widget", timestamp: makeTimestamp(100), replicaId: "r1" },
            },
            addedAt: makeTimestamp(100),
            removedAt: null,
          },
        },
        version: 1,
        lastUpdated: makeTimestamp(100),
      };

      await manager.saveSnapshot(sessionId, state);
      const snapshot = await persistence.getLatestSnapshot(sessionId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.state.items["item-1"].fields.name.value).toBe("Widget");
    });
  });

  describe("recoverState - no snapshot", () => {
    it("should return empty state when no operations exist", async () => {
      const state = await manager.recoverState(sessionId);
      expect(state.sessionId).toBe(sessionId);
      expect(state.items).toEqual({});
      expect(state.version).toBe(0);
    });

    it("should replay full operation log when no snapshot exists", async () => {
      // Add some operations
      const op1 = makeOperation(sessionId, "item-1", "add", { name: "A" }, 100);
      const op2 = makeOperation(sessionId, "item-2", "add", { name: "B" }, 200);
      const op3 = makeOperation(sessionId, "item-1", "update", { qty: 5 }, 300);

      await persistence.appendOperation(op1);
      await persistence.appendOperation(op2);
      await persistence.appendOperation(op3);

      const state = await manager.recoverState(sessionId);

      expect(Object.keys(state.items)).toHaveLength(2);
      expect(state.items["item-1"].fields.name.value).toBe("A");
      expect(state.items["item-1"].fields.qty.value).toBe(5);
      expect(state.items["item-2"].fields.name.value).toBe("B");
      expect(state.version).toBe(3);
    });

    it("should handle remove operations during replay", async () => {
      const op1 = makeOperation(sessionId, "item-1", "add", { name: "A" }, 100);
      const op2 = makeOperation(sessionId, "item-1", "remove", {}, 200);

      await persistence.appendOperation(op1);
      await persistence.appendOperation(op2);

      const state = await manager.recoverState(sessionId);

      expect(state.items["item-1"].removedAt).not.toBeNull();
    });
  });

  describe("recoverState - with snapshot", () => {
    it("should start from snapshot state and replay subsequent operations", async () => {
      // Create a state with one item already in it
      const snapshotState: CRDTState = {
        sessionId,
        items: {
          "item-1": {
            itemId: "item-1",
            fields: {
              name: { value: "Original", timestamp: makeTimestamp(100), replicaId: "r1" },
            },
            addedAt: makeTimestamp(100),
            removedAt: null,
          },
        },
        version: 1,
        lastUpdated: makeTimestamp(100),
      };

      // Save snapshot (this sets the createdAt to Date.now())
      await persistence.saveSnapshot(sessionId, snapshotState);

      // Add an operation after the snapshot (wallTime > snapshot.createdAt)
      // InMemoryPersistenceLayer uses wallTime > snapshot.createdAt for filtering
      const futureTime = Date.now() + 1000;
      const op = makeOperation(sessionId, "item-1", "update", { qty: 10 }, futureTime);
      await persistence.appendOperation(op);

      const state = await manager.recoverState(sessionId);

      expect(state.items["item-1"].fields.name.value).toBe("Original");
      expect(state.items["item-1"].fields.qty.value).toBe(10);
    });

    it("should use only operations since snapshot, not the full log", async () => {
      // Add operations before snapshot
      const op1 = makeOperation(sessionId, "item-1", "add", { name: "A" }, 100);
      await persistence.appendOperation(op1);

      // Save snapshot with the result of op1 already applied
      const snapshotState: CRDTState = {
        sessionId,
        items: {
          "item-1": {
            itemId: "item-1",
            fields: {
              name: { value: "A", timestamp: makeTimestamp(100), replicaId: "replica-1" },
            },
            addedAt: makeTimestamp(100),
            removedAt: null,
          },
        },
        version: 1,
        lastUpdated: makeTimestamp(100),
      };
      await persistence.saveSnapshot(sessionId, snapshotState);

      // Add operation after snapshot
      const futureTime = Date.now() + 1000;
      const op2 = makeOperation(sessionId, "item-2", "add", { name: "B" }, futureTime);
      await persistence.appendOperation(op2);

      const state = await manager.recoverState(sessionId);

      // Should have both items: item-1 from snapshot, item-2 from replay
      expect(state.items["item-1"].fields.name.value).toBe("A");
      expect(state.items["item-2"].fields.name.value).toBe("B");
    });

    it("should return snapshot state unchanged when no subsequent operations", async () => {
      const snapshotState: CRDTState = {
        sessionId,
        items: {
          "item-1": {
            itemId: "item-1",
            fields: {
              name: { value: "Frozen", timestamp: makeTimestamp(500), replicaId: "r1" },
            },
            addedAt: makeTimestamp(500),
            removedAt: null,
          },
        },
        version: 5,
        lastUpdated: makeTimestamp(500),
      };

      await persistence.saveSnapshot(sessionId, snapshotState);

      const state = await manager.recoverState(sessionId);

      expect(state.items["item-1"].fields.name.value).toBe("Frozen");
      expect(state.version).toBe(5);
    });
  });

  describe("recoverState - isolation between sessions", () => {
    it("should only recover operations for the specified session", async () => {
      const op1 = makeOperation("session-A", "item-1", "add", { name: "A" }, 100);
      const op2 = makeOperation("session-B", "item-2", "add", { name: "B" }, 200);

      await persistence.appendOperation(op1);
      await persistence.appendOperation(op2);

      const stateA = await manager.recoverState("session-A");
      const stateB = await manager.recoverState("session-B");

      expect(Object.keys(stateA.items)).toHaveLength(1);
      expect(stateA.items["item-1"]).toBeDefined();
      expect(Object.keys(stateB.items)).toHaveLength(1);
      expect(stateB.items["item-2"]).toBeDefined();
    });
  });

  describe("periodic snapshots", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should create snapshots at the configured interval", async () => {
      const shortManager = new SnapshotManager(persistence, 1000);

      // Add an operation so recovery produces a non-empty state
      const op = makeOperation(sessionId, "item-1", "add", { name: "Test" }, 50);
      await persistence.appendOperation(op);

      shortManager.startPeriodicSnapshots(sessionId);

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(1000);

      const snapshot = await persistence.getLatestSnapshot(sessionId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.sessionId).toBe(sessionId);

      shortManager.stopPeriodicSnapshots();
    });

    it("should stop creating snapshots after stopPeriodicSnapshots", async () => {
      const shortManager = new SnapshotManager(persistence, 1000);
      const saveSpy = vi.spyOn(persistence, "saveSnapshot");

      shortManager.startPeriodicSnapshots(sessionId);

      // Advance one interval
      await vi.advanceTimersByTimeAsync(1000);
      const callsAfterFirst = saveSpy.mock.calls.length;

      // Stop and advance more
      shortManager.stopPeriodicSnapshots();
      await vi.advanceTimersByTimeAsync(3000);

      expect(saveSpy.mock.calls.length).toBe(callsAfterFirst);
    });

    it("should restart interval when startPeriodicSnapshots called again", async () => {
      const shortManager = new SnapshotManager(persistence, 1000);
      const saveSpy = vi.spyOn(persistence, "saveSnapshot");

      shortManager.startPeriodicSnapshots(sessionId);
      await vi.advanceTimersByTimeAsync(500);

      // Restart — should reset the interval
      shortManager.startPeriodicSnapshots(sessionId);
      await vi.advanceTimersByTimeAsync(500);

      // Only 500ms elapsed since restart, so no snapshot yet
      expect(saveSpy.mock.calls.length).toBe(0);

      await vi.advanceTimersByTimeAsync(500);
      // Now 1000ms elapsed since restart
      expect(saveSpy.mock.calls.length).toBe(1);

      shortManager.stopPeriodicSnapshots();
    });
  });
});
