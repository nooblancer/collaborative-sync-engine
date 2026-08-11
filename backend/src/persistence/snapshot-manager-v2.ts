/**
 * Snapshot Manager V2 for the Collaborative Sync Engine.
 *
 * Implements automatic snapshot creation every N operations per room,
 * garbage collection of pre-snapshot operations and tombstones,
 * forced snapshot when room memory exceeds threshold, and delivering
 * latest snapshot + tail operations to new joining clients.
 *
 * Requirements: 23.1-23.6
 */

import { randomUUID } from "crypto";
import type {
  CRDTState,
  CRDTOperation,
  LWWElement,
  HLCTimestamp,
} from "../types/index.js";
import type { SnapshotManagerConfig } from "../types/snapshot.js";
import type { Snapshot } from "../types/persistence.js";

/** Default configuration values. */
const DEFAULT_SNAPSHOT_THRESHOLD = 1000;
const DEFAULT_MAX_ROOM_MEMORY_MB = 50;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Internal room tracking data for the snapshot manager.
 */
interface RoomTracker {
  /** Operations since last snapshot. */
  opsSinceSnapshot: number;
  /** All operations stored for the room (append-only log). */
  operations: CRDTOperation[];
  /** Ordered list of snapshots for this room. */
  snapshots: Snapshot[];
  /** Current CRDT state reference (managed externally but tracked for memory). */
  stateRef: CRDTState | null;
}

/**
 * Result of getClientJoinData — contains the latest snapshot and tail operations
 * that should be delivered to a newly joining client.
 */
export interface ClientJoinData {
  snapshot: Snapshot | null;
  tailOperations: CRDTOperation[];
}

/**
 * SnapshotManagerV2 coordinates periodic snapshot creation, garbage collection
 * of pre-snapshot operations, tombstone removal, and efficient state delivery
 * to new joining clients.
 */
export class SnapshotManagerV2 {
  private config: SnapshotManagerConfig;
  private rooms: Map<string, RoomTracker> = new Map();

  constructor(config?: Partial<SnapshotManagerConfig>) {
    this.config = {
      snapshotThreshold: config?.snapshotThreshold ?? DEFAULT_SNAPSHOT_THRESHOLD,
      maxRoomMemoryMb: config?.maxRoomMemoryMb ?? DEFAULT_MAX_ROOM_MEMORY_MB,
    };
  }

