/**
 * Unit tests for Awareness Broadcasting (Task 6.3)
 *
 * Tests cover:
 * - Fire-and-forget cursor position relay on Awareness_Channel
 * - 60fps throttle (max 60 updates/sec per client)
 * - Cursor-removed broadcast on client disconnect within 100ms
 * - Awareness updates are NOT persisted to database
 *
 * Validates: Requirements 2.1-2.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { ConnectionManagerV2 } from "./connection-manager-v2.js";
import { SyncEngineV2 } from "../engine/sync-engine-v2.js";
import type { ServerFrame, ClientFrame } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultConfig(overrides?: Partial<Record<string, unknown>>) {
  return {
    port: 0,
    jwtSecret: "test-secret",
    corsOrigins: ["*"],
    maxConnectionsTotal: 200,
    maxConnectionsPerRoom: 50,
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 10000,
    awarenessThrottleMs: 17, // ceil(1000/60) = 17ms for 60fps cap
    ...overrides,
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

function collectFrames(ws: WebSocket, timeoutMs: number): Promise<ServerFrame[]> {
  return new Promise((resolve) => {
    const frames: ServerFrame[] = [];
    const handler = (data: WebSocket.RawData) => {
      frames.push(JSON.parse(data.toString()) as ServerFrame);
    };
    ws.on("message", handler);
    setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(frames);
    }, timeoutMs);
  });
}

async function joinRoom(ws: WebSocket, roomId: string, seq: number): Promise<void> {
  sendFrame(ws, {
    channel: "control",
    roomId,
    seq,
    payload: { type: "join-room", roomId },
  });
  await waitForFrame(ws, (f) =>
    f.type === "control-response" && (f.payload as any)?.type === "join-room"
  );
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Awareness Broadcasting (Task 6.3)", () => {
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
  // Requirement 2.1: Fire-and-forget cursor position relay
  // -------------------------------------------------------------------------

  describe("Fire-and-forget cursor position relay (Req 2.1)", () => {
    it("should relay cursor position to all other room participants", async () => {
      engine.createRoom("awareness-relay-room");
      const c1 = await connectClient(port, { displayName: "Alice" });
      const c2 = await connectClient(port, { displayName: "Bob" });
      const c3 = await connectClient(port, { displayName: "Charlie" });

      await joinRoom(c1.ws, "awareness-relay-room", 1);
      await joinRoom(c2.ws, "awareness-relay-room", 1);
      await joinRoom(c3.ws, "awareness-relay-room", 1);

      // Collect frames on c2 and c3
      const c2Frames = collectFrames(c2.ws, 200);
      const c3Frames = collectFrames(c3.ws, 200);

      // c1 sends awareness update
      sendFrame(c1.ws, {
        channel: "awareness",
        roomId: "awareness-relay-room",
        seq: 2,
        payload: {
          cursor: { x: 100, y: 200 },
          displayName: "Alice",
          color: "#00ff00",
        },
      });

      const [c2Result, c3Result] = await Promise.all([c2Frames, c3Frames]);

      // Both c2 and c3 should receive the awareness update
      const c2Awareness = c2Result.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );
      const c3Awareness = c3Result.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );

      expect(c2Awareness.length).toBeGreaterThanOrEqual(1);
      expect(c3Awareness.length).toBeGreaterThanOrEqual(1);

      // Verify cursor data is relayed correctly
      expect((c2Awareness[0].payload as any).cursor).toEqual({ x: 100, y: 200 });
      expect((c3Awareness[0].payload as any).cursor).toEqual({ x: 100, y: 200 });

      c1.ws.close();
      c2.ws.close();
      c3.ws.close();
    });

    it("should NOT relay awareness update back to the sender", async () => {
      engine.createRoom("no-echo-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      await joinRoom(c1.ws, "no-echo-room", 1);
      await joinRoom(c2.ws, "no-echo-room", 1);

      const c1Frames = collectFrames(c1.ws, 150);

      sendFrame(c1.ws, {
        channel: "awareness",
        roomId: "no-echo-room",
        seq: 2,
        payload: { cursor: { x: 50, y: 50 }, displayName: "Sender", color: "#ff0000" },
      });

      const result = await c1Frames;
      const awarenessFrames = result.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );

      // Sender should NOT receive their own awareness update
      expect(awarenessFrames.length).toBe(0);

      c1.ws.close();
      c2.ws.close();
    });

    it("should include clientId in relayed awareness updates", async () => {
      engine.createRoom("clientid-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      await joinRoom(c1.ws, "clientid-room", 1);
      await joinRoom(c2.ws, "clientid-room", 1);

      const awarenessPromise = waitForFrame(c2.ws, (f) =>
        f.channel === "awareness" && f.type === "awareness-update"
      );

      sendFrame(c1.ws, {
        channel: "awareness",
        roomId: "clientid-room",
        seq: 2,
        payload: { cursor: { x: 10, y: 20 }, displayName: "Alice", color: "#0000ff" },
      });

      const frame = await awarenessPromise;
      expect((frame.payload as any).clientId).toBe(c1.clientId);

      c1.ws.close();
      c2.ws.close();
    });

    it("should silently drop awareness from non-joined clients", async () => {
      engine.createRoom("drop-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      // Only c2 joins the room
      await joinRoom(c2.ws, "drop-room", 1);

      const c2Frames = collectFrames(c2.ws, 150);

      // c1 sends awareness without joining — should be silently dropped
      sendFrame(c1.ws, {
        channel: "awareness",
        roomId: "drop-room",
        seq: 2,
        payload: { cursor: { x: 1, y: 1 }, displayName: "Ghost", color: "#aaa" },
      });

      const result = await c2Frames;
      const awarenessFrames = result.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );

      expect(awarenessFrames.length).toBe(0);

      c1.ws.close();
      c2.ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 2.3: Awareness updates are NOT persisted
  // -------------------------------------------------------------------------

  describe("Awareness updates bypass persistence (Req 2.3)", () => {
    it("should NOT persist awareness updates to the sync engine state", async () => {
      engine.createRoom("no-persist-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      await joinRoom(c1.ws, "no-persist-room", 1);
      await joinRoom(c2.ws, "no-persist-room", 1);

      // Send several awareness updates
      for (let i = 0; i < 5; i++) {
        sendFrame(c1.ws, {
          channel: "awareness",
          roomId: "no-persist-room",
          seq: 10 + i,
          payload: {
            cursor: { x: i * 10, y: i * 20 },
            displayName: "Alice",
            color: "#ff0000",
          },
        });
        await new Promise((r) => setTimeout(r, 20));
      }

      // Wait for processing
      await new Promise((r) => setTimeout(r, 100));

      // Check that the CRDT state has no awareness data
      const state = engine.getState("no-persist-room");
      expect(Object.keys(state.items).length).toBe(0);

      // Check that operation count is still 0
      const room = engine.getRoom("no-persist-room");
      expect(room?.operationCount).toBe(0);

      c1.ws.close();
      c2.ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 2.4: Cursor-removed broadcast on disconnect
  // -------------------------------------------------------------------------

  describe("Cursor-removed on disconnect (Req 2.4)", () => {
    it("should broadcast cursor-removed when client disconnects", async () => {
      engine.createRoom("cursor-remove-room");
      const c1 = await connectClient(port, { displayName: "Alice" });
      const c2 = await connectClient(port, { displayName: "Bob" });

      await joinRoom(c1.ws, "cursor-remove-room", 1);
      await joinRoom(c2.ws, "cursor-remove-room", 1);

      // Listen for cursor-removed on c1 when c2 disconnects
      const cursorRemovedPromise = waitForFrame(c1.ws, (f) =>
        f.channel === "awareness" &&
        f.type === "awareness-update" &&
        (f.payload as any)?.type === "cursor-removed"
      );

      // Disconnect c2
      c2.ws.close();

      const frame = await cursorRemovedPromise;
      expect(frame.channel).toBe("awareness");
      expect(frame.type).toBe("awareness-update");
      expect((frame.payload as any).type).toBe("cursor-removed");
      expect((frame.payload as any).clientId).toBe(c2.clientId);

      c1.ws.close();
    });

    it("should broadcast cursor-removed within 100ms of disconnect", async () => {
      engine.createRoom("cursor-timing-room");
      const c1 = await connectClient(port, { displayName: "Alice" });
      const c2 = await connectClient(port, { displayName: "Bob" });

      await joinRoom(c1.ws, "cursor-timing-room", 1);
      await joinRoom(c2.ws, "cursor-timing-room", 1);

      const startTime = Date.now();

      const cursorRemovedPromise = waitForFrame(c1.ws, (f) =>
        f.channel === "awareness" &&
        f.type === "awareness-update" &&
        (f.payload as any)?.type === "cursor-removed"
      );

      // Disconnect c2
      c2.ws.close();

      await cursorRemovedPromise;
      const elapsed = Date.now() - startTime;

      // Should be delivered within 100ms
      expect(elapsed).toBeLessThan(100);

      c1.ws.close();
    });

    it("should broadcast cursor-removed to all remaining participants", async () => {
      engine.createRoom("cursor-multi-room");
      const c1 = await connectClient(port, { displayName: "Alice" });
      const c2 = await connectClient(port, { displayName: "Bob" });
      const c3 = await connectClient(port, { displayName: "Charlie" });

      await joinRoom(c1.ws, "cursor-multi-room", 1);
      await joinRoom(c2.ws, "cursor-multi-room", 1);
      await joinRoom(c3.ws, "cursor-multi-room", 1);

      // Both c1 and c2 listen for cursor-removed when c3 disconnects
      const c1Promise = waitForFrame(c1.ws, (f) =>
        f.channel === "awareness" &&
        (f.payload as any)?.type === "cursor-removed" &&
        (f.payload as any)?.clientId === c3.clientId
      );
      const c2Promise = waitForFrame(c2.ws, (f) =>
        f.channel === "awareness" &&
        (f.payload as any)?.type === "cursor-removed" &&
        (f.payload as any)?.clientId === c3.clientId
      );

      // Disconnect c3
      c3.ws.close();

      const [c1Frame, c2Frame] = await Promise.all([c1Promise, c2Promise]);

      expect((c1Frame.payload as any).clientId).toBe(c3.clientId);
      expect((c2Frame.payload as any).clientId).toBe(c3.clientId);

      c1.ws.close();
      c2.ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 2.5: 60fps throttle (max 60 updates/sec per client)
  // -------------------------------------------------------------------------

  describe("60fps throttle (Req 2.5)", () => {
    it("should throttle awareness updates exceeding 60/sec per client", async () => {
      // Use exact 17ms throttle to match 60fps
      const throttleEngine = new SyncEngineV2();
      throttleEngine.createRoom("throttle-test-room");
      const throttleManager = new ConnectionManagerV2(
        createDefaultConfig({ awarenessThrottleMs: 17 }),
        throttleEngine
      );
      throttleManager.start();
      const throttlePort = getServerPort(throttleManager);

      const c1 = await connectClient(throttlePort);
      const c2 = await connectClient(throttlePort);

      await joinRoom(c1.ws, "throttle-test-room", 1);
      await joinRoom(c2.ws, "throttle-test-room", 1);

      // Collect frames on c2 for 200ms
      const framesPromise = collectFrames(c2.ws, 200);

      // Send 20 awareness updates rapidly (all within < 5ms, simulating burst)
      for (let i = 0; i < 20; i++) {
        sendFrame(c1.ws, {
          channel: "awareness",
          roomId: "throttle-test-room",
          seq: 10 + i,
          payload: {
            cursor: { x: i * 5, y: i * 5 },
            displayName: "Spammer",
            color: "#ff0000",
          },
        });
      }

      const frames = await framesPromise;
      const awarenessFrames = frames.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );

      // With 17ms throttle and 200ms window, max deliverable is ~12 (200/17)
      // But since all 20 are sent nearly instantly, only first should pass
      // (rest arrive within 17ms of first)
      expect(awarenessFrames.length).toBeLessThanOrEqual(12);
      // At least the first one should get through
      expect(awarenessFrames.length).toBeGreaterThanOrEqual(1);

      c1.ws.close();
      c2.ws.close();
      await throttleManager.stop();
    });

    it("should allow up to 60 updates per second when spaced correctly", async () => {
      // Use a shorter throttle to test that spaced updates DO get through
      const spacedEngine = new SyncEngineV2();
      spacedEngine.createRoom("spaced-room");
      const spacedManager = new ConnectionManagerV2(
        createDefaultConfig({ awarenessThrottleMs: 17 }),
        spacedEngine
      );
      spacedManager.start();
      const spacedPort = getServerPort(spacedManager);

      const c1 = await connectClient(spacedPort);
      const c2 = await connectClient(spacedPort);

      await joinRoom(c1.ws, "spaced-room", 1);
      await joinRoom(c2.ws, "spaced-room", 1);

      const framesPromise = collectFrames(c2.ws, 250);

      // Send 5 updates spaced 20ms apart (> 17ms throttle) — all should pass
      for (let i = 0; i < 5; i++) {
        sendFrame(c1.ws, {
          channel: "awareness",
          roomId: "spaced-room",
          seq: 10 + i,
          payload: {
            cursor: { x: i * 10, y: i * 10 },
            displayName: "Pacer",
            color: "#00ff00",
          },
        });
        await new Promise((r) => setTimeout(r, 20));
      }

      const frames = await framesPromise;
      const awarenessFrames = frames.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );

      // All 5 should get through since they're spaced > throttle interval
      expect(awarenessFrames.length).toBe(5);

      c1.ws.close();
      c2.ws.close();
      await spacedManager.stop();
    });

    it("should throttle per-client independently", async () => {
      engine.createRoom("independent-throttle-room");
      const c1 = await connectClient(port, { displayName: "Client1" });
      const c2 = await connectClient(port, { displayName: "Client2" });
      const observer = await connectClient(port, { displayName: "Observer" });

      await joinRoom(c1.ws, "independent-throttle-room", 1);
      await joinRoom(c2.ws, "independent-throttle-room", 1);
      await joinRoom(observer.ws, "independent-throttle-room", 1);

      const framesPromise = collectFrames(observer.ws, 150);

      // Both c1 and c2 send awareness at the same time
      sendFrame(c1.ws, {
        channel: "awareness",
        roomId: "independent-throttle-room",
        seq: 2,
        payload: { cursor: { x: 10, y: 10 }, displayName: "Client1", color: "#f00" },
      });
      sendFrame(c2.ws, {
        channel: "awareness",
        roomId: "independent-throttle-room",
        seq: 2,
        payload: { cursor: { x: 20, y: 20 }, displayName: "Client2", color: "#0f0" },
      });

      const frames = await framesPromise;
      const awarenessFrames = frames.filter(
        (f) => f.channel === "awareness" && f.type === "awareness-update"
      );

      // Observer should receive awareness from BOTH clients (throttle is per-client)
      expect(awarenessFrames.length).toBe(2);
      const clientIds = awarenessFrames.map((f) => (f.payload as any).clientId);
      expect(clientIds).toContain(c1.clientId);
      expect(clientIds).toContain(c2.clientId);

      c1.ws.close();
      c2.ws.close();
      observer.ws.close();
    });
  });

  // -------------------------------------------------------------------------
  // Integration: Awareness uses JSON format (Req 2.2)
  // -------------------------------------------------------------------------

  describe("JSON format for awareness (Req 2.2)", () => {
    it("should transmit awareness data as JSON", async () => {
      engine.createRoom("json-format-room");
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      await joinRoom(c1.ws, "json-format-room", 1);
      await joinRoom(c2.ws, "json-format-room", 1);

      // Capture the raw message on c2
      const rawPromise = new Promise<string>((resolve) => {
        c2.ws.on("message", (data) => {
          const str = data.toString();
          const frame = JSON.parse(str);
          if (frame.channel === "awareness") {
            resolve(str);
          }
        });
      });

      sendFrame(c1.ws, {
        channel: "awareness",
        roomId: "json-format-room",
        seq: 2,
        payload: {
          cursor: { x: 42, y: 84 },
          selection: ["obj-1", "obj-2"],
          displayName: "Alice",
          color: "#00d4ff",
        },
      });

      const rawMsg = await rawPromise;

      // Should be valid JSON
      const parsed = JSON.parse(rawMsg);
      expect(parsed.channel).toBe("awareness");
      expect(parsed.payload.cursor).toEqual({ x: 42, y: 84 });
      expect(parsed.payload.selection).toEqual(["obj-1", "obj-2"]);
      expect(parsed.payload.displayName).toBe("Alice");
      expect(parsed.payload.color).toBe("#00d4ff");

      c1.ws.close();
      c2.ws.close();
    });
  });
});
