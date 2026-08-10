/**
 * Client SDK type definitions for events, operation results, and errors.
 */

import type { UserPresence } from "./connection.js";

/** StateChangeEvent describes a state mutation observed by the client. */
export interface StateChangeEvent {
  collection: string;
  itemId: string;
  changeType: "added" | "removed" | "updated";
  newValue?: Record<string, unknown>;
  source: "local" | "remote";
}

/** OperationResult represents the outcome of a high-level SDK call. */
export interface OperationResult {
  operationId: string;
  accepted: boolean;
}

/** SDKError represents an error emitted by the Client SDK. */
export interface SDKError {
  operationId?: string;
  code: string;
  message: string;
}

/** PresenceEvent represents a presence change in the session. */
export interface PresenceEvent {
  type: "join" | "leave";
  user: UserPresence;
}
