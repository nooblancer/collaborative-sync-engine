/**
 * Conflict event type definitions for conflict resolution tracking.
 */

import type { HLCTimestamp } from "./crdt.js";

/** ConflictEvent records a resolved conflict between two concurrent operations. */
export interface ConflictEvent {
  id: string;
  roomId: string;
  timestamp: HLCTimestamp;
  field: string;
  operationA: { clientId: string; value: unknown; hlc: HLCTimestamp };
  operationB: { clientId: string; value: unknown; hlc: HLCTimestamp };
  winner: "A" | "B";
  /** Human-readable explanation of why this operation won. */
  reason: string;
}
