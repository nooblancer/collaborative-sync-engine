/**
 * Connection Manager - WebSocket server lifecycle management.
 * Handles connection establishment, JWT authentication, session assignment,
 * and connection limit enforcement.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import type {
  WebSocketSession,
  UserPresence,
  SessionInfo,
  ConnectionState,
  ServerMessage,
  CRDTOperation,
  StateDelta,
} from "../types/index.js";

/** Configuration options for the ConnectionManager. */
export interface ConnectionManagerConfig {
  /** Port for the WebSocket server (if no external HTTP server provided) */
  port?: number;
  /** JWT secret used to verify authentication tokens */
  jwtSecret: string;
  /** Maximum concurrent connections per session (default: 50) */
  maxConnectionsPerSession?: number;
  /** Connection establishment timeout in milliseconds (default: 3000) */
  connectionTimeoutMs?: number;
  /** Heartbeat ping interval in milliseconds (default: 30000, max 30s per spec) */
  heartbeatIntervalMs?: number;
  /** Heartbeat pong timeout in milliseconds — treat as disconnected if no pong within this (default: 30000, per requirement 2.3) */
  heartbeatTimeoutMs?: number;
  /** Grace period in ms for expired tokens before forced disconnect (default: 30000) */
  tokenGracePeriodMs?: number;
}

/** JWT payload structure expected in auth tokens. */
export interface TokenPayload {
  userId: string;
  displayName: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

/** A queued delta for a disconnected client. */
interface QueuedDelta {
  delta: StateDelta;
  queuedAt: number;
}

/** Maximum number of queued deltas per disconnected client. */
const MAX_QUEUED_DELTAS = 1000;

/** Maximum age for queued deltas (24 hours in milliseconds). */
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;

/** Internal tracked connection combining WebSocket with session data. */
interface TrackedConnection {
  ws: WebSocket;
  session: WebSocketSession;
  sessionId: string;
  /** Timestamp of the last pong received (or connection time if no pong yet) */
  lastPong: number;
  /** Interval ID for the heartbeat timer */
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  /** Token expiration timestamp (ms since epoch), null if token has no exp */
  tokenExpiresAt: number | null;
  /** Grace period timer for expired tokens (30s before forced disconnect) */
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * ConnectionManager manages WebSocket lifecycle, authentication,
 * and connection tracking.
 */
export class ConnectionManager {
  private wss: WebSocketServer | null = null;
  private readonly config: Required<ConnectionManagerConfig>;
  /** Map of client session ID → tracked connection */
  private connections: Map<string, TrackedConnection> = new Map();
  /** Map of session ID → set of client session IDs in that session */
  private sessionConnections: Map<string, Set<string>> = new Map();
  /** Queued deltas for disconnected clients (keyed by clientSessionId) */
  private missedUpdates: Map<string, QueuedDelta[]> = new Map();
  /** Clients that have exceeded queue limits and require full resync */
  private resyncRequired: Set<string> = new Set();
  /** Callback invoked when a client sends an operation */
  onOperation?: (clientId: string, operation: CRDTOperation) => Promise<void>;

  constructor(config: ConnectionManagerConfig) {
    this.config = {
      port: config.port ?? 0,
      jwtSecret: config.jwtSecret,
      maxConnectionsPerSession: config.maxConnectionsPerSession ?? 50,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 3000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 10000,
      tokenGracePeriodMs: config.tokenGracePeriodMs ?? 30000,
    };
  }

  /**
   * Start the WebSocket server. Optionally attach to an existing HTTP server.
   */
  start(server?: Server): WebSocketServer {
    if (server) {
      this.wss = new WebSocketServer({ server });
    } else {
      this.wss = new WebSocketServer({ port: this.config.port });
    }

    this.wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      this.handleConnection(ws, request);
    });

    return this.wss;
  }

