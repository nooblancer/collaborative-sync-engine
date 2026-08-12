/**
 * Workload generators for extended benchmark modes.
 *
 * Each generator produces an array of Buffer-serialized CRDT operations
 * compatible with the native-merge addon's `mergeBatch` and `mergeOperation` functions.
 *
 * Requirements: 1.1, 4.1, 5.6
 */

// ---------------------------------------------------------------------------
// Types (internal operation shape matching native-merge expectations)
// ---------------------------------------------------------------------------

interface CrdtOperation {
  id: string;
  sessionId: string;
  replicaId: string;
  type: "add" | "update" | "remove";
  itemId: string;
  payload: Record<string, unknown>;
  timestamp: {
    wallTime: number;
    logical: number;
    nodeId: string;
  };
  version: number;
}

// ---------------------------------------------------------------------------
// Contention Workload Generator
// ---------------------------------------------------------------------------

/**
 * Generates a high-contention workload where at least 80% of operations target
 * a key pool of no more than 10 items, using at least 3 distinct replica IDs.
 *
 * This forces frequent conflict resolution in the CRDT merge engine.
 *
 * Requirement 1.1: ≥80% ops target ≤10 keys, ≥3 replica source IDs
 */
export function generateContentionWorkload(ops: number): Buffer[] {
  const operations: Buffer[] = new Array(ops);
  const baseTime = Date.now();

  // Key pool: exactly 10 "hot" keys that receive the majority of operations
  const hotKeys = ["hot-key-0","hot-key-1","hot-key-2","hot-key-3","hot-key-4",
                   "hot-key-5","hot-key-6","hot-key-7","hot-key-8","hot-key-9"];

  // At least 3 replica IDs for concurrent conflicting writes
  const replicaIds = ["replica-A", "replica-B", "replica-C", "replica-D"];

  // Deterministically ensure ≥80% of ops target hot keys
  const hotCount = Math.ceil(ops * 0.8);

  let coldKeyCounter = 0;

  for (let i = 0; i < ops; i++) {
    const replicaId = replicaIds[i & 3]; // fast modulo 4
    const isHotOp = i < hotCount; // first 80% are hot (pre-sorted for speed)

    let itemId: string;
    let type: "add" | "update" | "remove";

    if (isHotOp) {
      itemId = hotKeys[i % 10];
      if (i < 10) {
        type = "add";
      } else {
        // Deterministic type based on index for speed (no Math.random)
        const typeIdx = i % 5;
        type = typeIdx < 3 ? "update" : typeIdx < 4 ? "add" : "remove";
      }
    } else {
      itemId = `cold-${coldKeyCounter++}`;
      type = "add";
    }

    operations[i] = Buffer.from(
      `{"id":"op-${i}","sessionId":"benchmark-contention","replicaId":"${replicaId}","type":"${type}","itemId":"${itemId}","payload":${type === "remove" ? "{}" : `{"n":${i}}`},"timestamp":{"wallTime":${baseTime + i},"logical":${i},"nodeId":"${replicaId}"},"version":${i + 1}}`
    );
  }

  return operations;
}

// ---------------------------------------------------------------------------
// Balanced Workload Generator
// ---------------------------------------------------------------------------

/**
 * Generates a balanced workload with approximately equal distribution across
 * add, update, and remove operation types (~33% each, within 30–36% per type).
 *
 * Requirement 4.1: each type constitutes between 30% and 36% of total operations
 */
export function generateBalancedWorkload(ops: number): Buffer[] {
  const operations: Buffer[] = new Array(ops);
  const baseTime = Date.now();

  // Exact counts: floor(ops/3) for first two, remainder for third
  const addCount = Math.floor(ops / 3);
  const updateCount = Math.floor(ops / 3);
  // removeCount = ops - addCount - updateCount (fills the rest)

  let itemCounter = 0;

  for (let i = 0; i < ops; i++) {
    let type: "add" | "update" | "remove";
    let itemId: string;

    // Deterministic distribution: first third = add, second third = update, rest = remove
    // Then we reference the item pool deterministically
    if (i < addCount) {
      type = "add";
      itemId = `bal-${itemCounter++}`;
    } else if (i < addCount + updateCount) {
      type = "update";
      itemId = `bal-${i % Math.max(1, itemCounter)}`;
    } else {
      type = "remove";
      itemId = `bal-${i % Math.max(1, itemCounter)}`;
    }

    operations[i] = Buffer.from(
      `{"id":"op-${i}","sessionId":"benchmark-balanced","replicaId":"balanced-node","type":"${type}","itemId":"${itemId}","payload":${type === "remove" ? "{}" : `{"n":${i}}`},"timestamp":{"wallTime":${baseTime + i},"logical":${i},"nodeId":"balanced-node"},"version":${i + 1}}`
    );
  }

  return operations;
}

// ---------------------------------------------------------------------------
// Snapshot Workload Generator
// ---------------------------------------------------------------------------

/**
 * Generates a workload with at least 20% remove operations to ensure
 * tombstones accumulate for meaningful snapshot/compaction measurement.
 *
 * Requirement 5.6: ≥20% remove operations
 */
export function generateSnapshotWorkload(ops: number): Buffer[] {
  const operations: Buffer[] = new Array(ops);
  const baseTime = Date.now();

  // 50% adds, 25% updates, 25% removes (safely above 20% minimum)
  const addCount = Math.ceil(ops * 0.50);
  const removeCount = Math.ceil(ops * 0.25);

  // First 10 ops are always adds to seed the item pool
  const seedCount = Math.min(10, addCount);
  let itemCounter = 0;

  for (let i = 0; i < ops; i++) {
    let type: "add" | "update" | "remove";
    let itemId: string;

    if (i < seedCount) {
      type = "add";
      itemId = `snap-${itemCounter++}`;
    } else if (i < addCount) {
      type = "add";
      itemId = `snap-${itemCounter++}`;
    } else if (i < addCount + removeCount) {
      type = "remove";
      // Target an existing item deterministically
      itemId = `snap-${i % Math.max(1, itemCounter)}`;
    } else {
      type = "update";
      itemId = `snap-${i % Math.max(1, itemCounter)}`;
    }

    operations[i] = Buffer.from(
      `{"id":"op-${i}","sessionId":"benchmark-snapshot","replicaId":"snapshot-node","type":"${type}","itemId":"${itemId}","payload":${type === "remove" ? "{}" : `{"n":${i}}`},"timestamp":{"wallTime":${baseTime + i},"logical":${i},"nodeId":"snapshot-node"},"version":${i + 1}}`
    );
  }

  return operations;
}

// ---------------------------------------------------------------------------
// Utility: Extract operation type from a Buffer-serialized operation
// ---------------------------------------------------------------------------

/**
 * Parses a Buffer-serialized operation and returns its type.
 * Useful for validating workload distributions in tests.
 */
export function getOperationType(opBuffer: Buffer): "add" | "update" | "remove" {
  const op = JSON.parse(opBuffer.toString()) as CrdtOperation;
  return op.type;
}

/**
 * Parses a Buffer-serialized operation and returns its itemId.
 * Useful for validating key distribution in tests.
 */
export function getOperationItemId(opBuffer: Buffer): string {
  const op = JSON.parse(opBuffer.toString()) as CrdtOperation;
  return op.itemId;
}

/**
 * Parses a Buffer-serialized operation and returns its replicaId.
 * Useful for validating replica diversity in tests.
 */
export function getOperationReplicaId(opBuffer: Buffer): string {
  const op = JSON.parse(opBuffer.toString()) as CrdtOperation;
  return op.replicaId;
}
