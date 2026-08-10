/**
 * Hybrid Logical Clock (HLC) implementation.
 * Combines wall clock time with a logical counter and node identifier
 * to produce causally-ordered, globally-unique timestamps.
 */

import type { HLCTimestamp } from "../types/index.js";

/**
 * Internal state tracking the last known wall time and logical counter
 * for each node, ensuring monotonically increasing timestamps.
 */
const state: { lastWallTime: number; lastLogical: number } = {
  lastWallTime: 0,
  lastLogical: 0,
};

/**
 * Creates a new HLC timestamp for the given node.
 *
 * Algorithm:
 * - If wall clock has advanced past the last known time, reset logical to 0.
 * - If wall clock equals the last known time, increment logical counter.
 * - If wall clock is behind (clock skew), use last known time and increment logical.
 */
export function createTimestamp(nodeId: string): HLCTimestamp {
  const now = Date.now();

  if (now > state.lastWallTime) {
    state.lastWallTime = now;
    state.lastLogical = 0;
  } else {
    state.lastLogical++;
  }

  return {
    wallTime: state.lastWallTime,
    logical: state.lastLogical,
    nodeId,
  };
}

/**
 * Compares two HLC timestamps for ordering.
 *
 * Comparison order:
 * 1. wallTime (numeric)
 * 2. logical counter (numeric)
 * 3. nodeId (lexicographic, deterministic tiebreaker)
 *
 * @returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareTimestamps(a: HLCTimestamp, b: HLCTimestamp): number {
  if (a.wallTime !== b.wallTime) {
    return a.wallTime - b.wallTime;
  }
  if (a.logical !== b.logical) {
    return a.logical - b.logical;
  }
  if (a.nodeId < b.nodeId) return -1;
  if (a.nodeId > b.nodeId) return 1;
  return 0;
}

/**
 * Merges a remote timestamp into the local clock state, producing
 * an updated local timestamp that respects causality.
 *
 * Algorithm:
 * - New wallTime = max(local.wallTime, remote.wallTime, Date.now())
 * - If all three sources have the same wallTime, increment logical = max(local.logical, remote.logical) + 1
 * - If the new wallTime equals both local and remote wallTime, increment logical = max(local.logical, remote.logical) + 1
 * - If the new wallTime equals only local wallTime, increment local logical + 1
 * - If the new wallTime equals only remote wallTime, increment remote logical + 1
 * - If wallTime has advanced past both, reset logical to 0
 */
export function mergeTimestamp(
  local: HLCTimestamp,
  remote: HLCTimestamp
): HLCTimestamp {
  const now = Date.now();
  const newWallTime = Math.max(local.wallTime, remote.wallTime, now);

  let newLogical: number;

  if (newWallTime === local.wallTime && newWallTime === remote.wallTime) {
    // All tied — take the max logical and increment
    newLogical = Math.max(local.logical, remote.logical) + 1;
  } else if (newWallTime === local.wallTime) {
    // Local wallTime is the max — increment local logical
    newLogical = local.logical + 1;
  } else if (newWallTime === remote.wallTime) {
    // Remote wallTime is the max — increment remote logical
    newLogical = remote.logical + 1;
  } else {
    // Wall clock has advanced past both — reset logical
    newLogical = 0;
  }

  // Update internal state
  state.lastWallTime = newWallTime;
  state.lastLogical = newLogical;

  return {
    wallTime: newWallTime,
    logical: newLogical,
    nodeId: local.nodeId,
  };
}
