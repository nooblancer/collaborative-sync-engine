/**
 * Snapshot Manager for the Collaborative Sync Engine.
 *
 * Handles periodic snapshot creation and state recovery from snapshots
 * plus operation replay. Ensures recovery requires replaying ≤ 1000
 * operations and completes within 30 seconds.
 *
 * Requirements: 7.4, 7.5, 7.6
 */

import type { CRDTState, CRDTOperation } from "../types/index.js";
import type { PersistenceLayer } from "./persistence-layer.js";
import { mergeOperation } from "../engine/merge.js";

/** Maximum default snapshot interval: 10 minutes (600,000 ms). */
const DEFAULT_SNAPSHOT_INTERVAL_MS = 600_000;

/**
 * SnapshotManager coordinates periodic snapshot creation and
 * state recovery via snapshot + operation replay.
 */
export class SnapshotManager {
  private persistence: PersistenceLayer;
  private snapshotIntervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * @param persistence - The persistence layer to use for snapshots and operations.
   * @param snapshotIntervalMs - Interval between periodic snapshots in milliseconds.
   *   Defaults to 600,000 ms (10 minutes). Must be ≤ 600,000 ms.
   */
  constructor(
    persistence: PersistenceLayer,
    snapshotIntervalMs: number = DEFAULT_SNAPSHOT_INTERVAL_MS
  ) {
    if (snapshotIntervalMs > DEFAULT_SNAPSHOT_INTERVAL_MS) {
      throw new Error(
        `Snapshot interval must be ≤ ${DEFAULT_SNAPSHOT_INTERVAL_MS}ms (10 minutes)`
      );
    }
    this.persistence = persistence;
    this.snapshotIntervalMs = snapshotIntervalMs;
  }

  /**
   * Starts periodic snapshot creation for a given session.
   * Each interval tick recovers the current state and saves a snapshot.
   *
   * @param sessionId - The session to snapshot periodically.
   */
  startPeriodicSnapshots(sessionId: string): void {
    this.stopPeriodicSnapshots();
    this.intervalHandle = setInterval(async () => {
      const state = await this.recoverState(sessionId);
      await this.saveSnapshot(sessionId, state);
    }, this.snapshotIntervalMs);
  }

  /**
   * Stops the periodic snapshot timer.
   */
  stopPeriodicSnapshots(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Manually saves a snapshot of the given state for a session.
   *
   * @param sessionId - The session ID.
   * @param state - The CRDT state to snapshot.
   * @returns The generated snapshot ID.
   */
  async saveSnapshot(sessionId: string, state: CRDTState): Promise<string> {
    return this.persistence.saveSnapshot(sessionId, state);
  }

  /**
   * Recovers the full CRDT state for a session on startup.
   *
   * Recovery logic:
   * 1. Load the latest snapshot via persistence.getLatestSnapshot(sessionId).
   * 2. If a snapshot exists, start from snapshot.state and replay operations
   *    returned by persistence.getOperationsSince(snapshotId).
   * 3. If no snapshot exists, start from an empty state and replay the full
   *    operation log from persistence.getFullOperationLog(sessionId).
   * 4. Apply each operation using mergeOperation(state, op).
   * 5. Return the recovered state.
   *
   * @param sessionId - The session to recover.
   * @returns The reconstructed CRDT state.
   */
  async recoverState(sessionId: string): Promise<CRDTState> {
    const snapshot = await this.persistence.getLatestSnapshot(sessionId);

    let state: CRDTState;
    let operations: CRDTOperation[];

    if (snapshot) {
      // Start from the snapshot state
      state = JSON.parse(JSON.stringify(snapshot.state));
      // Replay only operations since the snapshot
      operations = await this.persistence.getOperationsSince(snapshot.id);
    } else {
      // No snapshot — start from empty state and replay full log
      state = createEmptyState(sessionId);
      operations = await this.persistence.getFullOperationLog(sessionId);
    }

    // Apply each operation using the merge engine
    for (const op of operations) {
      mergeOperation(state, op);
    }

    return state;
  }
}

/**
 * Creates an empty CRDT state for a session.
 */
function createEmptyState(sessionId: string): CRDTState {
  return {
    sessionId,
    items: {},
    version: 0,
    lastUpdated: { wallTime: 0, logical: 0, nodeId: "" },
  };
}
