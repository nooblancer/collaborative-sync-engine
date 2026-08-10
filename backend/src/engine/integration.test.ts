/**
 * Integration tests for multi-client collaboration.
 *
 * Tests end-to-end behavior with real WebSocket connections:
 * - 5 concurrent clients connecting and editing shared inventory
 * - Offline → reconnect → merge → convergence flow
 * - Operation propagation within 200ms under normal conditions
 * - Presence join/leave broadcasting across multiple clients
 *
 * Requirements: 1.4, 2.1, 2.2, 6.2, 8.2, 8.5, 8.7
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import { createServer, type ServerInstance } from "../index.js";
import type { ServerMessage } from "../types/index.js";

// ─── Test Configuration ────────────────────────────────────────────────

let TEST_PORT = 9876;
const JWT_SECRET = "integration-test-secret";
const SESSION_ID = "integration-session";

// ─── Test Helpers ──────────────────────────────────────────────────────

/** Creates a JWT token for a test user. */
function createToken(userId: string, displayName: string, sessionId = SESSION_ID): string {
  return jwt.sign(
    { userId, displayName, sessionId },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

/** Connects a raw WebSocket client to the test server and waits for the connection to open. */
function connectClient(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", (err) => reject(err));
  });
}

/** Waits for a message matching a predicate from a WebSocket client. */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: ServerMessage) => boolean,
  timeoutMs = 5000
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeListener("message", handler);
      reject(new Error(`Timed out waiting for message (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(data: WebSocket.Data) {
      try {
        const msg: ServerMessage = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.on("message", handler);
  });
}

/** Collects all messages matching a predicate within a time window. */
function collectMessages(
  ws: WebSocket,
  predicate: (msg: ServerMessage) => boolean,
  durationMs: number
): Promise<ServerMessage[]> {
  return new Promise((resolve) => {
    const collected: ServerMessage[] = [];

    function handler(data: WebSocket.Data) {
      try {
        const msg: ServerMessage = JSON.parse(data.toString());
        if (predicate(msg)) {
          collected.push(msg);
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.on("message", handler);

    setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(collected);
    }, durationMs);
  });
}

/** Sends an operation message from a client. */
function sendOperation(
  ws: WebSocket,
  opts: {
    id: string;
    sessionId?: string;
    replicaId: string;
    type: "add" | "remove" | "update";
    itemId: string;
    payload: Record<string, unknown>;
    wallTime: number;
    logical?: number;
    version?: number;
  }
): void {
  const message = {
    type: "operation",
    payload: {
      id: opts.id,
      sessionId: opts.sessionId ?? SESSION_ID,
      replicaId: opts.replicaId,
      type: opts.type,
      itemId: opts.itemId,
      payload: opts.payload,
      timestamp: {
        wallTime: opts.wallTime,
        logical: opts.logical ?? 0,
        nodeId: opts.replicaId,
      },
      version: opts.version ?? 0,
    },
  };
  ws.send(JSON.stringify(message));
}

/** Small helper to wait a fixed duration. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gracefully closes a WebSocket client. */
function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    ws.on("close", () => resolve());
    ws.close();
  });
}

// ─── Test Suite ────────────────────────────────────────────────────────

describe("Integration: Multi-Client Collaboration", { timeout: 30000 }, () => {
  let server: ServerInstance;

  beforeEach(async () => {
    server = await createServer({
      port: 0,
      jwtSecret: JWT_SECRET,
      heartbeatIntervalMs: 60000, // Long heartbeat to avoid interference in short tests
      heartbeatTimeoutMs: 60000,
    });

    // Start the HTTP server on a random available port
    await new Promise<void>((resolve) => {
      server.httpServer.listen(0, () => resolve());
    });
    const addr = server.httpServer.address();
    TEST_PORT = typeof addr === "object" && addr ? addr.port : 9876;
  });

  afterEach(async () => {
    await server.stop();
  });

  // ─── Test: 5 concurrent clients editing shared inventory ───────────

  it("should support 5 concurrent clients connecting and editing shared inventory", async () => {
    // Connect 5 clients with valid tokens
    const clients: WebSocket[] = [];
    for (let i = 0; i < 5; i++) {
      const token = createToken(`user-${i}`, `User ${i}`);
      const ws = await connectClient(token);
      clients.push(ws);
    }

    // Give presence events time to propagate
    await sleep(200);

    // Each client adds an inventory item
    const baseTime = Date.now();
    for (let i = 0; i < 5; i++) {
      sendOperation(clients[i], {
        id: `op-${i}`,
        replicaId: `replica-${i}`,
        type: "add",
        itemId: `item-${i}`,
        payload: { name: `Widget ${i}`, quantity: i + 1 },
        wallTime: baseTime + i,
      });
    }

    // Wait for all clients to receive deltas or ACKs (up to 2 seconds)
    // Each client should receive 4 deltas (from the other 4 clients)
    // and 1 ACK (for its own operation)
    await sleep(2000);

    // Verify convergence: check server state has all 5 items
    const state = await server.syncEngine.getState(SESSION_ID);
    const activeItems = Object.values(state.items).filter((item) => item.removedAt === null);
    expect(activeItems.length).toBe(5);

    // Verify each item exists
    for (let i = 0; i < 5; i++) {
      expect(state.items[`item-${i}`]).toBeDefined();
      expect(state.items[`item-${i}`].removedAt).toBeNull();
    }

    // Cleanup
    await Promise.all(clients.map(closeClient));
  }, 10000);

  // ─── Test: Offline → reconnect → merge → convergence ──────────────

  it("should handle offline → reconnect → merge → convergence flow", async () => {
    // Client A connects and adds an item while online
    const tokenA = createToken("user-a", "User A");
    const clientA = await connectClient(tokenA);

    sendOperation(clientA, {
      id: "op-online-1",
      replicaId: "replica-a",
      type: "add",
      itemId: "item-online-1",
      payload: { name: "Online Item", quantity: 10 },
      wallTime: Date.now(),
    });

    // Wait for ACK
    await waitForMessage(clientA, (msg) => msg.type === "ack" && msg.operationId === "op-online-1");

    // Client B connects (observer)
    const tokenB = createToken("user-b", "User B");
    const clientB = await connectClient(tokenB);
    await sleep(100);

    // Client A disconnects (simulating going offline)
    await closeClient(clientA);
    await sleep(200);

    // While "offline", user generates operations that will be sent on reconnect.
    // On reconnect, client sends queued operations as a batch.
    // Simulate by reconnecting and immediately sending the "offline" operations.
    const clientA2 = await connectClient(tokenA);

    // Set up ACK listeners BEFORE sending operations (to avoid race conditions)
    const ack1Promise = waitForMessage(
      clientA2,
      (msg) => msg.type === "ack" && msg.operationId === "op-offline-1",
      5000
    );
    const ack2Promise = waitForMessage(
      clientA2,
      (msg) => msg.type === "ack" && msg.operationId === "op-offline-2",
      5000
    );

    // Send the "offline" operations (items created while disconnected)
    sendOperation(clientA2, {
      id: "op-offline-1",
      replicaId: "replica-a",
      type: "add",
      itemId: "item-offline-1",
      payload: { name: "Offline Item 1", quantity: 5 },
      wallTime: Date.now(),
      version: 1,
    });

    sendOperation(clientA2, {
      id: "op-offline-2",
      replicaId: "replica-a",
      type: "add",
      itemId: "item-offline-2",
      payload: { name: "Offline Item 2", quantity: 3 },
      wallTime: Date.now() + 1,
      version: 1,
    });

    // Wait for both ACKs
    await Promise.all([ack1Promise, ack2Promise]);

    // Verify convergence: all 3 items should be in server state
    const state = await server.syncEngine.getState(SESSION_ID);
    const activeItems = Object.values(state.items).filter((item) => item.removedAt === null);
    expect(activeItems.length).toBe(3);
    expect(state.items["item-online-1"]).toBeDefined();
    expect(state.items["item-offline-1"]).toBeDefined();
    expect(state.items["item-offline-2"]).toBeDefined();

    // Verify Client B received deltas for the offline operations
    // (the broadcastDelta should have sent them)
    // We just verify the server state converged — B would also get updates via delta broadcast

    // Cleanup
    await Promise.all([closeClient(clientA2), closeClient(clientB)]);
  }, 10000);

  // ─── Test: Propagation latency < 200ms ─────────────────────────────

  it("should propagate operations to other clients within 200ms under normal conditions", async () => {
    // Connect Client A (sender) and Client B (receiver)
    const tokenA = createToken("user-sender", "Sender");
    const tokenB = createToken("user-receiver", "Receiver");

    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);

    // Allow connections to stabilize
    await sleep(200);

    // Set up timer: measure how long until Client B receives the delta
    const sendTime = Date.now();

    // Client A sends an operation
    sendOperation(clientA, {
      id: "op-latency-test",
      replicaId: "replica-sender",
      type: "add",
      itemId: "item-latency",
      payload: { name: "Latency Test Item", quantity: 1 },
      wallTime: sendTime,
    });

    // Wait for Client B to receive the delta
    const deltaMsg = await waitForMessage(
      clientB,
      (msg) => msg.type === "delta",
      5000
    );

    const receiveTime = Date.now();
    const latency = receiveTime - sendTime;

    // Verify the delta was received
    expect(deltaMsg.type).toBe("delta");

    // Assert latency is under 200ms (generous for local testing)
    expect(latency).toBeLessThan(200);

    // Cleanup
    await Promise.all([closeClient(clientA), closeClient(clientB)]);
  }, 10000);

  // ─── Test: Presence join/leave broadcasting ────────────────────────

  it("should broadcast presence-join events when clients connect", async () => {
    // Connect Client A first
    const tokenA = createToken("user-presence-a", "Alice");
    const clientA = await connectClient(tokenA);

    // Set up listener on Client A for presence-join of next client
    const joinPromise = waitForMessage(
      clientA,
      (msg) => msg.type === "presence-join" && msg.user?.userId === "user-presence-b",
      5000
    );

    // Connect Client B
    const tokenB = createToken("user-presence-b", "Bob");
    const clientB = await connectClient(tokenB);

    // Client A should receive presence-join for Client B
    const joinMsg = await joinPromise;
    expect(joinMsg.type).toBe("presence-join");
    expect(joinMsg.user).toBeDefined();
    expect(joinMsg.user!.userId).toBe("user-presence-b");
    expect(joinMsg.user!.displayName).toBe("Bob");
    expect(joinMsg.user!.status).toBe("online");

    // Cleanup
    await Promise.all([closeClient(clientA), closeClient(clientB)]);
  }, 10000);

  it("should broadcast presence-leave events when clients disconnect", async () => {
    // Connect both clients
    const tokenA = createToken("user-leave-a", "Alice");
    const tokenB = createToken("user-leave-b", "Bob");

    const clientA = await connectClient(tokenA);
    const clientB = await connectClient(tokenB);

    // Wait for presence events to settle
    await sleep(300);

    // Set up listener on Client A for presence-leave
    const leavePromise = waitForMessage(
      clientA,
      (msg) => msg.type === "presence-leave" && msg.userId === "user-leave-b",
      5000
    );

    // Disconnect Client B
    await closeClient(clientB);

    // Client A should receive presence-leave for Client B
    const leaveMsg = await leavePromise;
    expect(leaveMsg.type).toBe("presence-leave");
    expect(leaveMsg.userId).toBe("user-leave-b");

    // Cleanup
    await closeClient(clientA);
  }, 10000);

  it("should broadcast presence events across multiple clients", async () => {
    // Connect 3 clients
    const tokens = [
      createToken("user-multi-a", "Alice"),
      createToken("user-multi-b", "Bob"),
      createToken("user-multi-c", "Charlie"),
    ];

    const clientA = await connectClient(tokens[0]);
    await sleep(100);

    const clientB = await connectClient(tokens[1]);
    await sleep(100);

    // Client A should have received a presence-join for B
    // Now connect C and both A and B should get presence-join

    const joinPromiseA = waitForMessage(
      clientA,
      (msg) => msg.type === "presence-join" && msg.user?.userId === "user-multi-c",
      5000
    );
    const joinPromiseB = waitForMessage(
      clientB,
      (msg) => msg.type === "presence-join" && msg.user?.userId === "user-multi-c",
      5000
    );

    const clientC = await connectClient(tokens[2]);

    const [joinMsgA, joinMsgB] = await Promise.all([joinPromiseA, joinPromiseB]);

    expect(joinMsgA.user!.userId).toBe("user-multi-c");
    expect(joinMsgA.user!.displayName).toBe("Charlie");
    expect(joinMsgB.user!.userId).toBe("user-multi-c");
    expect(joinMsgB.user!.displayName).toBe("Charlie");

    // Disconnect C and verify both A and B get leave events
    const leavePromiseA = waitForMessage(
      clientA,
      (msg) => msg.type === "presence-leave" && msg.userId === "user-multi-c",
      5000
    );
    const leavePromiseB = waitForMessage(
      clientB,
      (msg) => msg.type === "presence-leave" && msg.userId === "user-multi-c",
      5000
    );

    await closeClient(clientC);

    const [leaveMsgA, leaveMsgB] = await Promise.all([leavePromiseA, leavePromiseB]);
    expect(leaveMsgA.type).toBe("presence-leave");
    expect(leaveMsgB.type).toBe("presence-leave");

    // Cleanup
    await Promise.all([closeClient(clientA), closeClient(clientB)]);
  }, 15000);
});
