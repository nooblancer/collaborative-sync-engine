/**
 * Connection Manager V2 — Multi-room WebSocket gateway with channel multiplexing.
 *
 * Extends the original ConnectionManager concept to support:
 * - Multi-room sessions with dynamic join/leave
 * - Channel multiplexing (ops, awareness, metrics, control) over a single WebSocket
 * - CORS support for cross-origin WebSocket connections
 * - Participant tracking per room with presence broadcasts
 * - Room-not-found error handling
 * - State snapshot delivery on join
 * - Connection limit enforcement (200+ concurrent connections)
 *
 * Requirements: 1.1-1.7, 20.1-20.4, 22.4
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { v4 as uuidv4 } from "uuid";
import type {
  ClientFrame,
  ServerFrame,
  ChannelType,
  ControlPayload,
  RoomParticipant,
} from "../types/index.js";
import type { SyncEngineV2 } from "../engine/sync-engine-v2.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for ConnectionManagerV2. */
export interface ConnectionManagerV2Config {
  port: number;
  jwtSecret: string;
  corsOrigins: string[];
  maxConnectionsTotal: number;       // 200 minimum
  maxConnectionsPerRoom: number;     // Default 50
  heartbeatIntervalMs: number;       // 30000
  heartbeatTimeoutMs: number;        // 10000
  awarenessThrottleMs: number;       // ~16ms (60fps cap)
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** A tracked V2 WebSocket connection. */
interface TrackedConnectionV2 {
  ws: WebSocket;
  clientId: string;
  userId: string;
  displayName: string;
  connectedAt: number;
  /** Set of roomIds this client has joined. */
  rooms: Set<string>;
  /** Last heartbeat pong timestamp. */
  lastPong: number;
  /** Heartbeat interval handle. */
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  /** Per-room awareness throttle timestamps. */
  awarenessLastSent: Map<string, number>;
}

/** Channel handler function signature. */
type ChannelHandler = (
  client: TrackedConnectionV2,
  frame: ClientFrame
) => void;

// ---------------------------------------------------------------------------
// ConnectionManagerV2
// ---------------------------------------------------------------------------

export class ConnectionManagerV2 {
  private wss: WebSocketServer | null = null;
  private readonly config: ConnectionManagerV2Config;
  private readonly syncEngine: SyncEngineV2;

  /** All tracked connections by clientId. */
  private connections: Map<string, TrackedConnectionV2> = new Map();

  /** Room → Set of clientIds in the room. */
  private roomClients: Map<string, Set<string>> = new Map();

  /** Channel handlers. */
  private channelHandlers: Map<ChannelType, ChannelHandler>;

  constructor(config: ConnectionManagerV2Config, syncEngine: SyncEngineV2) {
    this.config = config;
    this.syncEngine = syncEngine;

    // Set up channel routing
    this.channelHandlers = new Map<ChannelType, ChannelHandler>([
      ["ops", this.handleOpsChannel.bind(this)],
      ["awareness", this.handleAwarenessChannel.bind(this)],
      ["metrics", this.handleMetricsChannel.bind(this)],
      ["control", this.handleControlChannel.bind(this)],
    ]);
  }

  /**
   * Start the WebSocket server. Optionally attach to an existing HTTP server.
   */
  start(server?: Server): WebSocketServer {
    const opts: Record<string, unknown> = {};

    if (server) {
      opts.server = server;
    } else {
      opts.port = this.config.port;
    }

    // CORS validation via verifyClient
    opts.verifyClient = (
      info: { origin: string; req: IncomingMessage },
      callback: (result: boolean, code?: number, message?: string) => void
    ) => {
      // Enforce connection limit
      if (this.connections.size >= this.config.maxConnectionsTotal) {
        callback(false, 503, "Server at maximum connection capacity");
        return;
      }

      // CORS validation
      const origin = info.origin || info.req.headers.origin || "";
      if (this.config.corsOrigins.length === 0 || this.config.corsOrigins.includes("*")) {
        callback(true);
        return;
      }
      if (this.config.corsOrigins.includes(origin)) {
        callback(true);
        return;
      }

      callback(false, 403, "Origin not allowed");
    };

    this.wss = new WebSocketServer(opts as any);

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
      tracked.ws.close(1001, "Server shutting down");
    }
    this.connections.clear();
    this.roomClients.clear();

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }

