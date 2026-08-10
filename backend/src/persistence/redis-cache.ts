/**
 * Redis-backed state caching for the Collaborative Sync Engine.
 * Provides fast state reads (< 50ms), presence hash storage,
 * and atomic connection counting.
 *
 * Requirements: 7.2
 */

import Redis from "ioredis";
import type { CRDTState } from "../types/index.js";

/** TTL for cached state keys: 1 hour in seconds. */
const STATE_TTL_SECONDS = 3600;

/**
 * RedisCacheInterface defines the caching contract for the persistence layer.
 */
export interface RedisCacheInterface {
  cacheState(sessionId: string, state: CRDTState): Promise<void>;
  getCachedState(sessionId: string): Promise<CRDTState | null>;
  setPresence(sessionId: string, userId: string, data: string): Promise<void>;
  getPresence(sessionId: string): Promise<Record<string, string>>;
  removePresence(sessionId: string, userId: string): Promise<void>;
  incrementConnectionCount(sessionId: string): Promise<number>;
  decrementConnectionCount(sessionId: string): Promise<number>;
  getConnectionCount(sessionId: string): Promise<number>;
}

/**
 * RedisCache — production implementation using ioredis for state caching,
 * presence tracking, and connection counting.
 */
export class RedisCache implements RedisCacheInterface {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  /**
   * Caches the current CRDT state for a session.
   * Sets a TTL of 1 hour, refreshed on every write.
   */
  async cacheState(sessionId: string, state: CRDTState): Promise<void> {
    const key = `crdt:state:${sessionId}`;
    const serialized = JSON.stringify(state);
    await this.client.set(key, serialized, "EX", STATE_TTL_SECONDS);
  }

  /**
   * Retrieves the cached CRDT state for a session.
   * Returns null if no cached state exists or the key has expired.
   */
  async getCachedState(sessionId: string): Promise<CRDTState | null> {
    const key = `crdt:state:${sessionId}`;
    const data = await this.client.get(key);
    if (data === null) {
      return null;
    }
    return JSON.parse(data) as CRDTState;
  }

  /**
   * Sets presence data for a user in a session using a Redis hash.
   */
  async setPresence(
    sessionId: string,
    userId: string,
    data: string
  ): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    await this.client.hset(key, userId, data);
  }

  /**
   * Retrieves all presence data for a session as a record of userId → data.
   */
  async getPresence(sessionId: string): Promise<Record<string, string>> {
    const key = `crdt:presence:${sessionId}`;
    return await this.client.hgetall(key);
  }

  /**
   * Removes a user's presence entry from the session hash.
   */
  async removePresence(sessionId: string, userId: string): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    await this.client.hdel(key, userId);
  }

  /**
   * Atomically increments the connection count for a session.
   * Returns the new count.
   */
  async incrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    return await this.client.incr(key);
  }

  /**
   * Atomically decrements the connection count for a session.
   * Ensures the count does not go below 0.
   * Returns the new count.
   */
  async decrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const result = await this.client.decr(key);
    if (result < 0) {
      await this.client.set(key, "0");
      return 0;
    }
    return result;
  }

  /**
   * Returns the current connection count for a session.
   */
  async getConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const value = await this.client.get(key);
    return value === null ? 0 : parseInt(value, 10);
  }

  /**
   * Disconnects the Redis client.
   */
  async close(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * InMemoryRedisCache — testing implementation that stores all data
 * in memory without requiring a real Redis instance.
 */
export class InMemoryRedisCache implements RedisCacheInterface {
  private stateCache: Map<string, { data: string; expiresAt: number }> =
    new Map();
  private presenceHashes: Map<string, Map<string, string>> = new Map();
  private connectionCounts: Map<string, number> = new Map();

  /**
   * Caches the current CRDT state for a session with a simulated TTL.
   */
  async cacheState(sessionId: string, state: CRDTState): Promise<void> {
    const key = `crdt:state:${sessionId}`;
    const serialized = JSON.stringify(state);
    const expiresAt = Date.now() + STATE_TTL_SECONDS * 1000;
    this.stateCache.set(key, { data: serialized, expiresAt });
  }

  /**
   * Retrieves the cached CRDT state for a session.
   * Returns null if no cached state exists or the simulated TTL has expired.
   */
  async getCachedState(sessionId: string): Promise<CRDTState | null> {
    const key = `crdt:state:${sessionId}`;
    const entry = this.stateCache.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.stateCache.delete(key);
      return null;
    }
    return JSON.parse(entry.data) as CRDTState;
  }

  /**
   * Sets presence data for a user in a session.
   */
  async setPresence(
    sessionId: string,
    userId: string,
    data: string
  ): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    if (!this.presenceHashes.has(key)) {
      this.presenceHashes.set(key, new Map());
    }
    this.presenceHashes.get(key)!.set(userId, data);
  }

  /**
   * Retrieves all presence data for a session.
   */
  async getPresence(sessionId: string): Promise<Record<string, string>> {
    const key = `crdt:presence:${sessionId}`;
    const hash = this.presenceHashes.get(key);
    if (!hash) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [userId, data] of hash.entries()) {
      result[userId] = data;
    }
    return result;
  }

  /**
   * Removes a user's presence entry from the session.
   */
  async removePresence(sessionId: string, userId: string): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    const hash = this.presenceHashes.get(key);
    if (hash) {
      hash.delete(userId);
    }
  }

  /**
   * Atomically increments the connection count for a session.
   */
  async incrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const current = this.connectionCounts.get(key) ?? 0;
    const next = current + 1;
    this.connectionCounts.set(key, next);
    return next;
  }

  /**
   * Atomically decrements the connection count for a session.
   * Ensures the count does not go below 0.
   */
  async decrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const current = this.connectionCounts.get(key) ?? 0;
    const next = Math.max(0, current - 1);
    this.connectionCounts.set(key, next);
    return next;
  }

  /**
   * Returns the current connection count for a session.
   */
  async getConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    return this.connectionCounts.get(key) ?? 0;
  }

  /**
   * Resets all in-memory state. Useful between test runs.
   */
  reset(): void {
    this.stateCache.clear();
    this.presenceHashes.clear();
    this.connectionCounts.clear();
  }
}
