/**
 * Pre-generated workload cache for benchmark modes.
 *
 * Instead of generating 50k+ Buffer objects on every benchmark request,
 * workloads are generated once at startup (or on first use) and reused
 * for every subsequent run. This eliminates the workload generation
 * bottleneck entirely — benchmark timing measures only the merge engine.
 */

import { generateContentionWorkload, generateBalancedWorkload, generateSnapshotWorkload } from "./benchmark-workloads.js";
import { generateOperationBatch } from "./benchmark.js";

// ---------------------------------------------------------------------------
// Cache storage
// ---------------------------------------------------------------------------

interface CachedWorkload {
  ops: number;
  buffers: Buffer[];
}

const contentionCache = new Map<number, Buffer[]>();
const balancedCache = new Map<number, Buffer[]>();
const snapshotCache = new Map<number, Buffer[]>();
const standardCache = new Map<number, Buffer[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a contention workload of the specified size.
 * Generated once, then reused for all subsequent calls with the same ops count.
 */
export function getCachedContentionWorkload(ops: number): Buffer[] {
  let cached = contentionCache.get(ops);
  if (!cached) {
    cached = generateContentionWorkload(ops);
    contentionCache.set(ops, cached);
  }
  return cached;
}

/**
 * Get a balanced workload of the specified size.
 * Generated once, then reused for all subsequent calls with the same ops count.
 */
export function getCachedBalancedWorkload(ops: number): Buffer[] {
  let cached = balancedCache.get(ops);
  if (!cached) {
    cached = generateBalancedWorkload(ops);
    balancedCache.set(ops, cached);
  }
  return cached;
}

/**
 * Get a snapshot workload of the specified size.
 * Generated once, then reused for all subsequent calls with the same ops count.
 */
export function getCachedSnapshotWorkload(ops: number): Buffer[] {
  let cached = snapshotCache.get(ops);
  if (!cached) {
    cached = generateSnapshotWorkload(ops);
    snapshotCache.set(ops, cached);
  }
  return cached;
}

/**
 * Get a standard workload of the specified size.
 * Generated once, then reused for all subsequent calls with the same ops count.
 */
export function getCachedStandardWorkload(ops: number): Buffer[] {
  let cached = standardCache.get(ops);
  if (!cached) {
    const existingItemIds: string[] = [];
    cached = generateOperationBatch(ops, existingItemIds);
    standardCache.set(ops, cached);
  }
  return cached;
}

/**
 * Pre-warm the cache with common operation counts.
 * Call at server startup to avoid first-request latency.
 */
export function prewarmCache(): void {
  const commonSizes = [500, 1000, 5000, 10000, 50000];

  for (const size of commonSizes) {
    getCachedContentionWorkload(size);
    getCachedBalancedWorkload(size);
    getCachedSnapshotWorkload(size);
    getCachedStandardWorkload(size);
  }
}
