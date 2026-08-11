/**
 * Batch processor type definitions for operation buffering and flush cycles.
 */

import type { CRDTOperation } from "./crdt.js";

/** BatchProcessorConfig controls the batching window and parallelism threshold. */
export interface BatchProcessorConfig {
  /** Batch window duration in milliseconds (1-5ms configurable). */
  windowMs: number;
  /** Number of operations that triggers parallel merge via worker threads. */
  workerThreadThreshold: number;
  /** Maximum operations allowed per flush cycle. */
  maxBatchSize: number;
}

/** BatchCycle represents a single flush cycle for a room's buffered operations. */
export interface BatchCycle {
  roomId: string;
  operations: CRDTOperation[];
  /** High-resolution start time for latency measurement. */
  startedAt: number;
  completedAt?: number;
}
