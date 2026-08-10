/**
 * Connection-related type definitions for WebSocket sessions,
 * user presence, and session metadata.
 */

/** ConnectionState enumerates WebSocket session states. */
export type ConnectionState = "connected" | "stale" | "disconnected";

/** WebSocketSession represents a single authenticated WebSocket connection. */
export interface WebSocketSession {
  id: string;
  userId: string;
  displayName: string;
  connectedAt: number;
  lastHeartbeat: number;
  state: ConnectionState;
}

/** UserPresence represents a user's presence in a session. */
export interface UserPresence {
  userId: string;
  /** 1-100 characters */
  displayName: string;
  connectedAt: number;
  status: "online" | "offline";
}

/** SessionInfo contains session metadata. */
export interface SessionInfo {
  id: string;
  createdBy: string;
  createdAt: number;
  maxConnections: number;
  isActive: boolean;
}
