/**
 * Core CRDT type definitions for the Collaborative Sync Engine.
 * Implements LWW-Element-Set semantics with Hybrid Logical Clock timestamps.
 */

/** HLCTimestamp represents a Hybrid Logical Clock timestamp. */
export interface HLCTimestamp {
  /** Milliseconds since epoch */
  wallTime: number;
  /** Logical counter for same-wallTime events */
  logical: number;
  /** Originating node identifier */
  nodeId: string;
}

/** LWWRegister holds a single field value with its timestamp and origin. */
export interface LWWRegister {
  value: unknown;
  timestamp: HLCTimestamp;
  replicaId: string;
}

/** LWWElement represents a single item in the LWW-Element-Set. */
export interface LWWElement {
  itemId: string;
  fields: Record<string, LWWRegister>;
  addedAt: HLCTimestamp;
  /** null means item is active */
  removedAt: HLCTimestamp | null;
}

/** CRDTState holds the full CRDT state for a session. */
export interface CRDTState {
  sessionId: string;
  items: Record<string, LWWElement>;
  version: number;
  lastUpdated: HLCTimestamp;
}

/** OperationType enumerates CRDT operation types. */
export type OperationType = "add" | "remove" | "update";

/** CRDTOperation represents a single operation on the CRDT state. */
export interface CRDTOperation {
  /** UUID v4 */
  id: string;
  sessionId: string;
  /** Client's unique replica identifier */
  replicaId: string;
  type: OperationType;
  itemId: string;
  payload: Record<string, unknown>;
  /** Hybrid Logical Clock timestamp */
  timestamp: HLCTimestamp;
  /** State version reference */
  version: number;
}

/** StateDelta represents the changed portion of state after a merge. */
export interface StateDelta {
  sessionId: string;
  changes: ItemChange[];
  timestamp: HLCTimestamp;
}

/** ItemChange represents a single item's change within a delta. */
export interface ItemChange {
  itemId: string;
  type: "added" | "removed" | "updated";
  fields?: Record<string, unknown>;
}
