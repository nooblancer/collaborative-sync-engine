/**
 * Unit tests for FileOperationQueue.
 * Requirements: 4.3, 4.4, 4.5, 4.7
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "fs/promises";
import { FileOperationQueue } from "./operation-queue.js";
import type { CRDTOperation } from "../types/index.js";

function createOp(id: string, seq: number): CRDTOperation {
  return {
    id,
    sessionId: "session-1",
    replicaId: "replica-1",
    type: "update",
    itemId: `item-${seq}`,
    payload: { name: `Item ${seq}` },
    timestamp: { wallTime: 1000 + seq, logical: seq, nodeId: "node-1" },
    version: seq,
  };
}

const TEST_STORAGE_PATH = "./data/test-queue-unit.json";

describe("FileOperationQueue", () => {
  let queue: FileOperationQueue;

  beforeEach(() => {
    queue = new FileOperationQueue("test-unit", TEST_STORAGE_PATH);
  });

  afterEach(async () => {
    try {
      await rm(TEST_STORAGE_PATH);
    } catch {
      // ignore if file doesn't exist
    }
  });

  describe("enqueue", () => {
    it("should add an operation to the queue", () => {
      const op = createOp("op-1", 1);
      queue.enqueue(op);
      expect(queue.size()).toBe(1);
    });

    it("should throw when queue is at max capacity", () => {
      for (let i = 0; i < 10_000; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      expect(() => queue.enqueue(createOp("overflow", 10_001))).toThrow(
        /queue is full/i
      );
    });
  });

  describe("dequeue", () => {
    it("should remove the operation with the given ID", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));
      queue.dequeue("op-1");
      expect(queue.size()).toBe(1);
      expect(queue.peek()?.id).toBe("op-2");
    });

    it("should be a no-op if the operation ID does not exist", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.dequeue("nonexistent");
      expect(queue.size()).toBe(1);
    });
  });

  describe("peek", () => {
    it("should return the first (oldest) operation without removing it", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));
      const peeked = queue.peek();
      expect(peeked?.id).toBe("op-1");
      expect(queue.size()).toBe(2);
    });

    it("should return null if the queue is empty", () => {
      expect(queue.peek()).toBeNull();
    });
  });

  describe("flush", () => {
    it("should return all operations in FIFO order and clear the queue", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));
      queue.enqueue(createOp("op-3", 3));
      const flushed = queue.flush();
      expect(flushed).toHaveLength(3);
      expect(flushed[0].id).toBe("op-1");
      expect(flushed[1].id).toBe("op-2");
      expect(flushed[2].id).toBe("op-3");
      expect(queue.size()).toBe(0);
    });

    it("should return empty array when queue is empty", () => {
      expect(queue.flush()).toEqual([]);
    });
  });

  describe("persist and restore", () => {
    it("should persist queue to file and restore it", async () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));
      await queue.persist();

      const newQueue = new FileOperationQueue("test-unit", TEST_STORAGE_PATH);
      const restored = await newQueue.restore();
      expect(restored).toHaveLength(2);
      expect(restored[0].id).toBe("op-1");
      expect(restored[1].id).toBe("op-2");
      expect(newQueue.size()).toBe(2);
    });

    it("should return empty array when file does not exist", async () => {
      const freshQueue = new FileOperationQueue(
        "nonexistent",
        "./data/nonexistent-queue.json"
      );
      const restored = await freshQueue.restore();
      expect(restored).toEqual([]);
      expect(freshQueue.size()).toBe(0);
    });
  });

  describe("maxCapacity", () => {
    it("should return 10000", () => {
      expect(queue.maxCapacity()).toBe(10_000);
    });
  });

  describe("FIFO ordering", () => {
    it("should maintain generation order across enqueue operations", () => {
      for (let i = 0; i < 5; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      for (let i = 0; i < 5; i++) {
        expect(queue.peek()?.id).toBe(`op-${i}`);
        queue.dequeue(`op-${i}`);
      }
    });
  });

  describe("ACK-based operation removal (Requirement 4.8)", () => {
    it("should remove exactly the acknowledged operation and leave all others unchanged", () => {
      const ops = [createOp("op-a", 1), createOp("op-b", 2), createOp("op-c", 3), createOp("op-d", 4), createOp("op-e", 5)];
      ops.forEach((op) => queue.enqueue(op));

      // ACK for "op-c" — remove from the middle
      queue.dequeue("op-c");

      expect(queue.size()).toBe(4);
      const remaining = queue.flush();
      expect(remaining.map((op) => op.id)).toEqual(["op-a", "op-b", "op-d", "op-e"]);
      // Verify full operation data is preserved
      expect(remaining[0]).toEqual(ops[0]);
      expect(remaining[1]).toEqual(ops[1]);
      expect(remaining[2]).toEqual(ops[3]);
      expect(remaining[3]).toEqual(ops[4]);
    });

    it("should handle ACK for the first operation in the queue", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));
      queue.enqueue(createOp("op-3", 3));

      queue.dequeue("op-1");

      expect(queue.size()).toBe(2);
      expect(queue.peek()?.id).toBe("op-2");
      const remaining = queue.flush();
      expect(remaining.map((op) => op.id)).toEqual(["op-2", "op-3"]);
    });

    it("should handle ACK for the last operation in the queue", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));
      queue.enqueue(createOp("op-3", 3));

      queue.dequeue("op-3");

      expect(queue.size()).toBe(2);
      const remaining = queue.flush();
      expect(remaining.map((op) => op.id)).toEqual(["op-1", "op-2"]);
    });

    it("should be a no-op when acknowledging a non-existent operation ID", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));

      queue.dequeue("op-nonexistent");

      expect(queue.size()).toBe(2);
      const remaining = queue.flush();
      expect(remaining.map((op) => op.id)).toEqual(["op-1", "op-2"]);
    });

    it("should handle multiple sequential ACKs correctly", () => {
      queue.enqueue(createOp("op-1", 1));
      queue.enqueue(createOp("op-2", 2));
      queue.enqueue(createOp("op-3", 3));
      queue.enqueue(createOp("op-4", 4));

      // ACK arrives for op-2, then op-4 (out of enqueue order)
      queue.dequeue("op-2");
      queue.dequeue("op-4");

      expect(queue.size()).toBe(2);
      const remaining = queue.flush();
      expect(remaining.map((op) => op.id)).toEqual(["op-1", "op-3"]);
    });
  });

  describe("getReconnectionBatch (Requirements 5.1, 5.8)", () => {
    it("should return all operations when queue has fewer than 1000", () => {
      for (let i = 0; i < 5; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      const { operations, discardedCount } = queue.getReconnectionBatch();
      expect(operations).toHaveLength(5);
      expect(discardedCount).toBe(0);
      expect(operations[0].id).toBe("op-0");
      expect(operations[4].id).toBe("op-4");
    });

    it("should return all operations when queue has exactly 1000", () => {
      for (let i = 0; i < 1000; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      const { operations, discardedCount } = queue.getReconnectionBatch();
      expect(operations).toHaveLength(1000);
      expect(discardedCount).toBe(0);
      expect(operations[0].id).toBe("op-0");
      expect(operations[999].id).toBe("op-999");
    });

    it("should return only the most recent 1000 operations when queue exceeds 1000", () => {
      for (let i = 0; i < 1500; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      const { operations, discardedCount } = queue.getReconnectionBatch();
      expect(operations).toHaveLength(1000);
      expect(discardedCount).toBe(500);
      // Most recent 1000 = operations 500..1499
      expect(operations[0].id).toBe("op-500");
      expect(operations[999].id).toBe("op-1499");
    });

    it("should preserve generation order in the returned batch", () => {
      for (let i = 0; i < 2000; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      const { operations } = queue.getReconnectionBatch();
      for (let i = 1; i < operations.length; i++) {
        expect(operations[i].timestamp.wallTime).toBeGreaterThan(
          operations[i - 1].timestamp.wallTime
        );
      }
    });

    it("should return empty operations and zero discarded when queue is empty", () => {
      const { operations, discardedCount } = queue.getReconnectionBatch();
      expect(operations).toHaveLength(0);
      expect(discardedCount).toBe(0);
    });

    it("should not mutate the original queue", () => {
      for (let i = 0; i < 1500; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      queue.getReconnectionBatch();
      expect(queue.size()).toBe(1500);
    });

    it("should report correct discardedCount at max capacity", () => {
      for (let i = 0; i < 10_000; i++) {
        queue.enqueue(createOp(`op-${i}`, i));
      }
      const { operations, discardedCount } = queue.getReconnectionBatch();
      expect(operations).toHaveLength(1000);
      expect(discardedCount).toBe(9000);
      // Most recent 1000 = operations 9000..9999
      expect(operations[0].id).toBe("op-9000");
      expect(operations[999].id).toBe("op-9999");
    });
  });
});
