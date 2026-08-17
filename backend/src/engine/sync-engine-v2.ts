/**
 * Sync Engine V2 — Multi-room CRDT orchestration engine.
 *
 * Manages room lifecycle (create, get, delete), delegates CRDT merge
 * operations to the existing merge engine, emits ConflictEvents when
 * LWW resolution occurs, and coordinates batch processing.
 *
 * Uses Rust-owned room state via native merge addon for production
 * batch processing path (createRoom → mergeOps → dropRoom), with
 * fallback to TypeScript merge for single operations and error recovery.
 *
 * Each room maintains fully isolated state: operations in one room
 * produce no side effects in another.
 *
 * Requirements: 1.1, 1.3, 1.7, 1.9, 1.10, 1.12, 3.1-3.7, 7.1-7.6
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  Room,
  RoomParticipant,
  CRDTState,
  CRDTOperation,
  HLCTimestamp,
  MergeResult,
  BatchMergeResult,
  StateDelta,
  ConflictEvent,
  LWWElement,
} from "../types/index.js";
import { mergeOperation } from "./merge.js";
import { compareTimestamps } from "./hlc.js";
import { BatchProcessor } from "./batch-processor.js";

// Load native merge addon for room-based functions
const nativeMergePath = path.join(__dirname, "..", "..", "native-merge", "native-merge.node");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMerge = require(nativeMergePath) as {
  createRoom: (roomId: string) => void;
  mergeOps: (roomId: string, operations: Buffer[]) => Buffer;
  getState: (roomId: string) => Buffer;
  dropRoom: (roomId: string) => void;
  mergeBatch: (state: Buffer, operations: Buffer[]) => Buffer;
};

/** Maximum number of conflict events retained per room. */
const MAX_CONFLICT_HISTORY = 100;

/**
 * TimeTravelResult extends CRDTState with metadata about
 * whether the result is bounded by garbage collection.
 */
export interface TimeTravelResult {
  state: CRDTState;
  /** True if the returned state is bounded by GC (oldest available snapshot). */
  boundedByGC: boolean;
}

/**
 * Internal snapshot record for time-travel purposes.
 */
interface RoomSnapshot {
  id: string;
  state: CRDTState;
  timestamp: HLCTimestamp;
  operationIndex: number; // Index into the operation log at snapshot time
}

/**
 * Creates an empty CRDT state for a new room.
 */
function createEmptyState(sessionId: string): CRDTState {
  return {
    sessionId,
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "server" },
  };
}

/**
 * SyncEngineV2 orchestrates multi-room collaborative sessions.
 *
 * Responsibilities:
 * - Room lifecycle management (create, get, delete)
 * - Operation processing with conflict detection and event emission
 * - Batch processing coordination via BatchProcessor
 * - Room state isolation guarantees
 * - Time-travel state queries with operation log replay
 * - Operation persistence with HLC timestamps (Requirements 7.1-7.6)
 */
export class SyncEngineV2 {
  private rooms: Map<string, Room> = new Map();
  private batchProcessor: BatchProcessor;
  private conflictListeners: Array<(event: ConflictEvent) => void> = [];

  /** Per-room append-only operation log for time-travel queries. */
  private operationLogs: Map<string, CRDTOperation[]> = new Map();

  /** Per-room snapshots for efficient state reconstruction. */
  private roomSnapshots: Map<string, RoomSnapshot[]> = new Map();

  constructor(batchProcessor?: BatchProcessor) {
    this.batchProcessor = batchProcessor ?? new BatchProcessor();
  }

