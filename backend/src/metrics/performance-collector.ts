/**
 * Performance Collector module for high-resolution metrics collection.
 *
 * Provides:
 * - High-resolution operation latency measurement (hrtime, microsecond precision)
 * - Rolling P50, P95, P99 percentile computation over a 10-second sliding window
 * - Per-second operation count with 60-second rolling throughput history
 * - Active connections, active rooms, total operations since server start tracking
 * - Metrics_Channel subscription: stream metric snapshots at 1-second intervals
 *
 * Requirements: 5.1-5.5
 */

import type {
  PerformanceCollector,
  PerformanceMetrics,
} from "../types/metrics.js";

/** Duration of the sliding window for latency percentiles (in ms). */
const LATENCY_WINDOW_MS = 10_000;

/** Maximum number of entries in the throughput history (60 seconds). */
const THROUGHPUT_HISTORY_SIZE = 60;

/** Interval for streaming metrics to subscribers (in ms). */
const METRICS_STREAM_INTERVAL_MS = 1_000;

/**
 * A timestamped latency sample used in the sliding window.
 */
interface LatencySample {
  /** The recorded latency in milliseconds. */
  latencyMs: number;
  /** The wall-clock time (Date.now()) when the sample was recorded. */
  recordedAt: number;
}

/**
 * Computes the given percentile from a sorted array of numbers.
 * Uses the nearest-rank method.
 *
 * @param sorted - A sorted (ascending) array of numeric values.
 * @param percentile - The percentile to compute (0-100).
 * @returns The value at the given percentile, or 0 if array is empty.
 */
function computePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Converts an hrtime diff to milliseconds with microsecond precision.
 */
function hrtimeDiffMs(start: [number, number]): number {
  const diff = process.hrtime(start);
  return diff[0] * 1_000 + diff[1] / 1_000_000;
}

/**
 * PerformanceCollectorImpl implements real-time performance metrics collection.
 *
 * - Records operation latency with hrtime microsecond precision (Req 5.1)
 * - Computes rolling P50, P95, P99 over a 10-second sliding window (Req 5.2)
 * - Maintains per-second operation counts with 60-second rolling history (Req 5.3)
 * - Streams metric snapshots to subscribers at 1-second intervals (Req 5.4)
 * - Tracks active connections, active rooms, and total ops processed (Req 5.5)
 */
export class PerformanceCollectorImpl implements PerformanceCollector {
  /** Sliding window of latency samples for percentile computation. */
  private latencySamples: LatencySample[] = [];

  /** Rolling throughput history: one entry per second, up to 60 entries. */
  private throughputHistory: number[] = [];

  /** Operation count for the current second. */
  private currentSecondOps: number = 0;

  /** Timestamp (seconds since epoch) of the current counting interval. */
  private currentSecond: number = Math.floor(Date.now() / 1000);

  /** Total operations processed since server start. */
  private totalOpsProcessed: number = 0;

  /** Number of active WebSocket connections. */
  private activeConnections: number = 0;

  /** Number of active rooms. */
  private activeRooms: number = 0;

  /** Set of subscribed client IDs for metrics streaming. */
  private subscribers: Set<string> = new Set();

  /** Timer handle for the 1-second metrics streaming interval. */
  private streamInterval: ReturnType<typeof setInterval> | null = null;

  /** Callback invoked when a metric snapshot is emitted to subscribers. */
  private onSnapshot: ((clientId: string, metrics: PerformanceMetrics) => void) | null = null;

  constructor() {
    this.startStreaming();
  }

  /**
   * Records an operation's latency using a high-resolution start time.
   * Computes the elapsed time from the given hrtime start point to now.
   *
   * Requirement 5.1: Measure operation processing time with microsecond precision.
   */
  recordOperationLatency(startHrtime: [number, number]): void {
    const latencyMs = hrtimeDiffMs(startHrtime);
    const now = Date.now();

    this.latencySamples.push({ latencyMs, recordedAt: now });

    // Prune samples outside the 10-second window
    this.pruneLatencySamples(now);
  }

  /**
   * Increments the operation count by the given amount (default 1).
   * Updates both per-second and total counters.
   *
   * Requirement 5.3: Count operations processed per second.
   * Requirement 5.5: Track total operations processed since server start.
   */
  incrementOpsCount(count: number = 1): void {
    this.rollSecondIfNeeded();
    this.currentSecondOps += count;
    this.totalOpsProcessed += count;
  }

