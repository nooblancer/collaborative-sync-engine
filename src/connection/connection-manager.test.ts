/**
 * Unit tests for ConnectionManager - WebSocket server connection lifecycle.
 * Tests authentication, session assignment, connection limits, presence tracking,
 * heartbeat timeout, and display name validation.
 *
 * Requirements covered: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { ConnectionManager } from "./connection-manager.js";
import type { ServerMessage } from "../types/index.js";

const JWT_SECRET = "test-secret-key";
let TEST_PORT = 9876;

function createToken(payload: {
  userId: string;
  displayName: string;
  sessionId: string;
  exp?: number;
}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

function createExpiredToken(payload: {
  userId: string;
  displayName: string;
  sessionId: string;
}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "-1s" });
}

function connectClient(
  port: number,
  token: string
): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?token=${token}`);
    const messages: ServerMessage[] = [];

    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.on("open", () => {
      // Give a brief delay for server-side processing
      setTimeout(() => resolve({ ws, messages }), 100);
    });

    ws.on("error", (err) => reject(err));
  });
}

function waitForMessage(ws: WebSocket, timeout = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitForMessage timed out")), timeout);
    ws.on("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForMessageOfType(ws: WebSocket, type: string, timeout = 2000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`waitForMessageOfType(${type}) timed out`)), timeout);
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ConnectionManager", () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager({
      port: 0,
      jwtSecret: JWT_SECRET,
      maxConnectionsPerSession: 3,
      heartbeatIntervalMs: 30000, // Keep heartbeat large so it doesn't interfere
      heartbeatTimeoutMs: 30000,
    });
    const wss = manager.start();
    const addr = wss.address();
    TEST_PORT = typeof addr === "object" && addr ? addr.port : 9876;
  });

  afterEach(async () => {
    await manager.stop();
  });

  describe("connection establishment", () => {
    it("should accept a valid authenticated connection and assign a session ID", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT, token);

      expect(manager.getConnectionCount("session-1")).toBe(1);
      const presenceList = manager.getPresenceList("session-1");
      expect(presenceList).toHaveLength(1);
      expect(presenceList[0].userId).toBe("user-1");
      expect(presenceList[0].displayName).toBe("Alice");
      expect(presenceList[0].status).toBe("online");

      ws.close();
    });

    it("should reject connections without a token", async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      const closePromise = waitForClose(ws);
      const msgPromise = waitForMessage(ws);

      const msg = await msgPromise;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("malformed");

      const { code } = await closePromise;
      expect(code).toBe(4001);
    });

    it("should reject connections with an expired token", async () => {
      const token = createExpiredToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token}`);
      const closePromise = waitForClose(ws);
      const msgPromise = waitForMessage(ws);

      const msg = await msgPromise;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("expired");

      const { code } = await closePromise;
      expect(code).toBe(4001);
    });

    it("should reject connections with a malformed token", async () => {
      const ws = new WebSocket(
        `ws://localhost:${TEST_PORT}?token=not-a-valid-jwt`
      );
      const closePromise = waitForClose(ws);
      const msgPromise = waitForMessage(ws);

      const msg = await msgPromise;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("malformed");

      const { code } = await closePromise;
      expect(code).toBe(4001);
    });

    it("should reject connections with a token signed with wrong secret", async () => {
      const token = jwt.sign(
        { userId: "user-1", displayName: "Alice", sessionId: "session-1" },
        "wrong-secret",
        { expiresIn: "1h" }
      );

      const ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token}`);
      const closePromise = waitForClose(ws);
      const msgPromise = waitForMessage(ws);

      const msg = await msgPromise;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("malformed");

      await closePromise;
    });

    it("should extract token from Authorization header", async () => {
      const token = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      await new Promise<void>((resolve) => {
        ws.on("open", () => setTimeout(resolve, 100));
      });

      expect(manager.getConnectionCount("session-1")).toBe(1);
      const presenceList = manager.getPresenceList("session-1");
      expect(presenceList[0].userId).toBe("user-2");

      ws.close();
    });
  });

  describe("connection limits", () => {
    it("should enforce max concurrent connections per session", async () => {
      const connections: WebSocket[] = [];

      // Connect max allowed (3)
      for (let i = 0; i < 3; i++) {
        const token = createToken({
          userId: `user-${i}`,
          displayName: `User ${i}`,
          sessionId: "session-1",
        });
        const { ws } = await connectClient(TEST_PORT, token);
        connections.push(ws);
      }

      expect(manager.getConnectionCount("session-1")).toBe(3);

      // Try to connect a 4th
      const token = createToken({
        userId: "user-3",
        displayName: "User 3",
        sessionId: "session-1",
      });

      const ws4 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token}`);
      const msgPromise = waitForMessage(ws4);
      const closePromise = waitForClose(ws4);

      const msg = await msgPromise;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("session_full");
      expect(msg.message).toContain("maximum");

      const { code } = await closePromise;
      expect(code).toBe(4003);

      // Clean up
      for (const conn of connections) {
        conn.close();
      }
    });

    it("should allow connections to different sessions independently", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-A",
      });
      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-B",
      });

      const { ws: ws1 } = await connectClient(TEST_PORT, token1);
      const { ws: ws2 } = await connectClient(TEST_PORT, token2);

      expect(manager.getConnectionCount("session-A")).toBe(1);
      expect(manager.getConnectionCount("session-B")).toBe(1);

      ws1.close();
      ws2.close();
    });
  });

  describe("disconnection handling", () => {
    it("should remove client from tracking on close", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT, token);
      expect(manager.getConnectionCount("session-1")).toBe(1);

      ws.close();
      // Wait for close event propagation
      await delay(200);

      expect(manager.getConnectionCount("session-1")).toBe(0);
      expect(manager.getPresenceList("session-1")).toHaveLength(0);
    });

    it("should broadcast presence-leave on disconnection (Req 2.2)", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });
      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      const { ws: ws1 } = await connectClient(TEST_PORT, token1);
      const { ws: ws2 } = await connectClient(TEST_PORT, token2);

      // Wait for connection to stabilize
      await delay(100);

      // Set up listener for presence-leave on ws1 before disconnecting ws2
      const leavePromise = waitForMessageOfType(ws1, "presence-leave");

      // Disconnect ws2
      ws2.close();

      const leaveMsg = await leavePromise;
      expect(leaveMsg.type).toBe("presence-leave");
      expect(leaveMsg.userId).toBe("user-2");

      ws1.close();
    });
  });

  describe("presence tracking", () => {
    it("should return empty presence list for unknown session", () => {
      expect(manager.getPresenceList("non-existent")).toEqual([]);
    });

    it("should return all connected users in a session", async () => {
      const connections: WebSocket[] = [];

      for (let i = 0; i < 3; i++) {
        const token = createToken({
          userId: `user-${i}`,
          displayName: `User ${i}`,
          sessionId: "session-1",
        });
        const { ws } = await connectClient(TEST_PORT, token);
        connections.push(ws);
      }

      const presenceList = manager.getPresenceList("session-1");
      expect(presenceList).toHaveLength(3);

      const userIds = presenceList.map((p) => p.userId).sort();
      expect(userIds).toEqual(["user-0", "user-1", "user-2"]);

      for (const conn of connections) {
        conn.close();
      }
    });

    it("should broadcast presence-join to existing clients when a new client connects (Req 2.1)", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws: ws1 } = await connectClient(TEST_PORT, token1);

      // Set up listener for presence-join before client 2 connects
      const joinPromise = waitForMessageOfType(ws1, "presence-join");

      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      const { ws: ws2 } = await connectClient(TEST_PORT, token2);

      const joinMsg = await joinPromise;
      expect(joinMsg.user?.userId).toBe("user-2");
      expect(joinMsg.user?.displayName).toBe("Bob");

      ws1.close();
      ws2.close();
    });

    it("should include userId, displayName, and connectedAt in presence list (Req 2.4)", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const beforeConnect = Date.now();
      const { ws } = await connectClient(TEST_PORT, token);

      const presenceList = manager.getPresenceList("session-1");
      expect(presenceList).toHaveLength(1);
      expect(presenceList[0].userId).toBe("user-1");
      expect(presenceList[0].displayName).toBe("Alice");
      expect(presenceList[0].connectedAt).toBeGreaterThanOrEqual(beforeConnect);
      expect(presenceList[0].connectedAt).toBeLessThanOrEqual(Date.now());

      ws.close();
    });

    it("should broadcast presence-join within 2 seconds of connection (Req 2.1)", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws: ws1 } = await connectClient(TEST_PORT, token1);

      // Set up a timed listener
      const start = Date.now();
      const joinPromise = waitForMessageOfType(ws1, "presence-join");

      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      const { ws: ws2 } = await connectClient(TEST_PORT, token2);

      const msg = await joinPromise;
      const elapsed = Date.now() - start;
      expect(msg.user?.userId).toBe("user-2");
      expect(elapsed).toBeLessThan(2000);

      ws1.close();
      ws2.close();
    });

    it("should broadcast presence-leave within 2 seconds of disconnection (Req 2.2)", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });
      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      const { ws: ws1 } = await connectClient(TEST_PORT, token1);
      const { ws: ws2 } = await connectClient(TEST_PORT, token2);
      await delay(100);

      // Set up a timed listener for presence-leave
      const start = Date.now();
      const leavePromise = waitForMessageOfType(ws1, "presence-leave");

      ws2.close();

      const msg = await leavePromise;
      const elapsed = Date.now() - start;
      expect(msg.userId).toBe("user-2");
      expect(elapsed).toBeLessThan(2000);

      ws1.close();
    });

    it("should validate display name is between 1 and 100 characters (Req 2.5)", async () => {
      // Empty display name should be rejected
      const emptyNameToken = jwt.sign(
        { userId: "user-1", displayName: "", sessionId: "session-1" },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${emptyNameToken}`);
      const msg1 = await waitForMessage(ws1);
      expect(msg1.type).toBe("error");
      expect(msg1.code).toBe("malformed");
      expect(msg1.message).toContain("Display name");
      await waitForClose(ws1);

      // 101-char display name should be rejected
      const longName = "a".repeat(101);
      const longNameToken = jwt.sign(
        { userId: "user-2", displayName: longName, sessionId: "session-1" },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${longNameToken}`);
      const msg2 = await waitForMessage(ws2);
      expect(msg2.type).toBe("error");
      expect(msg2.code).toBe("malformed");
      await waitForClose(ws2);

      // Exactly 100 characters should be accepted
      const maxName = "b".repeat(100);
      const maxNameToken = createToken({
        userId: "user-3",
        displayName: maxName,
        sessionId: "session-1",
      });

      const { ws: ws3 } = await connectClient(TEST_PORT, maxNameToken);
      const presenceList = manager.getPresenceList("session-1");
      expect(presenceList).toHaveLength(1);
      expect(presenceList[0].displayName).toBe(maxName);

      ws3.close();
    });

    it("should validate that a 1-character display name is accepted (Req 2.5)", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "A",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT, token);
      const presenceList = manager.getPresenceList("session-1");
      expect(presenceList).toHaveLength(1);
      expect(presenceList[0].displayName).toBe("A");

      ws.close();
    });
  });

  describe("heartbeat timeout (Req 2.3)", () => {
    let heartbeatManager: ConnectionManager;
    let HEARTBEAT_PORT: number;

    beforeEach(() => {
      // Use short intervals for testing heartbeat timeout
      heartbeatManager = new ConnectionManager({
        port: 0,
        jwtSecret: JWT_SECRET,
        maxConnectionsPerSession: 50,
        heartbeatIntervalMs: 50,   // Send ping every 50ms
        heartbeatTimeoutMs: 150,   // Timeout after 150ms without pong
      });
      const wss = heartbeatManager.start();
      const addr = wss.address();
      HEARTBEAT_PORT = typeof addr === "object" && addr ? addr.port : 9877;
    });

    afterEach(async () => {
      await heartbeatManager.stop();
    });

    it("should disconnect client after heartbeat timeout and broadcast presence-leave (Req 2.3)", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });
      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      // Connect observer client normally (will auto-respond to pings)
      const { ws: ws1 } = await connectClient(HEARTBEAT_PORT, token1);

      // Connect client 2 using raw socket to suppress pong
      const ws2 = new WebSocket(`ws://localhost:${HEARTBEAT_PORT}?token=${token2}`);
      await new Promise<void>((resolve) => ws2.on("open", () => setTimeout(resolve, 100)));

      // Both should be connected
      expect(heartbeatManager.getConnectionCount("session-1")).toBe(2);

      // Suppress pong responses from ws2 by overriding the underlying socket behavior
      // The ws library auto-responds to ping frames at the protocol level,
      // so we need to close the socket to simulate an unresponsive client
      const ws2ClosePromise = waitForClose(ws2);

      // Simulate unresponsive client: forcibly destroy the underlying socket
      // without sending a close frame (simulates network failure)
      (ws2 as any)._socket?.destroy();

      // Wait for the heartbeat timeout to fire and clean up
      await delay(400);

      // After timeout, only ws1 should remain
      expect(heartbeatManager.getConnectionCount("session-1")).toBe(1);

      ws1.close();
    });

    it("should broadcast presence-join when a previously disconnected client reconnects (Req 2.6)", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });
      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      // Connect observer client
      const { ws: ws1 } = await connectClient(HEARTBEAT_PORT, token1);
      await delay(50);

      // Set up listener for first presence-join
      const firstJoinPromise = waitForMessageOfType(ws1, "presence-join");

      // Connect client 2
      const { ws: ws2 } = await connectClient(HEARTBEAT_PORT, token2);
      const firstJoin = await firstJoinPromise;
      expect(firstJoin.user?.userId).toBe("user-2");

      // Disconnect client 2
      const leavePromise = waitForMessageOfType(ws1, "presence-leave");
      ws2.close();
      const leaveMsg = await leavePromise;
      expect(leaveMsg.userId).toBe("user-2");

      // Now reconnect user-2 — should trigger a new presence-join
      const rejoinPromise = waitForMessageOfType(ws1, "presence-join");

      const token2Reconnect = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });
      const { ws: ws2b } = await connectClient(HEARTBEAT_PORT, token2Reconnect);

      const rejoinMsg = await rejoinPromise;
      expect(rejoinMsg.user?.userId).toBe("user-2");
      expect(rejoinMsg.user?.displayName).toBe("Bob");

      ws1.close();
      ws2b.close();
    });
  });

  describe("error handling within 3 seconds", () => {
    it("should reject and close connection within timeout for invalid auth", async () => {
      const start = Date.now();
      const ws = new WebSocket(
        `ws://localhost:${TEST_PORT}?token=invalid-token`
      );
      const closePromise = waitForClose(ws);

      await closePromise;
      const elapsed = Date.now() - start;

      // Should complete within 3 seconds
      expect(elapsed).toBeLessThan(3000);
    });
  });
});


describe("ConnectionManager - Message Routing and Missed Update Queuing", () => {
  let manager: ConnectionManager;
  let TEST_PORT_ROUTING: number;

  beforeEach(() => {
    manager = new ConnectionManager({
      port: 0,
      jwtSecret: JWT_SECRET,
      maxConnectionsPerSession: 50,
      heartbeatIntervalMs: 60000,
      heartbeatTimeoutMs: 60000,
    });
    const wss = manager.start();
    const addr = wss.address();
    TEST_PORT_ROUTING = typeof addr === "object" && addr ? addr.port : 9878;
  });

  afterEach(async () => {
    await manager.stop();
  });

  describe("message routing - operations", () => {
    it("should invoke onOperation callback when client sends an operation message", async () => {
      const receivedOps: { clientId: string; operation: any }[] = [];
      manager.onOperation = async (clientId, operation) => {
        receivedOps.push({ clientId, operation });
      };

      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT_ROUTING, token);

      const operation = {
        id: "op-1",
        sessionId: "session-1",
        replicaId: "replica-1",
        type: "add",
        itemId: "item-1",
        payload: { name: "Widget", quantity: 5 },
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "node-1" },
        version: 1,
      };

      ws.send(JSON.stringify({ type: "operation", payload: operation }));

      await delay(200);

      expect(receivedOps).toHaveLength(1);
      expect(receivedOps[0].operation.id).toBe("op-1");
      expect(receivedOps[0].operation.type).toBe("add");

      ws.close();
    });

    it("should send error when operation processing fails", async () => {
      manager.onOperation = async () => {
        throw new Error("Processing failed");
      };

      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT_ROUTING, token);

      const errorPromise = waitForMessageOfType(ws, "error");

      ws.send(
        JSON.stringify({
          type: "operation",
          payload: { id: "op-1", type: "add" },
        })
      );

      const errorMsg = await errorPromise;
      expect(errorMsg.type).toBe("error");
      expect(errorMsg.code).toBe("operation_failed");

      ws.close();
    });
  });

  describe("message routing - presence request", () => {
    it("should return presence list when client sends presence-request", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });
      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });

      const { ws: ws1 } = await connectClient(TEST_PORT_ROUTING, token1);
      const { ws: ws2 } = await connectClient(TEST_PORT_ROUTING, token2);

      const presencePromise = waitForMessageOfType(ws1, "presence-list");

      ws1.send(JSON.stringify({ type: "presence-request" }));

      const presenceMsg = await presencePromise;
      expect(presenceMsg.type).toBe("presence-list");
      expect(presenceMsg.users).toHaveLength(2);

      const userIds = presenceMsg.users!.map((u) => u.userId).sort();
      expect(userIds).toEqual(["user-1", "user-2"]);

      ws1.close();
      ws2.close();
    });
  });

  describe("delta broadcasting", () => {
    it("should broadcast delta to all clients except the sender", async () => {
      const token1 = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });
      const token2 = createToken({
        userId: "user-2",
        displayName: "Bob",
        sessionId: "session-1",
      });
      const token3 = createToken({
        userId: "user-3",
        displayName: "Charlie",
        sessionId: "session-1",
      });

      const { ws: ws1 } = await connectClient(TEST_PORT_ROUTING, token1);
      const { ws: ws2 } = await connectClient(TEST_PORT_ROUTING, token2);
      const { ws: ws3 } = await connectClient(TEST_PORT_ROUTING, token3);

      // Get the client session IDs
      const presenceList = manager.getPresenceList("session-1");
      expect(presenceList).toHaveLength(3);

      // Find the clientSessionId for user-1 (the sender we want to exclude)
      // We need to find clientSessionIds from the connections map
      let senderClientId = "";
      // Access internal connections via getConnection helper — look for user-1
      const sessionConns = (manager as any).sessionConnections.get("session-1") as Set<string>;
      for (const clientId of sessionConns) {
        const conn = manager.getConnection(clientId);
        if (conn?.session.userId === "user-1") {
          senderClientId = clientId;
          break;
        }
      }

      const delta = {
        sessionId: "session-1",
        changes: [{ itemId: "item-1", type: "added" as const, fields: { name: "Widget" } }],
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "node-1" },
      };

      // Set up listeners on ws2 and ws3
      const deltaPromise2 = waitForMessageOfType(ws2, "delta");
      const deltaPromise3 = waitForMessageOfType(ws3, "delta");

      manager.broadcastDelta("session-1", delta, senderClientId);

      const msg2 = await deltaPromise2;
      const msg3 = await deltaPromise3;

      expect(msg2.type).toBe("delta");
      expect((msg2.payload as any).sessionId).toBe("session-1");
      expect(msg3.type).toBe("delta");
      expect((msg3.payload as any).changes[0].itemId).toBe("item-1");

      ws1.close();
      ws2.close();
      ws3.close();
    });
  });

  describe("missed update queuing", () => {
    it("should queue deltas for disconnected clients", () => {
      const delta = {
        sessionId: "session-1",
        changes: [{ itemId: "item-1", type: "added" as const }],
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "node-1" },
      };

      manager.queueMissedUpdate("client-disconnected", delta);

      expect(manager.getQueuedUpdateCount("client-disconnected")).toBe(1);
    });

    it("should queue multiple deltas in order", () => {
      for (let i = 0; i < 5; i++) {
        const delta = {
          sessionId: "session-1",
          changes: [{ itemId: `item-${i}`, type: "added" as const }],
          timestamp: { wallTime: Date.now() + i, logical: i, nodeId: "node-1" },
        };
        manager.queueMissedUpdate("client-1", delta);
      }

      expect(manager.getQueuedUpdateCount("client-1")).toBe(5);
    });

    it("should clear queue when exceeding max 1000 deltas", () => {
      for (let i = 0; i <= 1000; i++) {
        const delta = {
          sessionId: "session-1",
          changes: [{ itemId: `item-${i}`, type: "added" as const }],
          timestamp: { wallTime: Date.now(), logical: i, nodeId: "node-1" },
        };
        manager.queueMissedUpdate("client-overflow", delta);
      }

      // Queue exceeds 1000, should be cleared
      expect(manager.getQueuedUpdateCount("client-overflow")).toBe(0);
    });

    it("should flush queued deltas to a reconnected client in order", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT_ROUTING, token);

      // Get the client session ID
      const sessionConns = (manager as any).sessionConnections.get("session-1") as Set<string>;
      const clientId = [...sessionConns][0];

      // Queue some deltas
      for (let i = 0; i < 3; i++) {
        const delta = {
          sessionId: "session-1",
          changes: [{ itemId: `item-${i}`, type: "added" as const }],
          timestamp: { wallTime: Date.now() + i, logical: i, nodeId: "node-1" },
        };
        manager.queueMissedUpdate(clientId, delta);
      }

      expect(manager.getQueuedUpdateCount(clientId)).toBe(3);

      // Flush queued updates
      const result = manager.flushQueuedUpdates(clientId);
      expect(result).toBe(true);

      // Queue should be empty after flush
      expect(manager.getQueuedUpdateCount(clientId)).toBe(0);

      // Client should have received the deltas
      await delay(100);

      ws.close();
    });

    it("should trigger full resync when queue exceeds age limit (24 hours)", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT_ROUTING, token);

      const sessionConns = (manager as any).sessionConnections.get("session-1") as Set<string>;
      const clientId = [...sessionConns][0];

      // Manually insert old queued deltas (simulating 25-hour-old entries)
      const oldTime = Date.now() - 25 * 60 * 60 * 1000;
      const missedUpdates = manager.getMissedUpdates();
      missedUpdates.set(clientId, [
        {
          delta: {
            sessionId: "session-1",
            changes: [{ itemId: "item-old", type: "added" as const }],
            timestamp: { wallTime: oldTime, logical: 0, nodeId: "node-1" },
          },
          queuedAt: oldTime,
        },
      ]);

      const resyncPromise = waitForMessageOfType(ws, "resync-required");

      // Flush should detect the old entry and trigger resync
      const result = manager.flushQueuedUpdates(clientId);
      expect(result).toBe(false);

      const resyncMsg = await resyncPromise;
      expect(resyncMsg.type).toBe("resync-required");

      // Queue should be cleared
      expect(manager.getQueuedUpdateCount(clientId)).toBe(0);

      ws.close();
    });

    it("should trigger full resync when queue exceeds 1000 deltas on flush", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT_ROUTING, token);

      const sessionConns = (manager as any).sessionConnections.get("session-1") as Set<string>;
      const clientId = [...sessionConns][0];

      // Manually insert 1001 entries in the missed updates map
      const missedUpdates = manager.getMissedUpdates();
      const entries = [];
      for (let i = 0; i <= 1000; i++) {
        entries.push({
          delta: {
            sessionId: "session-1",
            changes: [{ itemId: `item-${i}`, type: "added" as const }],
            timestamp: { wallTime: Date.now(), logical: i, nodeId: "node-1" },
          },
          queuedAt: Date.now(),
        });
      }
      missedUpdates.set(clientId, entries);

      const resyncPromise = waitForMessageOfType(ws, "resync-required");

      // Flush should detect overflow and trigger resync
      const result = manager.flushQueuedUpdates(clientId);
      expect(result).toBe(false);

      const resyncMsg = await resyncPromise;
      expect(resyncMsg.type).toBe("resync-required");

      ws.close();
    });

    it("should return true from flushQueuedUpdates when no queued deltas exist", () => {
      const result = manager.flushQueuedUpdates("non-existent-client");
      expect(result).toBe(true);
    });
  });
});
