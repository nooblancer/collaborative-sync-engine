/**
 * Pure utility functions for the Stress Test Page benchmarks.
 * These are stateless helpers for formatting, computation, and display logic.
 */

/**
 * Formats a number with locale-aware thousands separators.
 * e.g., 51020 → "51,020"
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Formats milliseconds into a human-readable string.
 * <1ms → "<1ms", <1000ms → "Xms", ≥1000ms → "X.XXs"
 */
export function formatMs(ms: number): string {
  if (ms < 1) {
    return "<1ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Computes percentile from a sorted array of numbers.
 * Uses ceiling-rank method: index = ceil(p * length) - 1
 */
export function computePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    Math.ceil(percentile * sorted.length) - 1,
    sorted.length - 1
  );
  return sorted[Math.max(0, index)];
}

/**
 * Returns a Tailwind color class based on P99 latency thresholds.
 * < 20ms → "text-success"
 * 20-50ms → "text-warning"
 * > 50ms → "text-destructive"
 */
export function getLatencyColor(p99Ms: number): string {
  if (p99Ms < 20) {
    return "text-success";
  }
  if (p99Ms <= 50) {
    return "text-warning";
  }
  return "text-destructive";
}

/**
 * Applies a rolling window to an array, returning the last `windowSize` elements.
 */
export function applyWindow<T>(items: T[], windowSize: number): T[] {
  if (windowSize <= 0) {
    return [];
  }
  if (items.length <= windowSize) {
    return items;
  }
  return items.slice(-windowSize);
}
