/**
 * Property-based tests for the PerformanceCollectorImpl.
 *
 * Property 16: Latency Percentile Computation
 * Property 17: Throughput History Accuracy
 * Property 18: Metrics Counter Accuracy
 *
 * Feature: sync-platform-v2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { PerformanceCollectorImpl } from "./performance-collector.js";

// --- Helper: Nearest-rank percentile computation (reference implementation) ---

/**
 * Computes the percentile using the nearest-rank method (same as the production code).
 * This serves as the oracle for verifying the collector's output.
 */
function referencePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// --- Arbitraries (generators) ---

/** Generate an array of positive latency values (milliseconds). */
function arbLatencySamples(
  minLength: number,
  maxLength: number
): fc.Arbitrary<number[]> {
  return fc.array(
    fc.double({ min: 0.001, max: 10000, noNaN: true }),
    { minLength, maxLength }
  );
}

/** Generate a sequence of per-second operation counts for throughput history testing. */
function arbThroughputSequence(
  minSeconds: number,
  maxSeconds: number
): fc.Arbitrary<number[]> {
  return fc.array(
    fc.nat({ max: 500 }),
    { minLength: minSeconds, maxLength: maxSeconds }
  );
}

/**
 * Generate a sequence of system events (connections, disconnections, room creations,
 * room deletions, operation increments) to test counter accuracy.
 */
type MetricEvent =
  | { type: "connect"; count: number }
  | { type: "disconnect"; count: number }
  | { type: "createRoom"; count: number }
  | { type: "deleteRoom"; count: number }
  | { type: "ops"; count: number };

function arbMetricEvents(
  minLength: number,
  maxLength: number
): fc.Arbitrary<MetricEvent[]> {
  const arbEvent: fc.Arbitrary<MetricEvent> = fc.oneof(
    fc.nat({ max: 50 }).map((count) => ({ type: "connect" as const, count })),
    fc.nat({ max: 50 }).map((count) => ({ type: "disconnect" as const, count })),
    fc.nat({ max: 20 }).map((count) => ({ type: "createRoom" as const, count })),
    fc.nat({ max: 20 }).map((count) => ({ type: "deleteRoom" as const, count })),
    fc.integer({ min: 1, max: 100 }).map((count) => ({ type: "ops" as const, count }))
  );
  return fc.array(arbEvent, { minLength, maxLength });
}

// --- Property Tests ---

