/**
 * Property-based tests for ConnectionManager.
 * Feature: collaborative-sync-engine
 *
 * Property 13: Missed Update Queue Integrity - Validates: Requirements 6.4
 * Property 21: Authentication Error Classification - Validates: Requirements 10.2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { ConnectionManager } from "./connection-manager.js";
import type { StateDelta, HLCTimestamp, ItemChange, ServerMessage } from "../types/index.js";

/**
 * Helper: create a ConnectionManager instance for testing queue logic.
 * No WebSocket server is started — we only exercise queueMissedUpdate / getMissedUpdates / getQueuedUpdateCount.
 */
function createTestManager(): ConnectionManager {
  return new ConnectionManager({ jwtSecret: "test-secret" });
}

/**
 * Helper: generate a StateDelta with a unique timestamp for ordering verification.
 */
function makeDelta(index: number, sessionId: string): StateDelta {
  return {
    sessionId,
    changes: [
      {
        itemId: `item-${index}`,
        type: "updated",
        fields: { value: index },
      },
    ],
    timestamp: {
      wallTime: Date.now() + index,
      logical: index,
      nodeId: `node-${index}`,
    },
  };
}

/**
 * Arbitrary for generating a StateDelta with controlled properties.
 */
const arbItemChange: fc.Arbitrary<ItemChange> = fc.record({
  itemId: fc.string({ minLength: 1, maxLength: 20 }),
  type: fc.constantFrom("added" as const, "removed" as const, "updated" as const),
  fields: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.anything()), {
    nil: undefined,
  }),
});

const arbHLCTimestamp: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  logical: fc.integer({ min: 0, max: 10000 }),
  nodeId: fc.string({ minLength: 1, maxLength: 20 }),
});

const arbStateDelta: fc.Arbitrary<StateDelta> = fc.record({
  sessionId: fc.string({ minLength: 1, maxLength: 20 }),
  changes: fc.array(arbItemChange, { minLength: 1, maxLength: 5 }),
  timestamp: arbHLCTimestamp,
});

