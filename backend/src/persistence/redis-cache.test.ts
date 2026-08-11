/**
 * Unit tests for RedisCache (InMemoryRedisCache implementation).
 * Tests state caching, presence storage, connection counting,
 * room-based caching, participant tracking, op count, and metrics.
 *
 * Requirements: 5.1-5.5, 1.2, 7.2
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRedisCache } from "./redis-cache.js";
import type { CRDTState } from "../types/index.js";
import type { RoomParticipant } from "../types/room.js";

function makeCRDTState(sessionId: string, version = 1): CRDTState {
  return {
    sessionId,
    items: {},
    version,
    lastUpdated: { wallTime: Date.now(), logical: 0, nodeId: "node-1" },
  };
}

function makeParticipant(clientId: string): RoomParticipant {
  return {
    clientId,
    userId: `user-${clientId}`,
    displayName: `User ${clientId}`,
    joinedAt: Date.now(),
  };
}

describe("InMemoryRedisCache", () => {
  let cache: InMemoryRedisCache;

  beforeEach(() => {
    cache = new InMemoryRedisCache();
  });

  describe("cacheState / getCachedState", () => {
    it("should cache and retrieve state", async () => {
      const state = makeCRDTState("session-1", 5);
      state.items["item-1"] = {
        itemId: "item-1",
        fields: {
          name: {
            value: "Widget",
            timestamp: { wallTime: 1000, logical: 0, nodeId: "n1" },
            replicaId: "r1",
          },
        },
        addedAt: { wallTime: 1000, logical: 0, nodeId: "n1" },
        removedAt: null,
      };

      await cache.cacheState("session-1", state);
      const retrieved = await cache.getCachedState("session-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe("session-1");
      expect(retrieved!.version).toBe(5);
      expect(retrieved!.items["item-1"].fields["name"].value).toBe("Widget");
    });

    it("should return null for non-existent session", async () => {
      const result = await cache.getCachedState("non-existent");
      expect(result).toBeNull();
    });

    it("should overwrite previous cached state", async () => {
      const state1 = makeCRDTState("session-1", 1);
      const state2 = makeCRDTState("session-1", 10);

      await cache.cacheState("session-1", state1);
      await cache.cacheState("session-1", state2);

      const retrieved = await cache.getCachedState("session-1");
      expect(retrieved!.version).toBe(10);
    });

    it("should store states independently per session", async () => {
      const state1 = makeCRDTState("session-a", 1);
      const state2 = makeCRDTState("session-b", 2);

      await cache.cacheState("session-a", state1);
      await cache.cacheState("session-b", state2);

      const a = await cache.getCachedState("session-a");
      const b = await cache.getCachedState("session-b");

      expect(a!.version).toBe(1);
      expect(b!.version).toBe(2);
    });

    it("should serialize/deserialize state via JSON (deep copy)", async () => {
      const state = makeCRDTState("session-1", 1);
      await cache.cacheState("session-1", state);
      state.version = 999;
      const retrieved = await cache.getCachedState("session-1");
      expect(retrieved!.version).toBe(1);
    });
  });

  describe("presence operations", () => {
    it("should set and get presence data", async () => {
      await cache.setPresence("session-1", "user-1", '{"status":"online"}');
      await cache.setPresence("session-1", "user-2", '{"status":"online"}');

      const presence = await cache.getPresence("session-1");
      expect(presence["user-1"]).toBe('{"status":"online"}');
      expect(presence["user-2"]).toBe('{"status":"online"}');
    });

    it("should return empty object for session with no presence", async () => {
      const presence = await cache.getPresence("empty-session");
      expect(presence).toEqual({});
    });

    it("should overwrite presence for same user", async () => {
      await cache.setPresence("session-1", "user-1", '{"status":"online"}');
      await cache.setPresence("session-1", "user-1", '{"status":"away"}');

      const presence = await cache.getPresence("session-1");
      expect(presence["user-1"]).toBe('{"status":"away"}');
    });

    it("should remove presence for a specific user", async () => {
      await cache.setPresence("session-1", "user-1", '{"status":"online"}');
      await cache.setPresence("session-1", "user-2", '{"status":"online"}');
      await cache.removePresence("session-1", "user-1");

      const presence = await cache.getPresence("session-1");
      expect(presence["user-1"]).toBeUndefined();
      expect(presence["user-2"]).toBe('{"status":"online"}');
    });

    it("should handle removing non-existent presence gracefully", async () => {
      await cache.removePresence("session-1", "ghost-user");
      const presence = await cache.getPresence("session-1");
      expect(presence).toEqual({});
    });
  });

  describe("connection count operations", () => {
    it("should increment connection count from 0", async () => {
      const count = await cache.incrementConnectionCount("session-1");
      expect(count).toBe(1);
    });

    it("should increment connection count multiple times", async () => {
      await cache.incrementConnectionCount("session-1");
      await cache.incrementConnectionCount("session-1");
      const count = await cache.incrementConnectionCount("session-1");
      expect(count).toBe(3);
    });

    it("should decrement connection count", async () => {
      await cache.incrementConnectionCount("session-1");
      await cache.incrementConnectionCount("session-1");
      const count = await cache.decrementConnectionCount("session-1");
      expect(count).toBe(1);
    });

    it("should not decrement below 0", async () => {
      const count = await cache.decrementConnectionCount("session-1");
      expect(count).toBe(0);
    });

    it("should get connection count", async () => {
      await cache.incrementConnectionCount("session-1");
      await cache.incrementConnectionCount("session-1");
      const count = await cache.getConnectionCount("session-1");
      expect(count).toBe(2);
    });

    it("should return 0 for session with no connections", async () => {
      const count = await cache.getConnectionCount("unknown-session");
      expect(count).toBe(0);
    });

    it("should track counts independently per session", async () => {
      await cache.incrementConnectionCount("session-a");
      await cache.incrementConnectionCount("session-a");
      await cache.incrementConnectionCount("session-b");

      expect(await cache.getConnectionCount("session-a")).toBe(2);
      expect(await cache.getConnectionCount("session-b")).toBe(1);
    });
  });

  describe("room state caching (room:{roomId}:state)", () => {
    it("should cache and retrieve room state", async () => {
      const state = makeCRDTState("room-1", 3);
      await cache.cacheRoomState("room-1", state);

      const retrieved = await cache.getRoomState("room-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe("room-1");
      expect(retrieved!.version).toBe(3);
    });

    it("should return null for non-existent room state", async () => {
      const result = await cache.getRoomState("no-such-room");
      expect(result).toBeNull();
    });

    it("should overwrite room state on subsequent caches", async () => {
      const state1 = makeCRDTState("room-1", 1);
      const state2 = makeCRDTState("room-1", 42);

      await cache.cacheRoomState("room-1", state1);
      await cache.cacheRoomState("room-1", state2);

      const retrieved = await cache.getRoomState("room-1");
      expect(retrieved!.version).toBe(42);
    });

    it("should isolate state between rooms", async () => {
      const stateA = makeCRDTState("room-a", 10);
      const stateB = makeCRDTState("room-b", 20);

      await cache.cacheRoomState("room-a", stateA);
      await cache.cacheRoomState("room-b", stateB);

      expect((await cache.getRoomState("room-a"))!.version).toBe(10);
      expect((await cache.getRoomState("room-b"))!.version).toBe(20);
    });

    it("should deep-copy state (no mutation leakage)", async () => {
      const state = makeCRDTState("room-1", 5);
      await cache.cacheRoomState("room-1", state);
      state.version = 999;
      const retrieved = await cache.getRoomState("room-1");
      expect(retrieved!.version).toBe(5);
    });

    it("should delete room state", async () => {
      const state = makeCRDTState("room-1", 1);
      await cache.cacheRoomState("room-1", state);
      await cache.deleteRoomState("room-1");
      const retrieved = await cache.getRoomState("room-1");
      expect(retrieved).toBeNull();
    });
  });

  describe("room participants (room:{roomId}:participants)", () => {
    it("should set and get a participant", async () => {
      const participant = makeParticipant("client-1");
      await cache.setRoomParticipant("room-1", "client-1", participant);

      const retrieved = await cache.getRoomParticipant("room-1", "client-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.clientId).toBe("client-1");
      expect(retrieved!.displayName).toBe("User client-1");
    });

    it("should return null for non-existent participant", async () => {
      const result = await cache.getRoomParticipant("room-1", "ghost");
      expect(result).toBeNull();
    });

    it("should get all participants in a room", async () => {
      const p1 = makeParticipant("client-1");
      const p2 = makeParticipant("client-2");

      await cache.setRoomParticipant("room-1", "client-1", p1);
      await cache.setRoomParticipant("room-1", "client-2", p2);

      const all = await cache.getAllRoomParticipants("room-1");
      expect(Object.keys(all)).toHaveLength(2);
      expect(all["client-1"].clientId).toBe("client-1");
      expect(all["client-2"].clientId).toBe("client-2");
    });

    it("should return empty object for room with no participants", async () => {
      const all = await cache.getAllRoomParticipants("empty-room");
      expect(all).toEqual({});
    });

    it("should overwrite participant data on re-set", async () => {
      const p1 = makeParticipant("client-1");
      await cache.setRoomParticipant("room-1", "client-1", p1);

      const p1Updated = { ...p1, displayName: "Updated Name" };
      await cache.setRoomParticipant("room-1", "client-1", p1Updated);

      const retrieved = await cache.getRoomParticipant("room-1", "client-1");
      expect(retrieved!.displayName).toBe("Updated Name");
    });

    it("should remove a participant", async () => {
      const p1 = makeParticipant("client-1");
      const p2 = makeParticipant("client-2");

      await cache.setRoomParticipant("room-1", "client-1", p1);
      await cache.setRoomParticipant("room-1", "client-2", p2);
      await cache.removeRoomParticipant("room-1", "client-1");

      const retrieved = await cache.getRoomParticipant("room-1", "client-1");
      expect(retrieved).toBeNull();

      const remaining = await cache.getAllRoomParticipants("room-1");
      expect(Object.keys(remaining)).toHaveLength(1);
    });

    it("should handle removing non-existent participant gracefully", async () => {
      await cache.removeRoomParticipant("room-1", "ghost");
      const all = await cache.getAllRoomParticipants("room-1");
      expect(all).toEqual({});
    });

    it("should get participant count", async () => {
      await cache.setRoomParticipant("room-1", "c1", makeParticipant("c1"));
      await cache.setRoomParticipant("room-1", "c2", makeParticipant("c2"));
      await cache.setRoomParticipant("room-1", "c3", makeParticipant("c3"));

      expect(await cache.getRoomParticipantCount("room-1")).toBe(3);
    });

    it("should return 0 participant count for empty room", async () => {
      expect(await cache.getRoomParticipantCount("empty-room")).toBe(0);
    });

    it("should isolate participants between rooms", async () => {
      await cache.setRoomParticipant("room-a", "c1", makeParticipant("c1"));
      await cache.setRoomParticipant("room-b", "c2", makeParticipant("c2"));

      expect(await cache.getRoomParticipantCount("room-a")).toBe(1);
      expect(await cache.getRoomParticipantCount("room-b")).toBe(1);
      expect(await cache.getRoomParticipant("room-a", "c2")).toBeNull();
    });
  });

  describe("room op count (room:{roomId}:op_count)", () => {
    it("should increment op count from 0", async () => {
      const count = await cache.incrementRoomOpCount("room-1");
      expect(count).toBe(1);
    });

    it("should increment op count with custom amount", async () => {
      const count = await cache.incrementRoomOpCount("room-1", 50);
      expect(count).toBe(50);
    });

    it("should accumulate increments", async () => {
      await cache.incrementRoomOpCount("room-1", 10);
      await cache.incrementRoomOpCount("room-1", 20);
      const count = await cache.incrementRoomOpCount("room-1", 5);
      expect(count).toBe(35);
    });

    it("should get op count", async () => {
      await cache.incrementRoomOpCount("room-1", 100);
      expect(await cache.getRoomOpCount("room-1")).toBe(100);
    });

    it("should return 0 for room with no ops", async () => {
      expect(await cache.getRoomOpCount("empty-room")).toBe(0);
    });

    it("should reset op count to 0", async () => {
      await cache.incrementRoomOpCount("room-1", 500);
      await cache.resetRoomOpCount("room-1");
      expect(await cache.getRoomOpCount("room-1")).toBe(0);
    });

    it("should isolate op counts between rooms", async () => {
      await cache.incrementRoomOpCount("room-a", 10);
      await cache.incrementRoomOpCount("room-b", 20);

      expect(await cache.getRoomOpCount("room-a")).toBe(10);
      expect(await cache.getRoomOpCount("room-b")).toBe(20);
    });
  });

  describe("metrics: throughput (metrics:throughput)", () => {
    it("should push and retrieve throughput entries", async () => {
      await cache.pushThroughputEntry(100);
      await cache.pushThroughputEntry(200);
      await cache.pushThroughputEntry(150);

      const history = await cache.getThroughputHistory();
      expect(history).toEqual([100, 200, 150]);
    });

    it("should return empty array when no entries", async () => {
      const history = await cache.getThroughputHistory();
      expect(history).toEqual([]);
    });

    it("should trim to 60 entries (rolling window)", async () => {
      for (let i = 0; i < 70; i++) {
        await cache.pushThroughputEntry(i);
      }

      const history = await cache.getThroughputHistory();
      expect(history).toHaveLength(60);
      expect(history[0]).toBe(10);
      expect(history[59]).toBe(69);
    });
  });

  describe("metrics: latency histogram (metrics:latency:histogram)", () => {
    it("should record latencies into correct buckets", async () => {
      await cache.recordLatency(0.5);  // bucket 1
      await cache.recordLatency(3);    // bucket 5
      await cache.recordLatency(7);    // bucket 10
      await cache.recordLatency(45);   // bucket 50

      const histogram = await cache.getLatencyHistogram();
      expect(histogram.get(1)).toBe(1);
      expect(histogram.get(5)).toBe(1);
      expect(histogram.get(10)).toBe(1);
      expect(histogram.get(50)).toBe(1);
    });

    it("should accumulate counts in same bucket", async () => {
      await cache.recordLatency(1);
      await cache.recordLatency(0.5);
      await cache.recordLatency(0.8);

      const histogram = await cache.getLatencyHistogram();
      expect(histogram.get(1)).toBe(3);
    });

    it("should place very high latency in last bucket", async () => {
      await cache.recordLatency(99999);

      const histogram = await cache.getLatencyHistogram();
      expect(histogram.get(5000)).toBe(1);
    });

    it("should return empty histogram when no latencies recorded", async () => {
      const histogram = await cache.getLatencyHistogram();
      expect(histogram.size).toBe(0);
    });

    it("should reset histogram", async () => {
      await cache.recordLatency(5);
      await cache.recordLatency(10);
      await cache.resetLatencyHistogram();

      const histogram = await cache.getLatencyHistogram();
      expect(histogram.size).toBe(0);
    });
  });

  describe("metrics: connections (metrics:connections)", () => {
    it("should increment from 0", async () => {
      const count = await cache.incrementMetricsConnections();
      expect(count).toBe(1);
    });

    it("should track multiple increments", async () => {
      await cache.incrementMetricsConnections();
      await cache.incrementMetricsConnections();
      const count = await cache.incrementMetricsConnections();
      expect(count).toBe(3);
    });

    it("should decrement", async () => {
      await cache.incrementMetricsConnections();
      await cache.incrementMetricsConnections();
      const count = await cache.decrementMetricsConnections();
      expect(count).toBe(1);
    });

    it("should not decrement below 0", async () => {
      const count = await cache.decrementMetricsConnections();
      expect(count).toBe(0);
    });

    it("should get current connections", async () => {
      await cache.incrementMetricsConnections();
      await cache.incrementMetricsConnections();
      expect(await cache.getMetricsConnections()).toBe(2);
    });
  });

  describe("metrics: total_ops (metrics:total_ops)", () => {
    it("should increment from 0", async () => {
      const count = await cache.incrementMetricsTotalOps();
      expect(count).toBe(1);
    });

    it("should increment by custom amount", async () => {
      const count = await cache.incrementMetricsTotalOps(50);
      expect(count).toBe(50);
    });

    it("should accumulate total ops", async () => {
      await cache.incrementMetricsTotalOps(100);
      await cache.incrementMetricsTotalOps(200);
      expect(await cache.getMetricsTotalOps()).toBe(300);
    });

    it("should return 0 when no ops recorded", async () => {
      expect(await cache.getMetricsTotalOps()).toBe(0);
    });
  });

  describe("reset", () => {
    it("should clear all stored data including V2 keys", async () => {
      // V1 data
      await cache.cacheState("s1", makeCRDTState("s1"));
      await cache.setPresence("s1", "u1", "data");
      await cache.incrementConnectionCount("s1");

      // V2 room data
      await cache.cacheRoomState("room-1", makeCRDTState("room-1"));
      await cache.setRoomParticipant("room-1", "c1", makeParticipant("c1"));
      await cache.incrementRoomOpCount("room-1", 100);

      // V2 metrics data
      await cache.pushThroughputEntry(500);
      await cache.recordLatency(10);
      await cache.incrementMetricsConnections();
      await cache.incrementMetricsTotalOps(1000);

      cache.reset();

      // V1 cleared
      expect(await cache.getCachedState("s1")).toBeNull();
      expect(await cache.getPresence("s1")).toEqual({});
      expect(await cache.getConnectionCount("s1")).toBe(0);

      // V2 room cleared
      expect(await cache.getRoomState("room-1")).toBeNull();
      expect(await cache.getAllRoomParticipants("room-1")).toEqual({});
      expect(await cache.getRoomOpCount("room-1")).toBe(0);

      // V2 metrics cleared
      expect(await cache.getThroughputHistory()).toEqual([]);
      expect((await cache.getLatencyHistogram()).size).toBe(0);
      expect(await cache.getMetricsConnections()).toBe(0);
      expect(await cache.getMetricsTotalOps()).toBe(0);
    });
  });
});