  /**
   * Stop the WebSocket server and close all connections.
   */
  async stop(): Promise<void> {
    if (!this.wss) return;

    for (const [, tracked] of this.connections) {
      if (tracked.heartbeatInterval) {
        clearInterval(tracked.heartbeatInterval);
        tracked.heartbeatInterval = null;
      }
      if (tracked.graceTimer) {
        clearTimeout(tracked.graceTimer);
        tracked.graceTimer = null;
      }
      tracked.ws.close(1001, "Server shutting down");
    }
    this.connections.clear();
    this.sessionConnections.clear();

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }

  /**
   * Handle a new WebSocket connection: authenticate, assign session, enforce limits.
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const timeout = setTimeout(() => {
      const errorMsg: ServerMessage = {
        type: "error",
        code: "connection_timeout",
        message: "Connection establishment timed out",
        reason: "timeout",
      };
      ws.send(JSON.stringify(errorMsg));
      ws.close(4008, "Connection timeout");
    }, this.config.connectionTimeoutMs);

    try {
      const token = this.extractToken(request);
      if (!token) {
        clearTimeout(timeout);
        this.rejectConnection(ws, "malformed", "No authentication token provided");
        return;
      }

      // Verify token and check payload validity
      let decoded: TokenPayload;
      try {
        decoded = jwt.verify(token, this.config.jwtSecret) as TokenPayload;
      } catch (err: unknown) {
        clearTimeout(timeout);
        if (err instanceof jwt.TokenExpiredError) {
          this.rejectConnection(ws, "expired", "Authentication token has expired");
        } else if (err instanceof jwt.JsonWebTokenError) {
          this.rejectConnection(ws, "malformed", "Authentication token is malformed");
        } else {
          this.rejectConnection(ws, "unauthorized", "Authentication failed");
        }
        return;
      }

      if (!decoded.userId || !decoded.sessionId) {
        clearTimeout(timeout);
        this.rejectConnection(ws, "malformed", "Token missing required fields");
        return;
      }

      // Validate displayName length (1-100 characters per requirement 2.5)
      const displayName = decoded.displayName ?? "";
      if (displayName.length < 1 || displayName.length > 100) {
        clearTimeout(timeout);
        this.rejectConnection(
          ws,
          "malformed",
          "Display name must be between 1 and 100 characters"
        );
        return;
      }

      const sessionId = decoded.sessionId;

      // Enforce max connections per session
      const currentConnections = this.sessionConnections.get(sessionId);
      const connectionCount = currentConnections?.size ?? 0;

      if (connectionCount >= this.config.maxConnectionsPerSession) {
        clearTimeout(timeout);
        const errorMsg: ServerMessage = {
          type: "error",
          code: "session_full",
          message: `Session has reached the maximum of ${this.config.maxConnectionsPerSession} connections`,
          reason: "session_full",
        };
        ws.send(JSON.stringify(errorMsg));
        ws.close(4003, "Session full");
        return;
      }

      // Create WebSocket session
      const clientSessionId = uuidv4();
      const now = Date.now();
      const session: WebSocketSession = {
        id: clientSessionId,
        userId: decoded.userId,
        displayName: decoded.displayName,
        connectedAt: now,
        lastHeartbeat: now,
        state: "connected" as ConnectionState,
      };

      // Track the connection
      const tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : null;
      const tracked: TrackedConnection = {
        ws,
        session,
        sessionId,
        lastPong: now,
        heartbeatInterval: null,
        tokenExpiresAt,
        graceTimer: null,
      };
      this.connections.set(clientSessionId, tracked);

      if (!this.sessionConnections.has(sessionId)) {
        this.sessionConnections.set(sessionId, new Set());
      }
      this.sessionConnections.get(sessionId)!.add(clientSessionId);

      clearTimeout(timeout);

      // Start token expiration grace period timer if token has expiry
      if (tokenExpiresAt) {
        this.scheduleTokenGracePeriod(clientSessionId, tokenExpiresAt);
      }

      // Start heartbeat monitoring for this connection
      this.startHeartbeat(clientSessionId, tracked);

      // Broadcast presence-join to other clients in the session
      const userPresence: UserPresence = {
        userId: decoded.userId,
        displayName: decoded.displayName,
        connectedAt: now,
        status: "online",
      };
      this.broadcastPresenceJoin(sessionId, userPresence, clientSessionId);

      // Handle disconnection
      ws.on("close", () => {
        this.handleDisconnection(clientSessionId, sessionId, decoded.userId);
      });

      ws.on("error", () => {
        this.handleDisconnection(clientSessionId, sessionId, decoded.userId);
      });

      // Handle incoming messages (operations, presence requests, token-refresh)
      ws.on("message", (data) => {
        this.handleMessage(clientSessionId, sessionId, data.toString());
      });

    } catch {
      clearTimeout(timeout);
      this.rejectConnection(ws, "unauthorized", "Connection establishment failed");
    }
  }

  /**
   * Extract the authentication token from the request.
   * Checks URL query parameter `token` first, then the Authorization header.
   */
  private extractToken(request: IncomingMessage): string | null {
    // Try URL query parameter
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const queryToken = url.searchParams.get("token");
    if (queryToken) return queryToken;

    // Try Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    return null;
  }


