/**
 * Collaborative Sync Engine V2 — Application Entry Point
 *
 * Wires together all V2 backend components into a running server:
 * - ConnectionManagerV2: WebSocket gateway with channel multiplexing and CORS
 * - BatchProcessor: Operation buffering with configurable window
 * - SyncEngineV2: Multi-room CRDT orchestration
 * - NativeMergeAddon: Rust-based CRDT merge (used internally by SyncEngine)
 * - NetworkSimulator: Per-client network condition injection
 * - PerformanceCollector: High-resolution metrics with streaming
 * - SnapshotManagerV2: Periodic state snapshots and GC
 * - PersistenceLayerV2: PostgreSQL/in-memory operation & snapshot persistence
 * - RedisCacheV2: State caching and participant tracking
 *
 * Full operation pipeline:
 *   WebSocket → ConnectionManager → BatchProcessor → SyncEngine → NativeMergeAddon → Persist → Broadcast
 *
 * Requirements: 1.1-1.7, 6.1-6.7, 22.2-22.5
 */

import { createServer as createHttpServer, type Server } from "http";
import jwt from "jsonwebtoken";
import Redis from "ioredis";

// V2 Components
import { ConnectionManagerV2, type ConnectionManagerV2Config } from "./connection/connection-manager-v2.js";
import { BatchProcessor, type BatchProcessorConfig } from "./engine/batch-processor.js";
import { SyncEngineV2 } from "./engine/sync-engine-v2.js";
import { NetworkSimulatorImpl } from "./engine/network-simulator.js";
import { PerformanceCollectorImpl } from "./metrics/performance-collector.js";
import { SnapshotManagerV2 } from "./persistence/snapshot-manager-v2.js";
import {
  InMemoryPersistenceLayerV2,
  PostgresPersistenceLayerV2,
  type PersistenceLayerV2,
} from "./persistence/persistence-layer-v2.js";
import {
  InMemoryRedisCache,
  RedisCache,
  type RedisCacheV2Interface,
} from "./persistence/redis-cache.js";

// Types
import type {
  ServerFrame,
  PerformanceMetrics,
  ConflictEvent,
  CRDTOperation,
} from "./types/index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Server configuration derived from environment variables. */
export interface ServerConfig {
  port: number;
  jwtSecret: string;
  corsOrigins: string[];
  maxConnectionsTotal: number;
  maxConnectionsPerRoom: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  awarenessThrottleMs: number;
  batchWindowMs: number;
  batchWorkerThreadThreshold: number;
  batchMaxSize: number;
  snapshotThreshold: number;
  maxRoomMemoryMb: number;
  databaseUrl?: string;
  redisUrl?: string;
}

/** The running V2 server instance with all wired components. */
export interface ServerInstanceV2 {
  httpServer: Server;
  connectionManager: ConnectionManagerV2;
  syncEngine: SyncEngineV2;
  batchProcessor: BatchProcessor;
  networkSimulator: NetworkSimulatorImpl;
  performanceCollector: PerformanceCollectorImpl;
  snapshotManager: SnapshotManagerV2;
  persistenceLayer: PersistenceLayerV2;
  redisCache: RedisCacheV2Interface;
  stop: () => Promise<void>;
}

/**
 * Reads configuration from environment variables with sensible defaults.
 */
export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? "8080", 10),
    jwtSecret: process.env.JWT_SECRET ?? "development-secret",
    corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
    maxConnectionsTotal: parseInt(process.env.MAX_CONNECTIONS_TOTAL ?? "200", 10),
    maxConnectionsPerRoom: parseInt(process.env.MAX_CONNECTIONS_PER_ROOM ?? "50", 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? "30000", 10),
    heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS ?? "10000", 10),
    awarenessThrottleMs: parseInt(process.env.AWARENESS_THROTTLE_MS ?? "17", 10),
    batchWindowMs: parseInt(process.env.BATCH_WINDOW_MS ?? "2", 10),
    batchWorkerThreadThreshold: parseInt(process.env.BATCH_WORKER_THREAD_THRESHOLD ?? "50", 10),
    batchMaxSize: parseInt(process.env.BATCH_MAX_SIZE ?? "1000", 10),
    snapshotThreshold: parseInt(process.env.SNAPSHOT_THRESHOLD ?? "1000", 10),
    maxRoomMemoryMb: parseInt(process.env.MAX_ROOM_MEMORY_MB ?? "50", 10),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
  };
}