  /**
   * Handle new WebSocket connection. Assigns a clientId and sets up message routing.
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    // Extract client info from query params (simplified auth for V2)
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const userId = url.searchParams.get("userId") || uuidv4();
    const displayName = url.searchParams.get("displayName") || "Anonymous";
    const clientId = uuidv4();

    const tracked: TrackedConnectionV2 = {
      ws,
      clientId,
      userId,
      displayName,
      connectedAt: Date.now(),
      rooms: new Set(),
      lastPong: Date.now(),
      heartbeatInterval: null,
      awarenessLastSent: new Map(),
    };

    this.connections.set(clientId, tracked);

    // Send connected acknowledgment with clientId
    const connFrame: ServerFrame = {
      channel: "control",
      roomId: "",
      type: "control-response",
      payload: { type: "connected", clientId },
    };
    ws.send(JSON.stringify(connFrame));

    // Start heartbeat
    this.startHeartbeat(tracked);

    // Message handler
    ws.on("message", (data) => {
      this.handleMessage(tracked, data.toString());
    });

    // Disconnection handler
    ws.on("close", () => {
      this.handleDisconnection(tracked);
    });

    ws.on("error", () => {
      this.handleDisconnection(tracked);
    });
  }

  /**
   * Parse and route incoming messages to the correct channel handler.
   */
  private handleMessage(client: TrackedConnectionV2, rawData: string): void {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(rawData) as ClientFrame;
    } catch {
      this.sendError(client, "", "invalid_message", "Failed to parse message as JSON");
      return;
    }

    // Validate frame structure
    if (!frame.channel || frame.roomId === undefined || frame.seq === undefined) {
      this.sendError(client, "", "invalid_frame", "Message missing required fields (channel, roomId, seq)");
      return;
    }

    // Route to channel handler
    const handler = this.channelHandlers.get(frame.channel);
    if (!handler) {
      this.sendError(client, frame.roomId, "invalid_channel", `Unknown channel: ${frame.channel}`);
      return;
    }

