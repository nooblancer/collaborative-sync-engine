/**
 * Persistence Layer V2 — durable storage for room operations,
 * room snapshots, and conflict events.
 *
 * Provides both a PostgreSQL-backed implementation and an in-memory
 * implementation for testing.
 *
 * Requirements: 7.1, 23.1-23.2
 */

import { Pool, type PoolConfig } from "pg";
import { v4 as uuidv4 } from "uuid";
import type { CRDTOperation, CRDTState, HLCTimestamp } from "../types/index.js";
import type { ConflictEvent } from "../types/conflict.js";

/**
 * RoomSnapshot represents a point-in-time capture of a room's CRDT state.
 */
export interface RoomSnapshot {
  id: string;
  roomId: string;
  snapshotData: CRDTState;
  operationCount: number;
  createdAt: Date;
}

/**
 * RoomOperation represents a persisted operation in the append-only log.
 */
export interface RoomOperation {
  id: string;
  roomId: string;
  replicaId: string;
  operationType: string;
  itemId: string;
  payload: Record<string, unknown>;
  hlcWallTime: number;
  hlcLogical: number;
  hlcNodeId: string;
  createdAt: Date;
}

/**
 * PersistedConflictEvent represents a conflict event stored in the database.
 */
export interface PersistedConflictEvent {
  id: string;
  roomId: string;
  fieldName: string;
  operationA: unknown;
  operationB: unknown;
  winner: "A" | "B";
  reason: string;
  createdAt: Date;
}

/**
 * PersistenceLayerV2 interface for room-scoped operations, snapshots,
 * and conflict events.
 */
export interface PersistenceLayerV2 {
  // Room Operations
  appendRoomOperation(roomId: string, operation: CRDTOperation): Promise<void>;
  getRoomOperations(roomId: string, options?: { afterTimestamp?: HLCTimestamp; limit?: number }): Promise<RoomOperation[]>;
  getRoomOperationsByRange(roomId: string, from: HLCTimestamp, to: HLCTimestamp): Promise<RoomOperation[]>;
  deleteRoomOperationsBefore(roomId: string, beforeTimestamp: HLCTimestamp): Promise<number>;

  // Room Snapshots
  saveRoomSnapshot(roomId: string, state: CRDTState, operationCount: number): Promise<string>;
  getLatestRoomSnapshot(roomId: string): Promise<RoomSnapshot | null>;

  // Conflict Events
  saveConflictEvent(event: ConflictEvent): Promise<string>;
  getConflictEvents(roomId: string, limit?: number): Promise<PersistedConflictEvent[]>;
}

/**
 * PostgresPersistenceLayerV2 — production implementation using pg.Pool.
 */
export class PostgresPersistenceLayerV2 implements PersistenceLayerV2 {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  async appendRoomOperation(roomId: string, operation: CRDTOperation): Promise<void> {
    await this.pool.query(
      `INSERT INTO room_operations (id, room_id, replica_id, operation_type, item_id, payload, hlc_wall_time, hlc_logical, hlc_node_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        operation.id,
        roomId,
        operation.replicaId,
        operation.type,
        operation.itemId,
        JSON.stringify(operation.payload),
        operation.timestamp.wallTime,
        operation.timestamp.logical,
        operation.timestamp.nodeId,
      ]
    );
  }

  async getRoomOperations(
    roomId: string,
    options?: { afterTimestamp?: HLCTimestamp; limit?: number }
  ): Promise<RoomOperation[]> {
    let query: string;
    let params: unknown[];

    if (options?.afterTimestamp) {
      query = `SELECT id, room_id, replica_id, operation_type, item_id, payload, hlc_wall_time, hlc_logical, hlc_node_id, created_at
               FROM room_operations
               WHERE room_id = $1 AND (hlc_wall_time > $2 OR (hlc_wall_time = $2 AND hlc_logical > $3))
               ORDER BY hlc_wall_time ASC, hlc_logical ASC
               ${options?.limit ? `LIMIT ${options.limit}` : ""}`;
      params = [roomId, options.afterTimestamp.wallTime, options.afterTimestamp.logical];
    } else {
      query = `SELECT id, room_id, replica_id, operation_type, item_id, payload, hlc_wall_time, hlc_logical, hlc_node_id, created_at
               FROM room_operations
               WHERE room_id = $1
               ORDER BY hlc_wall_time ASC, hlc_logical ASC
               ${options?.limit ? `LIMIT ${options.limit}` : ""}`;
      params = [roomId];
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(rowToRoomOperation);
  }

  async getRoomOperationsByRange(
    roomId: string,
    from: HLCTimestamp,
    to: HLCTimestamp
  ): Promise<RoomOperation[]> {
    const result = await this.pool.query(
      `SELECT id, room_id, replica_id, operation_type, item_id, payload, hlc_wall_time, hlc_logical, hlc_node_id, created_at
       FROM room_operations
       WHERE room_id = $1
         AND (hlc_wall_time > $2 OR (hlc_wall_time = $2 AND hlc_logical >= $3))
         AND (hlc_wall_time < $4 OR (hlc_wall_time = $4 AND hlc_logical <= $5))
       ORDER BY hlc_wall_time ASC, hlc_logical ASC`,
      [roomId, from.wallTime, from.logical, to.wallTime, to.logical]
    );

    return result.rows.map(rowToRoomOperation);
  }

  async deleteRoomOperationsBefore(roomId: string, beforeTimestamp: HLCTimestamp): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM room_operations
       WHERE room_id = $1
         AND (hlc_wall_time < $2 OR (hlc_wall_time = $2 AND hlc_logical < $3))`,
      [roomId, beforeTimestamp.wallTime, beforeTimestamp.logical]
    );
    return result.rowCount ?? 0;
  }

