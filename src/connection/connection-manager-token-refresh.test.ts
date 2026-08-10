/**
 * Unit tests for ConnectionManager - Token refresh and grace period.
 * Tests token refresh on active connections and 30-second grace period for expired tokens.
 *
 * Requirements covered: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { ConnectionManager } from "./connection-manager.js";
import type { ServerMessage } from "../types/index.js";

const JWT_SECRET = "test-secret-key";
let TEST_PORT = 9879;

function createToken(
  payload: { userId: string; displayName: string; sessionId: string },
  expiresIn: string | number = "1h"
): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
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
      setTimeout(() => resolve({ ws, messages }), 100);
    });

    ws.on("error", (err) => reject(err));
  });
}

function waitForClose(ws: WebSocket, timeout = 5000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitForClose timed out")), timeout);
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

describe("ConnectionManager - Token Refresh", () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager({
      port: 0,
      jwtSecret: JWT_SECRET,
      maxConnectionsPerSession: 50,
      heartbeatIntervalMs: 60000,
      heartbeatTimeoutMs: 60000,
      tokenGracePeriodMs: 30000,
    });
    const wss = manager.start();
    const addr = wss.address();
    TEST_PORT = typeof addr === "object" && addr ? addr.port : 9879;
  });

  afterEach(async () => {
    await manager.stop();
  });

  describe("token refresh on active connection", () => {
    it("should accept a valid token-refresh and send ack", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws, messages } = await connectClient(TEST_PORT, token);

      // Send token-refresh message
      const newToken = createToken({
        userId: "user-1",
        displayName: "Alice Updated",
        sessionId: "session-1",
      });

      ws.send(JSON.stringify({ type: "token-refresh", token: newToken }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      const ackMsg = messages.find(
        (m) => m.type === "ack" && m.message === "Token refreshed successfully"
      );
      expect(ackMsg).toBeDefined();

      ws.close();
    });

    it("should update session credentials after refresh without disconnecting", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws } = await connectClient(TEST_PORT, token);

      // Verify initial presence
      let presenceList = manager.getPresenceList("session-1");
      expect(presenceList[0].displayName).toBe("Alice");

      // Send token-refresh with updated displayName
      const newToken = createToken({
        userId: "user-1",
        displayName: "Alice Updated",
        sessionId: "session-1",
      });

      ws.send(JSON.stringify({ type: "token-refresh", token: newToken }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify updated presence
      presenceList = manager.getPresenceList("session-1");
      expect(presenceList[0].displayName).toBe("Alice Updated");

      // Connection should still be active
      expect(manager.getConnectionCount("session-1")).toBe(1);

      ws.close();
    });

    it("should reject invalid token-refresh but NOT disconnect", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws, messages } = await connectClient(TEST_PORT, token);

      // Send invalid token-refresh
      ws.send(JSON.stringify({ type: "token-refresh", token: "invalid-jwt" }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should get error
      const errorMsg = messages.find(
        (m) => m.type === "error" && m.code === "token_refresh_failed"
      );
      expect(errorMsg).toBeDefined();

      // Connection should still be alive
      expect(manager.getConnectionCount("session-1")).toBe(1);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should reject token-refresh with no token field", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws, messages } = await connectClient(TEST_PORT, token);

      // Send refresh without a token
      ws.send(JSON.stringify({ type: "token-refresh" }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorMsg = messages.find(
        (m) => m.type === "error" && m.code === "token_refresh_failed"
      );
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.message).toContain("No token provided");

      // Connection stays open
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should reject token-refresh with expired token but NOT disconnect", async () => {
      const token = createToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });

      const { ws, messages } = await connectClient(TEST_PORT, token);

      // Send refresh with an expired token
      const expiredToken = createExpiredToken({
        userId: "user-1",
        displayName: "Alice",
        sessionId: "session-1",
      });
      ws.send(JSON.stringify({ type: "token-refresh", token: expiredToken }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorMsg = messages.find(
        (m) => m.type === "error" && m.code === "token_refresh_failed"
      );
      expect(errorMsg).toBeDefined();

      // Connection stays open
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });
  });

  describe("grace period for expired tokens", () => {
    it("should force-disconnect after grace period when no refresh is provided", async () => {
      // Restart manager with very short grace period for test speed
      await manager.stop();
      manager = new ConnectionManager({
        port: TEST_PORT,
        jwtSecret: JWT_SECRET,
        maxConnectionsPerSession: 50,
        heartbeatIntervalMs: 60000,
        heartbeatTimeoutMs: 60000,
        tokenGracePeriodMs: 500, // 500ms grace for test speed
      });
      manager.start();

      // Token expires in 1 second
      const token = createToken(
        { userId: "user-1", displayName: "Alice", sessionId: "session-1" },
        "1s"
      );

      const { ws, messages } = await connectClient(TEST_PORT, token);
      const closePromise = waitForClose(ws, 10000);

      // Wait for token to expire (1s) + grace period (500ms) + buffer
      const { code } = await closePromise;
      expect(code).toBe(4001);

      // Should have received token_expired error
      const errorMsg = messages.find(
        (m) => m.type === "error" && m.code === "token_expired"
      );
      expect(errorMsg).toBeDefined();
    }, 10000);

    it("should NOT disconnect if valid refresh is provided within grace period", async () => {
      // Restart manager with short grace period
      await manager.stop();
      manager = new ConnectionManager({
        port: TEST_PORT,
        jwtSecret: JWT_SECRET,
        maxConnectionsPerSession: 50,
        heartbeatIntervalMs: 60000,
        heartbeatTimeoutMs: 60000,
        tokenGracePeriodMs: 2000, // 2s grace for test
      });
      manager.start();

      // Token expires in 1 second
      const token = createToken(
        { userId: "user-1", displayName: "Alice", sessionId: "session-1" },
        "1s"
      );

      const { ws, messages } = await connectClient(TEST_PORT, token);

      // Wait for token to expire then send refresh during grace period
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Send valid token refresh within grace period
      const newToken = createToken(
        { userId: "user-1", displayName: "Alice", sessionId: "session-1" },
        "1h"
      );
      ws.send(JSON.stringify({ type: "token-refresh", token: newToken }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should receive ack
      const ackMsg = messages.find(
        (m) => m.type === "ack" && m.message === "Token refreshed successfully"
      );
      expect(ackMsg).toBeDefined();

      // Wait well beyond the original grace period — connection should remain
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Connection should still be open
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(manager.getConnectionCount("session-1")).toBe(1);

      ws.close();
    }, 10000);

    it("should cancel grace period timer when valid refresh token is received", async () => {
      // Restart manager with short grace period
      await manager.stop();
      manager = new ConnectionManager({
        port: TEST_PORT,
        jwtSecret: JWT_SECRET,
        maxConnectionsPerSession: 50,
        heartbeatIntervalMs: 60000,
        heartbeatTimeoutMs: 60000,
        tokenGracePeriodMs: 2000, // 2s grace for test
      });
      manager.start();

      // Token expires in 1 second
      const token = createToken(
        { userId: "user-1", displayName: "Alice", sessionId: "session-1" },
        "1s"
      );

      const { ws, messages } = await connectClient(TEST_PORT, token);

      // Wait for token to expire — grace period starts
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Refresh with valid token
      const newToken = createToken(
        { userId: "user-1", displayName: "Alice", sessionId: "session-1" },
        "1h"
      );
      ws.send(JSON.stringify({ type: "token-refresh", token: newToken }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify ack received
      const ackMsg = messages.find((m) => m.type === "ack");
      expect(ackMsg).toBeDefined();

      // Wait past original grace period — connection should remain open
      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(manager.getConnectionCount("session-1")).toBe(1);

      ws.close();
    }, 10000);
  });
});