    handler(client, frame);
  }

  // ---------------------------------------------------------------------------
  // Channel Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle operations channel messages — route to SyncEngine for merge.
   */
  private handleOpsChannel(client: TrackedConnectionV2, frame: ClientFrame): void {
    const { roomId } = frame;

    // Verify client is in the room
    if (!client.rooms.has(roomId)) {
      this.sendError(client, roomId, "not_in_room", "You must join the room before sending operations");
      return;
    }

    // Process the operation through the sync engine
    const payload = frame.payload as any;
    const operation = {
      id: payload.id || uuidv4(),
      type: payload.type || "update",
      itemId: payload.itemId || "",
      payload: payload.payload || {},
      timestamp: payload.timestamp || { wallTime: Date.now(), logical: 0, nodeId: client.clientId },
      version: payload.version || 1,
      replicaId: client.clientId,
      sessionId: roomId,
    };

    this.syncEngine.processOperation(roomId, operation).then((result) => {
      if (result.success) {
        // Send ACK to sender
        const ackFrame: ServerFrame = {
          channel: "ops",
          roomId,
          type: "ack",
          payload: { operationId: operation.id },
          replyTo: frame.seq,
        };
        this.sendToClient(client, ackFrame);

        // Broadcast delta to other room participants
        if (result.delta) {
          const deltaFrame: ServerFrame = {
            channel: "ops",
            roomId,
            type: "delta",
            payload: result.delta,
          };
          this.broadcastToRoom(roomId, deltaFrame, client.clientId);
        }
      } else {
        this.sendError(client, roomId, result.error?.code || "operation_failed", result.error?.message || "Operation processing failed", frame.seq);
      }
    }).catch(() => {
      this.sendError(client, roomId, "operation_failed", "Internal error processing operation", frame.seq);
    });
  }

  /**
   * Handle awareness channel messages — fire-and-forget relay to other room
   * participants with 60fps throttle (max 60 updates/sec per client per room).
   *
   * Key properties:
   * - Fire-and-forget: no persistence, no operation log, no database writes
   * - Throttled to max 60 updates/sec per sending client per room (~16.67ms min interval)
   * - Bypasses the sync engine entirely
   *
   * Requirements: 2.1-2.5
   */
  private handleAwarenessChannel(client: TrackedConnectionV2, frame: ClientFrame): void {
    const { roomId } = frame;

    if (!client.rooms.has(roomId)) {
      return; // Silently drop awareness from non-joined clients
    }

    // Throttle: enforce max 60 updates/sec per client per room
    // Using minimum interval of ceil(1000/60) = 17ms to guarantee <= 60 updates/sec
    const now = Date.now();
    const lastSent = client.awarenessLastSent.get(roomId) || 0;
    const minInterval = this.config.awarenessThrottleMs;
    if (now - lastSent < minInterval) {
      return; // Throttled — drop this update (fire-and-forget semantics)
    }
    client.awarenessLastSent.set(roomId, now);

    // Relay to other room participants — no persistence, no operation log
    const awarenessFrame: ServerFrame = {
      channel: "awareness",
      roomId,
      type: "awareness-update",
      payload: { ...frame.payload as object, clientId: client.clientId },
    };
    this.broadcastToRoom(roomId, awarenessFrame, client.clientId);
  }

  /**
   * Handle metrics channel messages — currently a no-op for client-sent metrics.
   */
  private handleMetricsChannel(_client: TrackedConnectionV2, _frame: ClientFrame): void {
    // Metrics channel is primarily server→client.
    // Client messages on this channel are currently ignored.
  }

  /**
   * Handle control channel messages — room join/leave and other commands.
   */
  private handleControlChannel(client: TrackedConnectionV2, frame: ClientFrame): void {
    const payload = frame.payload as ControlPayload;

    if (!payload || typeof payload !== "object" || !("type" in payload)) {
      this.sendError(client, frame.roomId, "invalid_payload", "Control payload must have a type field");
      return;
    }

    switch (payload.type) {
      case "join-room":
        this.handleJoinRoom(client, frame, payload as { type: "join-room"; roomId: string });
        break;
      case "leave-room":
        this.handleLeaveRoom(client, frame);
        break;
      case "create-room":
        this.handleCreateRoom(client, frame);
        break;
      default:
        // Forward other control commands (simulations etc) as-is
        this.sendControlResponse(client, frame.roomId, { type: payload.type, status: "acknowledged" }, frame.seq);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Room Management
  // ---------------------------------------------------------------------------

  /**
   * Handle join-room command: validate room, add participant, send snapshot, broadcast presence.
   */
  private handleJoinRoom(
    client: TrackedConnectionV2,
    frame: ClientFrame,
    payload: { type: "join-room"; roomId: string }
  ): void {
    const roomId = payload.roomId;

    // Validate room exists in SyncEngine
    const room = this.syncEngine.getRoom(roomId);
    if (!room) {
      const errorFrame: ServerFrame = {
        channel: "control",
        roomId,
        type: "error",
        payload: { code: "room_not_found", message: `Room "${roomId}" does not exist` },
        replyTo: frame.seq,
      };
      this.sendToClient(client, errorFrame);
      return;
    }

    // Check room connection limit
    const currentRoomClients = this.roomClients.get(roomId);
    if (currentRoomClients && currentRoomClients.size >= this.config.maxConnectionsPerRoom) {
      this.sendError(client, roomId, "room_full", `Room has reached maximum capacity of ${this.config.maxConnectionsPerRoom} connections`, frame.seq);
      return;
    }

    // Add participant to room
    const participant: RoomParticipant = {
      clientId: client.clientId,
      userId: client.userId,
      displayName: client.displayName,
      joinedAt: Date.now(),
    };

    room.participants.set(client.clientId, participant);
    client.rooms.add(roomId);

    if (!this.roomClients.has(roomId)) {
      this.roomClients.set(roomId, new Set());
    }
    this.roomClients.get(roomId)!.add(client.clientId);

    // Deliver current CRDT state snapshot to joining client
    const state = this.syncEngine.getState(roomId);
    const snapshotFrame: ServerFrame = {
      channel: "ops",
      roomId,
      type: "delta",
      payload: {
        sessionId: roomId,
        changes: Object.entries(state.items).map(([itemId, item]) => ({
          itemId,
          type: "add" as const,
          fields: item,
        })),
        timestamp: state.lastUpdated,
      },
      replyTo: frame.seq,
    };
    this.sendToClient(client, snapshotFrame);

    // Send join confirmation
    this.sendControlResponse(client, roomId, {
      type: "join-room",
      status: "joined",
      roomId,
      participants: Array.from(room.participants.values()),
    }, frame.seq);

    // Broadcast presence-join to other room participants
    const presenceFrame: ServerFrame = {
      channel: "control",
      roomId,
      type: "presence-join",
      payload: participant,
    };
    this.broadcastToRoom(roomId, presenceFrame, client.clientId);
  }

  /**
   * Handle leave-room command: remove participant, broadcast presence-leave.
   */
  private handleLeaveRoom(client: TrackedConnectionV2, frame: ClientFrame): void {
    const roomId = frame.roomId;

    if (!client.rooms.has(roomId)) {
      this.sendError(client, roomId, "not_in_room", "You are not in this room", frame.seq);
      return;
    }

    this.removeClientFromRoom(client, roomId);

    // Send leave confirmation
    this.sendControlResponse(client, roomId, {
      type: "leave-room",
      status: "left",
      roomId,
    }, frame.seq);
  }

  /**
   * Handle create-room command: create via SyncEngine, return room ID.
   */
  private handleCreateRoom(client: TrackedConnectionV2, frame: ClientFrame): void {
    // Use the client's requested roomId, or let the engine generate one
    const requestedRoomId = frame.roomId || undefined;
    const room = this.syncEngine.createRoom(requestedRoomId);

    // Add the client to the newly created room
    const participant: RoomParticipant = {
      clientId: client.clientId,
      userId: client.userId,
      displayName: client.displayName,
      joinedAt: Date.now(),
    };
    room.participants.set(client.clientId, participant);
    client.rooms.add(room.id);

    if (!this.roomClients.has(room.id)) {
      this.roomClients.set(room.id, new Set());
    }
    this.roomClients.get(room.id)!.add(client.clientId);

    this.sendControlResponse(client, room.id, {
      type: "create-room",
      status: "created",
      roomId: room.id,
    }, frame.seq);
  }

  /**
   * Remove a client from a room and broadcast presence-leave + cursor-removed.
   *
   * The cursor-removed broadcast occurs immediately (synchronously) upon
   * disconnect detection, ensuring delivery within the 100ms requirement.
   * Requirements: 2.4
   */
  private removeClientFromRoom(client: TrackedConnectionV2, roomId: string): void {
    client.rooms.delete(roomId);

    const roomClientSet = this.roomClients.get(roomId);
    if (roomClientSet) {
      roomClientSet.delete(client.clientId);
      if (roomClientSet.size === 0) {
        this.roomClients.delete(roomId);
      }
    }

    // Remove from sync engine room participants
    const room = this.syncEngine.getRoom(roomId);
    if (room) {
      room.participants.delete(client.clientId);
    }

    // Broadcast cursor-removed awareness update to remaining room participants (Req 2.4)
    const cursorRemovedFrame: ServerFrame = {
      channel: "awareness",
      roomId,
      type: "awareness-update",
      payload: { clientId: client.clientId, type: "cursor-removed" },
    };
    this.broadcastToRoom(roomId, cursorRemovedFrame, client.clientId);

    // Broadcast presence-leave to remaining room participants
    const presenceLeaveFrame: ServerFrame = {
      channel: "control",
      roomId,
      type: "presence-leave",
      payload: { clientId: client.clientId, userId: client.userId },
    };
    this.broadcastToRoom(roomId, presenceLeaveFrame, client.clientId);
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(tracked: TrackedConnectionV2): void {
    tracked.ws.on("pong", () => {
      tracked.lastPong = Date.now();
    });

    tracked.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      if (now - tracked.lastPong > this.config.heartbeatTimeoutMs) {
        // Stale connection — terminate
        if (tracked.heartbeatInterval) {
          clearInterval(tracked.heartbeatInterval);
          tracked.heartbeatInterval = null;
        }
        tracked.ws.terminate();
        return;
      }
      if (tracked.ws.readyState === WebSocket.OPEN) {
        tracked.ws.ping();
      }
    }, this.config.heartbeatIntervalMs);
  }

  // ---------------------------------------------------------------------------
  // Disconnection
  // ---------------------------------------------------------------------------

  private handleDisconnection(client: TrackedConnectionV2): void {
    // Prevent double-cleanup
    if (!this.connections.has(client.clientId)) return;

    // Clean up heartbeat
    if (client.heartbeatInterval) {
      clearInterval(client.heartbeatInterval);
      client.heartbeatInterval = null;
    }

    // Remove from all joined rooms
    for (const roomId of client.rooms) {
      this.removeClientFromRoom(client, roomId);
    }

    // Remove from global connections map
    this.connections.delete(client.clientId);
  }

  // ---------------------------------------------------------------------------
  // Messaging Utilities
  // ---------------------------------------------------------------------------

  /**
   * Send a ServerFrame to a specific client.
   */
  private sendToClient(client: TrackedConnectionV2, frame: ServerFrame): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(frame));
    }
  }

  /**
   * Broadcast a ServerFrame to all clients in a room, optionally excluding one.
   */
  private broadcastToRoom(roomId: string, frame: ServerFrame, excludeClientId?: string): void {
    const clientIds = this.roomClients.get(roomId);
    if (!clientIds) return;

    const data = JSON.stringify(frame);
    for (const cid of clientIds) {
      if (cid === excludeClientId) continue;
      const tracked = this.connections.get(cid);
      if (tracked && tracked.ws.readyState === WebSocket.OPEN) {
        tracked.ws.send(data);
      }
    }
  }

  /**
   * Send an error ServerFrame to a client.
   */
  private sendError(client: TrackedConnectionV2, roomId: string, code: string, message: string, replyTo?: number): void {
    const frame: ServerFrame = {
      channel: "control",
      roomId,
      type: "error",
      payload: { code, message },
      replyTo,
    };
    this.sendToClient(client, frame);
  }

  /**
   * Send a control-response ServerFrame to a client.
   */
  private sendControlResponse(client: TrackedConnectionV2, roomId: string, payload: unknown, replyTo?: number): void {
    const frame: ServerFrame = {
      channel: "control",
      roomId,
      type: "control-response",
      payload,
      replyTo,
    };
    this.sendToClient(client, frame);
  }

  // ---------------------------------------------------------------------------
  // Public Accessors (for testing and integration)
  // ---------------------------------------------------------------------------

  /** Get the total number of active connections. */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /** Get the number of clients in a specific room. */
  getRoomClientCount(roomId: string): number {
    return this.roomClients.get(roomId)?.size ?? 0;
  }

  /** Get a tracked connection by clientId (for testing). */
  getConnection(clientId: string): TrackedConnectionV2 | undefined {
    return this.connections.get(clientId);
  }

  /** Get the underlying WebSocketServer instance. */
  getServer(): WebSocketServer | null {
    return this.wss;
  }

  /** Get all client IDs currently in a room. */
  getRoomClientIds(roomId: string): string[] {
    const set = this.roomClients.get(roomId);
    return set ? Array.from(set) : [];
  }
}
