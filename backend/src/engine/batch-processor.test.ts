/**
 * Unit tests for the BatchProcessor.
 *
 * Requirements: 6.1-6.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BatchProcessor } from "./batch-processor.js";
import type { CRDTOperation } from "../types/index.js";
import type { BatchCycle } from "./batch-processor.js";

function makeOperation(overrides: Partial<CRDTOperation> = {}): CRDTOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2, 10)}`,
    sessionId: "session-1",
    replicaId: "replica-a",
    type: "add",
    itemId: `item-${Math.random().toString(36).slice(2, 8)}`,
    payload: { name: "Widget" },
    timestamp: { wallTime: Date.now(), logical: 0, nodeId: "node-a" },
    version: 0,
    ...overrides,
  };
}

describe("BatchProcessor", () => {
  let processor: BatchProcessor;

  beforeEach(() => {
    processor = new BatchProcessor({ windowMs: 2, workerThreadThreshold: 50, maxBatchSize: 1000 });
  });

  afterEach(async () => {
    await processor.shutdown();
  });

  describe("enqueue", () => {
    it("should immediately flush a single operation (no additional delay)", () => {
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      const op = makeOperation();
      processor.enqueue("room-1", op);

      // Single-operation passthrough: cycle should fire synchronously
      expect(cycles).toHaveLength(1);
      expect(cycles[0].roomId).toBe("room-1");
      expect(cycles[0].operations).toHaveLength(1);
      expect(cycles[0].operations[0]).toBe(op);
    });

    it("should buffer multiple operations within the batch window", async () => {
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      const op1 = makeOperation();
      const op2 = makeOperation();
      const op3 = makeOperation();

      // First op triggers immediate passthrough
      processor.enqueue("room-1", op1);
      expect(cycles).toHaveLength(1);

      // Second and third ops arrive during the collection window
      processor.enqueue("room-1", op2);
      processor.enqueue("room-1", op3);

      // Not yet flushed — waiting for window to expire
      expect(cycles).toHaveLength(1);

      // Wait for the batch window to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(2);
      expect(cycles[1].operations[0]).toBe(op2);
      expect(cycles[1].operations[1]).toBe(op3);
    });

    it("should batch multiple rapid operations into a single cycle", async () => {
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      // First op is passthrough
      processor.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Rapidly add 5 more operations (within the collection window)
      for (let i = 0; i < 5; i++) {
        processor.enqueue("room-1", makeOperation());
      }

      // Still just 1 cycle (the passthrough) — batch not yet flushed
      expect(cycles).toHaveLength(1);

      // Wait for batch window to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should be 2 cycles: 1 passthrough + 1 batched with all 5 ops
      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(5);
    });

    it("should isolate buffers per room", async () => {
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      // Both rooms get single-op passthrough
      processor.enqueue("room-1", makeOperation());
      processor.enqueue("room-2", makeOperation());

      expect(cycles).toHaveLength(2);
      expect(cycles[0].roomId).toBe("room-1");
      expect(cycles[1].roomId).toBe("room-2");
    });

    it("should flush immediately when maxBatchSize is reached", () => {
      const processor = new BatchProcessor({ windowMs: 5, workerThreadThreshold: 50, maxBatchSize: 3 });
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      // First op — passthrough
      processor.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Add ops to reach maxBatchSize (3) within collection window
      processor.enqueue("room-1", makeOperation());
      processor.enqueue("room-1", makeOperation());
      processor.enqueue("room-1", makeOperation());

      // Should flush at maxBatchSize without waiting for window
      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(3);
    });
  });

  describe("configure", () => {
    it("should update configuration", () => {
      processor.configure({ windowMs: 4 });
      expect(processor.getConfig().windowMs).toBe(4);
    });

    it("should clamp windowMs to [1, 5] range", () => {
      processor.configure({ windowMs: 0 });
      expect(processor.getConfig().windowMs).toBe(1);

      processor.configure({ windowMs: 10 });
      expect(processor.getConfig().windowMs).toBe(5);
    });

    it("should allow partial configuration updates", () => {
      processor.configure({ workerThreadThreshold: 100 });
      const config = processor.getConfig();
      expect(config.workerThreadThreshold).toBe(100);
      expect(config.windowMs).toBe(2); // unchanged
    });
  });

  describe("getQueueDepth", () => {
    it("should return 0 for rooms with no buffered operations", () => {
      expect(processor.getQueueDepth("room-1")).toBe(0);
    });

    it("should return 0 after single-op passthrough (buffer cleared)", () => {
      processor.onCycleComplete(() => {}); // no-op handler
      processor.enqueue("room-1", makeOperation());
      expect(processor.getQueueDepth("room-1")).toBe(0);
    });

    it("should return correct count for buffered operations", () => {
      // First op is passthrough (buffer created with 0 ops in collecting state)
      processor.enqueue("room-1", makeOperation());
      // These are buffered in the collection window
      processor.enqueue("room-1", makeOperation());
      processor.enqueue("room-1", makeOperation());

      expect(processor.getQueueDepth("room-1")).toBe(2);
    });
  });

  describe("onCycleComplete", () => {
    it("should support multiple handlers", () => {
      let handler1Count = 0;
      let handler2Count = 0;

      processor.onCycleComplete(() => { handler1Count++; });
      processor.onCycleComplete(() => { handler2Count++; });

      processor.enqueue("room-1", makeOperation());

      expect(handler1Count).toBe(1);
      expect(handler2Count).toBe(1);
    });

    it("should not crash if a handler throws", () => {
      processor.onCycleComplete(() => {
        throw new Error("handler error");
      });

      // Should not throw
      expect(() => processor.enqueue("room-1", makeOperation())).not.toThrow();
    });

    it("should include timing metadata in cycle", () => {
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      processor.enqueue("room-1", makeOperation());

      expect(cycles[0].startedAt).toBeGreaterThan(0);
      expect(cycles[0].completedAt).toBeGreaterThan(0);
      expect(cycles[0].completedAt!).toBeGreaterThanOrEqual(cycles[0].startedAt);
    });
  });

  describe("worker_threads threshold", () => {
    it("should mark parallelMerge=false for small batches", () => {
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      processor.enqueue("room-1", makeOperation());

      expect(cycles[0].parallelMerge).toBe(false);
    });

    it("should mark parallelMerge=true when batch ≥ threshold", async () => {
      const processor = new BatchProcessor({
        windowMs: 5,
        workerThreadThreshold: 5,
        maxBatchSize: 100,
      });
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      // First op — passthrough
      processor.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);
      expect(cycles[0].parallelMerge).toBe(false);

      // Add 10 more (meets threshold of 5) within collection window
      for (let i = 0; i < 10; i++) {
        processor.enqueue("room-1", makeOperation());
      }

      // Wait for batch window to flush
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The batched cycle should trigger parallel merge flag
      expect(cycles).toHaveLength(2);
      expect(cycles[1].parallelMerge).toBe(true);
      expect(cycles[1].operations.length).toBe(10);
    });
  });

  describe("causal ordering", () => {
    it("should maintain submission order for same-client operations within a batch", async () => {
      const processor = new BatchProcessor({ windowMs: 5, workerThreadThreshold: 50, maxBatchSize: 100 });
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      // First op — passthrough
      processor.enqueue("room-1", makeOperation({ replicaId: "client-a" }));
      expect(cycles).toHaveLength(1);

      // Buffer a sequence from same client within collection window
      const ops = Array.from({ length: 5 }, (_, i) =>
        makeOperation({
          replicaId: "client-a",
          timestamp: { wallTime: 1000 + i, logical: 0, nodeId: "node-a" },
        })
      );

      for (const op of ops) {
        processor.enqueue("room-1", op);
      }

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(cycles).toHaveLength(2);
      const batchedOps = cycles[1].operations;
      expect(batchedOps).toHaveLength(5);

      // Verify ordering preserved (same order as submitted)
      for (let i = 0; i < batchedOps.length - 1; i++) {
        expect(batchedOps[i].timestamp.wallTime).toBeLessThanOrEqual(
          batchedOps[i + 1].timestamp.wallTime
        );
      }
    });
  });

  describe("shutdown", () => {
    it("should flush pending buffers on shutdown", async () => {
      const cycles: BatchCycle[] = [];
      processor.onCycleComplete((cycle) => cycles.push(cycle));

      // First op — passthrough
      processor.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer some ops in collection window
      processor.enqueue("room-1", makeOperation());
      processor.enqueue("room-1", makeOperation());

      // Not yet flushed
      expect(cycles).toHaveLength(1);

      await processor.shutdown();

      // Shutdown should have flushed the buffered ops
      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(2);
    });
  });

  /**
   * Validates: Requirements 6.4
   * Test configurable window timing — operations are flushed after the configured window.
   */
  describe("configurable window timing", () => {
    it("should flush after 1ms window", async () => {
      const proc = new BatchProcessor({ windowMs: 1, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer ops in collection window
      proc.enqueue("room-1", makeOperation());
      proc.enqueue("room-1", makeOperation());

      // Not flushed yet (within 1ms window)
      expect(cycles).toHaveLength(1);

      // Wait slightly longer than 1ms to allow flush
      await new Promise((resolve) => setTimeout(resolve, 15));

      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(2);
      await proc.shutdown();
    });

    it("should flush after 3ms window", async () => {
      const proc = new BatchProcessor({ windowMs: 3, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer ops
      proc.enqueue("room-1", makeOperation());
      proc.enqueue("room-1", makeOperation());
      proc.enqueue("room-1", makeOperation());

      // Should not flush before the window expires
      expect(cycles).toHaveLength(1);

      // Wait longer than 3ms to allow flush
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(3);
      await proc.shutdown();
    });

    it("should flush after 5ms window", async () => {
      const proc = new BatchProcessor({ windowMs: 5, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer ops
      proc.enqueue("room-1", makeOperation());
      proc.enqueue("room-1", makeOperation());

      // Should not be flushed yet (within 5ms)
      expect(cycles).toHaveLength(1);

      // Wait longer than 5ms to ensure flush
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(2);
      await proc.shutdown();
    });

    it("should not flush before the configured window expires", async () => {
      const proc = new BatchProcessor({ windowMs: 5, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer ops — these go into the collection window
      proc.enqueue("room-1", makeOperation());
      proc.enqueue("room-1", makeOperation());

      // Immediately check — the timer hasn't fired yet
      expect(cycles).toHaveLength(1);

      // Now wait enough for the window to expire (5ms window + generous margin)
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(cycles).toHaveLength(2);
      await proc.shutdown();
    });
  });

  /**
   * Validates: Requirements 6.6
   * Test worker_threads threshold boundary at the default 50 operations.
   */
  describe("worker_threads threshold boundary (50 ops)", () => {
    it("should NOT trigger parallelMerge for 49 ops (below threshold)", async () => {
      const proc = new BatchProcessor({ windowMs: 5, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);
      expect(cycles[0].parallelMerge).toBe(false);

      // Buffer exactly 49 ops (below threshold)
      for (let i = 0; i < 49; i++) {
        proc.enqueue("room-1", makeOperation());
      }

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(49);
      expect(cycles[1].parallelMerge).toBe(false);
      await proc.shutdown();
    });

    it("should trigger parallelMerge for exactly 50 ops (at threshold)", async () => {
      const proc = new BatchProcessor({ windowMs: 5, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer exactly 50 ops (at threshold)
      for (let i = 0; i < 50; i++) {
        proc.enqueue("room-1", makeOperation());
      }

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(50);
      expect(cycles[1].parallelMerge).toBe(true);
      await proc.shutdown();
    });

    it("should trigger parallelMerge for 100 ops (well above threshold)", async () => {
      const proc = new BatchProcessor({ windowMs: 5, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer 100 ops
      for (let i = 0; i < 100; i++) {
        proc.enqueue("room-1", makeOperation());
      }

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cycles).toHaveLength(2);
      expect(cycles[1].operations).toHaveLength(100);
      expect(cycles[1].parallelMerge).toBe(true);
      await proc.shutdown();
    });
  });

  /**
   * Validates: Requirements 6.5, 6.6
   * P99 latency constraint: batch processing should complete in < 50ms per operation.
   */
  describe("P99 latency constraint", () => {
    it("should process a batch of 100 operations within 50ms total cycle time", async () => {
      const proc = new BatchProcessor({ windowMs: 2, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Passthrough first op
      proc.enqueue("room-1", makeOperation());
      expect(cycles).toHaveLength(1);

      // Buffer 100 ops to trigger a batched cycle
      for (let i = 0; i < 100; i++) {
        proc.enqueue("room-1", makeOperation());
      }

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cycles).toHaveLength(2);
      const batchCycle = cycles[1];

      // Verify the batch cycle completed within 50ms
      const cycleDurationMs = batchCycle.completedAt! - batchCycle.startedAt;
      expect(cycleDurationMs).toBeLessThan(50);
      await proc.shutdown();
    });

    it("should process single-operation passthrough within 50ms", () => {
      const proc = new BatchProcessor({ windowMs: 2, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      proc.enqueue("room-1", makeOperation());

      expect(cycles).toHaveLength(1);
      const cycleDurationMs = cycles[0].completedAt! - cycles[0].startedAt;
      expect(cycleDurationMs).toBeLessThan(50);
    });

    it("should maintain sub-50ms per-operation latency across multiple batches", async () => {
      const proc = new BatchProcessor({ windowMs: 1, workerThreadThreshold: 50, maxBatchSize: 1000 });
      const cycles: BatchCycle[] = [];
      proc.onCycleComplete((cycle) => cycles.push(cycle));

      // Run 5 batch cycles
      for (let batch = 0; batch < 5; batch++) {
        // Passthrough triggers a new room-buffer cycle
        proc.enqueue(`room-${batch}`, makeOperation());

        // Buffer 20 ops
        for (let i = 0; i < 20; i++) {
          proc.enqueue(`room-${batch}`, makeOperation());
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 30));

      // All batched cycles should complete within 50ms each
      const batchedCycles = cycles.filter((c) => c.operations.length > 1);
      for (const cycle of batchedCycles) {
        const cycleDurationMs = cycle.completedAt! - cycle.startedAt;
        expect(cycleDurationMs).toBeLessThan(50);
      }
      await proc.shutdown();
    });
  });
});
