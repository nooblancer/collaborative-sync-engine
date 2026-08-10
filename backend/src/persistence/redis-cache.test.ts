/**
 * Unit tests for RedisCache (InMemoryRedisCache implementation).
 * Tests state caching, presence storage, and connection counting.
 *
 * Requirements: 7.2
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRedisCache } from "./redis-cache.js";
import type { CRDTState } from "../types/index.js";

function makeCRDTState(sessionId: string, version = 1): CRDTState {
  return {
    sessionId,
    items: {},
    version,
    lastUpdated: { wallTime: Date.now(), logical: 0, nodeId: "node-1" },
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

      // Mutate original state
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
      // Should not throw
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

  describe("reset", () => {
    it("should clear all stored data", async () => {
      await cache.cacheState("s1", makeCRDTState("s1"));
      await cache.setPresence("s1", "u1", "data");
      await cache.incrementConnectionCount("s1");

      cache.reset();

      expect(await cache.getCachedState("s1")).toBeNull();
      expect(await cache.getPresence("s1")).toEqual({});
      expect(await cache.getConnectionCount("s1")).toBe(0);
    });
  });
});