describe("Feature: collaborative-sync-engine, Property 13: Missed Update Queue Integrity", () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any sequence of deltas queued for a disconnected client (up to 1000 items, within 24 hours),
   * redelivery upon reconnection shall preserve the original generation order of those deltas.
   */
  it("queued deltas preserve original generation order", () => {
    fc.assert(
      fc.property(
        fc.array(arbStateDelta, { minLength: 1, maxLength: 1000 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (deltas, clientId) => {
          const manager = createTestManager();

          // Queue all deltas
          for (const delta of deltas) {
            manager.queueMissedUpdate(clientId, delta);
          }

          // Verify count
          expect(manager.getQueuedUpdateCount(clientId)).toBe(deltas.length);

          // Verify order is preserved (first queued = first in array)
          const queue = manager.getMissedUpdates().get(clientId);
          expect(queue).toBeDefined();
          expect(queue!.length).toBe(deltas.length);

          for (let i = 0; i < deltas.length; i++) {
            expect(queue![i].delta).toEqual(deltas[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Verify that the queue count matches exactly the number of deltas queued.
   */
  it("getQueuedUpdateCount returns correct count for any N deltas (1-1000)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (n, clientId) => {
          const manager = createTestManager();
          const sessionId = "test-session";

          for (let i = 0; i < n; i++) {
            manager.queueMissedUpdate(clientId, makeDelta(i, sessionId));
          }

          expect(manager.getQueuedUpdateCount(clientId)).toBe(n);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.4, 6.5**
   *
   * Queueing more than 1000 deltas triggers overflow — the queue is cleared (resync scenario).
   */
  it("queueing more than 1000 deltas clears the queue (triggers resync)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1001, max: 1100 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (n, clientId) => {
          const manager = createTestManager();
          const sessionId = "test-session";

          for (let i = 0; i < n; i++) {
            manager.queueMissedUpdate(clientId, makeDelta(i, sessionId));
          }

          // After exceeding 1000, the queue should be deleted (resync required)
          expect(manager.getQueuedUpdateCount(clientId)).toBe(0);
          expect(manager.getMissedUpdates().has(clientId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/* ═══════════════════════════════════════════════════════════════════════════
 * Property 21: Authentication Error Classification
 * Feature: collaborative-sync-engine, Property 21: Authentication Error Classification
 * Validates: Requirements 10.2
 *
 * Verifies that invalid authentication tokens are rejected with correct error
 * classification: malformed for invalid/unverifiable JWTs, expired for tokens
 * with expired `exp` claim, and malformed for tokens signed with wrong secrets.
 * ═══════════════════════════════════════════════════════════════════════════ */

const AUTH_JWT_SECRET = "property-test-auth-secret-key";
let AUTH_TEST_PORT = 9891;

/** Helper to connect and capture the first error message + close event. */
function connectAndCaptureAuth(
  port: number,
  token: string
): Promise<{ message: ServerMessage; closeCode: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?token=${encodeURIComponent(token)}`);
    let message: ServerMessage | null = null;
    let closeCode = 0;

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error("Connection timed out"));
    }, 5000);

    ws.on("message", (data) => {
      if (!message) {
        message = JSON.parse(data.toString());
      }
    });

    ws.on("close", (code) => {
      clearTimeout(timeout);
      closeCode = code;
      if (message) {
        resolve({ message, closeCode });
      } else {
        setTimeout(() => {
          if (message) {
            resolve({ message, closeCode });
          } else {
            reject(new Error("Connection closed without error message"));
          }
        }, 50);
      }
    });

    ws.on("error", () => {
      // Errors are expected for rejected connections; wait for close
    });
  });
}

describe("Feature: collaborative-sync-engine, Property 21: Authentication Error Classification", () => {
  let authManager: ConnectionManager;

  beforeEach(() => {
    authManager = new ConnectionManager({
      port: 0,
      jwtSecret: AUTH_JWT_SECRET,
      maxConnectionsPerSession: 50,
      heartbeatIntervalMs: 60000,
      heartbeatTimeoutMs: 60000,
    });
    const wss = authManager.start();
    const addr = wss.address();
    AUTH_TEST_PORT = typeof addr === "object" && addr ? addr.port : 9891;
  });

  afterEach(async () => {
    await authManager.stop();
  });

  /**
   * **Validates: Requirements 10.2**
   *
   * For any random string that is not a valid JWT, the Connection Manager
   * SHALL reject the connection with error code "malformed".
   */
  it("malformed tokens (random strings) are rejected with code 'malformed'", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => {
          // Filter out strings that happen to look like valid JWT format
          const parts = s.split(".");
          return parts.length !== 3 || parts.some((p) => p.length === 0);
        }),
        async (randomToken) => {
          const { message, closeCode } = await connectAndCaptureAuth(AUTH_TEST_PORT, randomToken);

          expect(message.type).toBe("error");
          expect(message.code).toBe("malformed");
          expect(closeCode).toBe(4001);
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * **Validates: Requirements 10.2**
   *
   * For any valid JWT with an expired `exp` claim, the Connection Manager
   * SHALL reject the connection with error code "expired".
   */
  it("expired tokens are rejected with code 'expired'", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/).map((s) => `user-${s}`),
          displayName: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/).filter((s) => s.trim().length >= 1),
          sessionId: fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/).map((s) => `session-${s}`),
        }),
        async (payload) => {
          const expiredToken = jwt.sign(
            { userId: payload.userId, displayName: payload.displayName, sessionId: payload.sessionId },
            AUTH_JWT_SECRET,
            { expiresIn: "-1s" }
          );

          const { message, closeCode } = await connectAndCaptureAuth(AUTH_TEST_PORT, expiredToken);

          expect(message.type).toBe("error");
          expect(message.code).toBe("expired");
          expect(closeCode).toBe(4001);
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * **Validates: Requirements 10.2**
   *
   * For any JWT signed with a different secret than the server's configured secret,
   * jwt.verify throws JsonWebTokenError (signature mismatch), which the Connection
   * Manager SHALL classify as "malformed".
   */
  it("tokens signed with wrong secret are rejected with code 'malformed'", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/).map((s) => `user-${s}`),
          displayName: fc.stringMatching(/^[a-zA-Z0-9 ]{1,50}$/).filter((s) => s.trim().length >= 1),
          sessionId: fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/).map((s) => `session-${s}`),
          wrongSecret: fc.string({ minLength: 5, maxLength: 50 }).filter((s) => s !== AUTH_JWT_SECRET),
        }),
        async ({ userId, displayName, sessionId, wrongSecret }) => {
          const wrongSecretToken = jwt.sign(
            { userId, displayName, sessionId },
            wrongSecret,
            { expiresIn: "1h" }
          );

          const { message, closeCode } = await connectAndCaptureAuth(AUTH_TEST_PORT, wrongSecretToken);

          expect(message.type).toBe("error");
          expect(message.code).toBe("malformed");
          expect(closeCode).toBe(4001);
        }
      ),
      { numRuns: 30 }
    );
  });
});


// ─── Property 20: Presence Data Integrity ────────────────────────────────────

const PRESENCE_JWT_SECRET = "property-test-presence-secret-key";

/**
 * Helper to connect a WebSocket client and wait for it to be registered.
 */
function connectPresenceClient(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?token=${token}`);
    ws.on("open", () => {
      // Brief delay for server-side session registration
      setTimeout(() => resolve(ws), 50);
    });
    ws.on("error", (err) => reject(err));
  });
}

function closePresenceClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    ws.on("close", () => resolve());
    ws.close();
  });
}

// ─── Generators for Presence Test ─────────────────────────────────────────────

/**
 * Generates a valid display name between 1 and 100 printable characters.
 */
const presenceDisplayNameArb: fc.Arbitrary<string> = fc
  .string({
    minLength: 1,
    maxLength: 100,
    unit: fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126),
  })
  .filter((s) => s.trim().length > 0);

/**
 * Generates a valid user ID (alphanumeric with dashes/underscores).
 */
const presenceUserIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9_-]{1,30}$/)
  .filter((s) => s.length > 0);

interface PresenceUserDescriptor {
  userId: string;
  displayName: string;
}

/**
 * Generates a list of 1-5 users with unique userIds for a session.
 */
const presenceUsersArb: fc.Arbitrary<PresenceUserDescriptor[]> = fc
  .array(
    fc.record({
      userId: presenceUserIdArb,
      displayName: presenceDisplayNameArb,
    }),
    { minLength: 1, maxLength: 5 }
  )
  .map((users) => {
    // Ensure unique userIds by appending index suffix
    return users.map((u, i) => ({
      ...u,
      userId: `${u.userId}_${i}`,
    }));
  });

// ─── Property 20 Tests ───────────────────────────────────────────────────────

describe("Feature: collaborative-sync-engine, Property 20: Presence Data Integrity", () => {
  let presenceManager: ConnectionManager | null = null;
  let openPresenceClients: WebSocket[] = [];

  afterEach(async () => {
    // Clean up all open client connections
    for (const ws of openPresenceClients) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // ignore cleanup errors
      }
    }
    openPresenceClients = [];

    // Stop manager
    if (presenceManager) {
      await presenceManager.stop();
      presenceManager = null;
    }
  });

  /**
   * **Validates: Requirements 2.4, 2.5**
   *
   * Property: For any set of N users (1-5) connecting to a session,
   * getPresenceList returns exactly N entries, each with:
   * - a valid unique userId (non-empty string)
   * - a displayName between 1 and 100 characters
   * - a connectedAt timestamp > 0
   * - the correct userId/displayName matching the connected user
   */
  it("presence list returns exactly the connected users with valid identifiers, display names (1-100 chars), and timestamps", { timeout: 60000 }, async () => {
    await fc.assert(
      fc.asyncProperty(presenceUsersArb, async (users) => {
        const sessionId = "presence-test-session";

        presenceManager = new ConnectionManager({
          port: 0,
          jwtSecret: PRESENCE_JWT_SECRET,
          maxConnectionsPerSession: 50,
          heartbeatIntervalMs: 60000, // Long interval to avoid interference
          heartbeatTimeoutMs: 60000,
        });
        const wss = presenceManager.start();
        const addr = wss.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;

        // Allow server to start listening
        await new Promise((resolve) => setTimeout(resolve, 50));

        const connectedClients: WebSocket[] = [];
        const timestampBefore = Date.now();

        try {
          // Connect all users
          for (const user of users) {
            const token = jwt.sign(
              { userId: user.userId, displayName: user.displayName, sessionId },
              PRESENCE_JWT_SECRET,
              { expiresIn: "1h" }
            );
            const ws = await connectPresenceClient(port, token);
            connectedClients.push(ws);
            openPresenceClients.push(ws);
          }

          const timestampAfter = Date.now();

          // Request the presence list
          const presenceList = presenceManager.getPresenceList(sessionId);

          // ─── Assertions ─────────────────────────────────────────────────

          // 1. Presence list has exactly N users
          expect(presenceList.length).toBe(users.length);

          // 2. Each user in the presence list has valid fields
          for (const presence of presenceList) {
            // Valid unique identifier (non-empty string)
            expect(typeof presence.userId).toBe("string");
            expect(presence.userId.length).toBeGreaterThan(0);

            // Display name between 1 and 100 characters
            expect(typeof presence.displayName).toBe("string");
            expect(presence.displayName.length).toBeGreaterThanOrEqual(1);
            expect(presence.displayName.length).toBeLessThanOrEqual(100);

            // Connection timestamp > 0 and within a reasonable range
            expect(typeof presence.connectedAt).toBe("number");
            expect(presence.connectedAt).toBeGreaterThan(0);
            expect(presence.connectedAt).toBeGreaterThanOrEqual(timestampBefore);
            expect(presence.connectedAt).toBeLessThanOrEqual(timestampAfter);
          }

          // 3. The set of userIds in the presence list matches exactly the connected users
          const presenceUserIds = new Set(presenceList.map((p) => p.userId));
          const expectedUserIds = new Set(users.map((u) => u.userId));
          expect(presenceUserIds).toEqual(expectedUserIds);

          // 4. Display names match what was provided in the tokens
          for (const user of users) {
            const match = presenceList.find((p) => p.userId === user.userId);
            expect(match).toBeDefined();
            expect(match!.displayName).toBe(user.displayName);
          }

          // 5. All userIds in the presence list are unique
          expect(presenceUserIds.size).toBe(presenceList.length);
        } finally {
          // Close all client connections
          for (const ws of connectedClients) {
            await closePresenceClient(ws);
          }

          // Stop the manager
          await presenceManager.stop();
          presenceManager = null;
        }
      }),
      { numRuns: 30 }
    );
  });
});
