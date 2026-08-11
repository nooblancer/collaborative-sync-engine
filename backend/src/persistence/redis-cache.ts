/**
 * Redis-backed state caching for the Collaborative Sync Engine.
 * Provides fast state reads (< 50ms), presence hash storage,
 * and atomic connection counting.
 *
 * V2 adds room-based caching (room:{roomId}:state, room:{roomId}:participants,
 * room:{roomId}:op_count) and metrics keys (metrics:throughput,
 * metrics:latency:histogram, metrics:connections, metrics:total_ops).
 *
 * Requirements: 5.1-5.5, 1.2, 7.2
 */

import Redis from "ioredis";
import type { CRDTState } from "../types/index.js";
import type { RoomParticipant } from "../types/room.js";

/** TTL for cached state keys: 1 hour in seconds. */
const STATE_TTL_SECONDS = 3600;

/** Maximum entries in the throughput history list. */
const THROUGHPUT_HISTORY_MAX = 60;

/** Default latency histogram bucket boundaries (ms). */
const DEFAULT_HISTOGRAM_BUCKETS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];

/**
 * RedisCacheInterface defines the caching contract for the persistence layer (V1).
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
 * RedisCacheV2Interface extends the V1 interface with room-based caching
 * and metrics key management.
 *
 * Key schema:
 *   room:{roomId}:state          → JSON (current CRDTState)
 *   room:{roomId}:participants   → Hash (clientId → participant JSON)
 *   room:{roomId}:op_count       → Integer (ops since last snapshot)
 *   metrics:throughput           → List (60 entries, 1 per second)
 *   metrics:latency:histogram    → Sorted set (bucket boundaries → counts)
 *   metrics:connections          → Integer
 *   metrics:total_ops            → Integer
 */
export interface RedisCacheV2Interface extends RedisCacheInterface {
  // Room state caching
  cacheRoomState(roomId: string, state: CRDTState): Promise<void>;
  getRoomState(roomId: string): Promise<CRDTState | null>;
  deleteRoomState(roomId: string): Promise<void>;

  // Room participants (hash)
  setRoomParticipant(roomId: string, clientId: string, participant: RoomParticipant): Promise<void>;
  getRoomParticipant(roomId: string, clientId: string): Promise<RoomParticipant | null>;
  getAllRoomParticipants(roomId: string): Promise<Record<string, RoomParticipant>>;
  removeRoomParticipant(roomId: string, clientId: string): Promise<void>;
  getRoomParticipantCount(roomId: string): Promise<number>;

  // Room operation count (snapshot threshold tracking)
  incrementRoomOpCount(roomId: string, amount?: number): Promise<number>;
  getRoomOpCount(roomId: string): Promise<number>;
  resetRoomOpCount(roomId: string): Promise<void>;

  // Metrics: throughput (rolling 60-second list)
  pushThroughputEntry(opsPerSecond: number): Promise<void>;
  getThroughputHistory(): Promise<number[]>;

  // Metrics: latency histogram (sorted set of bucket boundaries → counts)
  recordLatency(latencyMs: number): Promise<void>;
  getLatencyHistogram(): Promise<Map<number, number>>;
  resetLatencyHistogram(): Promise<void>;

  // Metrics: connections (global counter)
  incrementMetricsConnections(): Promise<number>;
  decrementMetricsConnections(): Promise<number>;
  getMetricsConnections(): Promise<number>;

  // Metrics: total_ops (global counter)
  incrementMetricsTotalOps(count?: number): Promise<number>;
  getMetricsTotalOps(): Promise<number>;
}

/**
 * RedisCache — production implementation using ioredis for state caching,
 * presence tracking, connection counting, room-based caching, and metrics.
 */
export class RedisCache implements RedisCacheV2Interface {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  // ─── V1 Session-Based Methods ───────────────────────────────────────────

  async cacheState(sessionId: string, state: CRDTState): Promise<void> {
    const key = `crdt:state:${sessionId}`;
    const serialized = JSON.stringify(state);
    await this.client.set(key, serialized, "EX", STATE_TTL_SECONDS);
  }

  async getCachedState(sessionId: string): Promise<CRDTState | null> {
    const key = `crdt:state:${sessionId}`;
    const data = await this.client.get(key);
    if (data === null) return null;
    return JSON.parse(data) as CRDTState;
  }

