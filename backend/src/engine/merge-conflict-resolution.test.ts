/**
 * Unit tests for CRDT merge with conflict resolution (Task 4.3).
 *
 * Tests cover:
 * 1. LWW conflict resolution on Canvas_Object fields using HLC comparison
 * 2. Remove-wins semantics for delete operations
 * 3. Append-only merge for freehand path points
 * 4. ConflictEvent emission with full details
 * 5. Per-room conflict history bounded at 100
 *
 * Requirements: 3.2-3.5, 8.1-8.4
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mergeOperation } from "./merge.js";
import { SyncEngineV2 } from "./sync-engine-v2.js";
import type { CRDTState, CRDTOperation, ConflictEvent } from "../types/index.js";

function makeState(sessionId = "test-session"): CRDTState {
  return {
    sessionId,
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "server" },
  };
}

function makeOp(overrides: Partial<CRDTOperation> = {}): CRDTOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: "test-session",
    replicaId: "replica-1",
    type: "add",
    itemId: "item-1",
    payload: { x: 100 },
    timestamp: { wallTime: 1000, logical: 0, nodeId: "node-1" },
    version: 1,
    ...overrides,
  };
}

describe("LWW Conflict Resolution on Canvas_Object fields (Req 3.2, 3.4)", () => {
  it("higher wallTime wins when two clients modify the same field", () => {
    const state = makeState();

    // Client A adds item with x=10
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Client B updates x=20 with higher wallTime
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(state.items["obj-1"].fields["x"].value).toBe(20);
    expect(state.items["obj-1"].fields["x"].replicaId).toBe("client-b");
  });

  it("lower wallTime loses even if it arrives later", () => {
    const state = makeState();

    // Client A adds item with x=10 at wallTime 2000
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-a" },
    }));

    // Client B updates x=20 with LOWER wallTime (arrives "later" but has earlier timestamp)
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-b" },
    }));

    // Client A's value wins because it has higher wallTime
    expect(state.items["obj-1"].fields["x"].value).toBe(10);
  });

  it("ties on wallTime are broken by logical counter", () => {
    const state = makeState();

    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 1, nodeId: "node-a" },
    }));

    // Same wallTime, lower logical — should lose
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-b" },
    }));

    expect(state.items["obj-1"].fields["x"].value).toBe(10);
  });

  it("ties on wallTime and logical are broken by nodeId lexicographic comparison", () => {
    const state = makeState();

    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "aaa" },
    }));

    // Same wallTime, same logical, higher nodeId wins
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "zzz" },
    }));

    expect(state.items["obj-1"].fields["x"].value).toBe(20);
    expect(state.items["obj-1"].fields["x"].replicaId).toBe("client-b");
  });

  it("LWW applies per-field independently", () => {
    const state = makeState();

    // Client A adds item with x=10, y=10
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10, y: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Client B updates x=20 with higher timestamp
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    // Client C updates y=30 with even higher timestamp
    mergeOperation(state, makeOp({
      replicaId: "client-c",
      type: "update",
      itemId: "obj-1",
      payload: { y: 30 },
      timestamp: { wallTime: 3000, logical: 0, nodeId: "node-c" },
    }));

    // x should be B's value, y should be C's value
    expect(state.items["obj-1"].fields["x"].value).toBe(20);
    expect(state.items["obj-1"].fields["y"].value).toBe(30);
  });
});

describe("Remove-Wins Semantics (Req 3.3)", () => {
  it("delete wins over update regardless of HLC ordering (delete first)", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");

    // Add item
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Delete the item (lower timestamp)
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "remove",
      itemId: "obj-1",
      payload: {},
      timestamp: { wallTime: 1500, logical: 0, nodeId: "node-b" },
    }));

    // Update the item (higher timestamp, arrives after delete)
    const result = await engine.processOperation("room-1", makeOp({
      replicaId: "client-c",
      type: "update",
      itemId: "obj-1",
      payload: { x: 99 },
      timestamp: { wallTime: 3000, logical: 0, nodeId: "node-c" },
    }));

    // Remove-wins: update should be rejected
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("object_not_found");
  });

  it("tombstoned items have removedAt set", () => {
    const state = makeState();

    // Add item
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Remove item
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "remove",
      itemId: "obj-1",
      payload: {},
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(state.items["obj-1"].removedAt).not.toBeNull();
    expect(state.items["obj-1"].removedAt!.wallTime).toBe(2000);
  });

  it("remove and update in any order converges to removed state", () => {
    // Order 1: remove then update (at merge level)
    const state1 = makeState();
    mergeOperation(state1, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));
    mergeOperation(state1, makeOp({
      type: "remove",
      itemId: "obj-1",
      payload: {},
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));
    mergeOperation(state1, makeOp({
      type: "update",
      itemId: "obj-1",
      payload: { x: 99 },
      timestamp: { wallTime: 3000, logical: 0, nodeId: "node-c" },
    }));

    // Order 2: update then remove (at merge level)
    const state2 = makeState();
    mergeOperation(state2, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));
    mergeOperation(state2, makeOp({
      type: "update",
      itemId: "obj-1",
      payload: { x: 99 },
      timestamp: { wallTime: 3000, logical: 0, nodeId: "node-c" },
    }));
    mergeOperation(state2, makeOp({
      type: "remove",
      itemId: "obj-1",
      payload: {},
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    // Both should have removedAt set
    expect(state1.items["obj-1"].removedAt).not.toBeNull();
    expect(state2.items["obj-1"].removedAt).not.toBeNull();
  });
});

describe("Append-Only Merge for Freehand Path Points (Req 3.5)", () => {
  it("concurrent point additions from different clients are all preserved", () => {
    const state = makeState();

    // Client A creates a freehand path with initial points
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "path-1",
      payload: {
        type: "freehand",
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Client B adds more points to the same path
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "path-1",
      payload: {
        points: [{ x: 20, y: 20 }, { x: 30, y: 30 }],
      },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    const pointsField = state.items["path-1"].fields["points"];
    const pointsValue = pointsField.value as { segments: Array<{ data: unknown[] }> };

    // Both segments should be present (append-only, no data loss)
    expect(pointsValue.segments).toHaveLength(2);
    expect(pointsValue.segments[0].data).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(pointsValue.segments[1].data).toEqual([{ x: 20, y: 20 }, { x: 30, y: 30 }]);
  });

  it("three clients adding points all get their segments merged", () => {
    const state = makeState();

    // Client A starts the path
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "path-1",
      payload: {
        type: "freehand",
        points: [{ x: 0, y: 0 }],
      },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Client B adds points
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "path-1",
      payload: {
        points: [{ x: 50, y: 50 }],
      },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    // Client C adds points
    mergeOperation(state, makeOp({
      replicaId: "client-c",
      type: "update",
      itemId: "path-1",
      payload: {
        points: [{ x: 100, y: 100 }],
      },
      timestamp: { wallTime: 3000, logical: 0, nodeId: "node-c" },
    }));

    const pointsField = state.items["path-1"].fields["points"];
    const pointsValue = pointsField.value as { segments: Array<{ data: unknown[]; replicaId: string }> };

    // All three segments preserved
    expect(pointsValue.segments).toHaveLength(3);

    // Verify all points are present across segments
    const allPoints = pointsValue.segments.flatMap((s) => s.data);
    expect(allPoints).toContainEqual({ x: 0, y: 0 });
    expect(allPoints).toContainEqual({ x: 50, y: 50 });
    expect(allPoints).toContainEqual({ x: 100, y: 100 });
  });

  it("same client adding more points appends (does not overwrite)", () => {
    const state = makeState();

    // Client A starts the path
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "path-1",
      payload: {
        type: "freehand",
        points: [{ x: 0, y: 0 }],
      },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Client A adds more points later
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "update",
      itemId: "path-1",
      payload: {
        points: [{ x: 10, y: 10 }],
      },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-a" },
    }));

    const pointsField = state.items["path-1"].fields["points"];
    const pointsValue = pointsField.value as { segments: Array<{ data: unknown[] }> };

    // Both segments preserved (append-only, no overwrite)
    expect(pointsValue.segments).toHaveLength(2);
    const allPoints = pointsValue.segments.flatMap((s) => s.data);
    expect(allPoints).toContainEqual({ x: 0, y: 0 });
    expect(allPoints).toContainEqual({ x: 10, y: 10 });
  });

  it("segments are ordered deterministically by timestamp", () => {
    const state = makeState();

    // Add item with initial field so that updates work
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "path-1",
      payload: { type: "freehand" },
      timestamp: { wallTime: 500, logical: 0, nodeId: "node-a" },
    }));

    // Client C adds points (highest timestamp)
    mergeOperation(state, makeOp({
      replicaId: "client-c",
      type: "update",
      itemId: "path-1",
      payload: { points: [{ x: 30, y: 30 }] },
      timestamp: { wallTime: 3000, logical: 0, nodeId: "node-c" },
    }));

    // Client A adds points (lowest timestamp - arrives later)
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "update",
      itemId: "path-1",
      payload: { points: [{ x: 10, y: 10 }] },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    const pointsField = state.items["path-1"].fields["points"];
    const pointsValue = pointsField.value as {
      segments: Array<{ data: unknown[]; timestamp: { wallTime: number } }>
    };

    // Segments should be sorted by timestamp (ascending)
    expect(pointsValue.segments[0].timestamp.wallTime).toBe(1000);
    expect(pointsValue.segments[1].timestamp.wallTime).toBe(3000);
  });

  it("supports pre-structured segment format input", () => {
    const state = makeState();

    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "path-1",
      payload: {
        type: "freehand",
        points: {
          segments: [{
            replicaId: "client-a",
            startIndex: 0,
            data: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
            timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
          }],
        },
      },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Add another segment
    mergeOperation(state, makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "path-1",
      payload: {
        points: {
          segments: [{
            replicaId: "client-b",
            startIndex: 0,
            data: [{ x: 20, y: 20 }],
            timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
          }],
        },
      },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    const pointsField = state.items["path-1"].fields["points"];
    const pointsValue = pointsField.value as { segments: Array<{ data: unknown[] }> };

    expect(pointsValue.segments).toHaveLength(2);
    const allPoints = pointsValue.segments.flatMap((s) => s.data);
    expect(allPoints).toHaveLength(3);
  });

  it("duplicate segments are not added twice (idempotent)", () => {
    const state = makeState();

    const segment = {
      segments: [{
        replicaId: "client-a",
        startIndex: 0,
        data: [{ x: 0, y: 0 }],
        timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
      }],
    };

    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "path-1",
      payload: { type: "freehand", points: segment },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Apply same segment again
    mergeOperation(state, makeOp({
      replicaId: "client-a",
      type: "update",
      itemId: "path-1",
      payload: { points: segment },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    const pointsField = state.items["path-1"].fields["points"];
    const pointsValue = pointsField.value as { segments: Array<{ data: unknown[] }> };
    expect(pointsValue.segments).toHaveLength(1);
  });
});

describe("ConflictEvent Emission (Req 8.1, 8.2)", () => {
  let engine: SyncEngineV2;
  let conflicts: ConflictEvent[];

  beforeEach(() => {
    engine = new SyncEngineV2();
    conflicts = [];
    engine.onConflict((e) => conflicts.push(e));
    engine.createRoom("room-1");
  });

  it("emits ConflictEvent with both operations and their HLC timestamps", async () => {
    // Client A adds item
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { color: "red" },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    // Client B updates same field
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { color: "blue" },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];

    // Both operations included with HLC timestamps
    expect(conflict.operationA.clientId).toBe("client-a");
    expect(conflict.operationA.hlc.wallTime).toBe(1000);
    expect(conflict.operationA.value).toBe("red");

    expect(conflict.operationB.clientId).toBe("client-b");
    expect(conflict.operationB.hlc.wallTime).toBe(2000);
    expect(conflict.operationB.value).toBe("blue");
  });

  it("includes the field name where conflict occurred", async () => {
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { position_x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { position_x: 50 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(conflicts[0].field).toBe("position_x");
  });

  it("identifies winner correctly as 'B' when new operation wins", async () => {
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(conflicts[0].winner).toBe("B");
  });

  it("identifies winner correctly as 'A' when existing operation wins", async () => {
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 5000, logical: 0, nodeId: "node-a" },
    }));

    // Client B has lower timestamp — existing (A) wins
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-b" },
    }));

    expect(conflicts[0].winner).toBe("A");
  });

  it("provides human-readable reason for wallTime resolution", async () => {
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(conflicts[0].reason).toContain("higher wall time");
  });

  it("provides human-readable reason for logical counter resolution", async () => {
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 1000, logical: 5, nodeId: "node-b" },
    }));

    expect(conflicts[0].reason).toContain("higher logical counter");
  });

  it("provides human-readable reason for nodeId tiebreaker", async () => {
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "aaa" },
    }));

    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "zzz" },
    }));

    expect(conflicts[0].reason).toContain("lexicographic nodeId tiebreaker");
  });

  it("includes roomId in ConflictEvent", async () => {
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 10 },
      timestamp: { wallTime: 1000, logical: 0, nodeId: "node-a" },
    }));

    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 20 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(conflicts[0].roomId).toBe("room-1");
  });
});

describe("Per-Room Conflict History Bounded at 100 (Req 8.4)", () => {
  it("keeps at most 100 conflict events per room", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");

    // Add initial item
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 0 },
      timestamp: { wallTime: 100, logical: 0, nodeId: "node-a" },
    }));

    // Generate 120 conflicts by alternating clients
    for (let i = 1; i <= 120; i++) {
      const replica = i % 2 === 0 ? "client-b" : "client-c";
      const node = i % 2 === 0 ? "node-b" : "node-c";

      await engine.processOperation("room-1", makeOp({
        replicaId: replica,
        type: "update",
        itemId: "obj-1",
        payload: { x: i },
        timestamp: { wallTime: 200 + i, logical: 0, nodeId: node },
      }));
    }

    const history = engine.getConflictHistory("room-1");
    expect(history.length).toBeLessThanOrEqual(100);
  });

  it("retains most recent conflicts when limit exceeded", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");

    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 0 },
      timestamp: { wallTime: 100, logical: 0, nodeId: "node-a" },
    }));

    // Generate 105 conflicts
    for (let i = 1; i <= 105; i++) {
      const replica = i % 2 === 0 ? "client-b" : "client-c";
      const node = i % 2 === 0 ? "node-b" : "node-c";

      await engine.processOperation("room-1", makeOp({
        replicaId: replica,
        type: "update",
        itemId: "obj-1",
        payload: { x: i * 10 },
        timestamp: { wallTime: 200 + i, logical: 0, nodeId: node },
      }));
    }

    const history = engine.getConflictHistory("room-1");
    // The most recent conflict should have a high x value
    const lastConflict = history[history.length - 1];
    // It should be from a recent operation (high wallTime)
    expect(lastConflict.operationB.hlc.wallTime).toBeGreaterThan(290);
  });

  it("different rooms have independent conflict histories", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");
    engine.createRoom("room-2");

    // Add items to both rooms
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 0 },
      timestamp: { wallTime: 100, logical: 0, nodeId: "node-a" },
    }));
    await engine.processOperation("room-2", makeOp({
      replicaId: "client-a",
      type: "add",
      itemId: "obj-1",
      payload: { x: 0 },
      timestamp: { wallTime: 100, logical: 0, nodeId: "node-a" },
    }));

    // Generate conflict in room-1 only
    await engine.processOperation("room-1", makeOp({
      replicaId: "client-b",
      type: "update",
      itemId: "obj-1",
      payload: { x: 99 },
      timestamp: { wallTime: 2000, logical: 0, nodeId: "node-b" },
    }));

    expect(engine.getConflictHistory("room-1").length).toBe(1);
    expect(engine.getConflictHistory("room-2").length).toBe(0);
  });
});
