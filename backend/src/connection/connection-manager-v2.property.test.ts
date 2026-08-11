/**
 * Property-based tests for ConnectionManagerV2.
 * Feature: collaborative-sync-engine
 *
 * Property 5: Awareness Updates Bypass Persistence - Validates: Requirements 2.3
 * Property 6: Awareness Throttling - Validates: Requirements 2.5
 * Property 30: Channel Multiplexing Routing - Validates: Requirements 20.2, 20.3
 * Property 31: Channel Subscribe/Unsubscribe Without Disconnect - Validates: Requirements 20.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import WebSocket from "ws";
import { ConnectionManagerV2 } from "./connection-manager-v2.js";
import { SyncEngineV2 } from "../engine/sync-engine-v2.js";
import type { ServerFrame, ClientFrame, ChannelType } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultConfig() {
  return {
    port: 0,
    jwtSecret: "test-secret",
    corsOrigins: ["*"],
    maxConnectionsTotal: 200,
    maxConnectionsPerRoom: 50,
    heartbeatIntervalMs: 60000,
    heartbeatTimeoutMs: 60000,
    awarenessThrottleMs: 17, // ceil(1000/60) = 17ms -> max 60 per second
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
    setTimeout(() => reject(new Error("Connection timeout")), 5000);
  });
}

function sendFrame(ws: WebSocket, frame: ClientFrame): void {
  ws.send(JSON.stringify(frame));
}

function waitForFrame(
  ws: WebSocket,
  predicate: (frame: ServerFrame) => boolean,
  timeoutMs = 3000
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

function collectFrames(ws: WebSocket, durationMs: number): Promise<ServerFrame[]> {
  return new Promise((resolve) => {
    const frames: ServerFrame[] = [];
    const handler = (data: WebSocket.RawData) => {
      frames.push(JSON.parse(data.toString()) as ServerFrame);
    };
    ws.on("message", handler);
    setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(frames);
    }, durationMs);
  });
}

function joinRoom(ws: WebSocket, roomId: string, seq: number): Promise<ServerFrame> {
  sendFrame(ws, {
    channel: "control",
    roomId,
    seq,
    payload: { type: "join-room", roomId },
  });
  return waitForFrame(ws, (f) =>
    f.type === "control-response" && (f.payload as any)?.type === "join-room"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary for a valid awareness payload. */
const arbAwarenessPayload = fc.record({
  clientId: fc.string({ minLength: 1, maxLength: 20 }),
  cursor: fc.record({
    x: fc.integer({ min: 0, max: 2000 }),
    y: fc.integer({ min: 0, max: 2000 }),
  }),
  selection: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 5 }),
  displayName: fc.string({ minLength: 1, maxLength: 50 }),
  color: fc.hexaString({ minLength: 6, maxLength: 6 }).map((s) => `#${s}`),
});

/** Arbitrary for a valid channel type. */
const arbChannelType: fc.Arbitrary<ChannelType> = fc.constantFrom(
  "ops" as const,
  "awareness" as const,
  "metrics" as const,
  "control" as const
);

// ═══════════════════════════════════════════════════════════════════════════
// Property 5: Awareness Updates Bypass Persistence
// ═══════════════════════════════════════════════════════════════════════════

