/**
 * Persistence Layer implementation for the Collaborative Sync Engine.
 * Provides both a PostgreSQL-backed implementation and an in-memory
 * implementation for testing.
 *
 * Requirements: 7.1, 7.3, 7.7
 */

import { Pool, type PoolConfig } from "pg";
import { v4 as uuidv4 } from "uuid";
import type {
  CRDTOperation,
  CRDTState,
  PersistResult,
  Snapshot,
} from "../types/index.js";

/**
 * PersistenceLayer interface — durable storage for operation logs,
 * snapshots, and fast state caching.
 */
export interface PersistenceLayer {
  appendOperation(operation: CRDTOperation): Promise<PersistResult>;
  getOperationsSince(snapshotId: string): Promise<CRDTOperation[]>;
  getFullOperationLog(sessionId: string): Promise<CRDTOperation[]>;
  saveSnapshot(sessionId: string, state: CRDTState): Promise<string>;
  getLatestSnapshot(sessionId: string): Promise<Snapshot | null>;
  cacheState(sessionId: string, state: CRDTState): Promise<void>;
  getCachedState(sessionId: string): Promise<CRDTState | null>;
}

/**
 * PostgresPersistenceLayer — production implementation using pg.Pool
 * for connection pooling against a PostgreSQL database.
 */
export class PostgresPersistenceLayer implements PersistenceLayer {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  /**
   * Appends an operation to the durable operation log.
   * Returns { success: true } on success, or { success: false, error } on failure.
   * The Sync Engine must NOT ACK to the client if this fails.
   */
  async appendOperation(operation: CRDTOperation): Promise<PersistResult> {
    try {
      await this.pool.query(
        `INSERT INTO operations (id, session_id, replica_id, type, item_id, payload, wall_time, logical_counter, node_id, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          operation.id,
          operation.sessionId,
          operation.replicaId,
          operation.type,
          operation.itemId,
          JSON.stringify(operation.payload),
          operation.timestamp.wallTime,
          operation.timestamp.logical,
          operation.timestamp.nodeId,
          operation.version,
        ]
      );
      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown persistence error";
      return { success: false, error: message };
    }
  }

  /**
   * Returns all operations that occurred after the given snapshot.
   * Finds the snapshot's creation time, then returns operations created after it.
   */
  async getOperationsSince(snapshotId: string): Promise<CRDTOperation[]> {
    const snapshotResult = await this.pool.query(
      `SELECT session_id, created_at FROM snapshots WHERE id = $1`,
      [snapshotId]
    );

    if (snapshotResult.rows.length === 0) {
      return [];
    }

    const { session_id, created_at } = snapshotResult.rows[0];

    const result = await this.pool.query(
      `SELECT id, session_id, replica_id, type, item_id, payload, wall_time, logical_counter, node_id, version
       FROM operations
       WHERE session_id = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [session_id, created_at]
    );

    return result.rows.map(rowToOperation);
  }

  /**
   * Returns the full operation log for a session, ordered chronologically.
   */
  async getFullOperationLog(sessionId: string): Promise<CRDTOperation[]> {
    const result = await this.pool.query(
      `SELECT id, session_id, replica_id, type, item_id, payload, wall_time, logical_counter, node_id, version
       FROM operations
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );

    return result.rows.map(rowToOperation);
  }

  /**
   * Saves a state snapshot and returns its generated ID.
   */
  async saveSnapshot(sessionId: string, state: CRDTState): Promise<string> {
    const id = uuidv4();
    const operationCount = Object.keys(state.items).length;

    await this.pool.query(
      `INSERT INTO snapshots (id, session_id, state, operation_count)
       VALUES ($1, $2, $3, $4)`,
      [id, sessionId, JSON.stringify(state), operationCount]
    );

    return id;
  }

  /**
   * Returns the latest snapshot for a session, or null if none exists.
   */
  async getLatestSnapshot(sessionId: string): Promise<Snapshot | null> {
    const result = await this.pool.query(
      `SELECT id, session_id, state, operation_count, created_at
       FROM snapshots
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      sessionId: row.session_id,
      state: typeof row.state === "string" ? JSON.parse(row.state) : row.state,
      createdAt: new Date(row.created_at).getTime(),
      operationCount: row.operation_count,
    };
  }

  /**
   * Caches the current state for fast access.
   * In this PostgreSQL-only implementation, state is stored in a
   * dedicated query pattern. For Redis caching, see the Redis layer.
   */
  async cacheState(_sessionId: string, _state: CRDTState): Promise<void> {
    // Redis caching will be implemented in a separate task.
    // This is a no-op placeholder for the PostgreSQL layer.
  }

  /**
   * Retrieves cached state. Returns null since Redis caching is
   * handled separately.
   */
  async getCachedState(_sessionId: string): Promise<CRDTState | null> {
    // Redis caching will be implemented in a separate task.
    return null;
  }

  /**
   * Gracefully shuts down the connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * InMemoryPersistenceLayer — testing implementation that stores
 * all data in memory without requiring a real database.
 */
export class InMemoryPersistenceLayer implements PersistenceLayer {
  private operations: CRDTOperation[] = [];
  private snapshots: Map<string, Snapshot> = new Map();
  private stateCache: Map<string, CRDTState> = new Map();

  async appendOperation(operation: CRDTOperation): Promise<PersistResult> {
    try {
      this.operations.push({ ...operation });
      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown persistence error";
      return { success: false, error: message };
    }
  }

  async getOperationsSince(snapshotId: string): Promise<CRDTOperation[]> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return [];
    }

    return this.operations.filter(
      (op) =>
        op.sessionId === snapshot.sessionId &&
        op.timestamp.wallTime > snapshot.createdAt
    );
  }

  async getFullOperationLog(sessionId: string): Promise<CRDTOperation[]> {
    return this.operations.filter((op) => op.sessionId === sessionId);
  }

  async saveSnapshot(sessionId: string, state: CRDTState): Promise<string> {
    const id = uuidv4();
    const snapshot: Snapshot = {
      id,
      sessionId,
      state: JSON.parse(JSON.stringify(state)),
      createdAt: Date.now(),
      operationCount: Object.keys(state.items).length,
    };
    this.snapshots.set(id, snapshot);
    return id;
  }

  async getLatestSnapshot(sessionId: string): Promise<Snapshot | null> {
    let latest: Snapshot | null = null;
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.sessionId === sessionId) {
        if (!latest || snapshot.createdAt > latest.createdAt) {
          latest = snapshot;
        }
      }
    }
    return latest;
  }

  async cacheState(sessionId: string, state: CRDTState): Promise<void> {
    this.stateCache.set(sessionId, JSON.parse(JSON.stringify(state)));
  }

  async getCachedState(sessionId: string): Promise<CRDTState | null> {
    return this.stateCache.get(sessionId) ?? null;
  }

  /**
   * Resets all in-memory state. Useful between test runs.
   */
  reset(): void {
    this.operations = [];
    this.snapshots.clear();
    this.stateCache.clear();
  }
}

/**
 * Maps a database row to a CRDTOperation.
 */
function rowToOperation(row: Record<string, unknown>): CRDTOperation {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    replicaId: row.replica_id as string,
    type: row.type as CRDTOperation["type"],
    itemId: row.item_id as string,
    payload:
      typeof row.payload === "string"
        ? JSON.parse(row.payload)
        : (row.payload as Record<string, unknown>),
    timestamp: {
      wallTime: Number(row.wall_time),
      logical: Number(row.logical_counter),
      nodeId: row.node_id as string,
    },
    version: Number(row.version),
  };
}
