/**
 * Collaborative Sync Engine — Application Entry Point
 *
 * Wires together the Connection Manager, Sync Engine, Persistence Layer,
 * Redis Cache, and Snapshot Manager into a running server application.
 *
 * Requirements: 1.1, 1.4, 7.1, 7.6
 */

import { createServer as createHttpServer, type Server } from "http";
import Redis from "ioredis";
import { ConnectionManager, type ConnectionManagerConfig } from "./connection/connection-manager.js";
import { SyncEngine } from "./engine/sync-engine.js";
import {
  InMemoryPersistenceLayer,
  PostgresPersistenceLayer,
  type PersistenceLayer,
} from "./persistence/persistence-layer.js";
import {
  InMemoryRedisCache,
  RedisCache,
  type RedisCacheInterface,
} from "./persistence/redis-cache.js";
import { SnapshotManager } from "./persistence/snapshot-manager.js";
import type { ServerMessage } from "./types/index.js";

/** Server configuration derived from environment variables. */
export interface ServerConfig {
  port: number;
  jwtSecret: string;
  maxConnectionsPerSession: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  snapshotIntervalMs: number;
  databaseUrl?: string;
  redisUrl?: string;
}

/** The running server instance with all wired components. */
export interface ServerInstance {
  httpServer: Server;
  connectionManager: ConnectionManager;
  syncEngine: SyncEngine;
  persistenceLayer: PersistenceLayer;
  redisCache: RedisCacheInterface;
  snapshotManager: SnapshotManager;
  stop: () => Promise<void>;
}

/**
 * Reads configuration from environment variables with sensible defaults.
 */
export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? "8080", 10),
    jwtSecret: process.env.JWT_SECRET ?? "development-secret",
    maxConnectionsPerSession: parseInt(process.env.MAX_CONNECTIONS_PER_SESSION ?? "50", 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? "30000", 10),
    heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS ?? "10000", 10),
    snapshotIntervalMs: parseInt(process.env.SNAPSHOT_INTERVAL_MS ?? "600000", 10),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
  };
}

/**
 * Creates and wires the server components without starting the listener.
 * Useful for programmatic use and testing.
 */
export async function createServer(config?: Partial<ServerConfig>): Promise<ServerInstance> {
  const resolvedConfig: ServerConfig = { ...loadConfig(), ...config };

  // 1. Initialize Persistence Layer
  let persistenceLayer: PersistenceLayer;
  if (resolvedConfig.databaseUrl) {
    persistenceLayer = new PostgresPersistenceLayer({
      connectionString: resolvedConfig.databaseUrl,
    });
  } else {
    persistenceLayer = new InMemoryPersistenceLayer();
  }

  // 2. Initialize Redis Cache
  let redisCache: RedisCacheInterface;
  if (resolvedConfig.redisUrl) {
    const redisClient = new Redis(resolvedConfig.redisUrl);
    redisCache = new RedisCache(redisClient);
  } else {
    redisCache = new InMemoryRedisCache();
  }

  // 3. Create Sync Engine
  const syncEngine = new SyncEngine(persistenceLayer);

  // 4. Create Connection Manager
  const connectionManagerConfig: ConnectionManagerConfig = {
    port: resolvedConfig.port,
    jwtSecret: resolvedConfig.jwtSecret,
    maxConnectionsPerSession: resolvedConfig.maxConnectionsPerSession,
    heartbeatIntervalMs: resolvedConfig.heartbeatIntervalMs,
    heartbeatTimeoutMs: resolvedConfig.heartbeatTimeoutMs,
  };
  const connectionManager = new ConnectionManager(connectionManagerConfig);

  // 5. Register operation callback:
  //    Connection Manager → Sync Engine → Persistence → Broadcast
  connectionManager.onOperation = async (clientId, operation) => {
    const result = await syncEngine.processOperation(operation);

    if (result.success) {
      // Send ACK to the originating client
      const ackMsg: ServerMessage = {
        type: "ack",
        operationId: result.operationId,
        message: "Operation merged successfully",
      };
      connectionManager.sendToClient(clientId, ackMsg);

      // Broadcast delta to all other clients in the session
      if (result.delta) {
        connectionManager.broadcastDelta(
          operation.sessionId,
          result.delta,
          clientId
        );
      }
    } else {
      // Send error to the originating client
      const errorMsg: ServerMessage = {
        type: "error",
        operationId: result.operationId,
        code: result.error?.code ?? "operation_failed",
        message: result.error?.message ?? "Failed to process operation",
      };
      connectionManager.sendToClient(clientId, errorMsg);
    }
  };

  // 6. Create Snapshot Manager
  const snapshotManager = new SnapshotManager(
    persistenceLayer,
    resolvedConfig.snapshotIntervalMs
  );

  // 7. Create HTTP server with WebSocket upgrade handling
  const httpServer = createHttpServer((_req, res) => {
    // Basic health check endpoint
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", engine: "collaborative-sync-engine" }));
  });

  // Attach WebSocket server to HTTP server
  connectionManager.start(httpServer);

  // Stop function for graceful shutdown
  const stop = async (): Promise<void> => {
    snapshotManager.stopPeriodicSnapshots();
    await connectionManager.stop();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if ("close" in redisCache && typeof (redisCache as { close: () => Promise<void> }).close === "function") {
      await (redisCache as { close: () => Promise<void> }).close();
    }
    if ("close" in persistenceLayer && typeof (persistenceLayer as { close: () => Promise<void> }).close === "function") {
      await (persistenceLayer as { close: () => Promise<void> }).close();
    }
  };

  return {
    httpServer,
    connectionManager,
    syncEngine,
    persistenceLayer,
    redisCache,
    snapshotManager,
    stop,
  };
}

/**
 * Main entry point — starts the server and begins periodic snapshots.
 */
export async function main(): Promise<void> {
  const config = loadConfig();
  const server = await createServer(config);

  server.httpServer.listen(config.port, () => {
    console.log(`Collaborative Sync Engine started on port ${config.port}`);
    console.log(`  JWT Secret: ${config.jwtSecret === "development-secret" ? "(development default)" : "(configured)"}`);
    console.log(`  Max connections/session: ${config.maxConnectionsPerSession}`);
    console.log(`  Heartbeat interval: ${config.heartbeatIntervalMs}ms`);
    console.log(`  Heartbeat timeout: ${config.heartbeatTimeoutMs}ms`);
    console.log(`  Snapshot interval: ${config.snapshotIntervalMs}ms`);
    console.log(`  Persistence: ${config.databaseUrl ? "PostgreSQL" : "In-memory"}`);
    console.log(`  Cache: ${config.redisUrl ? "Redis" : "In-memory"}`);
  });

  // Start periodic snapshots for a default session (sessions are created dynamically)
  // The snapshot manager will be used per-session as sessions are created.
  // For now, we keep the manager ready to be started per session.

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
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
