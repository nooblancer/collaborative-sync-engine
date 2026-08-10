/**
 * Barrel export file for all shared type definitions.
 */

export type {
  HLCTimestamp,
  LWWRegister,
  LWWElement,
  CRDTState,
  OperationType,
  CRDTOperation,
  StateDelta,
  ItemChange,
} from "./crdt.js";

export type {
  ConnectionState,
  WebSocketSession,
  UserPresence,
  SessionInfo,
} from "./connection.js";

export type { ClientMessage, ServerMessage } from "./protocol.js";

export type { Snapshot, PersistResult } from "./persistence.js";

export type {
  OperationError,
  MergeResult,
  BatchMergeResult,
} from "./results.js";

export type {
  StateChangeEvent,
  OperationResult,
  SDKError,
  PresenceEvent,
} from "./client.js";
