/**
 * Persistence layer type definitions for snapshots and storage results.
 */

import type { CRDTState } from "./crdt.js";

/** Snapshot represents a point-in-time capture of the CRDT state. */
export interface Snapshot {
  id: string;
  sessionId: string;
  state: CRDTState;
  createdAt: number;
  operationCount: number;
}

/** PersistResult indicates whether a persistence operation succeeded. */
export interface PersistResult {
  success: boolean;
  error?: string;
}
