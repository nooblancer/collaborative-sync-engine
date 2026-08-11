/**
 * Performance metrics type definitions for the metrics collection system.
 */

/** PerformanceMetrics holds aggregated performance data with rolling windows. */
export interface PerformanceMetrics {
  opsPerSecond: number;
  /** 60-second rolling throughput history (one entry per second). */
  throughputHistory: number[];
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  activeConnections: number;
  activeRooms: number;
  totalOpsProcessed: number;
}

/** PerformanceCollector defines the interface for recording and querying metrics. */
export interface PerformanceCollector {
  recordOperationLatency(startHrtime: [number, number]): void;
  incrementOpsCount(count?: number): void;
  getMetrics(): PerformanceMetrics;
  subscribe(clientId: string): void;
  unsubscribe(clientId: string): void;
}
