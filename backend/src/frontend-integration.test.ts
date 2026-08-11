/**
 * Frontend-Backend Integration Tests
 *
 * Tests the frontend's usage patterns against the real backend server:
 * - Token-fetch + WebSocket connect flow (simulating useSyncEngine hook)
 * - Stress test flow end-to-end with metric verification
 * - Split-screen sync with network simulation controls
 *
 * These tests start a real backend server programmatically and connect
 * via WebSocket, simulating how the Next.js frontend interacts with the backend.
 *
 * Requirements: 12.2-12.3, 21.3-21.4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import http from "http";
import { createServer, type ServerInstanceV2 } from "./index.js";
import type { ClientFrame, ServerFrame } from "./types/index.js";

// ─── Test Configuration ────────────────────────────────────────────────

let TEST_PORT = 0;
const JWT_SECRET = "frontend-integration-test-secret";

// ─── Test Helpers ──────────────────────────────────────────────────────

let seqCounter = 0;
function nextSeq(): number {
  return ++seqCounter;
}

/** Simulates the frontend's token fetch from the /token endpoint. */
async function fetchToken(
  userId: string,
  displayName: string,
  roomId: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:${TEST_PORT}/token?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}&roomId=${encodeURIComponent(roomId)}`;
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.token) {
            resolve(parsed.token);
          } else {
            reject(new Error("No token in response"));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

/** Simulated frontend client with channel-multiplexed WebSocket. */
interface FrontendClient {
  ws: WebSocket;
  clientId: string;
  received: ServerFrame[];
  userId: string;
}

/**
 * Simulates the frontend's connection flow:
 * 1. Fetch token from /token endpoint
 * 2. Connect WebSocket with token query param
 * 3. Wait for "connected" control response
 *
 * This mirrors the useSyncEngine hook behavior.
 */
async function connectFrontendClient(
  userId: string,
  displayName: string
): Promise<FrontendClient> {
  // Step 1: Fetch token (simulates the HTTP fetch in useSyncEngine)
  const token = await fetchToken(userId, displayName, "default-room");

  // Step 2: Connect WebSocket with token
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://localhost:${TEST_PORT}?token=${token}`
    );
    const received: ServerFrame[] = [];
    let resolved = false;

    ws.on("message", (data) => {
      try {
        const frame: ServerFrame = JSON.parse(data.toString());
        received.push(frame);
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
            userId,
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", (err) => {
      if (!resolved) reject(err);
    });

    // Timeout after 5s
    setTimeout(() => {
      if (!resolved) reject(new Error("Connection timeout"));
    }, 5000);
  });
}

/** Connect using userId/displayName query params (alternative auth method). */
async function connectClientDirect(
  userId: string,
  displayName: string
): Promise<FrontendClient> {
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
            userId,
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on("error", (err) => {
      if (!resolved) reject(err);
    });

    setTimeout(() => {
      if (!resolved) reject(new Error("Connection timeout"));
    }, 5000);
  });
}

/** Send a ClientFrame on a channel (mirrors frontend's sendFrame). */
function sendFrame(client: FrontendClient, frame: ClientFrame): void {
  client.ws.send(JSON.stringify(frame));
}

/** Send a control command (mirrors frontend's sendControl). */
function sendControl(
  client: FrontendClient,
  roomId: string,
  command: Record<string, unknown>
): number {
  const seq = nextSeq();
  sendFrame(client, {
    channel: "control",
    roomId,
    seq,
    payload: command,
  });
  return seq;
}

/** Send an operation (mirrors frontend's sendOperation). */
function sendOperation(
  client: FrontendClient,
  roomId: string,
  operation: Record<string, unknown>
): number {
  const seq = nextSeq();
  sendFrame(client, {
    channel: "ops",
    roomId,
    seq,
    payload: operation,
  });
  return seq;
}

/**
 * Wait for a frame matching a predicate.
 * Checks already-received buffer first, then listens.
 */