describe("Feature: sync-platform-v2, Property 16: Latency Percentile Computation", () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * For any set of operation latency samples within a 10-second window,
   * the computed P50, P95, and P99 values SHALL equal the mathematically
   * correct percentile values for that sample set.
   */
  let collector: PerformanceCollectorImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    collector = new PerformanceCollectorImpl();
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  it("P50, P95, P99 match reference percentile computation for any sample set", () => {
    fc.assert(
      fc.property(
        arbLatencySamples(1, 200),
        (latencies) => {
          const now = Date.now();

          // Inject latency samples directly (all within the 10-second window)
          for (const latencyMs of latencies) {
            (collector as any).latencySamples.push({
              latencyMs,
              recordedAt: now,
            });
          }

          const metrics = collector.getMetrics();

          // Compute expected values using the same nearest-rank method
          const sorted = [...latencies].sort((a, b) => a - b);
          const expectedP50 = referencePercentile(sorted, 50);
          const expectedP95 = referencePercentile(sorted, 95);
          const expectedP99 = referencePercentile(sorted, 99);

          expect(metrics.p50LatencyMs).toBe(expectedP50);
          expect(metrics.p95LatencyMs).toBe(expectedP95);
          expect(metrics.p99LatencyMs).toBe(expectedP99);

          // Reset for next iteration
          (collector as any).latencySamples = [];
        }
      ),
      { numRuns: 100 }
    );
  });

  it("percentiles satisfy ordering constraint: P50 <= P95 <= P99", () => {
    fc.assert(
      fc.property(
        arbLatencySamples(1, 200),
        (latencies) => {
          const now = Date.now();

          for (const latencyMs of latencies) {
            (collector as any).latencySamples.push({
              latencyMs,
              recordedAt: now,
            });
          }

          const metrics = collector.getMetrics();

          // P50 <= P95 <= P99 always holds for any data set
          expect(metrics.p50LatencyMs).toBeLessThanOrEqual(metrics.p95LatencyMs);
          expect(metrics.p95LatencyMs).toBeLessThanOrEqual(metrics.p99LatencyMs);

          // Reset for next iteration
          (collector as any).latencySamples = [];
        }
      ),
      { numRuns: 100 }
    );
  });

  it("samples outside the 10-second window are excluded from percentile computation", () => {
    fc.assert(
      fc.property(
        arbLatencySamples(1, 50),
        arbLatencySamples(1, 50),
        (oldSamples, recentSamples) => {
          const now = Date.now();
          vi.setSystemTime(now);

          // Inject old samples (outside the 10-second window)
          for (const latencyMs of oldSamples) {
            (collector as any).latencySamples.push({
              latencyMs,
              recordedAt: now - 11_000, // 11 seconds ago
            });
          }

          // Inject recent samples (within the window)
          for (const latencyMs of recentSamples) {
            (collector as any).latencySamples.push({
              latencyMs,
              recordedAt: now,
            });
          }

          const metrics = collector.getMetrics();

          // Only recent samples should contribute to percentiles
          const sorted = [...recentSamples].sort((a, b) => a - b);
          const expectedP50 = referencePercentile(sorted, 50);
          const expectedP95 = referencePercentile(sorted, 95);
          const expectedP99 = referencePercentile(sorted, 99);

          expect(metrics.p50LatencyMs).toBe(expectedP50);
          expect(metrics.p95LatencyMs).toBe(expectedP95);
          expect(metrics.p99LatencyMs).toBe(expectedP99);

          // Reset for next iteration
          (collector as any).latencySamples = [];
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 17: Throughput History Accuracy", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any sequence of operation-count events over 60+ seconds,
   * the rolling throughput history SHALL contain exactly the last
   * 60 seconds of per-second operation counts.
   */
  let collector: PerformanceCollectorImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    collector = new PerformanceCollectorImpl();
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  it("throughput history contains exactly the last 60 seconds of per-second counts", () => {
    fc.assert(
      fc.property(
        arbThroughputSequence(61, 120),
        (opsPerSecond) => {
          const baseTime = Date.now();
          vi.setSystemTime(baseTime);

          // Simulate each second with its operation count
          for (let i = 0; i < opsPerSecond.length; i++) {
            vi.setSystemTime(baseTime + i * 1000);
            if (opsPerSecond[i] > 0) {
              collector.incrementOpsCount(opsPerSecond[i]);
            }
          }

          // Advance one more second to flush the last second's count into history
          vi.setSystemTime(baseTime + opsPerSecond.length * 1000);
          collector.incrementOpsCount(0); // trigger rollSecondIfNeeded

          const metrics = collector.getMetrics();

          // History should have at most 60 entries
          expect(metrics.throughputHistory.length).toBeLessThanOrEqual(60);

          // The history should contain exactly the last 60 seconds
          // (the last entry is the most recently completed second)
          const expectedHistory = opsPerSecond.slice(-60);
          expect(metrics.throughputHistory).toEqual(expectedHistory);

          // Reset collector for next iteration
          (collector as any).throughputHistory = [];
          (collector as any).currentSecondOps = 0;
          (collector as any).currentSecond = Math.floor(Date.now() / 1000);
          (collector as any).totalOpsProcessed = 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("throughput history length never exceeds 60 entries", () => {
    fc.assert(
      fc.property(
        arbThroughputSequence(1, 200),
        (opsPerSecond) => {
          const baseTime = Date.now();
          vi.setSystemTime(baseTime);

          for (let i = 0; i < opsPerSecond.length; i++) {
            vi.setSystemTime(baseTime + i * 1000);
            if (opsPerSecond[i] > 0) {
              collector.incrementOpsCount(opsPerSecond[i]);
            }
          }

          // Flush the last second
          vi.setSystemTime(baseTime + opsPerSecond.length * 1000);
          collector.incrementOpsCount(0);

          const metrics = collector.getMetrics();
          expect(metrics.throughputHistory.length).toBeLessThanOrEqual(60);

          // Reset for next iteration
          (collector as any).throughputHistory = [];
          (collector as any).currentSecondOps = 0;
          (collector as any).currentSecond = Math.floor(Date.now() / 1000);
          (collector as any).totalOpsProcessed = 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("gaps in activity are filled with zeros in throughput history", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 1, max: 100 }),
        (opsFirst, gapSeconds, opsAfter) => {
          const baseTime = Date.now();
          vi.setSystemTime(baseTime);

          // Record ops in first second
          collector.incrementOpsCount(opsFirst);

          // Skip gapSeconds seconds
          vi.setSystemTime(baseTime + (gapSeconds + 1) * 1000);
          collector.incrementOpsCount(opsAfter);

          const metrics = collector.getMetrics();

          // The history should contain: opsFirst, then (gapSeconds - 1) zeros
          // (The gap between the first second and the current second)
          expect(metrics.throughputHistory[0]).toBe(opsFirst);

          // All entries between first and last should be zero (representing gap seconds)
          for (let i = 1; i < gapSeconds; i++) {
            if (i < metrics.throughputHistory.length) {
              expect(metrics.throughputHistory[i]).toBe(0);
            }
          }

          // Reset for next iteration
          (collector as any).throughputHistory = [];
          (collector as any).currentSecondOps = 0;
          (collector as any).currentSecond = Math.floor(Date.now() / 1000);
          (collector as any).totalOpsProcessed = 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: sync-platform-v2, Property 18: Metrics Counter Accuracy", () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any sequence of connection, disconnection, room-creation, and operation
   * events, the Performance_Collector counters (active connections, active rooms,
   * total ops) SHALL accurately reflect the current system state.
   */
  let collector: PerformanceCollectorImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    collector = new PerformanceCollectorImpl();
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
  });

  it("counters accurately reflect the cumulative effect of any event sequence", () => {
    fc.assert(
      fc.property(
        arbMetricEvents(1, 50),
        (events) => {
          let expectedConnections = 0;
          let expectedRooms = 0;
          let expectedTotalOps = 0;

          for (const event of events) {
            switch (event.type) {
              case "connect":
                expectedConnections += event.count;
                collector.setActiveConnections(expectedConnections);
                break;
              case "disconnect":
                expectedConnections = Math.max(0, expectedConnections - event.count);
                collector.setActiveConnections(expectedConnections);
                break;
              case "createRoom":
                expectedRooms += event.count;
                collector.setActiveRooms(expectedRooms);
                break;
              case "deleteRoom":
                expectedRooms = Math.max(0, expectedRooms - event.count);
                collector.setActiveRooms(expectedRooms);
                break;
              case "ops":
                expectedTotalOps += event.count;
                collector.incrementOpsCount(event.count);
                break;
            }
          }

          const metrics = collector.getMetrics();

          expect(metrics.activeConnections).toBe(expectedConnections);
          expect(metrics.activeRooms).toBe(expectedRooms);
          expect(metrics.totalOpsProcessed).toBe(expectedTotalOps);

          // Reset for next iteration
          (collector as any).activeConnections = 0;
          (collector as any).activeRooms = 0;
          (collector as any).totalOpsProcessed = 0;
          (collector as any).currentSecondOps = 0;
          (collector as any).throughputHistory = [];
          (collector as any).currentSecond = Math.floor(Date.now() / 1000);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("totalOpsProcessed is monotonically non-decreasing for any sequence of incrementOpsCount calls", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 50 }),
        (increments) => {
          let previousTotal = 0;

          for (const inc of increments) {
            collector.incrementOpsCount(inc);
            const metrics = collector.getMetrics();
            expect(metrics.totalOpsProcessed).toBeGreaterThanOrEqual(previousTotal);
            previousTotal = metrics.totalOpsProcessed;
          }

          // Final total should equal sum of all increments
          const expectedTotal = increments.reduce((sum, n) => sum + n, 0);
          expect(collector.getMetrics().totalOpsProcessed).toBe(expectedTotal);

          // Reset for next iteration
          (collector as any).totalOpsProcessed = 0;
          (collector as any).currentSecondOps = 0;
          (collector as any).throughputHistory = [];
          (collector as any).currentSecond = Math.floor(Date.now() / 1000);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("activeConnections always reflects the last set value", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 500 }), { minLength: 1, maxLength: 30 }),
        (connectionCounts) => {
          for (const count of connectionCounts) {
            collector.setActiveConnections(count);
            expect(collector.getMetrics().activeConnections).toBe(count);
          }

          // Final value matches last in sequence
          const lastValue = connectionCounts[connectionCounts.length - 1];
          expect(collector.getMetrics().activeConnections).toBe(lastValue);

          // Reset for next iteration
          (collector as any).activeConnections = 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});