  async setPresence(sessionId: string, userId: string, data: string): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    await this.client.hset(key, userId, data);
  }

  async getPresence(sessionId: string): Promise<Record<string, string>> {
    const key = `crdt:presence:${sessionId}`;
    return await this.client.hgetall(key);
  }

  async removePresence(sessionId: string, userId: string): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    await this.client.hdel(key, userId);
  }

  async incrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    return await this.client.incr(key);
  }

  async decrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const result = await this.client.decr(key);
    if (result < 0) {
      await this.client.set(key, "0");
      return 0;
    }
    return result;
  }

  async getConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const value = await this.client.get(key);
    return value === null ? 0 : parseInt(value, 10);
  }

  // ─── V2 Room State Methods ──────────────────────────────────────────────

  async cacheRoomState(roomId: string, state: CRDTState): Promise<void> {
    const key = `room:${roomId}:state`;
    const serialized = JSON.stringify(state);
    await this.client.set(key, serialized, "EX", STATE_TTL_SECONDS);
  }

  async getRoomState(roomId: string): Promise<CRDTState | null> {
    const key = `room:${roomId}:state`;
    const data = await this.client.get(key);
    if (data === null) return null;
    return JSON.parse(data) as CRDTState;
  }

  async deleteRoomState(roomId: string): Promise<void> {
    const key = `room:${roomId}:state`;
    await this.client.del(key);
  }

  // ─── V2 Room Participants Methods ───────────────────────────────────────

  async setRoomParticipant(roomId: string, clientId: string, participant: RoomParticipant): Promise<void> {
    const key = `room:${roomId}:participants`;
    await this.client.hset(key, clientId, JSON.stringify(participant));
  }

  async getRoomParticipant(roomId: string, clientId: string): Promise<RoomParticipant | null> {
    const key = `room:${roomId}:participants`;
    const data = await this.client.hget(key, clientId);
    if (data === null) return null;
    return JSON.parse(data) as RoomParticipant;
  }

  async getAllRoomParticipants(roomId: string): Promise<Record<string, RoomParticipant>> {
    const key = `room:${roomId}:participants`;
    const raw = await this.client.hgetall(key);
    const result: Record<string, RoomParticipant> = {};
    for (const [clientId, json] of Object.entries(raw)) {
      result[clientId] = JSON.parse(json) as RoomParticipant;
    }
    return result;
  }

  async removeRoomParticipant(roomId: string, clientId: string): Promise<void> {
    const key = `room:${roomId}:participants`;
    await this.client.hdel(key, clientId);
  }

  async getRoomParticipantCount(roomId: string): Promise<number> {
    const key = `room:${roomId}:participants`;
    return await this.client.hlen(key);
  }

  // ─── V2 Room Op Count Methods ──────────────────────────────────────────

  async incrementRoomOpCount(roomId: string, amount: number = 1): Promise<number> {
    const key = `room:${roomId}:op_count`;
    return await this.client.incrby(key, amount);
  }

  async getRoomOpCount(roomId: string): Promise<number> {
    const key = `room:${roomId}:op_count`;
    const value = await this.client.get(key);
    return value === null ? 0 : parseInt(value, 10);
  }

  async resetRoomOpCount(roomId: string): Promise<void> {
    const key = `room:${roomId}:op_count`;
    await this.client.set(key, "0");
  }

  // ─── V2 Metrics: Throughput ─────────────────────────────────────────────

  async pushThroughputEntry(opsPerSecond: number): Promise<void> {
    const key = "metrics:throughput";
    await this.client.rpush(key, String(opsPerSecond));
    await this.client.ltrim(key, -THROUGHPUT_HISTORY_MAX, -1);
  }

  async getThroughputHistory(): Promise<number[]> {
    const key = "metrics:throughput";
    const entries = await this.client.lrange(key, 0, -1);
    return entries.map((e) => parseFloat(e));
  }

  // ─── V2 Metrics: Latency Histogram ─────────────────────────────────────

  async recordLatency(latencyMs: number): Promise<void> {
    const key = "metrics:latency:histogram";
    const bucket = findBucket(latencyMs, DEFAULT_HISTOGRAM_BUCKETS);
    await this.client.zincrby(key, 1, String(bucket));
  }

  async getLatencyHistogram(): Promise<Map<number, number>> {
    const key = "metrics:latency:histogram";
    const entries = await this.client.zrangebyscore(key, "-inf", "+inf", "WITHSCORES");
    const result = new Map<number, number>();
    for (let i = 0; i < entries.length; i += 2) {
      result.set(parseFloat(entries[i]), parseFloat(entries[i + 1]));
    }
    return result;
  }

  async resetLatencyHistogram(): Promise<void> {
    const key = "metrics:latency:histogram";
    await this.client.del(key);
  }

  // ─── V2 Metrics: Connections ────────────────────────────────────────────

  async incrementMetricsConnections(): Promise<number> {
    return await this.client.incr("metrics:connections");
  }

  async decrementMetricsConnections(): Promise<number> {
    const result = await this.client.decr("metrics:connections");
    if (result < 0) {
      await this.client.set("metrics:connections", "0");
      return 0;
    }
    return result;
  }

  async getMetricsConnections(): Promise<number> {
    const value = await this.client.get("metrics:connections");
    return value === null ? 0 : parseInt(value, 10);
  }

  // ─── V2 Metrics: Total Ops ─────────────────────────────────────────────

  async incrementMetricsTotalOps(count: number = 1): Promise<number> {
    return await this.client.incrby("metrics:total_ops", count);
  }

  async getMetricsTotalOps(): Promise<number> {
    const value = await this.client.get("metrics:total_ops");
    return value === null ? 0 : parseInt(value, 10);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * InMemoryRedisCache — testing implementation that stores all data
 * in memory without requiring a real Redis instance.
 * Implements both V1 and V2 interfaces.
 */
export class InMemoryRedisCache implements RedisCacheV2Interface {
  // V1 storage
  private stateCache: Map<string, { data: string; expiresAt: number }> = new Map();
  private presenceHashes: Map<string, Map<string, string>> = new Map();
  private connectionCounts: Map<string, number> = new Map();

  // V2 room storage
  private roomStates: Map<string, { data: string; expiresAt: number }> = new Map();
  private roomParticipants: Map<string, Map<string, string>> = new Map();
  private roomOpCounts: Map<string, number> = new Map();

  // V2 metrics storage
  private throughputHistory: number[] = [];
  private latencyHistogram: Map<number, number> = new Map();
  private metricsConnections: number = 0;
  private metricsTotalOps: number = 0;

  // ─── V1 Session-Based Methods ───────────────────────────────────────────

  async cacheState(sessionId: string, state: CRDTState): Promise<void> {
    const key = `crdt:state:${sessionId}`;
    const serialized = JSON.stringify(state);
    const expiresAt = Date.now() + STATE_TTL_SECONDS * 1000;
    this.stateCache.set(key, { data: serialized, expiresAt });
  }

  async getCachedState(sessionId: string): Promise<CRDTState | null> {
    const key = `crdt:state:${sessionId}`;
    const entry = this.stateCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.stateCache.delete(key);
      return null;
    }
    return JSON.parse(entry.data) as CRDTState;
  }

  async setPresence(sessionId: string, userId: string, data: string): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    if (!this.presenceHashes.has(key)) {
      this.presenceHashes.set(key, new Map());
    }
    this.presenceHashes.get(key)!.set(userId, data);
  }

  async getPresence(sessionId: string): Promise<Record<string, string>> {
    const key = `crdt:presence:${sessionId}`;
    const hash = this.presenceHashes.get(key);
    if (!hash) return {};
    const result: Record<string, string> = {};
    for (const [userId, data] of hash.entries()) {
      result[userId] = data;
    }
    return result;
  }

  async removePresence(sessionId: string, userId: string): Promise<void> {
    const key = `crdt:presence:${sessionId}`;
    const hash = this.presenceHashes.get(key);
    if (hash) hash.delete(userId);
  }

  async incrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const current = this.connectionCounts.get(key) ?? 0;
    const next = current + 1;
    this.connectionCounts.set(key, next);
    return next;
  }

  async decrementConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    const current = this.connectionCounts.get(key) ?? 0;
    const next = Math.max(0, current - 1);
    this.connectionCounts.set(key, next);
    return next;
  }

  async getConnectionCount(sessionId: string): Promise<number> {
    const key = `crdt:connections:${sessionId}`;
    return this.connectionCounts.get(key) ?? 0;
  }

  // ─── V2 Room State Methods ──────────────────────────────────────────────

  async cacheRoomState(roomId: string, state: CRDTState): Promise<void> {
    const key = `room:${roomId}:state`;
    const serialized = JSON.stringify(state);
    const expiresAt = Date.now() + STATE_TTL_SECONDS * 1000;
    this.roomStates.set(key, { data: serialized, expiresAt });
  }

  async getRoomState(roomId: string): Promise<CRDTState | null> {
    const key = `room:${roomId}:state`;
    const entry = this.roomStates.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.roomStates.delete(key);
      return null;
    }
    return JSON.parse(entry.data) as CRDTState;
  }

  async deleteRoomState(roomId: string): Promise<void> {
    const key = `room:${roomId}:state`;
    this.roomStates.delete(key);
  }

  // ─── V2 Room Participants Methods ───────────────────────────────────────

  async setRoomParticipant(roomId: string, clientId: string, participant: RoomParticipant): Promise<void> {
    const key = `room:${roomId}:participants`;
    if (!this.roomParticipants.has(key)) {
      this.roomParticipants.set(key, new Map());
    }
    this.roomParticipants.get(key)!.set(clientId, JSON.stringify(participant));
  }

  async getRoomParticipant(roomId: string, clientId: string): Promise<RoomParticipant | null> {
    const key = `room:${roomId}:participants`;
    const hash = this.roomParticipants.get(key);
    if (!hash) return null;
    const data = hash.get(clientId);
    if (!data) return null;
    return JSON.parse(data) as RoomParticipant;
  }

  async getAllRoomParticipants(roomId: string): Promise<Record<string, RoomParticipant>> {
    const key = `room:${roomId}:participants`;
    const hash = this.roomParticipants.get(key);
    if (!hash) return {};
    const result: Record<string, RoomParticipant> = {};
    for (const [clientId, json] of hash.entries()) {
      result[clientId] = JSON.parse(json) as RoomParticipant;
    }
    return result;
  }

  async removeRoomParticipant(roomId: string, clientId: string): Promise<void> {
    const key = `room:${roomId}:participants`;
    const hash = this.roomParticipants.get(key);
    if (hash) hash.delete(clientId);
  }

  async getRoomParticipantCount(roomId: string): Promise<number> {
    const key = `room:${roomId}:participants`;
    const hash = this.roomParticipants.get(key);
    return hash ? hash.size : 0;
  }

  // ─── V2 Room Op Count Methods ──────────────────────────────────────────

  async incrementRoomOpCount(roomId: string, amount: number = 1): Promise<number> {
    const key = `room:${roomId}:op_count`;
    const current = this.roomOpCounts.get(key) ?? 0;
    const next = current + amount;
    this.roomOpCounts.set(key, next);
    return next;
  }

  async getRoomOpCount(roomId: string): Promise<number> {
    const key = `room:${roomId}:op_count`;
    return this.roomOpCounts.get(key) ?? 0;
  }

  async resetRoomOpCount(roomId: string): Promise<void> {
    const key = `room:${roomId}:op_count`;
    this.roomOpCounts.set(key, 0);
  }

  // ─── V2 Metrics: Throughput ─────────────────────────────────────────────

  async pushThroughputEntry(opsPerSecond: number): Promise<void> {
    this.throughputHistory.push(opsPerSecond);
    if (this.throughputHistory.length > THROUGHPUT_HISTORY_MAX) {
      this.throughputHistory = this.throughputHistory.slice(-THROUGHPUT_HISTORY_MAX);
    }
  }

  async getThroughputHistory(): Promise<number[]> {
    return [...this.throughputHistory];
  }

  // ─── V2 Metrics: Latency Histogram ─────────────────────────────────────

  async recordLatency(latencyMs: number): Promise<void> {
    const bucket = findBucket(latencyMs, DEFAULT_HISTOGRAM_BUCKETS);
    const current = this.latencyHistogram.get(bucket) ?? 0;
    this.latencyHistogram.set(bucket, current + 1);
  }

  async getLatencyHistogram(): Promise<Map<number, number>> {
    return new Map(this.latencyHistogram);
  }

  async resetLatencyHistogram(): Promise<void> {
    this.latencyHistogram.clear();
  }

  // ─── V2 Metrics: Connections ────────────────────────────────────────────

  async incrementMetricsConnections(): Promise<number> {
    this.metricsConnections += 1;
    return this.metricsConnections;
  }

  async decrementMetricsConnections(): Promise<number> {
    this.metricsConnections = Math.max(0, this.metricsConnections - 1);
    return this.metricsConnections;
  }

  async getMetricsConnections(): Promise<number> {
    return this.metricsConnections;
  }

  // ─── V2 Metrics: Total Ops ─────────────────────────────────────────────

  async incrementMetricsTotalOps(count: number = 1): Promise<number> {
    this.metricsTotalOps += count;
    return this.metricsTotalOps;
  }

  async getMetricsTotalOps(): Promise<number> {
    return this.metricsTotalOps;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Resets all in-memory state. Useful between test runs.
   */
  reset(): void {
    this.stateCache.clear();
    this.presenceHashes.clear();
    this.connectionCounts.clear();
    this.roomStates.clear();
    this.roomParticipants.clear();
    this.roomOpCounts.clear();
    this.throughputHistory = [];
    this.latencyHistogram.clear();
    this.metricsConnections = 0;
    this.metricsTotalOps = 0;
  }
}

/**
 * Finds the appropriate histogram bucket for a given latency value.
 * Returns the smallest bucket boundary >= latencyMs, or the largest bucket
 * boundary if latencyMs exceeds all defined boundaries.
 */
function findBucket(latencyMs: number, buckets: number[]): number {
  for (const boundary of buckets) {
    if (latencyMs <= boundary) {
      return boundary;
    }
  }
  return buckets[buckets.length - 1];
}