  /**
   * Reject a WebSocket connection with an error message.
   */
  private rejectConnection(ws: WebSocket, code: string, message: string): void {
    const errorMsg: ServerMessage = {
      type: "error",
      code,
      message,
      reason: code,
    };
    ws.send(JSON.stringify(errorMsg));
    ws.close(4001, message);
  }

  /**
   * Handle a token-refresh request on an active connection.
   * Validates the new token and updates session credentials without disconnect.
   * If invalid, sends an error but does NOT disconnect (grace period may still be active).
   */
  private handleTokenRefresh(clientSessionId: string, newToken?: string): void {
    const tracked = this.connections.get(clientSessionId);
    if (!tracked) return;

    if (!newToken) {
      const errorMsg: ServerMessage = {
        type: "error",
        code: "token_refresh_failed",
        message: "No token provided in refresh request",
        reason: "token_refresh_failed",
      };
      tracked.ws.send(JSON.stringify(errorMsg));
      return;
    }

    let decoded: TokenPayload;
    try {
      decoded = jwt.verify(newToken, this.config.jwtSecret) as TokenPayload;
    } catch {
      // Invalid token — send error but do NOT disconnect (old token grace period still applies)
      const errorMsg: ServerMessage = {
        type: "error",
        code: "token_refresh_failed",
        message: "Invalid token provided for refresh",
        reason: "token_refresh_failed",
      };
      tracked.ws.send(JSON.stringify(errorMsg));
      return;
    }

    if (!decoded.userId || !decoded.sessionId) {
      const errorMsg: ServerMessage = {
        type: "error",
        code: "token_refresh_failed",
        message: "Refresh token missing required fields",
        reason: "token_refresh_failed",
      };
      tracked.ws.send(JSON.stringify(errorMsg));
      return;
    }

    // Token is valid — update session credentials without disconnecting
    tracked.session.userId = decoded.userId;
    tracked.session.displayName = decoded.displayName;
    tracked.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : null;

    // Cancel existing grace period timer since we have a fresh token
    if (tracked.graceTimer) {
      clearTimeout(tracked.graceTimer);
      tracked.graceTimer = null;
    }

    // Schedule a new grace period based on the new token's expiry
    if (tracked.tokenExpiresAt) {
      this.scheduleTokenGracePeriod(clientSessionId, tracked.tokenExpiresAt);
    }

    // Send acknowledgment to client
    const ackMsg: ServerMessage = {
      type: "ack",
      message: "Token refreshed successfully",
    };
    tracked.ws.send(JSON.stringify(ackMsg));
  }