  async saveRoomSnapshot(roomId: string, state: CRDTState, operationCount: number): Promise<string> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO room_snapshots (id, room_id, snapshot_data, operation_count)
       VALUES ($1, $2, $3, $4)`,
      [id, roomId, JSON.stringify(state), operationCount]
    );
    return id;
  }

  async getLatestRoomSnapshot(roomId: string): Promise<RoomSnapshot | null> {
    const result = await this.pool.query(
      `SELECT id, room_id, snapshot_data, operation_count, created_at
       FROM room_snapshots
       WHERE room_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [roomId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      roomId: row.room_id,
      snapshotData: typeof row.snapshot_data === "string" ? JSON.parse(row.snapshot_data) : row.snapshot_data,
      operationCount: row.operation_count,
      createdAt: new Date(row.created_at),
    };
  }

  async saveConflictEvent(event: ConflictEvent): Promise<string> {
    const id = event.id || uuidv4();
    await this.pool.query(
      `INSERT INTO conflict_events (id, room_id, field_name, operation_a, operation_b, winner, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        event.roomId,
        event.field,
        JSON.stringify(event.operationA),
        JSON.stringify(event.operationB),
        event.winner,
        event.reason,
      ]
    );
    return id;
  }

  async getConflictEvents(roomId: string, limit: number = 100): Promise<PersistedConflictEvent[]> {
    const result = await this.pool.query(
      `SELECT id, room_id, field_name, operation_a, operation_b, winner, reason, created_at
       FROM conflict_events
       WHERE room_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [roomId, limit]
    );

    return result.rows.map(rowToConflictEvent);
  }

  /**
   * Gracefully shuts down the connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * InMemoryPersistenceLayerV2 — testing implementation that stores
 * all data in memory without requiring a real database.
 */
export class InMemoryPersistenceLayerV2 implements PersistenceLayerV2 {
  private operations: RoomOperation[] = [];
  private snapshots: (RoomSnapshot & { _insertOrder: number })[] = [];
  private conflicts: (PersistedConflictEvent & { _insertOrder: number })[] = [];
  private _insertCounter = 0;

  async appendRoomOperation(roomId: string, operation: CRDTOperation): Promise<void> {
    this.operations.push({
      id: operation.id,
      roomId,
      replicaId: operation.replicaId,
      operationType: operation.type,
      itemId: operation.itemId,
      payload: { ...operation.payload },
      hlcWallTime: operation.timestamp.wallTime,
      hlcLogical: operation.timestamp.logical,
      hlcNodeId: operation.timestamp.nodeId,
      createdAt: new Date(),
    });
  }

  async getRoomOperations(
    roomId: string,
    options?: { afterTimestamp?: HLCTimestamp; limit?: number }
  ): Promise<RoomOperation[]> {
    let ops = this.operations.filter((op) => op.roomId === roomId);

    if (options?.afterTimestamp) {
      const { wallTime, logical } = options.afterTimestamp;
      ops = ops.filter(
        (op) =>
          op.hlcWallTime > wallTime ||
          (op.hlcWallTime === wallTime && op.hlcLogical > logical)
      );
    }

    ops.sort((a, b) => {
      if (a.hlcWallTime !== b.hlcWallTime) return a.hlcWallTime - b.hlcWallTime;
      return a.hlcLogical - b.hlcLogical;
    });

    if (options?.limit) {
      ops = ops.slice(0, options.limit);
    }

    return ops;
  }

