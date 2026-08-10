/**
 * Unit tests for the Persistence Layer.
 * Tests the InMemoryPersistenceLayer which mirrors the PostgresPersistenceLayer
 * behavior without requiring a database connection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPersistenceLayer } from "./persistence-layer.js";
import type { CRDTOperation, CRDTState } from "../types/index.js";

function makeOperation(overrides: Partial<CRDTOperation> = {}): CRDTOperation {
  return {
    id: overrides.id ?? "op-1",
    sessionId: overrides.sessionId ?? "session-1",
    replicaId: overrides.replicaId ?? "replica-1",
    type: overrides.type ?? "add",
    itemId: overrides.itemId ?? "item-1",
    payload: overrides.payload ?? { name: "Widget" },
    timestamp: overrides.timestamp ?? {
      wallTime: 1000,
      logical: 0,
      nodeId: "node-1",
    },
    version: overrides.version ?? 1,
  };
}

function makeState(overrides: Partial<CRDTState> = {}): CRDTState {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    items: overrides.items ?? {},
    version: overrides.version ?? 1,
    lastUpdated: overrides.lastUpdated ?? {
      wallTime: 1000,
      logical: 0,
      nodeId: "node-1",
    },
  };
}

describe("InMemoryPersistenceLayer", () => {
  let persistence: InMemoryPersistenceLayer;

  beforeEach(() => {
    persistence = new InMemoryPersistenceLayer();
  });

  describe("appendOperation", () => {
    it("should return success when appending a valid operation", async () => {
      const op = makeOperation();
      const result = await persistence.appendOperation(op);
      expect(result).toEqual({ success: true });
    });

    it("should persist the operation so it appears in the full log", async () => {
      const op = makeOperation();
      await persistence.appendOperation(op);
      const log = await persistence.getFullOperationLog("session-1");
      expect(log).toHaveLength(1);
      expect(log[0].id).toBe("op-1");
    });

    it("should store multiple operations in order", async () => {
      const op1 = makeOperation({ id: "op-1", timestamp: { wallTime: 1000, logical: 0, nodeId: "n1" } });
      const op2 = makeOperation({ id: "op-2", timestamp: { wallTime: 2000, logical: 0, nodeId: "n1" } });
      await persistence.appendOperation(op1);
      await persistence.appendOperation(op2);

      const log = await persistence.getFullOperationLog("session-1");
      expect(log).toHaveLength(2);
      expect(log[0].id).toBe("op-1");
      expect(log[1].id).toBe("op-2");
    });
  });

  describe("getFullOperationLog", () => {
    it("should return empty array for unknown session", async () => {
      const log = await persistence.getFullOperationLog("nonexistent");
      expect(log).toEqual([]);
    });

    it("should return only operations for the specified session", async () => {
      await persistence.appendOperation(makeOperation({ id: "op-1", sessionId: "session-1" }));
      await persistence.appendOperation(makeOperation({ id: "op-2", sessionId: "session-2" }));

      const log = await persistence.getFullOperationLog("session-1");
      expect(log).toHaveLength(1);
      expect(log[0].id).toBe("op-1");
    });
  });

  describe("getOperationsSince", () => {
    it("should return empty array for unknown snapshot", async () => {
      const ops = await persistence.getOperationsSince("nonexistent-snapshot");
      expect(ops).toEqual([]);
    });

    it("should return operations after a snapshot was created", async () => {
      const op1 = makeOperation({ id: "op-1", timestamp: { wallTime: 1000, logical: 0, nodeId: "n1" } });
      await persistence.appendOperation(op1);

      const snapshotId = await persistence.saveSnapshot("session-1", makeState());

      const op2 = makeOperation({ id: "op-2", timestamp: { wallTime: Date.now() + 1000, logical: 0, nodeId: "n1" } });
      await persistence.appendOperation(op2);

      const ops = await persistence.getOperationsSince(snapshotId);
      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe("op-2");
    });
  });

  describe("saveSnapshot / getLatestSnapshot", () => {
    it("should save and retrieve a snapshot", async () => {
      const state = makeState({ version: 5 });
      const id = await persistence.saveSnapshot("session-1", state);

      const snapshot = await persistence.getLatestSnapshot("session-1");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.id).toBe(id);
      expect(snapshot!.sessionId).toBe("session-1");
      expect(snapshot!.state.version).toBe(5);
    });

    it("should return null when no snapshot exists", async () => {
      const snapshot = await persistence.getLatestSnapshot("nonexistent");
      expect(snapshot).toBeNull();
    });

    it("should return the latest snapshot when multiple exist", async () => {
      const state1 = makeState({ version: 1 });
      await persistence.saveSnapshot("session-1", state1);

      // Small delay to ensure different createdAt
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state2 = makeState({ version: 2 });
      const id2 = await persistence.saveSnapshot("session-1", state2);

      const snapshot = await persistence.getLatestSnapshot("session-1");
      expect(snapshot!.id).toBe(id2);
      expect(snapshot!.state.version).toBe(2);
    });
  });

  describe("cacheState / getCachedState", () => {
    it("should cache and retrieve state", async () => {
      const state = makeState({ version: 7 });
      await persistence.cacheState("session-1", state);

      const cached = await persistence.getCachedState("session-1");
      expect(cached).not.toBeNull();
      expect(cached!.version).toBe(7);
    });

    it("should return null for uncached session", async () => {
      const cached = await persistence.getCachedState("nonexistent");
      expect(cached).toBeNull();
    });

    it("should store a deep copy (mutations don't affect cached)", async () => {
      const state = makeState({ version: 3 });
      await persistence.cacheState("session-1", state);

      state.version = 99;

      const cached = await persistence.getCachedState("session-1");
      expect(cached!.version).toBe(3);
    });
  });

  describe("reset", () => {
    it("should clear all stored data", async () => {
      await persistence.appendOperation(makeOperation());
      await persistence.saveSnapshot("session-1", makeState());
      await persistence.cacheState("session-1", makeState());

      persistence.reset();

      expect(await persistence.getFullOperationLog("session-1")).toEqual([]);
      expect(await persistence.getLatestSnapshot("session-1")).toBeNull();
      expect(await persistence.getCachedState("session-1")).toBeNull();
    });
  });
});
