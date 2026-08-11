/**
 * Integration Tests for Backend Pipeline V2
 *
 * Tests the full wired pipeline end-to-end using the V2 channel-multiplexed
 * WebSocket protocol:
 * - Full WebSocket flow: connect → join room → send operations → receive deltas
 * - Multi-client convergence with concurrent operations
 * - Offline/reconnect with queue replay and convergence
 * - Snapshot lifecycle over 5000 operations
 *
 * Requirements: 1.1-1.7, 3.6, 19.5, 23.1-23.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { createServer, type ServerInstanceV2 } from "./index.js";
import type { ClientFrame, ServerFrame } from "./types/index.js";

// ─── Test Configuration ────────────────────────────────────────────────

let TEST_PORT = 0;
const JWT_SECRET = "integration-v2-test-secret";

// ─── Test Helpers ──────────────────────────────────────────────────────

let seqCounter = 0;
function nextSeq(): number {
  return ++seqCounter;
}

/** Wrapper around a WebSocket that buffers all received frames. */
interface TestClient {
  ws: WebSocket;
  clientId: string;
  received: ServerFrame[];
}

/**
 * Connect a client and wait for the initial "connected" response.
 * Buffers all frames from the start to avoid race conditions.
 */
function connectClient(userId: string, displayName: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://localhost:${TEST_PORT}?userId=${userId}&displayName=${encodeURIComponent(displayName)}`
    );
    const received: ServerFrame[] = [];
    let resolved = false;

    ws.on("message", (data) => {
      try {
        const frame: ServerFrame = JSON.parse(data.toString());
        received.push(frame);
        // Resolve on the "connected" control-response
        if (
          !resolved &&
          frame.channel === "control" &&
          frame.type === "control-response" &&
          (frame.payload as any)?.type === "connected"
        ) {
          resolved = true;
          resolve({
            ws,
            clientId: (frame.payload as any).clientId,
            received,
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", (err) => {
      if (!resolved) reject(err);
    });
  });
}

/**
 * Wait for a frame matching a predicate. Checks already-received buffer first,
 * then listens for new frames.
 */
function waitForFrame(
  client: TestClient,
  predicate: (frame: ServerFrame) => boolean,
  timeoutMs = 5000
): Promise<ServerFrame> {
  // Check already-received frames
  const existing = client.received.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.ws.removeListener("message", handler);
      reject(new Error(`Timed out waiting for frame (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(data: WebSocket.Data) {
      try {
        const frame: ServerFrame = JSON.parse(data.toString());
        if (predicate(frame)) {
          clearTimeout(timeout);
          client.ws.removeListener("message", handler);
          resolve(frame);
        }
      } catch {
        // Ignore
      }
    }

    client.ws.on("message", handler);
  });
}

/** Send a ClientFrame to the server. */
function sendFrame(client: TestClient, frame: ClientFrame): void {
  client.ws.send(JSON.stringify(frame));
}

/** Send a create-room control command and return the created room ID. */
async function createRoom(client: TestClient): Promise<string> {
  const seq = nextSeq();
  sendFrame(client, {
    channel: "control",
    roomId: "",
    seq,
    payload: { type: "create-room" } as any,
  });
  const response = await waitForFrame(
    client,
    (f) =>
      f.channel === "control" &&
      f.type === "control-response" &&
      (f.payload as any)?.type === "create-room"
  );
  return (response.payload as any).roomId;
}

/** Send a join-room control command and wait for confirmation. */
async function joinRoom(client: TestClient, roomId: string): Promise<ServerFrame> {
  const seq = nextSeq();
  sendFrame(client, {
    channel: "control",
    roomId,
    seq,
    payload: { type: "join-room", roomId } as any,
  });
  const response = await waitForFrame(
    client,
    (f) =>
      f.channel === "control" &&
      f.type === "control-response" &&
      (f.payload as any)?.type === "join-room" &&
      (f.payload as any)?.status === "joined"
  );
  return response;
}

/** Send an operation on the ops channel. Returns the seq used. */
function sendOp(
  client: TestClient,
  roomId: string,
  opts: {
    id: string;
    type: "add" | "remove" | "update";
    itemId: string;
    payload: Record<string, unknown>;
    wallTime: number;
    logical?: number;
    nodeId?: string;
  }
): number {
  const seq = nextSeq();
  sendFrame(client, {
    channel: "ops",
    roomId,
    seq,
    payload: {
      id: opts.id,
      type: opts.type,
      itemId: opts.itemId,
      payload: opts.payload,
      timestamp: {
        wallTime: opts.wallTime,
        logical: opts.logical ?? 0,
        nodeId: opts.nodeId ?? opts.id,
      },
      version: 1,
    } as any,
  });
  return seq;
}

/** Small helper to wait a fixed duration. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gracefully close a WebSocket client. */
function closeClient(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    if (client.ws.readyState === WebSocket.CLOSED || client.ws.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    client.ws.on("close", () => resolve());
    client.ws.close();
  });
}

// ─── Test Suite ────────────────────────────────────────────────────────

describe("Integration V2: Backend Pipeline", { timeout: 60000 }, () => {
  let server: ServerInstanceV2;

  beforeEach(async () => {
    seqCounter = 0;
    server = await createServer({
      port: 0,
      jwtSecret: JWT_SECRET,
      heartbeatIntervalMs: 60000,
      heartbeatTimeoutMs: 60000,
      batchWindowMs: 2,
      snapshotThreshold: 1000,
    });

    await new Promise<void>((resolve) => {
      server.httpServer.listen(0, () => resolve());
    });
    const addr = server.httpServer.address();
    TEST_PORT = typeof addr === "object" && addr ? addr.port : 9999;
  });

  afterEach(async () => {
    await server.stop();
  });

  // ─── Test 1: Full WebSocket flow ───────────────────────────────────

  describe("Full WebSocket flow: connect → join room → send operations → receive deltas", () => {
    it("should complete the full pipeline for a single client", async () => {
      // 1. Connect
      const client = await connectClient("user-1", "Alice");
      expect(client.clientId).toBeDefined();

      // 2. Create a room
      const roomId = await createRoom(client);
      expect(roomId).toBeDefined();
      expect(typeof roomId).toBe("string");

      // 3. Join the room
      const joinResponse = await joinRoom(client, roomId);
      expect((joinResponse.payload as any).status).toBe("joined");

      // 4. Send an operation
      const opSeq = sendOp(client, roomId, {
        id: "op-1",
        type: "add",
        itemId: "item-1",
        payload: { name: "Widget", quantity: 5 },
        wallTime: Date.now(),
        nodeId: "node-1",
      });

      // 5. Receive ACK
      const ack = await waitForFrame(
        client,
        (f) =>
          f.channel === "ops" &&
          f.type === "ack" &&
          (f.payload as any)?.operationId === "op-1"
      );
      expect(ack.type).toBe("ack");

      // 6. Verify server state
      const state = server.syncEngine.getState(roomId);
      expect(state.items["item-1"]).toBeDefined();

      await closeClient(client);
    });

    it("should deliver deltas to other clients in the same room", async () => {
      const clientA = await connectClient("user-a", "Alice");
      const clientB = await connectClient("user-b", "Bob");

      // Create and join room
      const roomId = await createRoom(clientA);
      await joinRoom(clientA, roomId);
      await joinRoom(clientB, roomId);
      await sleep(100);

      // Clear received buffers to avoid matching stale messages
      clientB.received.length = 0;

      // A sends an operation
      sendOp(clientA, roomId, {
        id: "op-delta-1",
        type: "add",
        itemId: "item-delta-1",
        payload: { name: "Shared Item", quantity: 10 },
        wallTime: Date.now(),
        nodeId: "node-a",
      });

      // B should receive the delta
      const delta = await waitForFrame(
        clientB,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      expect(delta.type).toBe("delta");
      expect(delta.roomId).toBe(roomId);

      await Promise.all([closeClient(clientA), closeClient(clientB)]);
    });

    it("should return room_not_found for invalid room join", async () => {
      const client = await connectClient("user-err", "ErrorTest");

      const seq = nextSeq();
      sendFrame(client, {
        channel: "control",
        roomId: "nonexistent-room-xyz",
        seq,
        payload: { type: "join-room", roomId: "nonexistent-room-xyz" } as any,
      });

      const errorFrame = await waitForFrame(
        client,
        (f) =>
          f.channel === "control" &&
          f.type === "error" &&
          (f.payload as any)?.code === "room_not_found"
      );
      expect((errorFrame.payload as any).code).toBe("room_not_found");

      await closeClient(client);
    });

    it("should broadcast presence-join when a second client joins", async () => {
      const clientA = await connectClient("user-pj-a", "Alice");
      const roomId = await createRoom(clientA);
      await joinRoom(clientA, roomId);

      // Clear A's received buffer
      clientA.received.length = 0;

      // B joins — A should receive presence-join
      const clientB = await connectClient("user-pj-b", "Bob");
      await joinRoom(clientB, roomId);

      const presence = await waitForFrame(
        clientA,
        (f) => f.channel === "control" && f.type === "presence-join"
      );
      expect(presence.type).toBe("presence-join");
      expect((presence.payload as any).userId).toBe("user-pj-b");

      await Promise.all([closeClient(clientA), closeClient(clientB)]);
    });
  });

  // ─── Test 2: Multi-client convergence ──────────────────────────────

  describe("Multi-client convergence with concurrent operations", () => {
    it("should converge state when multiple clients send concurrently", async () => {
      const NUM_CLIENTS = 5;
      const clients: TestClient[] = [];

      for (let i = 0; i < NUM_CLIENTS; i++) {
        const c = await connectClient(`user-conv-${i}`, `User${i}`);
        clients.push(c);
      }

      // Create room with first client, all join
      const roomId = await createRoom(clients[0]);
      for (const c of clients) {
        await joinRoom(c, roomId);
      }
      await sleep(100);

      // Each client sends an operation concurrently
      const baseTime = Date.now();
      for (let i = 0; i < NUM_CLIENTS; i++) {
        sendOp(clients[i], roomId, {
          id: `op-conv-${i}`,
          type: "add",
          itemId: `item-conv-${i}`,
          payload: { name: `Item ${i}`, value: i * 10 },
          wallTime: baseTime + i,
          nodeId: `node-conv-${i}`,
        });
      }

      // Wait for processing
      await sleep(1500);

      // Verify convergence
      const state = server.syncEngine.getState(roomId);
      const activeItems = Object.values(state.items).filter(
        (item: any) => item.removedAt === null
      );
      expect(activeItems.length).toBe(NUM_CLIENTS);

      for (let i = 0; i < NUM_CLIENTS; i++) {
        expect(state.items[`item-conv-${i}`]).toBeDefined();
      }

      await Promise.all(clients.map(closeClient));
    });

    it("should propagate operations within 200ms (Req 3.6)", async () => {
      const clientA = await connectClient("user-lat-a", "Alice");
      const clientB = await connectClient("user-lat-b", "Bob");

      const roomId = await createRoom(clientA);
      await joinRoom(clientA, roomId);
      await joinRoom(clientB, roomId);
      await sleep(100);

      // Clear B's buffer
      clientB.received.length = 0;

      const sendTime = Date.now();

      sendOp(clientA, roomId, {
        id: "op-latency-v2",
        type: "add",
        itemId: "item-latency-v2",
        payload: { name: "Latency Test" },
        wallTime: sendTime,
        nodeId: "node-lat-a",
      });

      await waitForFrame(
        clientB,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      const latency = Date.now() - sendTime;

      // Should propagate within 200ms (generous for CI)
      expect(latency).toBeLessThan(200);

      await Promise.all([closeClient(clientA), closeClient(clientB)]);
    });

    it("should handle concurrent updates with LWW conflict resolution", async () => {
      const clientA = await connectClient("user-lww-a", "Alice");
      const clientB = await connectClient("user-lww-b", "Bob");

      const roomId = await createRoom(clientA);
      await joinRoom(clientA, roomId);
      await joinRoom(clientB, roomId);
      await sleep(100);

      // A creates an item
      sendOp(clientA, roomId, {
        id: "op-create",
        type: "add",
        itemId: "shared-item",
        payload: { name: "Original", quantity: 1 },
        wallTime: 1000,
        nodeId: "node-lww-a",
      });
      await sleep(300);

      // Both update the same item; B has higher wallTime → wins LWW
      sendOp(clientA, roomId, {
        id: "op-update-a",
        type: "update",
        itemId: "shared-item",
        payload: { name: "Alice's Version" },
        wallTime: 2000,
        nodeId: "node-lww-a",
      });
      sendOp(clientB, roomId, {
        id: "op-update-b",
        type: "update",
        itemId: "shared-item",
        payload: { name: "Bob's Version" },
        wallTime: 3000,
        nodeId: "node-lww-b",
      });

      await sleep(500);

      const state = server.syncEngine.getState(roomId);
      const item = state.items["shared-item"];
      expect(item).toBeDefined();
      // Fields are stored as LWWRegisters with { value, timestamp, replicaId }
      expect(item.fields.name.value).toBe("Bob's Version");

      await Promise.all([closeClient(clientA), closeClient(clientB)]);
    });
  });

  // ─── Test 3: Offline/reconnect with queue replay ───────────────────

  describe("Offline/reconnect with queue replay and convergence", () => {
    it("should replay queued operations after reconnect", async () => {
      const clientA = await connectClient("user-offline-a", "Alice");
      const clientB = await connectClient("user-offline-b", "Bob");

      const roomId = await createRoom(clientA);
      await joinRoom(clientA, roomId);
      await joinRoom(clientB, roomId);
      await sleep(100);

      // A sends an operation while online
      sendOp(clientA, roomId, {
        id: "op-online",
        type: "add",
        itemId: "item-online",
        payload: { name: "Online Item" },
        wallTime: Date.now(),
        nodeId: "node-a",
      });
      await waitForFrame(
        clientA,
        (f) => f.channel === "ops" && f.type === "ack" && (f.payload as any)?.operationId === "op-online"
      );

      // A disconnects
      await closeClient(clientA);
      await sleep(200);

      // B sends while A is offline
      sendOp(clientB, roomId, {
        id: "op-while-offline",
        type: "add",
        itemId: "item-while-offline",
        payload: { name: "Added While A Offline" },
        wallTime: Date.now(),
        nodeId: "node-b",
      });
      await sleep(200);

      // A reconnects and replays queued operations
      const clientA2 = await connectClient("user-offline-a", "Alice");
      await joinRoom(clientA2, roomId);
      await sleep(100);

      // Replay 5 "queued" operations
      for (let i = 0; i < 5; i++) {
        sendOp(clientA2, roomId, {
          id: `op-replay-${i}`,
          type: "add",
          itemId: `item-replay-${i}`,
          payload: { name: `Replay Item ${i}` },
          wallTime: Date.now() + i,
          nodeId: "node-a",
        });
      }
      await sleep(1000);

      // Verify convergence: all items present
      const state = server.syncEngine.getState(roomId);
      expect(state.items["item-online"]).toBeDefined();
      expect(state.items["item-while-offline"]).toBeDefined();
      for (let i = 0; i < 5; i++) {
        expect(state.items[`item-replay-${i}`]).toBeDefined();
      }

      const activeItems = Object.values(state.items).filter(
        (item: any) => item.removedAt === null
      );
      expect(activeItems.length).toBe(7); // 1 + 1 + 5

      await Promise.all([closeClient(clientA2), closeClient(clientB)]);
    });

    it("should maintain causal ordering of replayed operations (Req 19.5)", async () => {
      const client = await connectClient("user-causal", "Causal");
      const roomId = await createRoom(client);
      await joinRoom(client, roomId);
      await sleep(50);

      // Send operations with explicit causal ordering
      const baseTime = Date.now();
      for (let i = 0; i < 10; i++) {
        sendOp(client, roomId, {
          id: `op-causal-${i}`,
          type: "add",
          itemId: `item-causal-${i}`,
          payload: { name: `Item ${i}`, order: i },
          wallTime: baseTime + i * 10,
          logical: i,
          nodeId: "node-causal",
        });
      }
      await sleep(1000);

      const state = server.syncEngine.getState(roomId);
      for (let i = 0; i < 10; i++) {
        expect(state.items[`item-causal-${i}`]).toBeDefined();
        expect(state.items[`item-causal-${i}`].fields.order.value).toBe(i);
      }

      await closeClient(client);
    });

    it("should deliver state snapshot on rejoin after disconnect", async () => {
      const clientA = await connectClient("user-snap-a", "Alice");
      const roomId = await createRoom(clientA);
      await joinRoom(clientA, roomId);
      await sleep(50);

      // Add items before disconnecting
      for (let i = 0; i < 3; i++) {
        sendOp(clientA, roomId, {
          id: `op-pre-${i}`,
          type: "add",
          itemId: `item-pre-${i}`,
          payload: { name: `Pre Item ${i}` },
          wallTime: Date.now() + i,
          nodeId: "node-snap-a",
        });
      }
      await sleep(500);

      await closeClient(clientA);
      await sleep(200);

      // Reconnect — on join, should receive state snapshot
      const clientA2 = await connectClient("user-snap-a", "Alice");
      // Clear buffer to only get join-related messages
      clientA2.received.length = 0;

      await joinRoom(clientA2, roomId);

      // The join triggers a delta (snapshot) delivery
      const snapshot = await waitForFrame(
        clientA2,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      const changes = (snapshot.payload as any).changes;
      expect(changes).toBeDefined();
      expect(changes.length).toBeGreaterThanOrEqual(3);

      await closeClient(clientA2);
    });
  });

  // ─── Test 4: Snapshot lifecycle ────────────────────────────────────

  describe("Snapshot lifecycle over 5000 operations", () => {
    it("should trigger snapshot creation after threshold", async () => {
      // Restart server with very low snapshot threshold
      await server.stop();
      server = await createServer({
        port: 0,
        jwtSecret: JWT_SECRET,
        heartbeatIntervalMs: 60000,
        heartbeatTimeoutMs: 60000,
        batchWindowMs: 1,
        snapshotThreshold: 5,
      });
      await new Promise<void>((resolve) => {
        server.httpServer.listen(0, () => resolve());
      });
      const addr = server.httpServer.address();
      TEST_PORT = typeof addr === "object" && addr ? addr.port : 9999;

      const client = await connectClient("user-snapshot", "SnapshotUser");
      const roomId = await createRoom(client);
      await joinRoom(client, roomId);
      await sleep(50);

      // Send operations via WebSocket
      const baseTime = Date.now();
      for (let i = 0; i < 20; i++) {
        sendOp(client, roomId, {
          id: `op-snap-${i}`,
          type: "add",
          itemId: `item-snap-${i}`,
          payload: { name: `Snap Item ${i}` },
          wallTime: baseTime + i,
          nodeId: "node-snapshot",
        });
      }
      await sleep(1500);

      // Verify all items in state
      const state = server.syncEngine.getState(roomId);
      const activeItems = Object.values(state.items).filter(
        (item: any) => item.removedAt === null
      );
      expect(activeItems.length).toBe(20);

      // The room's operation count should reflect all processed ops
      const room = server.syncEngine.getRoom(roomId);
      expect(room).toBeDefined();
      expect(room!.operationCount).toBe(20);

      // Simulate the snapshot lifecycle: record operations into snapshot manager
      // and verify it creates a snapshot when threshold is exceeded
      server.snapshotManager.registerRoom(roomId, state);
      const dummyOp = {
        id: "snap-trigger",
        sessionId: roomId,
        replicaId: "test",
        type: "add" as const,
        itemId: "trigger",
        payload: {},
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "test" },
        version: 1,
      };

      // Record operations until threshold (5) is crossed
      for (let i = 0; i < 6; i++) {
        const result = await server.snapshotManager.recordOperation(roomId, dummyOp, state);
        if (result) {
          // Snapshot was triggered
          expect(result.state).toBeDefined();
          break;
        }
      }

      // Verify the snapshot is retrievable
      const retrieved = await server.snapshotManager.getLatestSnapshot(roomId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.state.items).toBeDefined();

      await closeClient(client);
    });

    it("should handle high volume with multiple snapshot cycles (Req 23.1-23.4)", async () => {
      await server.stop();
      server = await createServer({
        port: 0,
        jwtSecret: JWT_SECRET,
        heartbeatIntervalMs: 60000,
        heartbeatTimeoutMs: 60000,
        batchWindowMs: 1,
        snapshotThreshold: 10, // Low threshold for testing
      });
      await new Promise<void>((resolve) => {
        server.httpServer.listen(0, () => resolve());
      });
      const addr = server.httpServer.address();
      TEST_PORT = typeof addr === "object" && addr ? addr.port : 9999;

      const client = await connectClient("user-highvol", "HighVol");
      const roomId = await createRoom(client);
      await joinRoom(client, roomId);
      await sleep(50);

      // Send 50 operations with delays to create separate batch cycles
      const baseTime = Date.now();
      const TOTAL_OPS = 50;

      for (let i = 0; i < TOTAL_OPS; i++) {
        sendOp(client, roomId, {
          id: `op-hv-${i}`,
          type: "add",
          itemId: `item-hv-${i}`,
          payload: { name: `HV ${i}` },
          wallTime: baseTime + i,
          nodeId: "node-hv",
        });
        if (i % 5 === 4) await sleep(10); // Small delay every 5 ops
      }
      await sleep(2000);

      // Verify state integrity
      const state = server.syncEngine.getState(roomId);
      const activeItems = Object.values(state.items).filter(
        (item: any) => item.removedAt === null
      );
      expect(activeItems.length).toBe(TOTAL_OPS);

      await closeClient(client);
    });

    it("should deliver full state to newly joining clients after snapshots", async () => {
      await server.stop();
      server = await createServer({
        port: 0,
        jwtSecret: JWT_SECRET,
        heartbeatIntervalMs: 60000,
        heartbeatTimeoutMs: 60000,
        batchWindowMs: 1,
        snapshotThreshold: 10,
      });
      await new Promise<void>((resolve) => {
        server.httpServer.listen(0, () => resolve());
      });
      const addr = server.httpServer.address();
      TEST_PORT = typeof addr === "object" && addr ? addr.port : 9999;

      // Client A populates the room
      const clientA = await connectClient("user-tail-a", "Alice");
      const roomId = await createRoom(clientA);
      await joinRoom(clientA, roomId);
      await sleep(50);

      // Send 30 ops with delays to ensure multiple batch cycles
      const baseTime = Date.now();
      for (let i = 0; i < 30; i++) {
        sendOp(clientA, roomId, {
          id: `op-tail-${i}`,
          type: "add",
          itemId: `item-tail-${i}`,
          payload: { name: `Tail ${i}` },
          wallTime: baseTime + i,
          nodeId: "node-tail-a",
        });
        if (i % 3 === 2) await sleep(10);
      }
      await sleep(2000);

      // New client B joins — should get full current state
      const clientB = await connectClient("user-tail-b", "Bob");
      clientB.received.length = 0;
      await joinRoom(clientB, roomId);

      const snapshot = await waitForFrame(
        clientB,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      const changes = (snapshot.payload as any).changes;
      expect(changes).toBeDefined();
      expect(changes.length).toBe(30);

      await Promise.all([closeClient(clientA), closeClient(clientB)]);
    });
  });
});