  /**
   * Creates a new room with a unique identifier and empty CRDT state.
   *
   * Also initializes the room in the Rust-side Room_State_Store for
   * native merge_ops processing.
   *
   * @param roomId - Optional room ID. If not provided, a UUID is generated.
   * @returns The newly created Room.
   */
  createRoom(roomId?: string): Room {
    const id = roomId ?? randomUUID();

    // Return existing room if one already exists with this ID
    const existing = this.rooms.get(id);
    if (existing) {
      return existing;
    }

    const room: Room = {
      id,
      state: createEmptyState(id),
      participants: new Map<string, RoomParticipant>(),
      operationCount: 0,
      snapshotCount: 0,
      conflictHistory: [],
      createdAt: Date.now(),
    };

    this.rooms.set(id, room);
    this.operationLogs.set(id, []);
    this.roomSnapshots.set(id, []);

    // Initialize room in native Rust state store
    try {
      nativeMerge.createRoom(id);
    } catch {
      // Non-fatal: room-based native path will fall back to mergeBatch
    }

    return room;
  }

  /**
   * Retrieves a room by ID.
   *
   * @param roomId - The room identifier.
   * @returns The Room if it exists, undefined otherwise.
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Deletes a room and all its state.
   *
   * Also drops the room from the Rust-side Room_State_Store,
   * releasing native memory.
   *
   * @param roomId - The room identifier to delete.
   */
  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.operationLogs.delete(roomId);
    this.roomSnapshots.delete(roomId);

