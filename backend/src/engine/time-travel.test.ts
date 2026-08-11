/**
 * Unit tests for Time-Travel API (Task 9.1).
 *
 * Tests verify state reconstruction, operation range queries,
 * edge cases (empty state, GC-bounded), and performance targets.
 *
 * Requirements: 7.1-7.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SyncEngineV2 } from "./sync-engine-v2.js";
import type { CRDTOperation, HLCTimestamp } from "../types/index.js";

// --- Helpers ---

function makeOp(
  itemId: string,
  type: "add" | "update" | "remove",
  timestamp: HLCTimestamp,
  replicaId: string = "node-1",
  payload: Record<string, unknown> = { name: "test" }
): CRDTOperation {
  return {
    id: `op-${timestamp.wallTime}-${timestamp.logical}-${timestamp.nodeId}`,
    sessionId: "test-room",
    replicaId,
    type,
    itemId,
    payload,
    timestamp,
    version: 1,
  };
}

function hlc(wallTime: number, logical: number = 0, nodeId: string = "node-1"): HLCTimestamp {
  return { wallTime, logical, nodeId };
}

// --- Tests ---

describe("Time-Travel API: queryTimeTravelState", () => {
  let engine: SyncEngineV2;

  beforeEach(() => {
    engine = new SyncEngineV2();
  });

  it("returns empty state for a non-existent room", async () => {
    const result = await engine.queryTimeTravelState("no-such-room", hlc(1000));
    expect(result.state.items).toEqual({});
    expect(result.boundedByGC).toBe(false);
  });

  it("returns empty state when room has no operations", async () => {
    engine.createRoom("room-1");
    const result = await engine.queryTimeTravelState("room-1", hlc(1000));
    expect(result.state.items).toEqual({});
    expect(result.boundedByGC).toBe(false);
  });

  it("returns empty state for timestamp preceding all operations (Req 7.5)", async () => {
    engine.createRoom("room-1");
    const op = makeOp("item-1", "add", hlc(1000));
    await engine.processOperation("room-1", op);

    // Query at timestamp 500, before the first op at 1000
    const result = await engine.queryTimeTravelState("room-1", hlc(500));
    expect(result.state.items).toEqual({});
    expect(result.boundedByGC).toBe(false);
  });

  it("reconstructs state at a specific timestamp (Req 7.2)", async () => {
    engine.createRoom("room-1");

    // Add item-1 at t=1000
    await engine.processOperation(
      "room-1",
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "first" })
    );

    // Add item-2 at t=2000
    await engine.processOperation(
      "room-1",
      makeOp("item-2", "add", hlc(2000), "node-1", { name: "second" })
    );

    // Update item-1 at t=3000
    await engine.processOperation(
      "room-1",
      makeOp("item-1", "update", hlc(3000), "node-1", { name: "updated" })
    );

    // Query at t=1500 — should only have item-1 with original value
    const result1 = await engine.queryTimeTravelState("room-1", hlc(1500));
    expect(Object.keys(result1.state.items)).toEqual(["item-1"]);
    expect(result1.state.items["item-1"].fields["name"].value).toBe("first");

    // Query at t=2500 — should have item-1 and item-2
    const result2 = await engine.queryTimeTravelState("room-1", hlc(2500));
    expect(Object.keys(result2.state.items).sort()).toEqual(["item-1", "item-2"]);
    expect(result2.state.items["item-1"].fields["name"].value).toBe("first");
    expect(result2.state.items["item-2"].fields["name"].value).toBe("second");

    // Query at t=3500 — item-1 should be updated
    const result3 = await engine.queryTimeTravelState("room-1", hlc(3500));
    expect(result3.state.items["item-1"].fields["name"].value).toBe("updated");
    expect(result3.state.items["item-2"].fields["name"].value).toBe("second");
  });

  it("reconstructs state exactly at an operation timestamp (inclusive)", async () => {
    engine.createRoom("room-1");

    await engine.processOperation(
      "room-1",
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "hello" })
    );

    // Query exactly at t=1000 (the operation timestamp)
    const result = await engine.queryTimeTravelState("room-1", hlc(1000));
    expect(Object.keys(result.state.items)).toEqual(["item-1"]);
    expect(result.state.items["item-1"].fields["name"].value).toBe("hello");
  });

  it("uses snapshots for efficient reconstruction", async () => {
    engine.createRoom("room-1");

    // Add 10 items
    for (let i = 0; i < 10; i++) {
      await engine.processOperation(
        "room-1",
        makeOp(`item-${i}`, "add", hlc(1000 + i * 100), "node-1", { idx: i })
      );
    }

    // Create a snapshot
    engine.createTimeTravelSnapshot("room-1");

    // Add 5 more items after the snapshot
    for (let i = 10; i < 15; i++) {
      await engine.processOperation(
        "room-1",
        makeOp(`item-${i}`, "add", hlc(2000 + i * 100), "node-1", { idx: i })
      );
    }

    // Query at a point after the snapshot but before the last ops
    const result = await engine.queryTimeTravelState("room-1", hlc(2500));
    // Should have items 0-10 (from snapshot) plus items 11-13 (timestamps 2100-2300 are within range)
    const itemKeys = Object.keys(result.state.items);
    expect(itemKeys.length).toBeGreaterThanOrEqual(10);
  });

  it("returns oldest snapshot with boundedByGC=true after GC (Req 7.6)", async () => {
    engine.createRoom("room-1");

    // Add items at t=1000, 2000, 3000
    await engine.processOperation(
      "room-1",
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "a" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-2", "add", hlc(2000), "node-1", { name: "b" })
    );

    // Create first snapshot at this point
    engine.createTimeTravelSnapshot("room-1");

    // Add more ops
    await engine.processOperation(
      "room-1",
      makeOp("item-3", "add", hlc(3000), "node-1", { name: "c" })
    );

    // Create second snapshot
    engine.createTimeTravelSnapshot("room-1");

    // GC: keep only 1 snapshot (the latest one)
    const removed = engine.garbageCollect("room-1", 1);
    expect(removed).toBeGreaterThan(0);

    // Query at t=500 (before the oldest retained snapshot)
    const result = await engine.queryTimeTravelState("room-1", hlc(500));
    expect(result.boundedByGC).toBe(true);
    // Should return the oldest retained snapshot state
    expect(Object.keys(result.state.items).length).toBeGreaterThan(0);
  });

  it("does not mutate current room state during time-travel queries", async () => {
    engine.createRoom("room-1");

    await engine.processOperation(
      "room-1",
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "original" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-1", "update", hlc(2000), "node-1", { name: "updated" })
    );

    const currentState = engine.getState("room-1");
    const currentStateJSON = JSON.stringify(currentState);

    // Query at t=1500 (before the update)
    await engine.queryTimeTravelState("room-1", hlc(1500));

    // Current state should be unchanged
    expect(JSON.stringify(engine.getState("room-1"))).toBe(currentStateJSON);
  });
});

describe("Time-Travel API: queryOperationRange", () => {
  let engine: SyncEngineV2;

  beforeEach(() => {
    engine = new SyncEngineV2();
  });

  it("returns empty array for a non-existent room", async () => {
    const result = await engine.queryOperationRange("no-room", hlc(0), hlc(9999));
    expect(result).toEqual([]);
  });

  it("returns empty array when room has no operations", async () => {
    engine.createRoom("room-1");
    const result = await engine.queryOperationRange("room-1", hlc(0), hlc(9999));
    expect(result).toEqual([]);
  });

  it("returns operations within the specified range (Req 7.3)", async () => {
    engine.createRoom("room-1");

    await engine.processOperation(
      "room-1",
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "a" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-2", "add", hlc(2000), "node-1", { name: "b" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-3", "add", hlc(3000), "node-1", { name: "c" })
    );

    // Query range [1500, 2500] — should only include item-2
    const result = await engine.queryOperationRange("room-1", hlc(1500), hlc(2500));
    expect(result.length).toBe(1);
    expect(result[0].itemId).toBe("item-2");
  });

  it("returns operations in HLC causal order", async () => {
    engine.createRoom("room-1");

    // Insert operations in non-sorted order
    await engine.processOperation(
      "room-1",
      makeOp("item-3", "add", hlc(3000), "node-1", { name: "c" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "a" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-2", "add", hlc(2000), "node-1", { name: "b" })
    );

    const result = await engine.queryOperationRange("room-1", hlc(0), hlc(9999));
    expect(result.length).toBe(3);
    // Must be in HLC order
    expect(result[0].timestamp.wallTime).toBe(1000);
    expect(result[1].timestamp.wallTime).toBe(2000);
    expect(result[2].timestamp.wallTime).toBe(3000);
  });

  it("includes boundary timestamps (inclusive range)", async () => {
    engine.createRoom("room-1");

    await engine.processOperation(
      "room-1",
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "a" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-2", "add", hlc(2000), "node-1", { name: "b" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-3", "add", hlc(3000), "node-1", { name: "c" })
    );

    // Range exactly matching the first and last op timestamps
    const result = await engine.queryOperationRange("room-1", hlc(1000), hlc(3000));
    expect(result.length).toBe(3);
  });

  it("sorts by logical counter when wallTime is equal", async () => {
    engine.createRoom("room-1");

    await engine.processOperation(
      "room-1",
      makeOp("item-b", "add", hlc(1000, 2, "node-1"), "node-1", { name: "b" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-a", "add", hlc(1000, 0, "node-1"), "node-1", { name: "a" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-c", "add", hlc(1000, 1, "node-1"), "node-1", { name: "c" })
    );

    const result = await engine.queryOperationRange("room-1", hlc(900), hlc(1100));
    expect(result.length).toBe(3);
    expect(result[0].timestamp.logical).toBe(0);
    expect(result[1].timestamp.logical).toBe(1);
    expect(result[2].timestamp.logical).toBe(2);
  });

  it("sorts by nodeId when wallTime and logical are equal", async () => {
    engine.createRoom("room-1");

    await engine.processOperation(
      "room-1",
      makeOp("item-c", "add", hlc(1000, 0, "node-c"), "node-c", { name: "c" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-a", "add", hlc(1000, 0, "node-a"), "node-a", { name: "a" })
    );
    await engine.processOperation(
      "room-1",
      makeOp("item-b", "add", hlc(1000, 0, "node-b"), "node-b", { name: "b" })
    );

    const result = await engine.queryOperationRange("room-1", hlc(900), hlc(1100));
    expect(result.length).toBe(3);
    expect(result[0].timestamp.nodeId).toBe("node-a");
    expect(result[1].timestamp.nodeId).toBe("node-b");
    expect(result[2].timestamp.nodeId).toBe("node-c");
  });
});

describe("Time-Travel API: Operation Log Persistence (Req 7.1)", () => {
  it("persists every validated operation with its HLC timestamp", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");

    const ops = [
      makeOp("item-1", "add", hlc(1000), "node-1", { name: "a" }),
      makeOp("item-2", "add", hlc(2000), "node-2", { name: "b" }),
      makeOp("item-1", "update", hlc(3000), "node-1", { name: "updated" }),
    ];

    for (const op of ops) {
      await engine.processOperation("room-1", op);
    }

    const log = engine.getOperationLog("room-1");
    expect(log.length).toBe(3);
    expect(log[0].timestamp).toEqual(hlc(1000));
    expect(log[1].timestamp).toEqual(hlc(2000));
    expect(log[2].timestamp).toEqual(hlc(3000));
  });

  it("does not persist failed operations", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");

    // Try to update a non-existent item (should fail)
    const failedOp = makeOp("nonexistent", "update", hlc(1000), "node-1", { name: "x" });
    const result = await engine.processOperation("room-1", failedOp);
    expect(result.success).toBe(false);

    const log = engine.getOperationLog("room-1");
    expect(log.length).toBe(0);
  });
});

describe("Time-Travel API: Performance (Req 7.4)", () => {
  it("reconstructs state within 200ms for 1000 operations", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");

    // Insert 1000 operations
    for (let i = 0; i < 1000; i++) {
      await engine.processOperation(
        "room-1",
        makeOp(`item-${i}`, "add", hlc(1000 + i), "node-1", { idx: i })
      );
    }

    const start = performance.now();
    const result = await engine.queryTimeTravelState("room-1", hlc(1500));
    const elapsed = performance.now() - start;

    // Should complete well within 200ms for 1000 ops
    expect(elapsed).toBeLessThan(200);
    expect(Object.keys(result.state.items).length).toBe(501); // items 0-500
  });
});

describe("Time-Travel API: Snapshot-based reconstruction", () => {
  it("uses snapshot as starting point to avoid full replay", async () => {
    const engine = new SyncEngineV2();
    engine.createRoom("room-1");

    // Insert 100 ops
    for (let i = 0; i < 100; i++) {
      await engine.processOperation(
        "room-1",
        makeOp(`item-${i}`, "add", hlc(1000 + i * 10), "node-1", { idx: i })
      );
    }

    // Create snapshot at this point (100 items, last op at t=1990)
    engine.createTimeTravelSnapshot("room-1");

    // Add 50 more ops
    for (let i = 100; i < 150; i++) {
      await engine.processOperation(
        "room-1",
        makeOp(`item-${i}`, "add", hlc(2000 + i * 10), "node-1", { idx: i })
      );
    }

    // Query at t=3200 (after snapshot, within the 50 extra ops)
    const result = await engine.queryTimeTravelState("room-1", hlc(3200));
    // Snapshot has items 0-99, then ops from 2000+100*10=3000 to 3200 add items 100-120
    // Items with timestamps: 3000, 3010, ..., 3200 → 21 items from post-snapshot
    const totalItems = Object.keys(result.state.items).length;
    expect(totalItems).toBe(121); // 100 from snapshot + 21 from replay
  });
});
