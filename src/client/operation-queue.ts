/**
 * Operation Queue with file-based JSON persistence.
 * Implements FIFO ordering with max capacity of 10,000 operations.
 * Requirements: 4.3, 4.4, 4.5, 4.7
 */

import { mkdir, writeFile, readFile } from "fs/promises";
import { dirname } from "path";
import type { CRDTOperation } from "../types/index.js";

/** Maximum number of operations the queue can hold. */
const MAX_CAPACITY = 10_000;

/**
 * OperationQueue interface as defined in the design document.
 */
export interface OperationQueue {
  enqueue(operation: CRDTOperation): void;
  dequeue(operationId: string): void;
  peek(): CRDTOperation | null;
  size(): number;
  flush(): CRDTOperation[];
  persist(): Promise<void>;
  restore(): Promise<CRDTOperation[]>;
  maxCapacity(): number;
}

/**
 * FileOperationQueue implements OperationQueue with file-based JSON persistence.
 *
 * - FIFO ordering: operations are enqueued at the tail and dequeued/peeked from the head.
 * - Max capacity: rejects new operations when the queue holds 10,000 items.
 * - Persistence: writes/reads the queue to/from a JSON file on disk.
 */
export class FileOperationQueue implements OperationQueue {
  private queue: CRDTOperation[] = [];
  private readonly storagePath: string;

  constructor(replicaId: string, storagePath?: string) {
    this.storagePath =
      storagePath ?? `./data/queue-${replicaId}.json`;
  }

  /**
   * Appends an operation to the end of the queue.
   * Throws if the queue is at max capacity (10,000).
   */
  enqueue(operation: CRDTOperation): void {
    if (this.queue.length >= MAX_CAPACITY) {
      throw new Error(
        "Operation queue is full. Maximum capacity of 10,000 operations reached. Restore connectivity to continue."
      );
    }
    this.queue.push(operation);
  }

  /**
   * Removes the operation with the given ID from the queue.
   * No-op if the operation is not found.
   */
  dequeue(operationId: string): void {
    const index = this.queue.findIndex((op) => op.id === operationId);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  /**
   * Returns the first (oldest) operation without removing it, or null if empty.
   */
  peek(): CRDTOperation | null {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  /**
   * Returns the current number of operations in the queue.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Returns all operations in FIFO order and clears the queue.
   */
  flush(): CRDTOperation[] {
    const operations = [...this.queue];
    this.queue = [];
    return operations;
  }

  /**
   * Persists the current queue state to a JSON file.
   */
  async persist(): Promise<void> {
    const dir = dirname(this.storagePath);
    await mkdir(dir, { recursive: true });
    const data = JSON.stringify(this.queue, null, 2);
    await writeFile(this.storagePath, data, "utf-8");
  }

  /**
   * Restores the queue from the JSON file on disk.
   * Returns the restored operations. If the file does not exist, returns an empty array.
   */
  async restore(): Promise<CRDTOperation[]> {
    try {
      const data = await readFile(this.storagePath, "utf-8");
      const operations: CRDTOperation[] = JSON.parse(data);
      this.queue = operations;
      return [...this.queue];
    } catch (err: unknown) {
      // If file doesn't exist or is unreadable, start with an empty queue
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        this.queue = [];
        return [];
      }
      throw err;
    }
  }

  /**
   * Returns the maximum capacity of the queue (10,000).
   */
  maxCapacity(): number {
    return MAX_CAPACITY;
  }

  /**
   * Returns a batch of operations for reconnection transmission.
   *
   * If the queue has <= 1000 operations, returns all of them in generation order.
   * If the queue has > 1000 operations, returns only the most recent 1000 operations
   * (the last 1000 in the queue array since FIFO = generation order), discarding older ones.
   *
   * Requirements: 5.1, 5.8
   */
  getReconnectionBatch(): { operations: CRDTOperation[]; discardedCount: number } {
    const RECONNECTION_CAP = 1000;

    if (this.queue.length <= RECONNECTION_CAP) {
      return { operations: [...this.queue], discardedCount: 0 };
    }

    const discardedCount = this.queue.length - RECONNECTION_CAP;
    const operations = this.queue.slice(discardedCount);
    return { operations, discardedCount };
  }
}
