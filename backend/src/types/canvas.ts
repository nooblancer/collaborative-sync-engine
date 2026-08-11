/**
 * Canvas Object CRDT type definitions for the Collaborative Whiteboard.
 *
 * Uses a generic LWWRegister<T> for field-level last-writer-wins conflict
 * resolution and an AppendOnlySequence<T> for freehand path points that
 * merge without conflict across concurrent writers.
 *
 * Requirements: 3.1-3.7
 */

import type { HLCTimestamp } from "./crdt.js";

/**
 * Generic Last-Writer-Wins Register for field-level conflict resolution.
 * Higher HLC timestamp wins; ties broken by nodeId lexicographic comparison.
 */
export interface LWWRegister<T> {
  value: T;
  hlc: HLCTimestamp;
  nodeId: string;
}

/**
 * Append-only sequence CRDT for data that should never conflict.
 * Used for freehand path points where concurrent additions from different
 * clients merge by concatenating segments in causal order.
 */
export interface AppendOnlySequence<T> {
  segments: Array<{
    replicaId: string;
    startIndex: number;
    data: T[];
    timestamp: HLCTimestamp;
  }>;
}

/** Point data for freehand drawing paths. */
export interface FreehandPoint {
  x: number;
  y: number;
  pressure?: number;
}

/** Supported canvas object shape types. */
export type CanvasObjectType = "rectangle" | "circle" | "freehand";

/**
 * Full CRDT representation of a canvas object.
 * Each mutable field is wrapped in an LWWRegister for conflict resolution.
 * Freehand path points use an AppendOnlySequence for conflict-free merge.
 */
export interface CanvasObjectCRDT {
  id: string;
  type: LWWRegister<CanvasObjectType>;
  position: {
    x: LWWRegister<number>;
    y: LWWRegister<number>;
  };
  dimensions: {
    width: LWWRegister<number>;
    height: LWWRegister<number>;
  };
  radius: LWWRegister<number>;
  points: AppendOnlySequence<FreehandPoint>;
  style: {
    fill: LWWRegister<string>;
    stroke: LWWRegister<string>;
    strokeWidth: LWWRegister<number>;
  };
  /** null = active, set = tombstoned (remove-wins semantics) */
  removedAt: HLCTimestamp | null;
  createdBy: string;
  createdAt: HLCTimestamp;
}

/**
 * Simplified canvas object for frontend rendering.
 * Strips CRDT metadata, exposing only resolved values.
 */
export interface CanvasObject {
  id: string;
  type: CanvasObjectType;
  position: { x: number; y: number };
  dimensions?: { width: number; height: number };
  radius?: number;
  points?: FreehandPoint[];
  style: { fill: string; stroke: string; strokeWidth: number };
  createdBy: string;
  createdAt: HLCTimestamp;
}