  /**
   * Schedule the token expiration grace period.
   * When the token expires, starts a 30-second grace period.
   * If no valid refresh is received within the grace period, force-disconnects.
   */
  private scheduleTokenGracePeriod(clientSessionId: string, tokenExpiresAt: number): void {
    const tracked = this.connections.get(clientSessionId);
    if (!tracked) return;

    const now = Date.now();
    const timeUntilExpiry = tokenExpiresAt - now;

    if (timeUntilExpiry <= 0) {
      // Token already expired — start grace period immediately
      this.startGracePeriod(clientSessionId);
    } else {
      // Schedule grace period to start when token expires
      // We use a timer to fire at expiry, then start the grace period
      tracked.graceTimer = setTimeout(() => {
        this.startGracePeriod(clientSessionId);
      }, timeUntilExpiry);
    }
  }

  /**
   * Start the 30-second grace period after token expiration.
   * If no valid token-refresh is received within the grace period, force disconnect.
   */
  private startGracePeriod(clientSessionId: string): void {
    const tracked = this.connections.get(clientSessionId);
    if (!tracked) return;

    tracked.graceTimer = setTimeout(() => {
      // Grace period expired — force disconnect
      const conn = this.connections.get(clientSessionId);
      if (!conn) return;

      const errorMsg: ServerMessage = {
        type: "error",
        code: "token_expired",
        message: "Authentication token expired and no valid refresh was provided",
        reason: "token_expired",
      };
      conn.ws.send(JSON.stringify(errorMsg));
      conn.ws.close(4001, "Token expired");
    }, this.config.tokenGracePeriodMs);
  }