  async getRoomOperationsByRange(
    roomId: string,
    from: HLCTimestamp,
    to: HLCTimestamp
  ): Promise<RoomOperation[]> {
    return this.operations
      .filter((op) => {
        if (op.roomId !== roomId) return false;
        const afterFrom =
          op.hlcWallTime > from.wallTime ||
          (op.hlcWallTime === from.wallTime && op.hlcLogical >= from.logical);
        const beforeTo =
          op.hlcWallTime < to.wallTime ||
          (op.hlcWallTime === to.wallTime && op.hlcLogical <= to.logical);
        return afterFrom && beforeTo;
      })
      .sort((a, b) => {
        if (a.hlcWallTime !== b.hlcWallTime) return a.hlcWallTime - b.hlcWallTime;
        return a.hlcLogical - b.hlcLogical;
      });
  }

  async deleteRoomOperationsBefore(roomId: string, beforeTimestamp: HLCTimestamp): Promise<number> {
    const before = this.operations.length;
    this.operations = this.operations.filter((op) => {
      if (op.roomId !== roomId) return true;
      const isBefore =
        op.hlcWallTime < beforeTimestamp.wallTime ||
        (op.hlcWallTime === beforeTimestamp.wallTime && op.hlcLogical < beforeTimestamp.logical);
      return !isBefore;
    });
    return before - this.operations.length;
  }

  async saveRoomSnapshot(roomId: string, state: CRDTState, operationCount: number): Promise<string> {
    const id = uuidv4();
    this.snapshots.push({
      id,
      roomId,
      snapshotData: JSON.parse(JSON.stringify(state)),
      operationCount,
      createdAt: new Date(),
      _insertOrder: this._insertCounter++,
    });
    return id;
  }

  async getLatestRoomSnapshot(roomId: string): Promise<RoomSnapshot | null> {
    const roomSnapshots = this.snapshots
      .filter((s) => s.roomId === roomId)
      .sort((a, b) => b._insertOrder - a._insertOrder);

    if (roomSnapshots.length === 0) return null;
    const { _insertOrder, ...snapshot } = roomSnapshots[0];
    return snapshot;
  }

  async saveConflictEvent(event: ConflictEvent): Promise<string> {
    const id = event.id || uuidv4();
    this.conflicts.push({
      id,
      roomId: event.roomId,
      fieldName: event.field,
      operationA: event.operationA,
      operationB: event.operationB,
      winner: event.winner,
      reason: event.reason,
      createdAt: new Date(),
      _insertOrder: this._insertCounter++,
    });
    return id;
  }

  async getConflictEvents(roomId: string, limit: number = 100): Promise<PersistedConflictEvent[]> {
    return this.conflicts
      .filter((c) => c.roomId === roomId)
      .sort((a, b) => b._insertOrder - a._insertOrder)
      .slice(0, limit)
      .map(({ _insertOrder, ...event }) => event);
  }

  /**
   * Resets all in-memory state. Useful between test runs.
   */
  reset(): void {
    this.operations = [];
    this.snapshots = [];
    this.conflicts = [];
    this._insertCounter = 0;
  }

  /**
   * Returns all stored operations for testing inspection.
   */
  getAllOperations(): RoomOperation[] {
    return [...this.operations];
  }

  /**
   * Returns all stored snapshots for testing inspection.
   */
  getAllSnapshots(): RoomSnapshot[] {
    return this.snapshots.map(({ _insertOrder, ...s }) => s);
  }

  /**
   * Returns all stored conflict events for testing inspection.
   */
  getAllConflicts(): PersistedConflictEvent[] {
    return this.conflicts.map(({ _insertOrder, ...c }) => c);
  }
}

/**
 * Maps a database row to a RoomOperation.
 */
function rowToRoomOperation(row: Record<string, unknown>): RoomOperation {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    replicaId: row.replica_id as string,
    operationType: row.operation_type as string,
    itemId: row.item_id as string,
    payload:
      typeof row.payload === "string"
        ? JSON.parse(row.payload)
        : (row.payload as Record<string, unknown>),
    hlcWallTime: Number(row.hlc_wall_time),
    hlcLogical: Number(row.hlc_logical),
    hlcNodeId: row.hlc_node_id as string,
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Maps a database row to a PersistedConflictEvent.
 */
function rowToConflictEvent(row: Record<string, unknown>): PersistedConflictEvent {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    fieldName: row.field_name as string,
    operationA:
      typeof row.operation_a === "string"
        ? JSON.parse(row.operation_a)
        : row.operation_a,
    operationB:
      typeof row.operation_b === "string"
        ? JSON.parse(row.operation_b)
        : row.operation_b,
    winner: row.winner as "A" | "B",
    reason: row.reason as string,
    createdAt: new Date(row.created_at as string),
  };
}