  /**
   * Registers a room with the snapshot manager.
   * Must be called when a room is created so the manager can track it.
   */
  registerRoom(roomId: string, initialState: CRDTState): void {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        opsSinceSnapshot: 0,
        operations: [],
        snapshots: [],
        stateRef: initialState,
      });
    }
  }

  /**
   * Unregisters a room (e.g., when deleted).
   */
  unregisterRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /**
   * Records an operation for a room and checks if a snapshot should be created.
   * Call this after each operation is processed.
   *
   * @param roomId - The room identifier.
   * @param operation - The operation that was just processed.
   * @param currentState - The current room state after applying the operation.
   * @returns A Snapshot if one was created (threshold reached), or null.
   *
   * Requirement 23.1: Automatic snapshot every 1,000 operations.
   */
  async recordOperation(
    roomId: string,
    operation: CRDTOperation,
    currentState: CRDTState
  ): Promise<Snapshot | null> {
    const tracker = this.getOrCreateTracker(roomId, currentState);
    tracker.operations.push(operation);
    tracker.stateRef = currentState;
    tracker.opsSinceSnapshot++;

    // Check operation threshold
    if (tracker.opsSinceSnapshot >= this.config.snapshotThreshold) {
      return this.createSnapshot(roomId, currentState, tracker);
    }

    return null;
  }

  /**
   * Checks if a snapshot should be created based on operation count,
   * and creates one if the threshold is reached.
   *
   * @param roomId - The room identifier.
   * @param opCount - The total number of operations since last snapshot.
   * @returns A Snapshot if created, null otherwise.
   *
   * Requirement 23.1: Compute snapshot every 1,000 ops.
   */
  async checkAndSnapshot(
    roomId: string,
    opCount: number
  ): Promise<Snapshot | null> {
    const tracker = this.rooms.get(roomId);
    if (!tracker || !tracker.stateRef) return null;

    if (opCount >= this.config.snapshotThreshold) {
      return this.createSnapshot(roomId, tracker.stateRef, tracker);
    }

    return null;
  }

  /**
   * Forces a snapshot regardless of operation count.
   * Used when memory exceeds the threshold or on explicit request.
   *
   * @param roomId - The room identifier.
   * @returns The created Snapshot.
   *
   * Requirement 23.6: Force snapshot when memory exceeds 50MB.
   */
  async forceSnapshot(roomId: string): Promise<Snapshot> {
    const tracker = this.rooms.get(roomId);
    if (!tracker || !tracker.stateRef) {
      throw new Error(`Room ${roomId} not registered with snapshot manager`);
    }

    return this.createSnapshot(roomId, tracker.stateRef, tracker);
  }

  /**
   * Returns the latest snapshot for a room, or null if none exists.
   *
   * @param roomId - The room identifier.
   * @returns The latest Snapshot or null.
   */
  async getLatestSnapshot(roomId: string): Promise<Snapshot | null> {
    const tracker = this.rooms.get(roomId);
    if (!tracker || tracker.snapshots.length === 0) return null;

    return tracker.snapshots[tracker.snapshots.length - 1];
  }

  /**
   * Performs garbage collection for a room.
   * Marks all operations prior to the given snapshot as eligible for deletion
   * and removes them. Also removes tombstones from the active in-memory state.
   *
   * @param roomId - The room identifier.
   * @param beforeSnapshot - The snapshot that defines the GC boundary.
   * @returns The number of operations removed.
   *
   * Requirement 23.2: Mark pre-snapshot operations as GC eligible.
   * Requirement 23.3: Remove tombstones from active state.
   */
  async garbageCollect(
    roomId: string,
    beforeSnapshot: Snapshot
  ): Promise<number> {
    const tracker = this.rooms.get(roomId);
    if (!tracker) return 0;

    // Find operations that are before the snapshot's creation time
    const snapshotTime = beforeSnapshot.createdAt;
    let opsRemoved = 0;

    // Remove operations created before the snapshot
    const remainingOps: CRDTOperation[] = [];
    for (const op of tracker.operations) {
      if (op.timestamp.wallTime < snapshotTime) {
        opsRemoved++;
      } else {
        remainingOps.push(op);
      }
    }
    tracker.operations = remainingOps;

    // Remove tombstones from the active state (Requirement 23.3)
    if (tracker.stateRef) {
      this.removeTombstones(tracker.stateRef);
    }

    return opsRemoved;
  }

  /**
   * Calculates approximate memory usage of a room in bytes.
   * Estimates based on JSON serialization size of state + operation log.
   *
   * @param roomId - The room identifier.
   * @returns Estimated memory usage in bytes.
   *
   * Requirement 23.5: Maintain room memory below 50MB.
   */
  getMemoryUsage(roomId: string): number {
    const tracker = this.rooms.get(roomId);
    if (!tracker) return 0;

    let bytes = 0;

    // State memory
    if (tracker.stateRef) {
      bytes += this.estimateObjectSize(tracker.stateRef);
    }

    // Operations memory
    for (const op of tracker.operations) {
      bytes += this.estimateObjectSize(op);
    }

    // Snapshots memory (usually only last 1-2 are kept)
    for (const snap of tracker.snapshots) {
      bytes += this.estimateObjectSize(snap);
    }

    return bytes;
  }

  /**
   * Checks if room memory exceeds the threshold and forces a snapshot + GC if so.
   *
   * @param roomId - The room identifier.
   * @returns A Snapshot if one was forced, null otherwise.
   *
   * Requirement 23.6: Force snapshot when memory exceeds 50MB.
   */
  async checkMemoryAndSnapshot(roomId: string): Promise<Snapshot | null> {
    const memoryBytes = this.getMemoryUsage(roomId);
    const thresholdBytes = this.config.maxRoomMemoryMb * BYTES_PER_MB;

    if (memoryBytes > thresholdBytes) {
      const snapshot = await this.forceSnapshot(roomId);
      await this.garbageCollect(roomId, snapshot);
      return snapshot;
    }

    return null;
  }

  /**
   * Returns the data needed for a new client joining a room:
   * the latest snapshot plus only operations created after that snapshot.
   *
   * @param roomId - The room identifier.
   * @returns ClientJoinData with snapshot and tail operations.
   *
   * Requirement 23.4: Deliver snapshot + tail ops to new clients.
   */
  async getClientJoinData(roomId: string): Promise<ClientJoinData> {
    const tracker = this.rooms.get(roomId);
    if (!tracker) {
      return { snapshot: null, tailOperations: [] };
    }

    const latestSnapshot =
      tracker.snapshots.length > 0
        ? tracker.snapshots[tracker.snapshots.length - 1]
        : null;

    if (!latestSnapshot) {
      // No snapshot available — return all operations
      return { snapshot: null, tailOperations: [...tracker.operations] };
    }

    // Return only operations created after the snapshot
    const tailOps = tracker.operations.filter(
      (op) => op.timestamp.wallTime >= latestSnapshot.createdAt
    );

    return { snapshot: latestSnapshot, tailOperations: tailOps };
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): SnapshotManagerConfig {
    return { ...this.config };
  }

  /**
   * Updates configuration at runtime.
   */
  configure(config: Partial<SnapshotManagerConfig>): void {
    if (config.snapshotThreshold !== undefined) {
      this.config.snapshotThreshold = config.snapshotThreshold;
    }
    if (config.maxRoomMemoryMb !== undefined) {
      this.config.maxRoomMemoryMb = config.maxRoomMemoryMb;
    }
  }

  /**
   * Returns the number of operations since the last snapshot for a room.
   */
  getOpsSinceSnapshot(roomId: string): number {
    const tracker = this.rooms.get(roomId);
    return tracker?.opsSinceSnapshot ?? 0;
  }

  /**
   * Returns all tracked operations for a room (for testing/inspection).
   */
  getOperations(roomId: string): CRDTOperation[] {
    const tracker = this.rooms.get(roomId);
    return tracker?.operations ?? [];
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Gets or creates a tracker for a room.
   */
  private getOrCreateTracker(
    roomId: string,
    currentState: CRDTState
  ): RoomTracker {
    let tracker = this.rooms.get(roomId);
    if (!tracker) {
      tracker = {
        opsSinceSnapshot: 0,
        operations: [],
        snapshots: [],
        stateRef: currentState,
      };
      this.rooms.set(roomId, tracker);
    }
    return tracker;
  }

  /**
   * Creates a snapshot, cleans tombstones from the snapshotted state,
   * and resets the operation counter.
   */
  private createSnapshot(
    roomId: string,
    currentState: CRDTState,
    tracker: RoomTracker
  ): Snapshot {
    // Deep clone the state for the snapshot
    const snapshotState: CRDTState = JSON.parse(JSON.stringify(currentState));

    // Remove tombstones from the snapshot state (Requirement 23.3)
    this.removeTombstones(snapshotState);

    const snapshot: Snapshot = {
      id: randomUUID(),
      sessionId: roomId,
      state: snapshotState,
      createdAt: Date.now(),
      operationCount: tracker.operations.length,
    };

    tracker.snapshots.push(snapshot);
    tracker.opsSinceSnapshot = 0;

    // Also clean tombstones from the live state
    if (tracker.stateRef) {
      this.removeTombstones(tracker.stateRef);
    }

    return snapshot;
  }

  /**
   * Removes all tombstoned (deleted) items from a CRDT state.
   * An item is tombstoned when its `removedAt` field is not null.
   */
  private removeTombstones(state: CRDTState): void {
    const itemIds = Object.keys(state.items);
    for (const itemId of itemIds) {
      const item: LWWElement = state.items[itemId];
      if (item.removedAt !== null) {
        delete state.items[itemId];
      }
    }
  }

  /**
   * Estimates the size of an object in bytes using JSON serialization length.
   * This is an approximation — actual memory usage may differ due to V8 internals.
   */
  private estimateObjectSize(obj: unknown): number {
    try {
      return JSON.stringify(obj).length * 2; // UTF-16 chars → ~2 bytes each
    } catch {
      return 0;
    }
  }
}
