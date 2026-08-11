/**
 * Client SDK V2 type definitions.
 *
 * Defines configuration, connection states, channel multiplexing,
 * awareness, control commands, and offline queue interfaces for the
 * V2 client SDK with channel multiplexing over a single WebSocket.
 *
 * Validates: Requirements 19.1-19.5, 20.1-20.9
 */

import type { CRDTOperation, HLCTimestamp } from "./crdt.js";
import type { ConflictEvent } from "./conflict.js";
import type { PerformanceMetrics } from "./metrics.js";
import type { StateChangeEvent } from "./client.js";
import type { ChannelType } from "./wire-protocol.js";

export type { ChannelType } from "./wire-protocol.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the Client SDK V2 instance. */
export interface ClientSDKV2Config {
  /** WebSocket sync URL (NEXT_PUBLIC_SYNC_URL). */
  syncUrl: string;
  /** Initial reconnect delay in milliseconds (default: 100). */
  reconnectBaseMs: number;
  /** Maximum reconnect delay in milliseconds (default: 30000). */
  reconnectMaxMs: number;
  /** Maximum operations the offline queue can hold (default: 100000). */
  offlineQueueCapacity: number;
  /** Operations replayed per second on reconnection (default: 5000). */
  replayRatePerSecond: number;
}

// ---------------------------------------------------------------------------
// Connection State
// ---------------------------------------------------------------------------

/**
 * Connection lifecycle states for the V2 SDK.
 *
 * - connected: WebSocket open and authenticated
 * - disconnected: No active connection
 * - reconnecting: Attempting to re-establish connection with exponential backoff
 * - replaying: Connected, draining offline queue
 */
export type ConnectionStateV2 =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "replaying";

// ---------------------------------------------------------------------------
// Channel Multiplexing
// ---------------------------------------------------------------------------

/** Subscription state for a single channel. */
export interface ChannelSubscription {
  channel: ChannelType;
  active: boolean;
  subscribedAt: number;
}

/** Map of channel subscriptions keyed by channel type. */
export type ChannelSubscriptionMap = Record<ChannelType, ChannelSubscription>;

// ---------------------------------------------------------------------------
// Awareness
// ---------------------------------------------------------------------------

/** Real-time awareness update broadcast on the awareness channel. */
export interface AwarenessUpdate {
  clientId: string;
  cursor?: { x: number; y: number };
  selection?: string[];
  displayName: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Control Commands
// ---------------------------------------------------------------------------

/** Discriminated union of control commands sent on the control channel. */
export type ControlCommand =
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  | { type: "leave-room" }
  | { type: "set-latency"; latencyMs: number }
  | { type: "disconnect-simulation" }
  | { type: "reconnect-simulation" }
  | { type: "partition-simulation"; groupA: string[]; groupB: string[] }
  | { type: "heal-partition" }
  | { type: "query-history"; from: HLCTimestamp; to: HLCTimestamp }
  | { type: "time-travel"; timestamp: HLCTimestamp };

// ---------------------------------------------------------------------------
// Offline Queue
// ---------------------------------------------------------------------------

/** Configuration for the client-side offline operation queue. */
export interface OfflineQueueConfig {
  /** Maximum number of operations the queue can hold (default: 100000). */
  capacity: number;
  /** localStorage key used for persistence across page reloads. */
  persistenceKey: string;
}

/** A single entry in the offline operation queue. */
export interface OfflineQueueEntry {
  /** The CRDT operation to be replayed. */
  operation: CRDTOperation;
  /** Timestamp (ms) when the operation was enqueued. */
  enqueuedAt: number;
  /** Monotonic sequence number for causal ordering during replay. */
  seq: number;
}

/** State of the offline queue at a point in time. */
export interface OfflineQueueState {
  entries: OfflineQueueEntry[];
  nextSeq: number;
  isFull: boolean;
}

// ---------------------------------------------------------------------------
// Client SDK V2 Interface
// ---------------------------------------------------------------------------

/** Primary interface for the V2 Client SDK with channel multiplexing. */
export interface ClientSDKV2 {
  /** Connect to a room with authentication token. */
  connect(roomId: string, token: string): Promise<void>;
  /** Disconnect from the current room. */
  disconnect(): void;

  // Channel operations
  /** Send a CRDT operation on the ops channel. */
  sendOperation(operation: CRDTOperation): void;
  /** Send an awareness update on the awareness channel. */
  sendAwareness(data: AwarenessUpdate): void;
  /** Send a control command on the control channel. */
  sendControl(command: ControlCommand): void;

  // Channel subscriptions
  /** Subscribe to a logical channel to start receiving messages. */
  subscribeChannel(channel: ChannelType): void;
  /** Unsubscribe from a logical channel without closing the WebSocket. */
  unsubscribeChannel(channel: ChannelType): void;

  // State queries
  /** Get the current connection state. */
  getConnectionState(): ConnectionStateV2;
  /** Get the number of operations pending in the offline queue. */
  getOfflineQueueSize(): number;

  // Event handlers
  /** Register handler for state change events from merged operations. */
  onStateChange(handler: (event: StateChangeEvent) => void): void;
  /** Register handler for conflict resolution events. */
  onConflict(handler: (event: ConflictEvent) => void): void;
  /** Register handler for streamed performance metrics. */
  onMetrics(handler: (metrics: PerformanceMetrics) => void): void;
  /** Register handler for awareness updates from other clients. */
  onAwareness(handler: (update: AwarenessUpdate) => void): void;
  /** Register handler for connection state transitions. */
  onConnectionStateChange(handler: (state: ConnectionStateV2) => void): void;
}