  /**
   * Start heartbeat monitoring for a tracked connection.
   * Sends ws.ping() at the configured interval and checks for stale connections.
   */
  private startHeartbeat(clientSessionId: string, tracked: TrackedConnection): void {
    const { ws } = tracked;

    // Listen for pong responses to update lastPong timestamp
    ws.on("pong", () => {
      const conn = this.connections.get(clientSessionId);
      if (conn) {
        conn.lastPong = Date.now();
        conn.session.lastHeartbeat = conn.lastPong;
      }
    });

    // Start interval to send pings and check for stale connections
    tracked.heartbeatInterval = setInterval(() => {
      const conn = this.connections.get(clientSessionId);
      if (!conn) {
        // Connection already removed, clear this interval
        if (tracked.heartbeatInterval) {
          clearInterval(tracked.heartbeatInterval);
          tracked.heartbeatInterval = null;
        }
        return;
      }

      const now = Date.now();
      const elapsed = now - conn.lastPong;

      if (elapsed > this.config.heartbeatTimeoutMs) {
        // Connection is stale — terminate it and update presence to offline
        conn.session.state = "stale";
        if (conn.heartbeatInterval) {
          clearInterval(conn.heartbeatInterval);
          conn.heartbeatInterval = null;
        }
        conn.ws.terminate();
        // handleDisconnection will be triggered by the 'close' event from terminate()
      } else {
        // Send ping
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Handle client disconnection: clean up tracking and broadcast presence-leave.
   */
  private handleDisconnection(clientSessionId: string, sessionId: string, userId: string): void {
    const tracked = this.connections.get(clientSessionId);
    if (!tracked) return; // Already cleaned up

    // Clear heartbeat interval
    if (tracked.heartbeatInterval) {
      clearInterval(tracked.heartbeatInterval);
      tracked.heartbeatInterval = null;
    }

    // Clear grace timer if active
    if (tracked.graceTimer) {
      clearTimeout(tracked.graceTimer);
      tracked.graceTimer = null;
    }

    // Update session state
    tracked.session.state = "disconnected";

    // Remove from tracking
    this.connections.delete(clientSessionId);
    const sessionConns = this.sessionConnections.get(sessionId);
    if (sessionConns) {
      sessionConns.delete(clientSessionId);
      if (sessionConns.size === 0) {
        this.sessionConnections.delete(sessionId);
      }
    }

    // Broadcast presence-leave
    this.broadcastPresenceLeave(sessionId, userId);
  }

  /**
   * Broadcast a presence-join event to all other clients in the session.
   */
  broadcastPresenceJoin(sessionId: string, user: UserPresence, excludeClientId?: string): void {
    const msg: ServerMessage = {
      type: "presence-join",
      user,
    };
    this.broadcastToSession(sessionId, msg, excludeClientId);
  }

  /**
   * Broadcast a presence-leave event to all clients in the session.
   */
  broadcastPresenceLeave(sessionId: string, userId: string): void {
    const msg: ServerMessage = {
      type: "presence-leave",
      userId,
    };
    this.broadcastToSession(sessionId, msg);
  }

  /**
   * Get the list of currently connected users in a session.
   */
  getPresenceList(sessionId: string): UserPresence[] {
    const sessionConns = this.sessionConnections.get(sessionId);
    if (!sessionConns) return [];

    const users: UserPresence[] = [];
    for (const clientId of sessionConns) {
      const tracked = this.connections.get(clientId);
      if (tracked && tracked.session.state === "connected") {
        users.push({
          userId: tracked.session.userId,
          displayName: tracked.session.displayName,
          connectedAt: tracked.session.connectedAt,
          status: "online",
        });
      }
    }
    return users;
  }

  /**
   * Get a tracked connection by its client session ID.
   */
  getConnection(clientSessionId: string): TrackedConnection | undefined {
    return this.connections.get(clientSessionId);
  }

  /**
   * Get count of active connections for a session.
   */
  getConnectionCount(sessionId: string): number {
    return this.sessionConnections.get(sessionId)?.size ?? 0;
  }

  /**
   * Terminate a specific client connection.
   */
  async terminateConnection(clientSessionId: string, reason: string): Promise<void> {
    const tracked = this.connections.get(clientSessionId);
    if (!tracked) return;

    const errorMsg: ServerMessage = {
      type: "error",
      code: "terminated",
      message: reason,
      reason: "terminated",
    };
    tracked.ws.send(JSON.stringify(errorMsg));
    tracked.ws.close(4000, reason);
  }

  /**
   * Send a message to a specific client.
   */
  sendToClient(clientSessionId: string, message: ServerMessage): void {
    const tracked = this.connections.get(clientSessionId);
    if (tracked && tracked.ws.readyState === WebSocket.OPEN) {
      tracked.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast a message to all clients in a session, optionally excluding one.
   */
  private broadcastToSession(sessionId: string, message: ServerMessage, excludeClientId?: string): void {
    const sessionConns = this.sessionConnections.get(sessionId);
    if (!sessionConns) return;

    const data = JSON.stringify(message);
    for (const clientId of sessionConns) {
      if (clientId === excludeClientId) continue;
      const tracked = this.connections.get(clientId);
      if (tracked && tracked.ws.readyState === WebSocket.OPEN) {
        tracked.ws.send(data);
      }
    }
  }

  /**
   * Get the underlying WebSocketServer instance.
   */
  getServer(): WebSocketServer | null {
    return this.wss;
  }

  /**
   * Handle an incoming WebSocket message from a client.
   * Routes operations, presence requests, and pong messages.
   */
  private handleMessage(clientSessionId: string, sessionId: string, rawData: string): void {
    let message: { type?: string; payload?: unknown };
    try {
      message = JSON.parse(rawData);
    } catch {
      this.sendToClient(clientSessionId, {
        type: "error",
        code: "invalid_message",
        message: "Failed to parse message as JSON",
      });
      return;
    }

    switch (message.type) {
      case "operation": {
        const operation = message.payload as CRDTOperation;
        if (this.onOperation) {
          this.onOperation(clientSessionId, operation).catch(() => {
            this.sendToClient(clientSessionId, {
              type: "error",
              code: "operation_failed",
              message: "Failed to process operation",
            });
          });
        }
        break;
      }
      case "presence-request": {
        const users = this.getPresenceList(sessionId);
        this.sendToClient(clientSessionId, {
          type: "presence-list",
          users,
        });
        break;
      }
      case "pong": {
        // Handled by heartbeat ws.on("pong") — this is for application-level pongs
        const conn = this.connections.get(clientSessionId);
        if (conn) {
          conn.lastPong = Date.now();
          conn.session.lastHeartbeat = conn.lastPong;
        }
        break;
      }
      case "token-refresh": {
        this.handleTokenRefresh(clientSessionId, (message as { token?: string }).token);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Broadcast a delta to all connected clients in a session, excluding the sender.
   * If a client is disconnected (ws not open), the delta is queued for later delivery.
   */
  broadcastDelta(sessionId: string, delta: StateDelta, excludeClientId: string): void {
    const sessionConns = this.sessionConnections.get(sessionId);
    if (!sessionConns) return;

    const msg: ServerMessage = {
      type: "delta",
      payload: delta,
    };
    const data = JSON.stringify(msg);

    for (const clientId of sessionConns) {
      if (clientId === excludeClientId) continue;
      const tracked = this.connections.get(clientId);
      if (tracked && tracked.ws.readyState === WebSocket.OPEN) {
        tracked.ws.send(data);
      } else if (tracked) {
        // Client is connected but websocket isn't open — queue the delta
        this.queueMissedUpdate(clientId, delta);
      }
    }
  }

  /**
   * Queue a missed delta for a disconnected client.
   * Enforces max 1000 deltas per client and 24-hour max age.
   */
  queueMissedUpdate(clientId: string, delta: StateDelta): void {
    // If client already requires resync, don't queue anything
    if (this.resyncRequired.has(clientId)) {
      return;
    }

    let queue = this.missedUpdates.get(clientId);
    if (!queue) {
      queue = [];
      this.missedUpdates.set(clientId, queue);
    }

    queue.push({ delta, queuedAt: Date.now() });

    // If queue exceeds limits, mark for full resync (clear queue)
    if (queue.length > MAX_QUEUED_DELTAS) {
      this.missedUpdates.delete(clientId);
      this.resyncRequired.add(clientId);
    }
  }

  /**
   * Flush all queued deltas to a reconnected client in generation order.
   * If the queue exceeds limits (count or age), clears the queue and sends resync-required.
   * Returns true if deltas were flushed, false if resync was triggered.
   */
  flushQueuedUpdates(clientId: string): boolean {
    // If client was marked for resync due to queue overflow, trigger resync
    if (this.resyncRequired.has(clientId)) {
      this.resyncRequired.delete(clientId);
      this.missedUpdates.delete(clientId);
      this.sendToClient(clientId, {
        type: "resync-required",
        reason: "Missed update queue exceeded limits",
      });
      return false;
    }

    const queue = this.missedUpdates.get(clientId);
    if (!queue || queue.length === 0) {
      this.missedUpdates.delete(clientId);
      return true;
    }

    const now = Date.now();

    // Check if queue exceeds limits
    const oldestEntry = queue[0];
    if (queue.length > MAX_QUEUED_DELTAS || (now - oldestEntry.queuedAt) > MAX_QUEUE_AGE_MS) {
      // Queue has exceeded limits — trigger full resync
      this.missedUpdates.delete(clientId);
      this.sendToClient(clientId, {
        type: "resync-required",
        reason: "Missed update queue exceeded limits",
      });
      return false;
    }

    // Send all queued deltas in order
    for (const entry of queue) {
      const msg: ServerMessage = {
        type: "delta",
        payload: entry.delta,
      };
      this.sendToClient(clientId, msg);
    }

    // Clear the queue after flushing
    this.missedUpdates.delete(clientId);
    return true;
  }

  /**
   * Get the count of queued deltas for a specific client. (Useful for testing)
   */
  getQueuedUpdateCount(clientId: string): number {
    return this.missedUpdates.get(clientId)?.length ?? 0;
  }

  /**
   * Get the missed updates map (exposed for testing).
   */
  getMissedUpdates(): Map<string, QueuedDelta[]> {
    return this.missedUpdates;
  }
}
