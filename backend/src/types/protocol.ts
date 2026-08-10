/**
 * Wire protocol message definitions for client-server communication.
 */

import type { UserPresence } from "./connection.js";

/** ClientMessage represents messages sent from client to server. */
export interface ClientMessage {
  type: "operation" | "presence-request" | "token-refresh" | "pong";
  payload?: unknown;
  token?: string;
}

/** ServerMessage represents messages sent from server to client. */
export interface ServerMessage {
  type:
    | "ack"
    | "delta"
    | "presence-join"
    | "presence-leave"
    | "presence-list"
    | "ping"
    | "error"
    | "batch-result"
    | "resync-required";
  operationId?: string;
  payload?: unknown;
  user?: UserPresence;
  userId?: string;
  users?: UserPresence[];
  code?: string;
  message?: string;
  reason?: string;
}