  /**
   * Returns a snapshot of all current performance metrics.
   *
   * Requirements 5.1-5.5.
   */
  getMetrics(): PerformanceMetrics {
    this.rollSecondIfNeeded();
    const now = Date.now();
    this.pruneLatencySamples(now);

    // Extract latency values and sort for percentile computation
    const latencies = this.latencySamples.map((s) => s.latencyMs).sort((a, b) => a - b);

    return {
      opsPerSecond: this.computeCurrentOpsPerSecond(),
      throughputHistory: [...this.throughputHistory],
      p50LatencyMs: computePercentile(latencies, 50),
      p95LatencyMs: computePercentile(latencies, 95),
      p99LatencyMs: computePercentile(latencies, 99),
      activeConnections: this.activeConnections,
      activeRooms: this.activeRooms,
      totalOpsProcessed: this.totalOpsProcessed,
    };
  }

  /**
   * Subscribes a client to receive metric snapshots at 1-second intervals.
   *
   * Requirement 5.4: Stream metric snapshots at 1-second intervals.
   */
  subscribe(clientId: string): void {
    this.subscribers.add(clientId);
  }

  /**
   * Unsubscribes a client from metric snapshot streaming.
   */
  unsubscribe(clientId: string): void {
    this.subscribers.delete(clientId);
  }

  /**
   * Sets the callback invoked when metric snapshots are emitted to subscribers.
   * The callback receives the clientId and the metrics snapshot.
   */
  setSnapshotCallback(
    callback: (clientId: string, metrics: PerformanceMetrics) => void
  ): void {
    this.onSnapshot = callback;
  }

  /**
   * Updates the active connection count.
   *
   * Requirement 5.5: Track active WebSocket connections.
   */
  setActiveConnections(count: number): void {
    this.activeConnections = count;
  }

  /**
   * Updates the active room count.
   *
   * Requirement 5.5: Track active rooms.
   */
  setActiveRooms(count: number): void {
    this.activeRooms = count;
  }

  /**
   * Returns the set of currently subscribed client IDs.
   */
  getSubscribers(): ReadonlySet<string> {
    return this.subscribers;
  }

  /**
   * Stops the metrics streaming interval (cleanup for shutdown/tests).
   */
  destroy(): void {
    if (this.streamInterval !== null) {
      clearInterval(this.streamInterval);
      this.streamInterval = null;
    }
  }

  /**
   * Starts the 1-second interval that streams metrics to all subscribers.
   *
   * Requirement 5.4: Stream at 1-second intervals.
   */
  private startStreaming(): void {
    this.streamInterval = setInterval(() => {
      if (this.subscribers.size === 0) return;

      const metrics = this.getMetrics();
      for (const clientId of this.subscribers) {
        if (this.onSnapshot) {
          this.onSnapshot(clientId, metrics);
        }
      }
    }, METRICS_STREAM_INTERVAL_MS);

    // Ensure the interval doesn't prevent process exit
    if (this.streamInterval.unref) {
      this.streamInterval.unref();
    }
  }

  /**
   * Prunes latency samples that are older than the 10-second sliding window.
   */
  private pruneLatencySamples(now: number): void {
    const cutoff = now - LATENCY_WINDOW_MS;
    // Find first sample within the window and slice
    let firstValid = 0;
    while (
      firstValid < this.latencySamples.length &&
      this.latencySamples[firstValid].recordedAt < cutoff
    ) {
      firstValid++;
    }
    if (firstValid > 0) {
      this.latencySamples = this.latencySamples.slice(firstValid);
    }
  }

  /**
   * Rolls the per-second operation counter if the current second has elapsed.
   * Pushes the completed second's count into the throughput history.
   */
  private rollSecondIfNeeded(): void {
    const nowSecond = Math.floor(Date.now() / 1000);
    if (nowSecond > this.currentSecond) {
      // Push the completed second(s) into throughput history
      const elapsedSeconds = nowSecond - this.currentSecond;

      // Push the ops counted for the last known second
      this.throughputHistory.push(this.currentSecondOps);

      // If more than 1 second elapsed, fill gaps with zeros
      for (let i = 1; i < elapsedSeconds; i++) {
        this.throughputHistory.push(0);
      }

      // Trim to 60 entries max
      if (this.throughputHistory.length > THROUGHPUT_HISTORY_SIZE) {
        this.throughputHistory = this.throughputHistory.slice(
          this.throughputHistory.length - THROUGHPUT_HISTORY_SIZE
        );
      }

      // Reset for the new second
      this.currentSecondOps = 0;
      this.currentSecond = nowSecond;
    }
  }

  /**
   * Computes the current ops/sec using the most recent completed second.
   * Falls back to the current (in-progress) second if no history exists.
   */
  private computeCurrentOpsPerSecond(): number {
    if (this.throughputHistory.length > 0) {
      return this.throughputHistory[this.throughputHistory.length - 1];
    }
    return this.currentSecondOps;
  }
}
