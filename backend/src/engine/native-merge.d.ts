/**
 * TypeScript binding declarations for the native Rust CRDT merge addon.
 *
 * The addon is compiled via napi-rs and provides CPU-bound CRDT merge
 * computations at near-native speed. All data is serialized/deserialized
 * via JSON-encoded Buffers for cross-boundary transfer.
 *
 * @module native-merge
 */

/**
 * Result of merging a single operation into state.
 * Contains the updated state and a delta describing what changed.
 */
export interface MergeResultBuffer {
  success: boolean;
  operationId: string;
  delta?: {
    sessionId: string;
    changes: Array<{
      itemId: string;
      type: 'added' | 'removed' | 'updated';
      fields?: Record<string, unknown>;
    }>;
    timestamp: {
      wallTime: number;
      logical: number;
      nodeId: string;
    };
  };
  error?: {
    operationId: string;
    code: string;
    message: string;
  };
  state: {
    sessionId: string;
    items: Record<string, unknown>;
    version: number;
    lastUpdated: {
      wallTime: number;
      logical: number;
      nodeId: string;
    };
  };
}

/**
 * Result of merging a batch of operations.
 * Contains aggregated results including all changes and the final state.
 */
export interface BatchMergeResultBuffer {
  totalReceived: number;
  merged: number;
  failed: Array<{
    operationId: string;
    code: string;
    message: string;
  }>;
  finalDelta: {
    sessionId: string;
    changes: Array<{
      itemId: string;
      type: 'added' | 'removed' | 'updated';
      fields?: Record<string, unknown>;
    }>;
    timestamp: {
      wallTime: number;
      logical: number;
      nodeId: string;
    };
  };
  state: {
    sessionId: string;
    items: Record<string, unknown>;
    version: number;
    lastUpdated: {
      wallTime: number;
      logical: number;
      nodeId: string;
    };
  };
}

/**
 * Native Merge Addon interface.
 *
 * All functions accept and return Buffers containing JSON-serialized data.
 * This avoids expensive JS<->Rust object marshalling and enables zero-copy
 * transfer for large state objects.
 */
export interface NativeMergeAddon {
  /**
   * Merge a single operation into state.
   * @param state - Buffer containing JSON-serialized CRDTState
   * @param operation - Buffer containing JSON-serialized CRDTOperation
   * @returns Buffer containing JSON-serialized MergeResultBuffer (new state + delta)
   */
  mergeOperation(state: Buffer, operation: Buffer): Buffer;

  /**
   * Merge a batch of operations sequentially.
   * @param state - Buffer containing JSON-serialized CRDTState
   * @param operations - Array of Buffers, each containing a JSON-serialized CRDTOperation
   * @returns Buffer containing JSON-serialized BatchMergeResultBuffer
   */
  mergeBatch(state: Buffer, operations: Buffer[]): Buffer;

  /**
   * Compare two HLC timestamps.
   * @param a - Buffer containing JSON-serialized HLCTimestamp
   * @param b - Buffer containing JSON-serialized HLCTimestamp
   * @returns -1 if a < b, 0 if a == b, 1 if a > b
   */
  compareHlc(a: Buffer, b: Buffer): number;

  /**
   * Compute a state snapshot: consolidate state and remove tombstones.
   * @param state - Buffer containing JSON-serialized CRDTState
   * @returns Buffer containing JSON-serialized CRDTState with tombstones removed
   */
  computeSnapshot(state: Buffer): Buffer;
}

/**
 * Merge a single operation into state.
 * @param state - Buffer containing JSON-serialized CRDTState
 * @param operation - Buffer containing JSON-serialized CRDTOperation
 * @returns Buffer containing JSON-serialized MergeResultBuffer
 */
export declare function mergeOperation(state: Buffer, operation: Buffer): Buffer;

/**
 * Merge a batch of operations sequentially.
 * @param state - Buffer containing JSON-serialized CRDTState
 * @param operations - Array of Buffers, each containing a JSON-serialized CRDTOperation
 * @returns Buffer containing JSON-serialized BatchMergeResultBuffer
 */
export declare function mergeBatch(state: Buffer, operations: Buffer[]): Buffer;

/**
 * Compare two HLC timestamps.
 * @param a - Buffer containing JSON-serialized HLCTimestamp
 * @param b - Buffer containing JSON-serialized HLCTimestamp
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
export declare function compareHlc(a: Buffer, b: Buffer): number;

/**
 * Compute a state snapshot: consolidate state and remove tombstones.
 * @param state - Buffer containing JSON-serialized CRDTState
 * @returns Buffer containing JSON-serialized CRDTState with tombstones removed
 */
export declare function computeSnapshot(state: Buffer): Buffer;
