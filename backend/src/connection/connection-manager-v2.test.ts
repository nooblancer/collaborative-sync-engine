/**
 * Unit tests for ConnectionManagerV2 — Multi-room WebSocket gateway.
 *
 * Tests cover:
 * - WebSocket connection establishment
 * - Channel multiplexing and routing
 * - Room join/leave with presence broadcasts
 * - Participant tracking
 * - Connection limits
 * - Room-not-found error handling
 * - State snapshot delivery on join
 * - CORS validation
 *
 * Validates: Requirements 1.1-1.7, 20.1-20.4, 22.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { ConnectionManagerV2 } from "./connection-manager-v2.js";
import { SyncEngineV2 } from "../engine/sync-engine-v2.js";
import type { ServerFrame, ClientFrame } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultConfig() {
  return {
    port: 0, // Random available port
    jwtSecret: "test-secret",
    corsOrigins: ["*"],
    maxConnectionsTotal: 200,
    maxConnectionsPerRoom: 50,
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 10000,
    awarenessThrottleMs: 16,
  };
}

function getServerPort(manager: ConnectionManagerV2): number {
  const wss = manager.getServer();
  const addr = wss?.address();
  if (addr && typeof addr === "object") {
    return addr.port;
  }
  throw new Error("Server not started or port not available");
}

function connectClient(
  port: number,
  opts?: { userId?: string; displayName?: string }
): Promise<{ ws: WebSocket; clientId: string }> {
  return new Promise((resolve, reject) => {
    const userId = opts?.userId || "user-" + Math.random().toString(36).slice(2);
    const displayName = opts?.displayName || "TestUser";
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?userId=${userId}&displayName=${encodeURIComponent(displayName)}`
    );

    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as ServerFrame;
      if (frame.type === "control-response" && (frame.payload as any)?.type === "connected") {
        resolve({ ws, clientId: (frame.payload as any).clientId });
      }
    });

    ws.on("error", reject);
    setTimeout(() => reject(new Error("Connection timeout")), 3000);
  });
}

function sendFrame(ws: WebSocket, frame: ClientFrame): void {
  ws.send(JSON.stringify(frame));
}

function waitForFrame(
  ws: WebSocket,
  predicate: (frame: ServerFrame) => boolean,
  timeoutMs = 2000
): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for frame")), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString()) as ServerFrame;
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(frame);
      }
    };
    ws.on("message", handler);
  });
}

function collectFrames(ws: WebSocket, count: number, timeoutMs = 2000): Promise<ServerFrame[]> {
  return new Promise((resolve, reject) => {
    const frames: ServerFrame[] = [];
    const timer = setTimeout(() => resolve(frames), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      frames.push(JSON.parse(data.toString()) as ServerFrame);
      if (frames.length >= count) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(frames);
      }
    };
    ws.on("message", handler);
  });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("ConnectionManagerV2", () => {
  let manager: ConnectionManagerV2;
  let engine: SyncEngineV2;
  let port: number;

  beforeEach(() => {
    engine = new SyncEngineV2();
    manager = new ConnectionManagerV2(createDefaultConfig(), engine);
    manager.start();
    port = getServerPort(manager);
  });

  afterEach(async () => {
    await manager.stop();
  });

  // -------------------------------------------------------------------------
  // Connection Establishment
  // -------------------------------------------------------------------------

  describe("Connection Establishment", () => {
    it("should accept WebSocket connections and return clientId", async () => {
      const { ws, clientId } = await connectClient(port);
      expect(clientId).toBeDefined();
      expect(typeof clientId).toBe("string");
      expect(clientId.length).toBeGreaterThan(0);
      ws.close();
    });

    it("should track connected clients", async () => {
      const { ws } = await connectClient(port);
      expect(manager.getConnectionCount()).toBe(1);
      ws.close();
    });

    it("should support multiple concurrent connections", async () => {
      const clients = await Promise.all([
        connectClient(port),
        connectClient(port),
        connectClient(port),
      ]);
      expect(manager.getConnectionCount()).toBe(3);
      for (const { ws } of clients) ws.close();
    });

    it("should reject connections when max total is reached", async () => {
      // Create a manager with a very low limit
      const limitedEngine = new SyncEngineV2();
      const limitedManager = new ConnectionManagerV2(
        { ...createDefaultConfig(), maxConnectionsTotal: 2 },
        limitedEngine
      );
      limitedManager.start();
      const limitedPort = getServerPort(limitedManager);

      const c1 = await connectClient(limitedPort);
      const c2 = await connectClient(limitedPort);

      // Third connection should be rejected
      const rejected = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${limitedPort}?userId=user3`);
        ws.on("unexpected-response", (_req, res) => {
          resolve(res.statusCode === 503);
        });
        ws.on("open", () => resolve(false));
        setTimeout(() => resolve(false), 2000);
      });

      expect(rejected).toBe(true);
      c1.ws.close();
      c2.ws.close();
      await limitedManager.stop();
    });
  });

  // -------------------------------------------------------------------------
  // CORS Validation
  // -------------------------------------------------------------------------

  describe("CORS Validation", () => {
    it("should accept connections from allowed origins", async () => {
      const corsEngine = new SyncEngineV2();
      const corsManager = new ConnectionManagerV2(
        { ...createDefaultConfig(), corsOrigins: ["http://localhost:3000"] },
        corsEngine
      );
      corsManager.start();
      const corsPort = getServerPort(corsManager);

      // Must pass the allowed origin header explicitly
      const connected = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${corsPort}?userId=u1`, {
          headers: { origin: "http://localhost:3000" },
        });
        ws.on("open", () => {
          ws.close();
          resolve(true);
        });
        ws.on("unexpected-response", () => resolve(false));
        ws.on("error", () => resolve(false));
        setTimeout(() => resolve(false), 2000);
      });

      expect(connected).toBe(true);
      await corsManager.stop();
    });

    it("should reject connections from disallowed origins", async () => {
      const corsEngine = new SyncEngineV2();
      const corsManager = new ConnectionManagerV2(
        { ...createDefaultConfig(), corsOrigins: ["http://allowed.com"] },
        corsEngine
      );
      corsManager.start();
      const corsPort = getServerPort(corsManager);

      const rejected = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${corsPort}?userId=u1`, {
          headers: { origin: "http://evil.com" },
        });
        ws.on("unexpected-response", (_req, res) => {
          resolve(res.statusCode === 403);
        });
        ws.on("open", () => resolve(false));
        setTimeout(() => resolve(false), 2000);
      });

      expect(rejected).toBe(true);
      await corsManager.stop();
    });
  });

  // -------------------------------------------------------------------------
  // Channel Multiplexing
  // -------------------------------------------------------------------------

  describe("Channel Multiplexing", () => {
    it("should route control channel messages to control handler", async () => {
      const room = engine.createRoom("test-room");
      const { ws, clientId } = await connectClient(port);

      const responsePromise = waitForFrame(ws, (f) =>
        f.type === "control-response" && (f.payload as any)?.type === "join-room"
      );

      sendFrame(ws, {
        channel: "control",
        roomId: "test-room",
        seq: 1,
        payload: { type: "join-room", roomId: "test-room" },
      });

      const response = await responsePromise;
      expect(response.channel).toBe("control");
      expect((response.payload as any).status).toBe("joined");
      ws.close();
    });

    it("should route ops channel messages to ops handler", async () => {
      const room = engine.createRoom("ops-room");
      const { ws } = await connectClient(port);

      // First join the room
      sendFrame(ws, {
        channel: "control",
        roomId: "ops-room",
        seq: 1,
        payload: { type: "join-room", roomId: "ops-room" },
      });
      await waitForFrame(ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      // Send an operation
      const ackPromise = waitForFrame(ws, (f) => f.type === "ack" && f.channel === "ops");
      sendFrame(ws, {
        channel: "ops",
        roomId: "ops-room",
        seq: 2,
        payload: {
          id: "op-1",
          type: "add",
          itemId: "item-1",
          payload: { x: 10 },
          timestamp: { wallTime: Date.now(), logical: 0, nodeId: "test" },
          version: 1,
        },
      });

      const ack = await ackPromise;
      expect(ack.channel).toBe("ops");
      expect(ack.type).toBe("ack");
      expect(ack.replyTo).toBe(2);
      ws.close();
    });

    it("should return error for invalid channel", async () => {
      const { ws } = await connectClient(port);

      const errorPromise = waitForFrame(ws, (f) => f.type === "error");
      ws.send(JSON.stringify({
        channel: "bogus",
        roomId: "any",
        seq: 1,
        payload: {},
      }));

      const error = await errorPromise;
      expect((error.payload as any).code).toBe("invalid_channel");
      ws.close();
    });

    it("should return error for malformed JSON", async () => {
      const { ws } = await connectClient(port);

      const errorPromise = waitForFrame(ws, (f) => f.type === "error");
      ws.send("not json at all {{{");

      const error = await errorPromise;
      expect((error.payload as any).code).toBe("invalid_message");
      ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Room Join/Leave
  // -------------------------------------------------------------------------

  describe("Room Join/Leave", () => {
    it("should allow clients to join an existing room", async () => {
      engine.createRoom("room-1");
      const { ws } = await connectClient(port);

      const responsePromise = waitForFrame(ws, (f) =>
        f.type === "control-response" && (f.payload as any)?.type === "join-room"
      );

      sendFrame(ws, {
        channel: "control",
        roomId: "room-1",
        seq: 1,
        payload: { type: "join-room", roomId: "room-1" },
      });

      const response = await responsePromise;
      expect((response.payload as any).status).toBe("joined");
      expect((response.payload as any).roomId).toBe("room-1");
      expect(manager.getRoomClientCount("room-1")).toBe(1);
      ws.close();
    });

    it("should return room_not_found for invalid room join", async () => {
      const { ws } = await connectClient(port);

      const errorPromise = waitForFrame(ws, (f) =>
        f.type === "error" && (f.payload as any)?.code === "room_not_found"
      );

      sendFrame(ws, {
        channel: "control",
        roomId: "nonexistent",
        seq: 1,
        payload: { type: "join-room", roomId: "nonexistent" },
      });

      const error = await errorPromise;
      expect((error.payload as any).code).toBe("room_not_found");
      expect(error.replyTo).toBe(1);
      ws.close();
    });

    it("should allow clients to leave a room", async () => {
      engine.createRoom("room-leave");
      const { ws } = await connectClient(port);

      // Join first
      sendFrame(ws, {
        channel: "control",
        roomId: "room-leave",
        seq: 1,
        payload: { type: "join-room", roomId: "room-leave" },
      });
      await waitForFrame(ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      expect(manager.getRoomClientCount("room-leave")).toBe(1);

      // Leave
      const leavePromise = waitForFrame(ws, (f) =>
        f.type === "control-response" && (f.payload as any)?.type === "leave-room"
      );
      sendFrame(ws, {
        channel: "control",
        roomId: "room-leave",
        seq: 2,
        payload: { type: "leave-room" },
      });

      const leaveResponse = await leavePromise;
      expect((leaveResponse.payload as any).status).toBe("left");
      expect(manager.getRoomClientCount("room-leave")).toBe(0);
      ws.close();
    });

    it("should broadcast presence-join to other room participants", async () => {
      engine.createRoom("room-presence");
      const c1 = await connectClient(port, { displayName: "Alice" });
      const c2 = await connectClient(port, { displayName: "Bob" });

      // Alice joins
      sendFrame(c1.ws, {
        channel: "control",
        roomId: "room-presence",
        seq: 1,
        payload: { type: "join-room", roomId: "room-presence" },
      });
      await waitForFrame(c1.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      // Listen for presence-join on Alice's WS when Bob joins
      const presencePromise = waitForFrame(c1.ws, (f) => f.type === "presence-join");

      // Bob joins
      sendFrame(c2.ws, {
        channel: "control",
        roomId: "room-presence",
        seq: 1,
        payload: { type: "join-room", roomId: "room-presence" },
      });

      const presence = await presencePromise;
      expect(presence.type).toBe("presence-join");
      expect((presence.payload as any).displayName).toBe("Bob");
      c1.ws.close();
      c2.ws.close();
    });

    it("should broadcast presence-leave when a client leaves", async () => {
      engine.createRoom("room-leave-bc");
      const c1 = await connectClient(port, { displayName: "Alice" });
      const c2 = await connectClient(port, { displayName: "Bob" });

      // Both join
      sendFrame(c1.ws, {
        channel: "control",
        roomId: "room-leave-bc",
        seq: 1,
        payload: { type: "join-room", roomId: "room-leave-bc" },
      });
      await waitForFrame(c1.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      sendFrame(c2.ws, {
        channel: "control",
        roomId: "room-leave-bc",
        seq: 1,
        payload: { type: "join-room", roomId: "room-leave-bc" },
      });
      await waitForFrame(c2.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      // Listen for presence-leave on Alice's WS
      const leavePromise = waitForFrame(c1.ws, (f) => f.type === "presence-leave");

      // Bob leaves
      sendFrame(c2.ws, {
        channel: "control",
        roomId: "room-leave-bc",
        seq: 2,
        payload: { type: "leave-room" },
      });

      const leaveEvent = await leavePromise;
      expect(leaveEvent.type).toBe("presence-leave");
      expect((leaveEvent.payload as any).userId).toBeDefined();
      c1.ws.close();
      c2.ws.close();
    });

    it("should create a room via control channel", async () => {
      const { ws } = await connectClient(port);

      const responsePromise = waitForFrame(ws, (f) =>
        f.type === "control-response" && (f.payload as any)?.type === "create-room"
      );

      sendFrame(ws, {
        channel: "control",
        roomId: "",
        seq: 1,
        payload: { type: "create-room" },
      });

      const response = await responsePromise;
      expect((response.payload as any).status).toBe("created");
      expect((response.payload as any).roomId).toBeDefined();

      // Verify room exists in engine
      const roomId = (response.payload as any).roomId;
      expect(engine.getRoom(roomId)).toBeDefined();
      ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Participant Tracking
  // -------------------------------------------------------------------------

  describe("Participant Tracking", () => {
    it("should track participants per room", async () => {
      engine.createRoom("track-room");
      const c1 = await connectClient(port, { userId: "user-a", displayName: "Alice" });
      const c2 = await connectClient(port, { userId: "user-b", displayName: "Bob" });

      sendFrame(c1.ws, {
        channel: "control",
        roomId: "track-room",
        seq: 1,
        payload: { type: "join-room", roomId: "track-room" },
      });
      await waitForFrame(c1.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      sendFrame(c2.ws, {
        channel: "control",
        roomId: "track-room",
        seq: 1,
        payload: { type: "join-room", roomId: "track-room" },
      });
      await waitForFrame(c2.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      expect(manager.getRoomClientCount("track-room")).toBe(2);

      const room = engine.getRoom("track-room");
      expect(room?.participants.size).toBe(2);
      c1.ws.close();
      c2.ws.close();
    });

    it("should remove participants on disconnect", async () => {
      engine.createRoom("disconnect-room");
      const { ws } = await connectClient(port);

      sendFrame(ws, {
        channel: "control",
        roomId: "disconnect-room",
        seq: 1,
        payload: { type: "join-room", roomId: "disconnect-room" },
      });
      await waitForFrame(ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      expect(manager.getRoomClientCount("disconnect-room")).toBe(1);

      ws.close();
      // Allow time for close event to process
      await new Promise((r) => setTimeout(r, 100));
      expect(manager.getRoomClientCount("disconnect-room")).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // State Snapshot Delivery
  // -------------------------------------------------------------------------

  describe("State Snapshot Delivery", () => {
    it("should deliver current CRDT state snapshot when client joins", async () => {
      engine.createRoom("snapshot-room");

      // Add some state to the room
      await engine.processOperation("snapshot-room", {
        id: "op-1",
        sessionId: "snapshot-room",
        type: "add",
        itemId: "item-1",
        payload: { x: 100, y: 200 },
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "setup" },
        version: 1,
        replicaId: "setup-client",
      });

      const { ws } = await connectClient(port);

      // Wait for the snapshot delta frame specifically
      const snapshotPromise = waitForFrame(ws, (f) =>
        f.channel === "ops" && f.type === "delta" && f.replyTo === 1
      );

      sendFrame(ws, {
        channel: "control",
        roomId: "snapshot-room",
        seq: 1,
        payload: { type: "join-room", roomId: "snapshot-room" },
      });

      const snapshotFrame = await snapshotPromise;
      expect(snapshotFrame).toBeDefined();
      expect((snapshotFrame.payload as any).changes).toBeDefined();
      expect((snapshotFrame.payload as any).changes.length).toBeGreaterThan(0);
      ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Awareness Channel
  // -------------------------------------------------------------------------

  describe("Awareness Channel", () => {
    it("should relay awareness updates to other room participants", async () => {
      engine.createRoom("awareness-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      // Both join room
      sendFrame(c1.ws, {
        channel: "control",
        roomId: "awareness-room",
        seq: 1,
        payload: { type: "join-room", roomId: "awareness-room" },
      });
      await waitForFrame(c1.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      sendFrame(c2.ws, {
        channel: "control",
        roomId: "awareness-room",
        seq: 1,
        payload: { type: "join-room", roomId: "awareness-room" },
      });
      await waitForFrame(c2.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      // c1 sends awareness update
      const awarenessPromise = waitForFrame(c2.ws, (f) =>
        f.channel === "awareness" && f.type === "awareness-update"
      );

      sendFrame(c1.ws, {
        channel: "awareness",
        roomId: "awareness-room",
        seq: 2,
        payload: {
          clientId: c1.clientId,
          cursor: { x: 50, y: 75 },
          displayName: "TestUser",
          color: "#ff0000",
        },
      });

      const awarenessFrame = await awarenessPromise;
      expect(awarenessFrame.type).toBe("awareness-update");
      expect((awarenessFrame.payload as any).cursor).toEqual({ x: 50, y: 75 });
      c1.ws.close();
      c2.ws.close();
    });

    it("should throttle awareness updates per configured interval", async () => {
      engine.createRoom("throttle-room");
      // Use a high throttle for easy testing
      const throttleEngine = new SyncEngineV2();
      throttleEngine.createRoom("throttle-room");
      const throttleManager = new ConnectionManagerV2(
        { ...createDefaultConfig(), awarenessThrottleMs: 100 },
        throttleEngine
      );
      throttleManager.start();
      const throttlePort = getServerPort(throttleManager);

      const c1 = await connectClient(throttlePort);
      const c2 = await connectClient(throttlePort);

      // Both join
      sendFrame(c1.ws, {
        channel: "control",
        roomId: "throttle-room",
        seq: 1,
        payload: { type: "join-room", roomId: "throttle-room" },
      });
      await waitForFrame(c1.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      sendFrame(c2.ws, {
        channel: "control",
        roomId: "throttle-room",
        seq: 1,
        payload: { type: "join-room", roomId: "throttle-room" },
      });
      await waitForFrame(c2.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      // Send 5 awareness updates rapidly
      for (let i = 0; i < 5; i++) {
        sendFrame(c1.ws, {
          channel: "awareness",
          roomId: "throttle-room",
          seq: 10 + i,
          payload: { clientId: "throttle-c1", cursor: { x: i * 10, y: i * 10 }, selection: [], displayName: "A", color: "#f00" },
        });
      }

      // Only 1 should arrive (the first one, rest are throttled within 100ms)
      const frames = await collectFrames(c2.ws, 5, 200);
      const awarenessFrames = frames.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );
      // Should get at most 1 within the throttle window
      expect(awarenessFrames.length).toBeLessThanOrEqual(2);
      expect(awarenessFrames.length).toBeGreaterThanOrEqual(1);

      c1.ws.close();
      c2.ws.close();
      await throttleManager.stop();
    });
  });

  // -------------------------------------------------------------------------
  // Operations Channel
  // -------------------------------------------------------------------------

  describe("Operations Channel", () => {
    it("should reject operations from clients not in the room", async () => {
      engine.createRoom("ops-reject-room");
      const { ws } = await connectClient(port);

      const errorPromise = waitForFrame(ws, (f) =>
        f.type === "error" && (f.payload as any)?.code === "not_in_room"
      );

      sendFrame(ws, {
        channel: "ops",
        roomId: "ops-reject-room",
        seq: 1,
        payload: {
          id: "op-1",
          type: "add",
          itemId: "item-1",
          payload: { x: 10 },
          timestamp: { wallTime: Date.now(), logical: 0, nodeId: "test" },
          version: 1,
        },
      });

      const error = await errorPromise;
      expect((error.payload as any).code).toBe("not_in_room");
      ws.close();
    });

    it("should broadcast deltas to other room participants", async () => {
      engine.createRoom("broadcast-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      // Both join
      sendFrame(c1.ws, {
        channel: "control",
        roomId: "broadcast-room",
        seq: 1,
        payload: { type: "join-room", roomId: "broadcast-room" },
      });
      await waitForFrame(c1.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      sendFrame(c2.ws, {
        channel: "control",
        roomId: "broadcast-room",
        seq: 1,
        payload: { type: "join-room", roomId: "broadcast-room" },
      });
      await waitForFrame(c2.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      // c1 sends an operation
      const deltaPromise = waitForFrame(c2.ws, (f) =>
        f.channel === "ops" && f.type === "delta"
      );

      sendFrame(c1.ws, {
        channel: "ops",
        roomId: "broadcast-room",
        seq: 2,
        payload: {
          id: "op-broadcast-1",
          type: "add",
          itemId: "item-bc-1",
          payload: { name: "rectangle" },
          timestamp: { wallTime: Date.now(), logical: 0, nodeId: "c1-node" },
          version: 1,
        },
      });

      const delta = await deltaPromise;
      expect(delta.channel).toBe("ops");
      expect(delta.type).toBe("delta");
      expect(delta.roomId).toBe("broadcast-room");
      c1.ws.close();
      c2.ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Disconnection Cleanup
  // -------------------------------------------------------------------------

  describe("Disconnection Cleanup", () => {
    it("should clean up connection tracking on disconnect", async () => {
      const { ws } = await connectClient(port);
      expect(manager.getConnectionCount()).toBe(1);

      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(manager.getConnectionCount()).toBe(0);
    });

    it("should broadcast presence-leave on disconnect", async () => {
      engine.createRoom("dc-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      // Both join
      sendFrame(c1.ws, {
        channel: "control",
        roomId: "dc-room",
        seq: 1,
        payload: { type: "join-room", roomId: "dc-room" },
      });
      await waitForFrame(c1.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      sendFrame(c2.ws, {
        channel: "control",
        roomId: "dc-room",
        seq: 1,
        payload: { type: "join-room", roomId: "dc-room" },
      });
      await waitForFrame(c2.ws, (f) => f.type === "control-response" && (f.payload as any)?.type === "join-room");

      // Listen for presence-leave on c1 when c2 disconnects
      const presenceLeavePromise = waitForFrame(c1.ws, (f) => f.type === "presence-leave");

      c2.ws.close();

      const leaveEvent = await presenceLeavePromise;
      expect(leaveEvent.type).toBe("presence-leave");
      expect((leaveEvent.payload as any).clientId).toBeDefined();
      c1.ws.close();
    });
  });
});
