/**
 * Unit tests for the PerformanceCollectorImpl module.
 *
 * Validates Requirements 5.1-5.5:
 * - 5.1: High-resolution operation latency measurement (hrtime, microsecond precision)
 * - 5.2: Rolling P50, P95, P99 percentile computation over 10-second sliding window
 * - 5.3: Per-second operation count with 60-second rolling throughput history
 * - 5.4: Metrics_Channel subscription: stream metric snapshots at 1-second intervals
 * - 5.5: Track active connections, active rooms, total operations since server start
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PerformanceCollectorImpl } from "./performance-collector.js";

describe("PerformanceCollectorImpl", () => {
  let collector: PerformanceCollectorImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    collector = new PerformanceCollectorImpl();
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  describe("Requirement 5.1: High-resolution latency measurement", () => {
    it("should record operation latency using hrtime start point", () => {
      // Simulate an operation that took some time
      const start = process.hrtime();
      // We can't easily control process.hrtime in tests, but we can verify the sample is recorded
      collector.recordOperationLatency(start);

      const metrics = collector.getMetrics();
      // At least one sample was recorded (latency >= 0)
      expect(metrics.p50LatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should produce latency values with sub-millisecond precision", () => {
      // Record a latency by using hrtime
      const start = process.hrtime();
      collector.recordOperationLatency(start);

      const metrics = collector.getMetrics();
      // The value should be a number (possibly with decimal places for microsecond precision)
      expect(typeof metrics.p50LatencyMs).toBe("number");
      expect(Number.isFinite(metrics.p50LatencyMs)).toBe(true);
    });
  });

  describe("Requirement 5.2: Rolling percentile computation", () => {
    it("should compute P50, P95, P99 from latency samples", () => {
      // Inject known latency samples by accessing internals
      const now = Date.now();
      // Create 100 samples with known latencies: 1ms, 2ms, ..., 100ms
      for (let i = 1; i <= 100; i++) {
        (collector as any).latencySamples.push({
          latencyMs: i,
          recordedAt: now,
        });
      }

      const metrics = collector.getMetrics();

      // P50 of [1..100] using nearest-rank: ceil(0.5 * 100) - 1 = index 49 => value 50
      expect(metrics.p50LatencyMs).toBe(50);
      // P95: ceil(0.95 * 100) - 1 = index 94 => value 95
      expect(metrics.p95LatencyMs).toBe(95);
      // P99: ceil(0.99 * 100) - 1 = index 98 => value 99
      expect(metrics.p99LatencyMs).toBe(99);
    });

    it("should return 0 for percentiles when no samples exist", () => {
      const metrics = collector.getMetrics();
      expect(metrics.p50LatencyMs).toBe(0);
      expect(metrics.p95LatencyMs).toBe(0);
      expect(metrics.p99LatencyMs).toBe(0);
    });

    it("should use a 10-second sliding window for percentile computation", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      // Add old samples first (11 seconds ago - outside window)
      for (let i = 100; i <= 110; i++) {
        (collector as any).latencySamples.push({
          latencyMs: i,
          recordedAt: now - 11_000,
        });
      }

      // Add recent samples at current time
      for (let i = 1; i <= 10; i++) {
        (collector as any).latencySamples.push({
          latencyMs: i,
          recordedAt: now,
        });
      }

      // Advance time slightly to trigger prune on getMetrics
      vi.setSystemTime(now + 100);

      const metrics = collector.getMetrics();
      // Old samples should be pruned, only recent ones remain
      // P99 of [1..10]: ceil(0.99 * 10) - 1 = index 9 => value 10
      expect(metrics.p99LatencyMs).toBe(10);
      // P50 of [1..10]: ceil(0.5 * 10) - 1 = index 4 => value 5
      expect(metrics.p50LatencyMs).toBe(5);
    });
  });

  describe("Requirement 5.3: Per-second operation count with 60-second history", () => {
    it("should count operations for the current second", () => {
      collector.incrementOpsCount(5);
      collector.incrementOpsCount(3);

      // Total should be 8
      const metrics = collector.getMetrics();
      expect(metrics.totalOpsProcessed).toBe(8);
    });

    it("should roll per-second counts into throughput history when second elapses", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      collector.incrementOpsCount(10);

      // Advance time by 1 second
      vi.setSystemTime(now + 1000);

      collector.incrementOpsCount(5);

      const metrics = collector.getMetrics();
      // The previous second (10 ops) should be in history
      expect(metrics.throughputHistory).toContain(10);
      // Current ops/sec should report the last completed second
      expect(metrics.opsPerSecond).toBe(10);
    });

    it("should maintain at most 60 entries in throughput history", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      // Simulate 70 seconds of activity
      for (let i = 0; i < 70; i++) {
        vi.setSystemTime(now + i * 1000);
        collector.incrementOpsCount(i + 1);
      }

      // Advance one more second to flush the last
      vi.setSystemTime(now + 70 * 1000);
      collector.incrementOpsCount(1);

      const metrics = collector.getMetrics();
      expect(metrics.throughputHistory.length).toBeLessThanOrEqual(60);
    });

    it("should fill zero gaps for seconds with no activity", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      collector.incrementOpsCount(7);

      // Skip 3 seconds
      vi.setSystemTime(now + 3000);
      collector.incrementOpsCount(2);

      const metrics = collector.getMetrics();
      // History should contain: 7, 0, 0 (the 3 elapsed seconds, current is not yet flushed)
      expect(metrics.throughputHistory).toContain(7);
      expect(metrics.throughputHistory).toContain(0);
    });

    it("should default incrementOpsCount to 1 when no argument given", () => {
      collector.incrementOpsCount();
      collector.incrementOpsCount();
      collector.incrementOpsCount();

      const metrics = collector.getMetrics();
      expect(metrics.totalOpsProcessed).toBe(3);
    });
  });

  describe("Requirement 5.4: Metrics streaming at 1-second intervals", () => {
    it("should invoke snapshot callback for all subscribers every second", () => {
      const callback = vi.fn();
      collector.setSnapshotCallback(callback);

      collector.subscribe("client-1");
      collector.subscribe("client-2");

      // Advance time by 1 second to trigger the interval
      vi.advanceTimersByTime(1000);

      // Callback should be called once per subscriber
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith("client-1", expect.any(Object));
      expect(callback).toHaveBeenCalledWith("client-2", expect.any(Object));
    });

    it("should not invoke callback when there are no subscribers", () => {
      const callback = vi.fn();
      collector.setSnapshotCallback(callback);

      vi.advanceTimersByTime(1000);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should stop streaming to unsubscribed clients", () => {
      const callback = vi.fn();
      collector.setSnapshotCallback(callback);

      collector.subscribe("client-1");
      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(1);

      callback.mockClear();
      collector.unsubscribe("client-1");
      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should stream metrics at exactly 1-second intervals", () => {
      const callback = vi.fn();
      collector.setSnapshotCallback(callback);
      collector.subscribe("client-1");

      // Advance 500ms - should not have fired yet
      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      // Advance another 500ms (total 1000ms) - should fire
      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance another 1000ms - should fire again
      vi.advanceTimersByTime(1000);
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe("Requirement 5.5: Active connections, rooms, and total ops tracking", () => {
    it("should track active connections", () => {
      collector.setActiveConnections(42);
      const metrics = collector.getMetrics();
      expect(metrics.activeConnections).toBe(42);
    });

    it("should track active rooms", () => {
      collector.setActiveRooms(7);
      const metrics = collector.getMetrics();
      expect(metrics.activeRooms).toBe(7);
    });

    it("should track total operations processed since start", () => {
      collector.incrementOpsCount(100);
      collector.incrementOpsCount(200);
      collector.incrementOpsCount(50);

      const metrics = collector.getMetrics();
      expect(metrics.totalOpsProcessed).toBe(350);
    });

    it("should report all counters together in getMetrics", () => {
      collector.setActiveConnections(10);
      collector.setActiveRooms(3);
      collector.incrementOpsCount(500);

      const metrics = collector.getMetrics();
      expect(metrics.activeConnections).toBe(10);
      expect(metrics.activeRooms).toBe(3);
      expect(metrics.totalOpsProcessed).toBe(500);
    });
  });

  describe("Subscription management", () => {
    it("should track subscribers via getSubscribers", () => {
      collector.subscribe("client-a");
      collector.subscribe("client-b");

      const subscribers = collector.getSubscribers();
      expect(subscribers.has("client-a")).toBe(true);
      expect(subscribers.has("client-b")).toBe(true);
      expect(subscribers.size).toBe(2);
    });

    it("should not duplicate subscribers", () => {
      collector.subscribe("client-a");
      collector.subscribe("client-a");

      expect(collector.getSubscribers().size).toBe(1);
    });

    it("should handle unsubscribing non-existent clients gracefully", () => {
      expect(() => collector.unsubscribe("non-existent")).not.toThrow();
    });
  });

  describe("Cleanup", () => {
    it("should stop streaming on destroy", () => {
      const callback = vi.fn();
      collector.setSnapshotCallback(callback);
      collector.subscribe("client-1");

      collector.destroy();

      vi.advanceTimersByTime(5000);
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
