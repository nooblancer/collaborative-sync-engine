/**
 * Stress Test Operation Generator
 *
 * Extracted from StressTestDemo for testability.
 * Generates CRDT operations for stress testing the sync engine.
 */

export type OperationType = "create" | "update" | "delete";

export interface StressOperation {
  id: string;
  type: OperationType;
  itemId: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * Generates a unique operation ID using timestamp and random suffix.
 */
export function generateOperationId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generates a unique item ID.
 */
export function generateItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generates exactly `count` valid CRDT operations for stress testing.
 *
 * The distribution follows:
 * - ~40% creates (or create if no items exist)
 * - ~45% updates (referencing existing items)
 * - ~15% deletes (removing from pool, ensures pool never empties)
 *
 * Every generated operation has: id, type, itemId, payload, and timestamp.
 */
export function generateOperations(count: number): StressOperation[] {
  const ops: StressOperation[] = [];
  const itemIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    let type: OperationType;
    let itemId: string;

    if (roll < 0.4 || itemIds.length === 0) {
      type = "create";
      itemId = generateItemId();
      itemIds.push(itemId);
    } else if (roll < 0.85) {
      type = "update";
      itemId = itemIds[Math.floor(Math.random() * itemIds.length)];
    } else {
      type = "delete";
      const idx = Math.floor(Math.random() * itemIds.length);
      itemId = itemIds[idx];
      itemIds.splice(idx, 1);
      if (itemIds.length === 0) itemIds.push(generateItemId());
    }

    ops.push({
      id: generateOperationId(),
      type,
      itemId,
      payload:
        type === "create"
          ? { name: `Item-${i}`, quantity: Math.floor(Math.random() * 1000) }
          : type === "update"
            ? { quantity: Math.floor(Math.random() * 1000) }
            : {},
      timestamp: Date.now(),
    });
  }

  return ops;
}

/**
 * Backpressure-aware operation queue.
 *
 * Accepts operations even under backpressure (queue building up).
 * Guarantees no operations are silently dropped—all submitted ops
 * are queued and eventually processed.
 */
export class BackpressureQueue {
  private queue: StressOperation[] = [];
  private processed: StressOperation[] = [];
  private processing = false;
  private processingDelay: number;

  constructor(processingDelayMs = 1) {
    this.processingDelay = processingDelayMs;
  }

  /**
   * Submit an operation. Never drops — always queues.
   */
  submit(op: StressOperation): void {
    this.queue.push(op);
  }

  /**
   * Returns current queue depth (unprocessed operations).
   */
  getQueueDepth(): number {
    return this.queue.length;
  }

  /**
   * Returns all operations that have been processed.
   */
  getProcessed(): StressOperation[] {
    return [...this.processed];
  }

  /**
   * Returns total operations submitted (queued + processed).
   */
  getTotalSubmitted(): number {
    return this.queue.length + this.processed.length;
  }

  /**
   * Returns true if there are operations waiting to be processed.
   */
  isUnderBackpressure(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Process a single operation from the queue.
   * Returns the processed operation or null if queue is empty.
   */
  processOne(): StressOperation | null {
    if (this.queue.length === 0) return null;
    const op = this.queue.shift()!;
    this.processed.push(op);
    return op;
  }

  /**
   * Process all remaining operations in the queue.
   * Returns the number of operations processed.
   */
  processAll(): number {
    let count = 0;
    while (this.queue.length > 0) {
      this.processOne();
      count++;
    }
    return count;
  }

  /**
   * Drain the queue up to `batchSize` operations.
   * Returns the operations that were processed.
   */
  processBatch(batchSize: number): StressOperation[] {
    const batch: StressOperation[] = [];
    const toProcess = Math.min(batchSize, this.queue.length);
    for (let i = 0; i < toProcess; i++) {
      const op = this.queue.shift()!;
      this.processed.push(op);
      batch.push(op);
    }
    return batch;
  }
}