describe("Feature: collaborative-sync-engine, Property 5: Awareness Updates Bypass Persistence", () => {
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

  /**
   * **Validates: Requirements 2.3**
   *
   * For any awareness update sent on the Awareness_Channel, the operation log
   * and persistence layer SHALL NOT contain that update.
   *
   * We verify this by:
   * 1. Sending N awareness updates from a client
   * 2. Checking that the room's operationCount does NOT increase
   * 3. Checking that the room's CRDT state items remain empty (no awareness data persisted)
   */
  it("awareness updates do not increment room operation count or persist to state", { timeout: 30000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbAwarenessPayload, { minLength: 1, maxLength: 20 }),
        async (awarenessPayloads) => {
          const roomId = `awareness-bypass-${Math.random().toString(36).slice(2)}`;
          engine.createRoom(roomId);

          const c1 = await connectClient(port);
          const c2 = await connectClient(port);

          // Both clients join the room
          await joinRoom(c1.ws, roomId, 1);
          await joinRoom(c2.ws, roomId, 1);

          // Record operation count before sending awareness
          const opCountBefore = engine.getRoom(roomId)!.operationCount;
          const stateBefore = JSON.stringify(engine.getState(roomId).items);

          // Send all awareness updates from c1
          for (let i = 0; i < awarenessPayloads.length; i++) {
            sendFrame(c1.ws, {
              channel: "awareness",
              roomId,
              seq: 100 + i,
              payload: awarenessPayloads[i],
            });
          }

          // Wait for processing
          await delay(100);

          // Verify: operation count must NOT have changed
          const opCountAfter = engine.getRoom(roomId)!.operationCount;
          expect(opCountAfter).toBe(opCountBefore);

          // Verify: CRDT state items must NOT contain awareness data
          const stateAfter = JSON.stringify(engine.getState(roomId).items);
          expect(stateAfter).toBe(stateBefore);

          c1.ws.close();
          c2.ws.close();
          await delay(50);
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 6: Awareness Throttling
// ═══════════════════════════════════════════════════════════════════════════

describe("Feature: collaborative-sync-engine, Property 6: Awareness Throttling", () => {
  let manager: ConnectionManagerV2;
  let engine: SyncEngineV2;
  let port: number;

  beforeEach(() => {
    engine = new SyncEngineV2();
    // Use awarenessThrottleMs=17 which means max 60 updates per second (1000/17 ≈ 58.8)
    manager = new ConnectionManagerV2(createDefaultConfig(), engine);
    manager.start();
    port = getServerPort(manager);
  });

  afterEach(async () => {
    await manager.stop();
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * For any client sending awareness updates at a rate exceeding 60 per second,
   * the Connection_Manager SHALL deliver at most 60 updates per second to
   * recipient clients.
   *
   * Strategy: Send many awareness updates as fast as possible over 1 second,
   * then verify the recipient received no more than 60 per second.
   */
  it("delivers at most 60 awareness updates per second to recipients regardless of send rate", { timeout: 30000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        // Number of updates to send (much more than 60 to ensure exceeding the limit)
        fc.integer({ min: 100, max: 200 }),
        async (updateCount) => {
          const roomId = `throttle-${Math.random().toString(36).slice(2)}`;
          engine.createRoom(roomId);

          const c1 = await connectClient(port);
          const c2 = await connectClient(port);

          await joinRoom(c1.ws, roomId, 1);
          await joinRoom(c2.ws, roomId, 1);

          // Start collecting frames on c2
          const collectionDurationMs = 1100; // Slightly over 1 second
          const framesPromise = collectFrames(c2.ws, collectionDurationMs);

          // Send awareness updates as fast as possible from c1
          for (let i = 0; i < updateCount; i++) {
            sendFrame(c1.ws, {
              channel: "awareness",
              roomId,
              seq: 200 + i,
              payload: {
                clientId: c1.clientId,
                cursor: { x: i, y: i * 2 },
                selection: [],
                displayName: "Sender",
                color: "#00ff00",
              },
            });
          }

          const receivedFrames = await framesPromise;
          const awarenessFrames = receivedFrames.filter(
            (f) => f.channel === "awareness" && f.type === "awareness-update"
          );

          // At most 60 updates should be delivered per second
          // With throttle at 17ms, max = ceil(1100/17) ≈ 65 — allow slight margin for timing
          expect(awarenessFrames.length).toBeLessThanOrEqual(65);
          // Should have received at least 1
          expect(awarenessFrames.length).toBeGreaterThanOrEqual(1);

          c1.ws.close();
          c2.ws.close();
          await delay(50);
        }
      ),
      { numRuns: 10 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 30: Channel Multiplexing Routing
// ═══════════════════════════════════════════════════════════════════════════

describe("Feature: collaborative-sync-engine, Property 30: Channel Multiplexing Routing", () => {
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

  /**
   * **Validates: Requirements 20.2, 20.3**
   *
   * For any multiplexed message with a channel identifier field, the
   * Connection_Manager SHALL route it to the correct channel handler,
   * and the message SHALL include the channel identifier.
   *
   * Strategy: For each channel type, send a valid message and verify
   * that the response comes back on the correct channel.
   */
  it("messages with a channel identifier are routed to the correct handler and responses include channel identifier", { timeout: 30000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomSuffix: fc.stringMatching(/^[a-z0-9]{3,10}$/),
          seqNum: fc.integer({ min: 1, max: 10000 }),
        }),
        async ({ roomSuffix, seqNum }) => {
          const roomId = `mux-${roomSuffix}`;
          engine.createRoom(roomId);

          const c1 = await connectClient(port);
          const c2 = await connectClient(port);

          await joinRoom(c1.ws, roomId, 1);
          await joinRoom(c2.ws, roomId, 1);

          // Test ops channel routing: send operation, expect ACK on "ops" channel
          const opsAckPromise = waitForFrame(c1.ws, (f) =>
            f.channel === "ops" && f.type === "ack" && f.replyTo === seqNum
          );
          sendFrame(c1.ws, {
            channel: "ops",
            roomId,
            seq: seqNum,
            payload: {
              id: `op-${seqNum}`,
              type: "add",
              itemId: `item-${seqNum}`,
              payload: { x: 10 },
              timestamp: { wallTime: Date.now(), logical: 0, nodeId: "test-node" },
              version: 1,
            },
          });
          const opsAck = await opsAckPromise;
          // Verify channel identifier is present in the response
          expect(opsAck.channel).toBe("ops");
          expect(opsAck.roomId).toBe(roomId);

          // Test awareness channel routing: send awareness, verify c2 gets it on "awareness" channel
          const awarenessPromise = waitForFrame(c2.ws, (f) =>
            f.channel === "awareness" && f.type === "awareness-update"
          );
          sendFrame(c1.ws, {
            channel: "awareness",
            roomId,
            seq: seqNum + 1,
            payload: {
              clientId: c1.clientId,
              cursor: { x: 42, y: 84 },
              selection: [],
              displayName: "Tester",
              color: "#abcdef",
            },
          });
          const awarenessResponse = await awarenessPromise;
          expect(awarenessResponse.channel).toBe("awareness");
          expect(awarenessResponse.roomId).toBe(roomId);

          // Test control channel routing: send create-room, expect response on "control" channel
          const controlPromise = waitForFrame(c1.ws, (f) =>
            f.channel === "control" &&
            f.type === "control-response" &&
            (f.payload as any)?.type === "create-room"
          );
          sendFrame(c1.ws, {
            channel: "control",
            roomId: "",
            seq: seqNum + 2,
            payload: { type: "create-room" },
          });
          const controlResponse = await controlPromise;
          expect(controlResponse.channel).toBe("control");

          c1.ws.close();
          c2.ws.close();
          await delay(50);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * **Validates: Requirements 20.2, 20.3**
   *
   * For any invalid channel identifier, the Connection_Manager SHALL
   * return an error — verifying that routing is strict and only valid
   * channels are accepted.
   */
  it("messages with invalid channel identifiers are rejected with error", { timeout: 15000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => !["ops", "awareness", "metrics", "control"].includes(s)
        ),
        async (invalidChannel) => {
          const { ws } = await connectClient(port);

          const errorPromise = waitForFrame(ws, (f) =>
            f.type === "error" && (f.payload as any)?.code === "invalid_channel"
          );

          ws.send(JSON.stringify({
            channel: invalidChannel,
            roomId: "some-room",
            seq: 1,
            payload: {},
          }));

          const error = await errorPromise;
          expect(error.type).toBe("error");
          expect((error.payload as any).code).toBe("invalid_channel");

          ws.close();
          await delay(50);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Property 31: Channel Subscribe/Unsubscribe Without Disconnect
// ═══════════════════════════════════════════════════════════════════════════

describe("Feature: collaborative-sync-engine, Property 31: Channel Subscribe/Unsubscribe Without Disconnect", () => {
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

  /**
   * **Validates: Requirements 20.4**
   *
   * For any sequence of channel subscribe and unsubscribe operations (room
   * join/leave), the underlying WebSocket connection SHALL remain open and
   * in connected state.
   *
   * Strategy: Perform a random sequence of join-room and leave-room operations
   * on multiple rooms, verifying after each operation that the WebSocket is
   * still open and the client can still communicate.
   */
  it("sequences of room join/leave operations keep the WebSocket connection open", { timeout: 60000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a sequence of subscribe/unsubscribe actions
        fc.array(
          fc.record({
            action: fc.constantFrom("join" as const, "leave" as const),
            roomIndex: fc.integer({ min: 0, max: 2 }),
          }),
          { minLength: 3, maxLength: 10 }
        ),
        async (actions) => {
          // Create 3 rooms
          const roomIds: string[] = [];
          for (let i = 0; i < 3; i++) {
            const rid = `sub-unsub-${Math.random().toString(36).slice(2)}-${i}`;
            engine.createRoom(rid);
            roomIds.push(rid);
          }

          const { ws, clientId } = await connectClient(port);
          const joinedRooms = new Set<string>();
          let seq = 1;

          for (const { action, roomIndex } of actions) {
            const roomId = roomIds[roomIndex];

            if (action === "join" && !joinedRooms.has(roomId)) {
              // Subscribe (join room)
              const joinPromise = waitForFrame(ws, (f) =>
                f.type === "control-response" && (f.payload as any)?.type === "join-room"
              );
              sendFrame(ws, {
                channel: "control",
                roomId,
                seq: seq++,
                payload: { type: "join-room", roomId },
              });
              await joinPromise;
              joinedRooms.add(roomId);
            } else if (action === "leave" && joinedRooms.has(roomId)) {
              // Unsubscribe (leave room)
              const leavePromise = waitForFrame(ws, (f) =>
                f.type === "control-response" && (f.payload as any)?.type === "leave-room"
              );
              sendFrame(ws, {
                channel: "control",
                roomId,
                seq: seq++,
                payload: { type: "leave-room" },
              });
              await leavePromise;
              joinedRooms.delete(roomId);
            }

            // After each action, verify the WebSocket is still OPEN
            expect(ws.readyState).toBe(WebSocket.OPEN);
          }

          // Final verification: connection is still tracked by the manager
          expect(manager.getConnectionCount()).toBeGreaterThanOrEqual(1);
          expect(manager.getConnection(clientId)).toBeDefined();

          // Verify we can still send and receive messages after all the subscribe/unsubscribe ops
          const pingRoomId = roomIds[0];
          if (!joinedRooms.has(pingRoomId)) {
            // Join a room to verify the connection still works
            const finalJoinPromise = waitForFrame(ws, (f) =>
              f.type === "control-response" && (f.payload as any)?.type === "join-room"
            );
            sendFrame(ws, {
              channel: "control",
              roomId: pingRoomId,
              seq: seq++,
              payload: { type: "join-room", roomId: pingRoomId },
            });
            const finalJoin = await finalJoinPromise;
            expect((finalJoin.payload as any).status).toBe("joined");
          }

          // WebSocket must still be open
          expect(ws.readyState).toBe(WebSocket.OPEN);

          ws.close();
          await delay(50);
        }
      ),
      { numRuns: 20 }
    );
  });
});
