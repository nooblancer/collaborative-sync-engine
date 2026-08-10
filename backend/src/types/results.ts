/**
 * Result type definitions for merge operations, batch processing, and errors.
 */

import type { StateDelta } from "./crdt.js";

/** OperationError describes why an operation failed. */
export interface OperationError {
  operationId: string;
  code: string;
  message: string;
}

/** MergeResult represents the outcome of processing a single operation. */
export interface MergeResult {
  success: boolean;
  operationId: string;
  delta?: StateDelta;
  error?: OperationError;
}

/** BatchMergeResult represents the outcome of processing a batch of operations. */
export interface BatchMergeResult {
  totalReceived: number;
  merged: number;
  failed: OperationError[];
  finalDelta: StateDelta;
}
