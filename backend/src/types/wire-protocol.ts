/**
 * Wire protocol V2 type definitions for channel-multiplexed communication.
 */

/** ChannelType enumerates the four logical channels over a single WebSocket. */
export type ChannelType = "ops" | "awareness" | "metrics" | "control";

/** OperationPayload is the payload shape for the ops channel. */
export interface OperationPayload {
  id: string;
  type: string;
  itemId: string;
  payload: Record<string, unknown>;
  timestamp: { wallTime: number; logical: number; nodeId: string };
  version: number;
}

/** AwarenessPayload is the payload shape for the awareness channel. */
export interface AwarenessPayload {
  clientId: string;
  cursor?: { x: number; y: number };
  selection?: string[];
  displayName: string;
  color: string;
}

/** ControlPayload is the payload shape for the control channel. */
export type ControlPayload =
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  | { type: "leave-room" }
  | { type: "set-latency"; latencyMs: number }
  | { type: "disconnect-simulation" }
  | { type: "reconnect-simulation" }
  | { type: "partition-simulation"; groupA: string[]; groupB: string[] }
  | { type: "heal-partition" }
  | { type: "query-history"; from: { wallTime: number; logical: number; nodeId: string }; to: { wallTime: number; logical: number; nodeId: string } }
  | { type: "time-travel"; timestamp: { wallTime: number; logical: number; nodeId: string } };

/** ClientFrame is the client-to-server message envelope for V2 wire protocol. */
export interface ClientFrame {
  channel: ChannelType;
  roomId: string;
  /** Monotonic sequence number for ordering. */
  seq: number;
  payload: OperationPayload | AwarenessPayload | ControlPayload;
}

/** ServerFrame is the server-to-client message envelope for V2 wire protocol. */
export interface ServerFrame {
  channel: ChannelType;
  roomId: string;
  type:
    | "ack"
    | "delta"
    | "conflict"
    | "awareness-update"
    | "metrics-snapshot"
    | "control-response"
    | "error"
    | "presence-join"
    | "presence-leave";
  payload: unknown;
  /** Correlates to the client's seq number for request-response patterns. */
  replyTo?: number;
}
