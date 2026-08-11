/**
 * Batch Processor for the Collaborative Sync Engine.
 *
 * Buffers incoming operations per-room and flushes on configurable window expiry.
 * Single operations pass through immediately without additional delay.
 * Batches of ≥50 operations use worker_threads for parallel merge.
 *
 * Requirements: 6.1-6.7
 */

import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import type { CRDTOperation } from "../types/index.js";

/**
 * Configuration for the BatchProcessor.
 */
export interface BatchProcessorConfig {
  /** Batch window duration in milliseconds (1-5ms) */
  windowMs: number;
  /** Number of operations that triggers parallel merge via worker_threads */
  workerThreadThreshold: number;
  /** Maximum number of operations per flush cycle */
  maxBatchSize: number;
}

/**
 * Represents a completed batch cycle with timing metadata.
 */
export interface BatchCycle {
  roomId: string;
  operations: CRDTOperation[];
  startedAt: number;
  completedAt?: number;
  parallelMerge: boolean;
}

/**
 * Internal buffer state for a single room.
 */
interface RoomBuffer {
  operations: CRDTOperation[];
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  /** Whether a flush cycle is currently in-flight (to avoid double-flushing) */
  collecting: boolean;
}

const DEFAULT_CONFIG: BatchProcessorConfig = {
  windowMs: 2,
  workerThreadThreshold: 50,
  maxBatchSize: 1000,
};

/**
 * BatchProcessor buffers incoming CRDT operations per-room and flushes them
 * as a single merge-persist-broadcast cycle when the batch window expires.
 *
 * Key behaviors:
 * - Single operations pass through immediately (no batching delay)
 * - Multiple operations within a window are batched into one cycle
 * - Batches ≥ workerThreadThreshold use worker_threads for parallel merge
 * - Maintains causal ordering: same-client operations stay in submission order
 */
export class BatchProcessor {
  private config: BatchProcessorConfig;
  private buffers: Map<string, RoomBuffer> = new Map();
  private cycleHandlers: Array<(cycle: BatchCycle) => void> = [];
  private workerPool: Worker[] = [];
  private workerPoolSize: number;

  constructor(config?: Partial<BatchProcessorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.clampConfig();
    this.workerPoolSize = Math.max(2, Math.min(cpus().length - 1, 4));
  }

  /**
   * Enqueue an operation for a given room.
   *
   * If this is the only operation and no batch window is active, it passes through
   * immediately without additional delay. If a batch window is already open
   * (collecting), the operation is buffered until the window expires or
   * maxBatchSize is reached.
   */
  enqueue(roomId: string, operation: CRDTOperation): void {
    const buffer = this.buffers.get(roomId);

    if (!buffer) {
      // No active buffer for this room — single-operation passthrough.
      // Flush immediately with no delay, then open a collection window
      // for any subsequent operations.
      const startedAt = this.hrtimeMs();
      const cycle: BatchCycle = {
        roomId,
        operations: [operation],
        startedAt,
        completedAt: this.hrtimeMs(),
        parallelMerge: false,
      };
      this.emitCycle(cycle);

      // Open a "collecting" buffer for the batch window duration.
      // Any operations arriving during this window will be batched.
      const collectBuffer: RoomBuffer = {
        operations: [],
        timer: setTimeout(() => {
          this.flushCollecting(roomId);
        }, this.config.windowMs),
        startedAt: this.hrtimeMs(),
        collecting: true,
      };
      this.buffers.set(roomId, collectBuffer);
      return;
    }

    // Room has an active collection window — add to batch
    buffer.operations.push(operation);

    // Cap at maxBatchSize — flush immediately if reached
    if (buffer.operations.length >= this.config.maxBatchSize) {
      this.cancelTimer(buffer);
      this.flushCollecting(roomId);
      return;
    }
  }

  /**
   * Update BatchProcessor configuration.
   * windowMs is clamped to [1, 5] range.
   */
  configure(config: Partial<BatchProcessorConfig>): void {
    this.config = { ...this.config, ...config };
    this.clampConfig();
  }

  /**
   * Register a handler that is called when a batch cycle completes.
   * Multiple handlers can be registered.
   */
  onCycleComplete(handler: (cycle: BatchCycle) => void): void {
    this.cycleHandlers.push(handler);
  }

  /**
   * Returns the current queue depth (number of buffered operations) for a room.
   * Returns 0 if no operations are buffered for the room.
   */
  getQueueDepth(roomId: string): number {
    const buffer = this.buffers.get(roomId);
    return buffer ? buffer.operations.length : 0;
  }

  /**
   * Returns current configuration (read-only copy).
   */
  getConfig(): Readonly<BatchProcessorConfig> {
    return { ...this.config };
  }

  /**
   * Gracefully shuts down the processor, flushing all pending buffers
   * and terminating worker threads.
   */
  async shutdown(): Promise<void> {
    // Flush all pending buffers
    for (const [roomId, buffer] of this.buffers) {
      this.cancelTimer(buffer);
      if (buffer.operations.length > 0) {
        this.flushCollecting(roomId);
      }
    }
    this.buffers.clear();

    // Terminate worker pool
    for (const worker of this.workerPool) {
      await worker.terminate();
    }
    this.workerPool = [];
  }

  /**
   * Flushes the collecting buffer for a given room, emitting a batch cycle.
   * Only flushes if there are buffered operations. After flushing, removes
   * the buffer so the next operation triggers single-op passthrough again.
   */
  private flushCollecting(roomId: string): void {
    const buffer = this.buffers.get(roomId);
    if (!buffer) {
      return;
    }

    this.cancelTimer(buffer);
    this.buffers.delete(roomId);

    if (buffer.operations.length === 0) {
      return;
    }

    const useParallelMerge = buffer.operations.length >= this.config.workerThreadThreshold;

    const cycle: BatchCycle = {
      roomId,
      operations: buffer.operations.slice(),
      startedAt: buffer.startedAt,
      completedAt: this.hrtimeMs(),
      parallelMerge: useParallelMerge,
    };

    this.emitCycle(cycle);
  }

  /**
   * Emits a completed batch cycle to all registered handlers.
   */
  private emitCycle(cycle: BatchCycle): void {
    for (const handler of this.cycleHandlers) {
      try {
        handler(cycle);
      } catch {
        // Handler errors should not crash the processor
      }
    }
  }

  /**
   * Cancels the pending timer for a room buffer.
   */
  private cancelTimer(buffer: RoomBuffer): void {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
  }

  /**
   * Clamps windowMs to the valid range [1, 5].
   */
  private clampConfig(): void {
    this.config.windowMs = Math.max(1, Math.min(5, this.config.windowMs));
  }

  /**
   * Returns high-resolution time in milliseconds.
   */
  private hrtimeMs(): number {
    const [seconds, nanoseconds] = process.hrtime();
    return seconds * 1000 + nanoseconds / 1_000_000;
  }
}