/**
 * Creates and wires the V2 server components without starting the listener.
 * Useful for programmatic use and testing.
 */
export async function createServer(config?: Partial<ServerConfig>): Promise<ServerInstanceV2> {
  const resolvedConfig: ServerConfig = { ...loadConfig(), ...config };

  // -------------------------------------------------------------------------
  // 1. Initialize Persistence Layer
  // -------------------------------------------------------------------------
  let persistenceLayer: PersistenceLayerV2;
  if (resolvedConfig.databaseUrl) {
    persistenceLayer = new PostgresPersistenceLayerV2({
      connectionString: resolvedConfig.databaseUrl,
    });
  } else {
    persistenceLayer = new InMemoryPersistenceLayerV2();
  }

  // -------------------------------------------------------------------------
  // 2. Initialize Redis Cache
  // -------------------------------------------------------------------------
  let redisCache: RedisCacheV2Interface;
  let redisClient: Redis | null = null;
  if (resolvedConfig.redisUrl) {
    redisClient = new Redis(resolvedConfig.redisUrl);
    redisCache = new RedisCache(redisClient) as unknown as RedisCacheV2Interface;
  } else {
    redisCache = new InMemoryRedisCache() as unknown as RedisCacheV2Interface;
  }

  // -------------------------------------------------------------------------
  // 3. Create Batch Processor
  // -------------------------------------------------------------------------
  const batchProcessorConfig: Partial<BatchProcessorConfig> = {
    windowMs: resolvedConfig.batchWindowMs,
    workerThreadThreshold: resolvedConfig.batchWorkerThreadThreshold,
    maxBatchSize: resolvedConfig.batchMaxSize,
  };
  const batchProcessor = new BatchProcessor(batchProcessorConfig);

  // -------------------------------------------------------------------------
  // 4. Create Sync Engine V2
  // -------------------------------------------------------------------------
  const syncEngine = new SyncEngineV2(batchProcessor);

  // -------------------------------------------------------------------------
  // 5. Create Network Simulator
  // -------------------------------------------------------------------------
  const networkSimulator = new NetworkSimulatorImpl();

  // -------------------------------------------------------------------------
  // 6. Create Performance Collector
  // -------------------------------------------------------------------------
  const performanceCollector = new PerformanceCollectorImpl();

  // -------------------------------------------------------------------------
  // 7. Create Snapshot Manager V2
  // -------------------------------------------------------------------------
  const snapshotManager = new SnapshotManagerV2({
    snapshotThreshold: resolvedConfig.snapshotThreshold,
    maxRoomMemoryMb: resolvedConfig.maxRoomMemoryMb,
  });

  // -------------------------------------------------------------------------
  // 8. Create Connection Manager V2
  // -------------------------------------------------------------------------
  const connectionManagerConfig: ConnectionManagerV2Config = {
    port: resolvedConfig.port,
    jwtSecret: resolvedConfig.jwtSecret,
    corsOrigins: resolvedConfig.corsOrigins,
    maxConnectionsTotal: resolvedConfig.maxConnectionsTotal,
    maxConnectionsPerRoom: resolvedConfig.maxConnectionsPerRoom,
    heartbeatIntervalMs: resolvedConfig.heartbeatIntervalMs,
    heartbeatTimeoutMs: resolvedConfig.heartbeatTimeoutMs,
    awarenessThrottleMs: resolvedConfig.awarenessThrottleMs,
  };
  const connectionManager = new ConnectionManagerV2(connectionManagerConfig, syncEngine);

  // -------------------------------------------------------------------------
  // 9. Wire Operation Pipeline
  //    WebSocket → ConnectionManager → BatchProcessor → SyncEngine
  //    → NativeMergeAddon (internal) → Persist → Broadcast
  // -------------------------------------------------------------------------

  // 9a. When BatchProcessor completes a cycle, persist operations and update metrics
  batchProcessor.onCycleComplete(async (cycle) => {
    const startTime = process.hrtime();

    // Persist each operation in the batch
    for (const op of cycle.operations) {
      try {
        await persistenceLayer.appendRoomOperation(cycle.roomId, op);
      } catch {
        // Log persistence errors but don't block the pipeline
      }
    }

    // Update Redis cache with current room state
    const roomState = syncEngine.getState(cycle.roomId);
    try {
      await redisCache.cacheRoomState(cycle.roomId, roomState);
      await redisCache.incrementRoomOpCount(cycle.roomId, cycle.operations.length);
    } catch {
      // Cache failures are non-critical
    }

    // Record operation latency for metrics
    performanceCollector.recordOperationLatency(startTime);
    performanceCollector.incrementOpsCount(cycle.operations.length);

    // Check if we need a snapshot
    try {
      // Record each operation with the current state for snapshot tracking
      const lastOp = cycle.operations[cycle.operations.length - 1];
      const snapshotResult = await snapshotManager.recordOperation(cycle.roomId, lastOp, roomState);
      if (snapshotResult) {
        await persistenceLayer.saveRoomSnapshot(cycle.roomId, snapshotResult.state, snapshotResult.operationCount);
        await redisCache.resetRoomOpCount(cycle.roomId);
      }
    } catch {
      // Snapshot errors are non-critical
    }
  });

  // 9b. Wire conflict events to broadcast to all room clients
  syncEngine.onConflict((event: ConflictEvent) => {
    const conflictFrame: ServerFrame = {
      channel: "ops",
      roomId: event.roomId,
      type: "conflict",
      payload: event,
    };
    broadcastToRoom(connectionManager, event.roomId, conflictFrame);

    // Persist conflict event
    persistenceLayer.saveConflictEvent(event).catch(() => {
      // Non-critical persistence failure
    });
  });

  // 9c. Wire Performance Collector metrics streaming via Metrics_Channel
  performanceCollector.setSnapshotCallback((clientId: string, metrics: PerformanceMetrics) => {
    const client = connectionManager.getConnection(clientId);
    if (!client) {
      performanceCollector.unsubscribe(clientId);
      return;
    }

    // Send metrics snapshot on the metrics channel to all rooms this client is in
    const metricsFrame: ServerFrame = {
      channel: "metrics",
      roomId: "__global__",
      type: "metrics-snapshot",
      payload: metrics,
    };

    sendFrameToClient(connectionManager, clientId, metricsFrame);
  });

  // -------------------------------------------------------------------------
  // 10. Wire Control_Channel Extended Commands
  //     (Simulation commands and time-travel queries)
  // -------------------------------------------------------------------------
  wireControlChannelExtensions(connectionManager, syncEngine, networkSimulator, performanceCollector);

  // -------------------------------------------------------------------------
  // 11. Create HTTP Server with CORS, Token Endpoint, and Health Check
  // -------------------------------------------------------------------------
  const httpServer = createHttpServer((req, res) => {
    // CORS headers for frontend cross-origin requests
    const allowedOrigin = resolvedConfig.corsOrigins.includes("*")
      ? "*"
      : resolvedConfig.corsOrigins.join(", ");

    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${resolvedConfig.port}`);

    // Token endpoint — generates a JWT for the requesting user
    if (url.pathname === "/token") {
      const userId = url.searchParams.get("userId") || "anon-" + Date.now().toString(36);
      const displayName = url.searchParams.get("displayName") || "Anonymous";
      const roomId = url.searchParams.get("roomId") || "default-room";
      const token = jwt.sign(
        { userId, displayName, roomId },
        resolvedConfig.jwtSecret,
        { expiresIn: "1h" }
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token }));
      return;
    }

    // Health check
    if (url.pathname === "/health") {
      const metrics = performanceCollector.getMetrics();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        engine: "collaborative-sync-engine-v2",
        metrics: {
          activeConnections: metrics.activeConnections,
          activeRooms: metrics.activeRooms,
          totalOpsProcessed: metrics.totalOpsProcessed,
          opsPerSecond: metrics.opsPerSecond,
        },
      }));
      return;
    }

    // Default route
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", engine: "collaborative-sync-engine-v2" }));
  });

  // Attach WebSocket server to HTTP server
  connectionManager.start(httpServer);

  // -------------------------------------------------------------------------
  // 12. Update Performance Collector with live connection/room counts
  // -------------------------------------------------------------------------
  const metricsUpdateInterval = setInterval(() => {
    performanceCollector.setActiveConnections(connectionManager.getConnectionCount());
    performanceCollector.setActiveRooms(syncEngine.getRoomCount());
  }, 1000);
  metricsUpdateInterval.unref();

  // -------------------------------------------------------------------------
  // Graceful Shutdown
  // -------------------------------------------------------------------------
  const stop = async (): Promise<void> => {
    clearInterval(metricsUpdateInterval);
    performanceCollector.destroy();
    await batchProcessor.shutdown();
    await connectionManager.stop();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if (redisClient) {
      redisClient.disconnect();
    }
    if ("close" in persistenceLayer && typeof (persistenceLayer as { close: () => Promise<void> }).close === "function") {
      await (persistenceLayer as { close: () => Promise<void> }).close();
    }
  };

  return {
    httpServer,
    connectionManager,
    syncEngine,
    batchProcessor,
    networkSimulator,
    performanceCollector,
    snapshotManager,
    persistenceLayer,
    redisCache,
    stop,
  };
}

// ---------------------------------------------------------------------------
// Control Channel Extensions
// ---------------------------------------------------------------------------

/**
 * Wires additional Control_Channel command routing for:
 * - Network simulation commands (set-latency, disconnect-simulation, etc.)
 * - Time-travel queries
 * - Metrics channel subscription
 *
 * The ConnectionManagerV2 already handles create-room, join-room, leave-room.
 * This function patches in handling for the extended commands by intercepting
 * unhandled control messages.
 */
function wireControlChannelExtensions(
  connectionManager: ConnectionManagerV2,
  syncEngine: SyncEngineV2,
  networkSimulator: NetworkSimulatorImpl,
  performanceCollector: PerformanceCollectorImpl
): void {
  // Monkey-patch the connection manager to intercept extended control commands.
  // The CM already sends an "acknowledged" response for unknown commands,
  // but we override that by exposing an onControlCommand hook.
  const originalClass = connectionManager as any;

  // Store reference to original control handler and wrap it
  const originalHandleControlChannel = originalClass.handleControlChannel?.bind(originalClass);

  // Override handleControlChannel to intercept simulation and time-travel commands
  originalClass.handleControlChannel = function (client: any, frame: any) {
    const payload = frame.payload as any;

    if (!payload || typeof payload !== "object" || !("type" in payload)) {
      originalClass.sendError(client, frame.roomId, "invalid_payload", "Control payload must have a type field");
      return;
    }

    switch (payload.type) {
      // Room lifecycle — delegate to original handler
      case "join-room":
      case "leave-room":
      case "create-room":
        if (originalHandleControlChannel) {
          originalHandleControlChannel(client, frame);
        }
        break;

      // --- Network Simulation Commands ---
      case "set-latency":
        networkSimulator.setLatency(client.clientId, payload.latencyMs ?? 0);
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: "set-latency",
          status: "applied",
          latencyMs: payload.latencyMs ?? 0,
        }, frame.seq);
        break;

      case "disconnect-simulation":
        networkSimulator.simulateDisconnect(client.clientId);
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: "disconnect-simulation",
          status: "applied",
        }, frame.seq);
        break;

      case "reconnect-simulation": {
        const queuedOps = networkSimulator.simulateReconnect(client.clientId);
        // Deliver queued operations to the client in causal order
        for (const op of queuedOps) {
          const deltaFrame: ServerFrame = {
            channel: "ops",
            roomId: frame.roomId,
            type: "delta",
            payload: {
              sessionId: frame.roomId,
              changes: [{
                itemId: op.itemId,
                type: op.type === "add" ? "added" : op.type === "remove" ? "removed" : "updated",
                fields: op.payload,
              }],
              timestamp: op.timestamp,
            },
          };
          sendFrameToClient(connectionManager, client.clientId, deltaFrame);
        }
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: "reconnect-simulation",
          status: "applied",
          queuedOperationsDelivered: queuedOps.length,
        }, frame.seq);
        break;
      }

      case "partition-simulation":
        networkSimulator.setPartition(payload.groupA ?? [], payload.groupB ?? []);
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: "partition-simulation",
          status: "applied",
        }, frame.seq);
        break;

      case "heal-partition":
        networkSimulator.healPartition();
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: "heal-partition",
          status: "applied",
        }, frame.seq);
        break;

      // --- Time-Travel Queries ---
      case "time-travel": {
        const timestamp = payload.timestamp;
        if (!timestamp) {
          sendControlError(connectionManager, client, frame.roomId, "invalid_payload", "time-travel requires a timestamp", frame.seq);
          break;
        }
        syncEngine.queryTimeTravelState(frame.roomId, timestamp).then((result) => {
          sendControlResponse(connectionManager, client, frame.roomId, {
            type: "time-travel",
            status: "success",
            state: result.state,
            boundedByGC: result.boundedByGC,
          }, frame.seq);
        }).catch((err: Error) => {
          sendControlError(connectionManager, client, frame.roomId, "time_travel_failed", err.message, frame.seq);
        });
        break;
      }

      case "query-history": {
        const from = payload.from;
        const to = payload.to;
        if (!from || !to) {
          sendControlError(connectionManager, client, frame.roomId, "invalid_payload", "query-history requires from and to timestamps", frame.seq);
          break;
        }
        syncEngine.queryOperationRange(frame.roomId, from, to).then((operations) => {
          sendControlResponse(connectionManager, client, frame.roomId, {
            type: "query-history",
            status: "success",
            operations,
          }, frame.seq);
        }).catch((err: Error) => {
          sendControlError(connectionManager, client, frame.roomId, "query_failed", err.message, frame.seq);
        });
        break;
      }

      // --- Metrics Channel Subscription ---
      case "subscribe-metrics":
        performanceCollector.subscribe(client.clientId);
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: "subscribe-metrics",
          status: "subscribed",
        }, frame.seq);
        break;

      case "unsubscribe-metrics":
        performanceCollector.unsubscribe(client.clientId);
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: "unsubscribe-metrics",
          status: "unsubscribed",
        }, frame.seq);
        break;

      default:
        sendControlResponse(connectionManager, client, frame.roomId, {
          type: payload.type,
          status: "acknowledged",
        }, frame.seq);
        break;
    }
  };
}

// ---------------------------------------------------------------------------
// Helper functions for sending frames via ConnectionManager
// ---------------------------------------------------------------------------

function sendFrameToClient(
  connectionManager: ConnectionManagerV2,
  clientId: string,
  frame: ServerFrame
): void {
  const client = connectionManager.getConnection(clientId);
  if (client) {
    // Access the underlying send method
    const tracked = client as any;
    if (tracked.ws && tracked.ws.readyState === 1) { // WebSocket.OPEN
      tracked.ws.send(JSON.stringify(frame));
    }
  }
}

function broadcastToRoom(
  connectionManager: ConnectionManagerV2,
  roomId: string,
  frame: ServerFrame,
  excludeClientId?: string
): void {
  const clientIds = connectionManager.getRoomClientIds(roomId);
  for (const clientId of clientIds) {
    if (clientId === excludeClientId) continue;
    sendFrameToClient(connectionManager, clientId, frame);
  }
}

function sendControlResponse(
  connectionManager: ConnectionManagerV2,
  client: any,
  roomId: string,
  payload: unknown,
  replyTo?: number
): void {
  const frame: ServerFrame = {
    channel: "control",
    roomId,
    type: "control-response",
    payload,
    replyTo,
  };
  if (client.ws && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(frame));
  }
}

function sendControlError(
  connectionManager: ConnectionManagerV2,
  client: any,
  roomId: string,
  code: string,
  message: string,
  replyTo?: number
): void {
  const frame: ServerFrame = {
    channel: "control",
    roomId,
    type: "error",
    payload: { code, message },
    replyTo,
  };
  if (client.ws && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(frame));
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Main entry point — starts the V2 server with all components wired together.
 */
export async function main(): Promise<void> {
  const config = loadConfig();
  const server = await createServer(config);

  server.httpServer.listen(config.port, () => {
    console.log(`\n  Collaborative Sync Engine V2 started on port ${config.port}`);
    console.log(`  ─────────────────────────────────────────────────`);
    console.log(`  CORS origins:         ${config.corsOrigins.join(", ")}`);
    console.log(`  Max connections:      ${config.maxConnectionsTotal}`);
    console.log(`  Max per room:         ${config.maxConnectionsPerRoom}`);
    console.log(`  Batch window:         ${config.batchWindowMs}ms`);
    console.log(`  Worker threshold:     ${config.batchWorkerThreadThreshold} ops`);
    console.log(`  Snapshot threshold:   ${config.snapshotThreshold} ops`);
    console.log(`  Heartbeat interval:   ${config.heartbeatIntervalMs}ms`);
    console.log(`  Persistence:          ${config.databaseUrl ? "PostgreSQL" : "In-memory"}`);
    console.log(`  Cache:                ${config.redisUrl ? "Redis" : "In-memory"}`);
    console.log(`  JWT Secret:           ${config.jwtSecret === "development-secret" ? "(development default)" : "(configured)"}`);
    console.log(`  ─────────────────────────────────────────────────\n`);
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down gracefully...");
    await server.stop();
    console.log("Server stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Auto-start when run directly via `node dist/index.js`
const isMainModule = typeof require !== "undefined" && require.main === module;
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Backwards-compatible V1 exports for existing tests
// ---------------------------------------------------------------------------

/** @deprecated Use ServerInstanceV2 instead */
export type ServerInstance = ServerInstanceV2;