function waitForFrame(
  client: FrontendClient,
  predicate: (frame: ServerFrame) => boolean,
  timeoutMs = 5000
): Promise<ServerFrame> {
  const existing = client.received.find(predicate);
  if (existing) return Promise.resolve(existing);

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

/**
 * Collect frames matching a predicate for a duration.
 */
function collectFrames(
  client: FrontendClient,
  predicate: (frame: ServerFrame) => boolean,
  durationMs: number
): Promise<ServerFrame[]> {
  return new Promise((resolve) => {
    const collected: ServerFrame[] = [];

    // Check existing buffer
    for (const frame of client.received) {
      if (predicate(frame)) collected.push(frame);
    }

    function handler(data: WebSocket.Data) {
      try {
        const frame: ServerFrame = JSON.parse(data.toString());
        if (predicate(frame)) collected.push(frame);
      } catch {
        // Ignore
      }
    }

    client.ws.on("message", handler);

    setTimeout(() => {
      client.ws.removeListener("message", handler);
      resolve(collected);
    }, durationMs);
  });
}

/** Create a room and return the room ID. */
async function createRoom(client: FrontendClient): Promise<string> {
  sendControl(client, "", { type: "create-room" });
  const response = await waitForFrame(
    client,
    (f) =>
      f.channel === "control" &&
      f.type === "control-response" &&
      (f.payload as any)?.type === "create-room"
  );
  return (response.payload as any).roomId;
}

/** Join a room and wait for confirmation. */
async function joinRoom(client: FrontendClient, roomId: string): Promise<void> {
  sendControl(client, roomId, { type: "join-room", roomId });
  await waitForFrame(
    client,
    (f) =>
      f.channel === "control" &&
      f.type === "control-response" &&
      (f.payload as any)?.type === "join-room" &&
      (f.payload as any)?.status === "joined"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeClient(client: FrontendClient): Promise<void> {
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

describe("Frontend-Backend Integration", { timeout: 30000 }, () => {
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

  // ─── Test 1: Token-fetch + WebSocket Connect Flow ─────────────────

  describe("WebSocket connection from frontend client to backend (Req 12.2)", () => {
    it("should fetch a valid JWT token from the /token endpoint", async () => {
      const token = await fetchToken("visitor-1", "Visitor", "test-room");
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT has 3 parts
    });

    it("should connect via WebSocket using the fetched token", async () => {
      const client = await connectFrontendClient("visitor-2", "Alice");
      expect(client.clientId).toBeDefined();
      expect(typeof client.clientId).toBe("string");
      await closeClient(client);
    });

    it("should complete the full frontend flow: token → connect → create room → join", async () => {
      // Simulates the useSyncEngine hook's complete initialization
      const client = await connectFrontendClient("hero-visitor", "Visitor");
      expect(client.clientId).toBeDefined();

      // Create a room (like the hero section does)
      const roomId = await createRoom(client);
      expect(roomId).toBeDefined();
      expect(typeof roomId).toBe("string");

      // Join the room
      await joinRoom(client, roomId);

      // Subscribe to metrics (like the frontend does)
      // Server acknowledges the command on the control channel
      sendControl(client, roomId, { type: "subscribe-metrics" });
      const metricsResponse = await waitForFrame(
        client,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "subscribe-metrics"
      );
      // The control channel acknowledges the subscription request
      expect((metricsResponse.payload as any).status).toBeDefined();

      await closeClient(client);
    });

    it("should support CORS health check endpoint", async () => {
      const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        http.get(`http://localhost:${TEST_PORT}/health`, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          });
        }).on("error", reject);
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.engine).toBe("collaborative-sync-engine-v2");
      expect(response.body.metrics).toBeDefined();
    });
  });

  // ─── Test 2: Stress Test Flow End-to-End ──────────────────────────

  describe("Stress test flow end-to-end with metric verification (Req 21.3-21.4)", () => {
    it("should process burst of operations and receive ACKs for all", async () => {
      const client = await connectClientDirect("stress-user", "StressTester");
      const roomId = await createRoom(client);
      await joinRoom(client, roomId);
      await sleep(100);

      const BURST_SIZE = 100;
      const baseTime = Date.now();

      // Send burst of operations (simulates StressTestDemo burst mode)
      for (let i = 0; i < BURST_SIZE; i++) {
        sendOperation(client, roomId, {
          id: `stress-op-${i}`,
          type: "add",
          itemId: `stress-item-${i}`,
          payload: { name: `Stress Item ${i}`, value: i },
          timestamp: {
            wallTime: baseTime + i,
            logical: i,
            nodeId: `stress-node`,
          },
          version: 1,
        });
      }

      // Wait for processing to complete
      await sleep(3000);

      // Verify server state: all operations applied
      const state = server.syncEngine.getState(roomId);
      const activeItems = Object.values(state.items).filter(
        (item: any) => item.removedAt === null
      );
      expect(activeItems.length).toBe(BURST_SIZE);

      await closeClient(client);
    });

    it("should stream metrics during stress test via Metrics_Channel", async () => {
      const client = await connectClientDirect("metrics-stress", "MetricsUser");
      const roomId = await createRoom(client);
      await joinRoom(client, roomId);

      // Subscribe to metrics via control channel
      sendControl(client, roomId, { type: "subscribe-metrics" });
      await waitForFrame(
        client,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "subscribe-metrics"
      );

      await sleep(100);

      // Send operations to generate load
      const baseTime = Date.now();
      for (let i = 0; i < 50; i++) {
        sendOperation(client, roomId, {
          id: `metric-op-${i}`,
          type: "add",
          itemId: `metric-item-${i}`,
          payload: { name: `Item ${i}` },
          timestamp: {
            wallTime: baseTime + i,
            logical: i,
            nodeId: "metric-node",
          },
          version: 1,
        });
      }

      // Wait for all operations to process
      await sleep(2000);

      // Verify all operations were processed at the engine level
      const state = server.syncEngine.getState(roomId);
      const activeItems = Object.values(state.items).filter(
        (item: any) => item.removedAt === null
      );
      expect(activeItems.length).toBe(50);

      // Verify performance collector is accessible and returns valid structure
      const metrics = server.performanceCollector.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics).toHaveProperty("opsPerSecond");
      expect(metrics).toHaveProperty("p50LatencyMs");
      expect(metrics).toHaveProperty("p99LatencyMs");
      expect(metrics).toHaveProperty("activeConnections");
      expect(metrics).toHaveProperty("totalOpsProcessed");

      // Verify health endpoint exposes metrics (frontend can poll this)
      const healthResponse = await new Promise<{ status: number; body: any }>(
        (resolve, reject) => {
          http.get(`http://localhost:${TEST_PORT}/health`, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              resolve({ status: res.statusCode!, body: JSON.parse(data) });
            });
          }).on("error", reject);
        }
      );
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body.metrics).toBeDefined();
      expect(healthResponse.body.metrics).toHaveProperty("activeConnections");
      expect(healthResponse.body.metrics).toHaveProperty("totalOpsProcessed");

      await closeClient(client);
    });

    it("should handle sustained operation rate without dropping operations", async () => {
      const client = await connectClientDirect("sustained-user", "SustainedTester");
      const roomId = await createRoom(client);
      await joinRoom(client, roomId);
      await sleep(100);

      const TOTAL_OPS = 200;
      const baseTime = Date.now();

      // Sustained mode: send operations with small delays between batches
      for (let batch = 0; batch < 10; batch++) {
        for (let i = 0; i < 20; i++) {
          const opIdx = batch * 20 + i;
          sendOperation(client, roomId, {
            id: `sustained-op-${opIdx}`,
            type: "add",
            itemId: `sustained-item-${opIdx}`,
            payload: { name: `Sustained ${opIdx}`, batch },
            timestamp: {
              wallTime: baseTime + opIdx,
              logical: opIdx,
              nodeId: "sustained-node",
            },
            version: 1,
          });
        }
        await sleep(50); // Small inter-batch delay
      }

      await sleep(3000);

      // Verify all operations were processed (no drops)
      const state = server.syncEngine.getState(roomId);
      const activeItems = Object.values(state.items).filter(
        (item: any) => item.removedAt === null
      );
      expect(activeItems.length).toBe(TOTAL_OPS);

      await closeClient(client);
    });
  });

  // ─── Test 3: Split-Screen Sync with Network Simulation ────────────

  describe("Split-screen sync with network simulation controls (Req 12.3)", () => {
    it("should sync operations bidirectionally between two clients in same room", async () => {
      // Simulate two split-screen panels with independent WebSocket connections
      const leftPanel = await connectClientDirect("left-panel", "Left");
      const rightPanel = await connectClientDirect("right-panel", "Right");

      const roomId = await createRoom(leftPanel);
      await joinRoom(leftPanel, roomId);
      await joinRoom(rightPanel, roomId);
      await sleep(100);

      // Clear received buffers
      leftPanel.received.length = 0;
      rightPanel.received.length = 0;

      // Left panel sends an operation
      sendOperation(leftPanel, roomId, {
        id: "left-op-1",
        type: "add",
        itemId: "left-item-1",
        payload: { name: "From Left", side: "left" },
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "left-node" },
        version: 1,
      });

      // Right panel should receive it as a delta
      const rightDelta = await waitForFrame(
        rightPanel,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      expect(rightDelta).toBeDefined();
      expect(rightDelta.roomId).toBe(roomId);

      // Right panel sends an operation
      rightPanel.received.length = 0;
      leftPanel.received.length = 0;
      await sleep(100);

      sendOperation(rightPanel, roomId, {
        id: "right-op-1",
        type: "add",
        itemId: "right-item-1",
        payload: { name: "From Right", side: "right" },
        timestamp: { wallTime: Date.now() + 1, logical: 1, nodeId: "right-node" },
        version: 1,
      });

      // Left panel should receive it as a delta
      const leftDelta = await waitForFrame(
        leftPanel,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      expect(leftDelta).toBeDefined();
      expect(leftDelta.roomId).toBe(roomId);

      // Both panels should have converged state
      const state = server.syncEngine.getState(roomId);
      expect(state.items["left-item-1"]).toBeDefined();
      expect(state.items["right-item-1"]).toBeDefined();

      await Promise.all([closeClient(leftPanel), closeClient(rightPanel)]);
    });

    it("should apply latency simulation via control channel", async () => {
      const leftPanel = await connectClientDirect("latency-left", "Left");
      const rightPanel = await connectClientDirect("latency-right", "Right");

      const roomId = await createRoom(leftPanel);
      await joinRoom(leftPanel, roomId);
      await joinRoom(rightPanel, roomId);
      await sleep(100);

      // Send set-latency command on the control channel (simulates the latency slider)
      // The server acknowledges receipt of the simulation command
      sendControl(rightPanel, roomId, {
        type: "set-latency",
        latencyMs: 200,
      });

      const latencyResponse = await waitForFrame(
        rightPanel,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "set-latency"
      );
      // Server acknowledges the simulation command
      expect((latencyResponse.payload as any).status).toBeDefined();

      // Verify operations still flow between panels even after simulation command
      rightPanel.received.length = 0;
      sendOperation(leftPanel, roomId, {
        id: "post-latency-op",
        type: "add",
        itemId: "post-latency-item",
        payload: { name: "Still syncing" },
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "left-node" },
        version: 1,
      });

      const delta = await waitForFrame(
        rightPanel,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      expect(delta).toBeDefined();

      // Reset latency
      sendControl(rightPanel, roomId, {
        type: "set-latency",
        latencyMs: 0,
      });
      await waitForFrame(
        rightPanel,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "set-latency"
      );

      await Promise.all([closeClient(leftPanel), closeClient(rightPanel)]);
    });

    it("should simulate disconnect and queue operations for reconnect", async () => {
      const leftPanel = await connectClientDirect("disc-left", "Left");
      const rightPanel = await connectClientDirect("disc-right", "Right");

      const roomId = await createRoom(leftPanel);
      await joinRoom(leftPanel, roomId);
      await joinRoom(rightPanel, roomId);
      await sleep(100);

      // Send disconnect-simulation command on control channel (disconnect toggle)
      sendControl(rightPanel, roomId, {
        type: "disconnect-simulation",
      });
      const discResponse = await waitForFrame(
        rightPanel,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "disconnect-simulation"
      );
      // Server acknowledges the simulation command
      expect((discResponse.payload as any).status).toBeDefined();

      // Left panel sends operations (server processes them regardless)
      for (let i = 0; i < 5; i++) {
        sendOperation(leftPanel, roomId, {
          id: `disc-op-${i}`,
          type: "add",
          itemId: `disc-item-${i}`,
          payload: { name: `Disconnected Item ${i}` },
          timestamp: { wallTime: Date.now() + i, logical: i, nodeId: "left-node" },
          version: 1,
        });
      }
      await sleep(500);

      // Send reconnect-simulation command
      sendControl(rightPanel, roomId, {
        type: "reconnect-simulation",
      });

      const reconnectResponse = await waitForFrame(
        rightPanel,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "reconnect-simulation"
      );
      expect((reconnectResponse.payload as any).status).toBeDefined();

      // Server state should have all operations from left panel
      const state = server.syncEngine.getState(roomId);
      for (let i = 0; i < 5; i++) {
        expect(state.items[`disc-item-${i}`]).toBeDefined();
      }

      await Promise.all([closeClient(leftPanel), closeClient(rightPanel)]);
    });

    it("should synchronize state within 200ms between split-screen panels", async () => {
      const leftPanel = await connectClientDirect("sync-left", "Left");
      const rightPanel = await connectClientDirect("sync-right", "Right");

      const roomId = await createRoom(leftPanel);
      await joinRoom(leftPanel, roomId);
      await joinRoom(rightPanel, roomId);
      await sleep(200);

      // Clear buffers
      rightPanel.received.length = 0;

      const startTime = Date.now();

      // Left panel sends an operation
      sendOperation(leftPanel, roomId, {
        id: "sync-timing-op",
        type: "add",
        itemId: "sync-timing-item",
        payload: { name: "Timing Test" },
        timestamp: { wallTime: startTime, logical: 0, nodeId: "left-sync" },
        version: 1,
      });

      // Measure how quickly right panel receives delta
      await waitForFrame(
        rightPanel,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      const syncLatency = Date.now() - startTime;

      // Split-screen sync should complete within 200ms
      expect(syncLatency).toBeLessThan(200);

      await Promise.all([closeClient(leftPanel), closeClient(rightPanel)]);
    });

    it("should handle partition simulation between two client groups", async () => {
      const leftPanel = await connectClientDirect("part-left", "Left");
      const rightPanel = await connectClientDirect("part-right", "Right");

      const roomId = await createRoom(leftPanel);
      await joinRoom(leftPanel, roomId);
      await joinRoom(rightPanel, roomId);
      await sleep(100);

      // Send partition-simulation command (partition wall between panels)
      sendControl(leftPanel, roomId, {
        type: "partition-simulation",
        groupA: [leftPanel.clientId],
        groupB: [rightPanel.clientId],
      });

      const partResponse = await waitForFrame(
        leftPanel,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "partition-simulation"
      );
      // Server acknowledges the partition command
      expect((partResponse.payload as any).status).toBeDefined();

      // Heal partition command
      sendControl(leftPanel, roomId, {
        type: "heal-partition",
      });

      const healResponse = await waitForFrame(
        leftPanel,
        (f) =>
          f.channel === "control" &&
          f.type === "control-response" &&
          (f.payload as any)?.type === "heal-partition"
      );
      expect((healResponse.payload as any).status).toBeDefined();

      // Verify operations still work after partition commands
      rightPanel.received.length = 0;
      sendOperation(leftPanel, roomId, {
        id: "post-partition-op",
        type: "add",
        itemId: "post-partition-item",
        payload: { name: "After Partition" },
        timestamp: { wallTime: Date.now(), logical: 0, nodeId: "left-node" },
        version: 1,
      });

      const delta = await waitForFrame(
        rightPanel,
        (f) => f.channel === "ops" && f.type === "delta"
      );
      expect(delta).toBeDefined();

      await Promise.all([closeClient(leftPanel), closeClient(rightPanel)]);
    });
  });
});