    // Drop room from native Rust state store
    try {
      nativeMerge.dropRoom(roomId);
    } catch {
      // Non-fatal: room may not exist in native store
    }
  }

  /**
   * Processes a single CRDT operation against a room's state.
   *
   * Validates the room exists, delegates merge to the merge engine,
   * detects conflicts (LWW resolution on same field), emits ConflictEvents,
   * and returns the merge result.
   *
   * @param roomId - Target room identifier.
   * @param operation - The CRDT operation to process.
   * @returns The MergeResult describing the outcome.
   */
  async processOperation(
    roomId: string,
    operation: CRDTOperation
  ): Promise<MergeResult> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        success: false,
        operationId: operation.id,
        error: {
          operationId: operation.id,
          code: "room_not_found",
          message: `Room "${roomId}" does not exist`,
        },
      };
    }

    // Check if the operation targets a deleted (tombstoned) item for updates
    if (operation.type === "update") {
      const existingItem = room.state.items[operation.itemId] as
        | LWWElement
        | undefined;
      if (existingItem && existingItem.removedAt !== null) {
        // Remove-wins: reject updates to tombstoned items
        return {
          success: false,
          operationId: operation.id,
          error: {
            operationId: operation.id,
            code: "object_not_found",
            message: `Item "${operation.itemId}" has been deleted`,
          },
        };
      }
    }

    // Capture pre-merge field state for conflict detection
    const preFieldStates = this.captureFieldStates(room, operation);

    // Delegate to the merge engine
    const result = mergeOperation(room.state, operation);

    if (result.success) {
      room.operationCount++;

      // Persist operation to the append-only log (Requirement 7.1)
      this.appendToOperationLog(roomId, operation);

      // Detect and emit conflict events
      this.detectAndEmitConflicts(room, operation, preFieldStates);
    }

    return result;
  }

  /**
   * Processes a batch of operations for a room.
   *
   * Uses native `mergeOps` for optimized batch processing (state stays in Rust).
   * Falls back to sequential TypeScript merge if the native path fails.
   *
   * @param roomId - Target room identifier.
   * @param operations - Array of CRDT operations to process.
   * @returns BatchMergeResult with merged count, failures, and final delta.
   */
  async processBatch(
    roomId: string,
    operations: CRDTOperation[]
  ): Promise<BatchMergeResult> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        totalReceived: operations.length,
        merged: 0,
        failed: operations.map((op) => ({
          operationId: op.id,
          code: "room_not_found",
          message: `Room "${roomId}" does not exist`,
        })),
        finalDelta: {
          sessionId: roomId,
          changes: [],
          timestamp: { wallTime: 0, logical: 0, nodeId: "server" },
        },
      };
    }

    // Try native mergeOps path first (Requirement 1.10, 4.5 fallback)
    try {
      const opBuffers = operations.map((op) => Buffer.from(JSON.stringify(op)));
      const deltaBuffer = nativeMerge.mergeOps(roomId, opBuffers);
      const delta = JSON.parse(deltaBuffer.toString()) as {
        roomId: string;
        merged: number;
        conflicts: number;
        failed: number;
        itemCount: number;
        changes: Array<{ itemId: string; type: string; fields?: Record<string, unknown> }>;
        timestamp: HLCTimestamp;
      };

      // Update local state from native store for consistency
      try {
        const stateBuffer = nativeMerge.getState(roomId);
        room.state = JSON.parse(stateBuffer.toString()) as CRDTState;
      } catch {
        // If getState fails, state may be slightly stale but not critical
      }

      // Persist operations to append-only log (Requirement 7.1)
      for (const operation of operations) {
        this.appendToOperationLog(roomId, operation);
      }
      room.operationCount += delta.merged;

      // Build delta changes for broadcast
      const changes: StateDelta["changes"] = delta.changes.map((c) => ({
        type: c.type as "added" | "updated" | "removed",
        itemId: c.itemId,
        fields: c.fields,
      }));

      return {
        totalReceived: operations.length,
        merged: delta.merged,
        failed: delta.failed > 0
          ? operations.slice(delta.merged).map((op) => ({
              operationId: op.id,
              code: "merge_failed",
              message: "Operation failed during native merge",
            }))
          : [],
        finalDelta: {
          sessionId: roomId,
          changes,
          timestamp: delta.timestamp,
        },
      };
    } catch {
      // Fallback to sequential TypeScript merge (Requirement 4.5)
      return this.processBatchFallback(roomId, operations);
    }
  }

  /**
   * Fallback batch processing using sequential TypeScript merge.
   * Used when native mergeOps fails.
   */
  private async processBatchFallback(
    roomId: string,
    operations: CRDTOperation[]
  ): Promise<BatchMergeResult> {
    let merged = 0;
    const failed: Array<{
      operationId: string;
      code: string;
      message: string;
    }> = [];
    const allChanges: StateDelta["changes"] = [];
    let lastTimestamp: HLCTimestamp = {
      wallTime: 0,
      logical: 0,
      nodeId: "server",
    };

    for (const operation of operations) {
      const result = await this.processOperation(roomId, operation);

      if (result.success) {
        merged++;
        if (result.delta && result.delta.changes.length > 0) {
          allChanges.push(...result.delta.changes);
          lastTimestamp = result.delta.timestamp;
        }
      } else if (result.error) {
        failed.push(result.error);
      }
    }

    return {
      totalReceived: operations.length,
      merged,
      failed,
      finalDelta: {
        sessionId: roomId,
        changes: allChanges,
        timestamp: lastTimestamp,
      },
    };
  }

  /**
   * Returns the current CRDT state for a room.
   *
   * For snapshot persistence, use `getNativeState()` which reads
   * directly from the Rust-owned room state store.
   *
   * @param roomId - The room identifier.
   * @returns The current CRDTState, or an empty state if room doesn't exist.
   */
  getState(roomId: string): CRDTState {
    const room = this.rooms.get(roomId);
    if (!room) {
      return createEmptyState(roomId);
    }
    return room.state;
  }

  /**
   * Returns the current state directly from the Rust-owned room state store.
   * Used for snapshot persistence where we want the authoritative Rust-held state.
   *
   * Falls back to TypeScript-held state if native store is unavailable.
   *
   * @param roomId - The room identifier.
   * @returns The current CRDTState from native store.
   */
  getNativeState(roomId: string): CRDTState {
    try {
      const stateBuffer = nativeMerge.getState(roomId);
      return JSON.parse(stateBuffer.toString()) as CRDTState;
    } catch {
      // Fallback to TypeScript-held state
      const room = this.rooms.get(roomId);
      if (!room) {
        return createEmptyState(roomId);
      }
      return room.state;
    }
  }

  /**
   * Returns the conflict history for a room.
   *
   * @param roomId - The room identifier.
   * @param limit - Maximum number of events to return (default: all, max 100).
   * @returns Array of ConflictEvents, most recent first.
   */
  getConflictHistory(roomId: string, limit?: number): ConflictEvent[] {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    const history = room.conflictHistory;
    if (limit !== undefined && limit < history.length) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * Queries the CRDT state at a given historical HLC timestamp.
   *
   * Reconstructs state by finding the nearest snapshot before the target
   * timestamp, then replaying operations up to and including the target.
   *
   * Requirements: 7.2, 7.4, 7.5, 7.6
   *
   * @param roomId - The room identifier.
   * @param timestamp - The target HLC timestamp to reconstruct state at.
   * @returns The reconstructed CRDTState at the given point in time.
   */
  async queryTimeTravelState(
    roomId: string,
    timestamp: HLCTimestamp
  ): Promise<TimeTravelResult> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        state: createEmptyState(roomId),
        boundedByGC: false,
      };
    }

    const opLog = this.operationLogs.get(roomId) ?? [];
    const snapshots = this.roomSnapshots.get(roomId) ?? [];

    // Requirement 7.5: If timestamp precedes all operations, return empty state
    if (opLog.length === 0 || compareTimestamps(timestamp, opLog[0].timestamp) < 0) {
      // Check if there are snapshots and the timestamp is before the oldest one
      // (Requirement 7.6: bounded by GC)
      if (snapshots.length > 0) {
        const oldestSnapshot = snapshots[0];
        if (compareTimestamps(timestamp, oldestSnapshot.timestamp) < 0) {
          return {
            state: JSON.parse(JSON.stringify(oldestSnapshot.state)),
            boundedByGC: true,
          };
        }
      }
      return {
        state: createEmptyState(roomId),
        boundedByGC: false,
      };
    }

    // Find the best snapshot to start from (latest snapshot with timestamp <= target)
    let baseState: CRDTState = createEmptyState(roomId);
    let startIndex = 0;

    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (compareTimestamps(snapshots[i].timestamp, timestamp) <= 0) {
        baseState = JSON.parse(JSON.stringify(snapshots[i].state));
        startIndex = snapshots[i].operationIndex;
        break;
      }
    }

    // Replay operations from startIndex up to and including the target timestamp
    for (let i = startIndex; i < opLog.length; i++) {
      const op = opLog[i];
      if (compareTimestamps(op.timestamp, timestamp) > 0) {
        break;
      }
      mergeOperation(baseState, op);
    }

    return {
      state: baseState,
      boundedByGC: false,
    };
  }

  /**
   * Queries operations within a HLC timestamp range [from, to] in causal order.
   *
   * Returns the sequence of operations whose HLC timestamps fall within the
   * specified range, sorted in causal (HLC) order.
   *
   * Requirements: 7.3
   *
   * @param roomId - The room identifier.
   * @param from - Start of the timestamp range (inclusive).
   * @param to - End of the timestamp range (inclusive).
   * @returns Array of CRDTOperations in causal order.
   */
  async queryOperationRange(
    roomId: string,
    from: HLCTimestamp,
    to: HLCTimestamp
  ): Promise<CRDTOperation[]> {
    const opLog = this.operationLogs.get(roomId) ?? [];

    // The operation log is maintained in insertion order which preserves
    // causal ordering for same-client operations. For the full causal order,
    // we filter by range and sort by HLC.
    const inRange: CRDTOperation[] = [];

    for (const op of opLog) {
      if (
        compareTimestamps(op.timestamp, from) >= 0 &&
        compareTimestamps(op.timestamp, to) <= 0
      ) {
        inRange.push(op);
      }
    }

    // Sort in HLC causal order: wallTime, logical, nodeId
    inRange.sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));

    return inRange;
  }

  /**
   * Registers a listener for conflict events.
   */
  onConflict(listener: (event: ConflictEvent) => void): void {
    this.conflictListeners.push(listener);
  }

  /**
   * Returns the number of active rooms.
   */
  getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Returns the underlying batch processor instance.
   */
  getBatchProcessor(): BatchProcessor {
    return this.batchProcessor;
  }

  // --- Private helpers ---

  /**
   * Captures the pre-merge field states for an operation's target item.
   * Used to detect conflicts after merge completes.
   */
  private captureFieldStates(
    room: Room,
    operation: CRDTOperation
  ): Map<string, { value: unknown; hlc: HLCTimestamp; replicaId: string }> {
    const preStates = new Map<
      string,
      { value: unknown; hlc: HLCTimestamp; replicaId: string }
    >();

    if (operation.type !== "update" && operation.type !== "add") {
      return preStates;
    }

    const existingItem = room.state.items[operation.itemId] as
      | LWWElement
      | undefined;
    if (!existingItem) {
      return preStates;
    }

    // Capture current field values for fields being modified
    for (const key of Object.keys(operation.payload)) {
      const field = existingItem.fields[key];
      if (field) {
        preStates.set(key, {
          value: field.value,
          hlc: field.timestamp,
          replicaId: field.replicaId,
        });
      }
    }

    return preStates;
  }

  /**
   * Detects conflicts by comparing pre-merge and post-merge field states.
   *
   * A conflict is detected when:
   * 1. The operation targets a field that already exists
   * 2. The existing field was written by a different client
   * 3. The operation's value differs from the existing value
   *
   * When detected, emits a ConflictEvent documenting both operations and the winner.
   */
  private detectAndEmitConflicts(
    room: Room,
    operation: CRDTOperation,
    preFieldStates: Map<
      string,
      { value: unknown; hlc: HLCTimestamp; replicaId: string }
    >
  ): void {
    if (operation.type !== "update" && operation.type !== "add") {
      return;
    }

    for (const [fieldName, priorState] of preFieldStates) {
      const newValue = operation.payload[fieldName];

      // A conflict exists when:
      // - Different client wrote the field previously
      // - The values differ (same value = no real conflict)
      if (
        priorState.replicaId !== operation.replicaId &&
        JSON.stringify(priorState.value) !== JSON.stringify(newValue)
      ) {
        // Determine winner by comparing HLC timestamps
        const cmp = compareTimestamps(operation.timestamp, priorState.hlc);
        const operationWins = cmp > 0 || (cmp === 0 && operation.replicaId > priorState.replicaId);

        const conflictEvent: ConflictEvent = {
          id: randomUUID(),
          roomId: room.id,
          timestamp: operation.timestamp,
          field: fieldName,
          operationA: {
            clientId: priorState.replicaId,
            value: priorState.value,
            hlc: priorState.hlc,
          },
          operationB: {
            clientId: operation.replicaId,
            value: newValue,
            hlc: operation.timestamp,
          },
          winner: operationWins ? "B" : "A",
          reason: this.buildConflictReason(
            operationWins,
            operation.timestamp,
            priorState.hlc,
            operation.replicaId,
            priorState.replicaId
          ),
        };

        this.addConflictToHistory(room, conflictEvent);
        this.emitConflictEvent(conflictEvent);
      }
    }
  }

  /**
   * Builds a human-readable explanation of why an operation won the conflict.
   */
  private buildConflictReason(
    operationBWins: boolean,
    hlcB: HLCTimestamp,
    hlcA: HLCTimestamp,
    replicaB: string,
    replicaA: string
  ): string {
    const winner = operationBWins ? "B" : "A";
    const winnerHlc = operationBWins ? hlcB : hlcA;
    const loserHlc = operationBWins ? hlcA : hlcB;

    if (winnerHlc.wallTime !== loserHlc.wallTime) {
      return `Operation ${winner} wins: higher wall time (${winnerHlc.wallTime} > ${loserHlc.wallTime})`;
    }
    if (winnerHlc.logical !== loserHlc.logical) {
      return `Operation ${winner} wins: higher logical counter (${winnerHlc.logical} > ${loserHlc.logical})`;
    }
    const winnerNode = operationBWins ? replicaB : replicaA;
    const loserNode = operationBWins ? replicaA : replicaB;
    return `Operation ${winner} wins: lexicographic nodeId tiebreaker ("${winnerNode}" > "${loserNode}")`;
  }

  /**
   * Adds a conflict event to the room's history, maintaining the 100-event bound.
   */
  private addConflictToHistory(room: Room, event: ConflictEvent): void {
    room.conflictHistory.push(event);
    if (room.conflictHistory.length > MAX_CONFLICT_HISTORY) {
      room.conflictHistory = room.conflictHistory.slice(-MAX_CONFLICT_HISTORY);
    }
  }

  /**
   * Emits a conflict event to all registered listeners.
   */
  private emitConflictEvent(event: ConflictEvent): void {
    for (const listener of this.conflictListeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not crash the engine
      }
    }
  }

  // --- Time-Travel helpers ---

  /**
   * Appends an operation to the room's operation log.
   * Maintains operations in insertion order (which is causal for same-client ops).
   * Requirement 7.1: persist every validated operation with its HLC timestamp.
   */
  private appendToOperationLog(roomId: string, operation: CRDTOperation): void {
    let log = this.operationLogs.get(roomId);
    if (!log) {
      log = [];
      this.operationLogs.set(roomId, log);
    }
    log.push(operation);
  }

  /**
   * Creates a time-travel snapshot at the current point for the given room.
   * This allows efficient state reconstruction by providing a starting point
   * that avoids replaying the entire operation history.
   *
   * @param roomId - The room identifier.
   */
  createTimeTravelSnapshot(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const opLog = this.operationLogs.get(roomId) ?? [];
    let snapshots = this.roomSnapshots.get(roomId);
    if (!snapshots) {
      snapshots = [];
      this.roomSnapshots.set(roomId, snapshots);
    }

    const snapshot: RoomSnapshot = {
      id: randomUUID(),
      state: JSON.parse(JSON.stringify(room.state)),
      timestamp: room.state.lastUpdated,
      operationIndex: opLog.length,
    };

    snapshots.push(snapshot);
    room.snapshotCount++;
  }

  /**
   * Performs garbage collection on the operation log for a room.
   * Removes operations that precede the oldest retained snapshot.
   * After GC, time-travel queries for timestamps before the oldest snapshot
   * will return the oldest snapshot state with boundedByGC=true.
   *
   * @param roomId - The room identifier.
   * @param keepSnapshots - Number of snapshots to retain (default: 1).
   * @returns Number of operations removed.
   */
  garbageCollect(roomId: string, keepSnapshots: number = 1): number {
    const snapshots = this.roomSnapshots.get(roomId);
    const opLog = this.operationLogs.get(roomId);
    if (!snapshots || !opLog || snapshots.length <= keepSnapshots) {
      return 0;
    }

    // Remove older snapshots, keeping only the last `keepSnapshots`
    const removedSnapshots = snapshots.splice(0, snapshots.length - keepSnapshots);
    if (removedSnapshots.length === 0) return 0;

    // The oldest retained snapshot defines the GC boundary
    const oldestRetained = snapshots[0];
    const gcBoundary = oldestRetained.operationIndex;

    if (gcBoundary <= 0) return 0;

    // Remove operations before the GC boundary
    const removed = opLog.splice(0, gcBoundary);

    // Adjust snapshot operationIndex values to account for removed ops
    for (const snap of snapshots) {
      snap.operationIndex -= gcBoundary;
    }

    return removed.length;
  }

  /**
   * Returns the operation log for a room (for testing/inspection).
   */
  getOperationLog(roomId: string): CRDTOperation[] {
    return this.operationLogs.get(roomId) ?? [];
  }

  /**
   * Returns the snapshots for a room (for testing/inspection).
   */
  getSnapshots(roomId: string): RoomSnapshot[] {
    return this.roomSnapshots.get(roomId) ?? [];
  }
}
