/**
 * Snapshot manager type definitions for state consolidation and garbage collection.
 */

/** SnapshotManagerConfig controls snapshot creation thresholds and memory limits. */
export interface SnapshotManagerConfig {
  /** Number of operations that triggers a snapshot (default: 1000). */
  snapshotThreshold: number;
  /** Maximum memory allowed per room in megabytes (default: 50). */
  maxRoomMemoryMb: number;
}
