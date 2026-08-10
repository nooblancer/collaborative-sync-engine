/**
 * Demo: Collaborative Sync Engine in Action
 *
 * This script demonstrates:
 * 1. Starting the server
 * 2. 3 clients connecting with JWT auth
 * 3. Real-time inventory collaboration (add, update, remove)
 * 4. Conflict resolution via LWW-Element-Set
 * 5. Presence tracking (join/leave)
 * 6. Operation propagation across clients
 */

import jwt from "jsonwebtoken";
import WebSocket from "ws";
import { createServer, type ServerInstance } from "./src/index.js";
import type { ServerMessage } from "./src/types/index.js";

const PORT = 4567;
const JWT_SECRET = "demo-secret-key";
const SESSION_ID = "inventory-session";

// ─── Helpers ───────────────────────────────────────────────────────────

function createToken(userId: string, displayName: string): string {
  return jwt.sign({ userId, displayName, sessionId: SESSION_ID }, JWT_SECRET, { expiresIn: "1h" });
}

function connectClient(name: string, token: string): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}?token=${token}`);
    const messages: ServerMessage[] = [];

    ws.on("message", (data) => {
      const msg: ServerMessage = JSON.parse(data.toString());
      messages.push(msg);

      // Log interesting events
      if (msg.type === "presence-join") {
        console.log(`  📢 ${name} sees: ${msg.user?.displayName} joined`);
      } else if (msg.type === "presence-leave") {
        console.log(`  📢 ${name} sees: ${msg.userId} left`);
      } else if (msg.type === "delta") {
        const delta = msg.payload as any;
        for (const change of delta.changes || []) {
          if (change.type === "added") {
            console.log(`  📥 ${name} received: item "${change.itemId}" added (fields: ${JSON.stringify(change.fields)})`);
          } else if (change.type === "updated") {
            console.log(`  📥 ${name} received: item "${change.itemId}" updated (fields: ${JSON.stringify(change.fields)})`);
          } else if (change.type === "removed") {
            console.log(`  📥 ${name} received: item "${change.itemId}" removed`);
          }
        }
      } else if (msg.type === "ack") {
        // ACK received silently
      }
    });

    ws.on("open", () => setTimeout(() => resolve({ ws, messages }), 100));
    ws.on("error", reject);
  });
}

function sendOp(ws: WebSocket, op: { id: string; type: string; itemId: string; payload: Record<string, unknown>; replicaId: string; wallTime: number }) {
  ws.send(JSON.stringify({
    type: "operation",
    payload: {
      id: op.id,
      sessionId: SESSION_ID,
      replicaId: op.replicaId,
      type: op.type,
      itemId: op.itemId,
      payload: op.payload,
      timestamp: { wallTime: op.wallTime, logical: 0, nodeId: op.replicaId },
      version: 0,
    },
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Demo ─────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Collaborative Sync Engine — Live Demo                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // 1. Start server
  console.log("🚀 Starting server on port", PORT, "...");
  const server: ServerInstance = await createServer({
    port: PORT,
    jwtSecret: JWT_SECRET,
    heartbeatIntervalMs: 60000,
    heartbeatTimeoutMs: 60000,
  });
  await new Promise<void>((resolve) => server.httpServer.listen(PORT, resolve));
  console.log("✅ Server running\n");

  // 2. Connect clients
  console.log("━━━ Phase 1: Connecting Clients ━━━━━━━━━━━━━━━━━━━━━━━━━");
  const tokenAlice = createToken("alice", "Alice");
  const tokenBob = createToken("bob", "Bob");
  const tokenCharlie = createToken("charlie", "Charlie");

  const alice = await connectClient("Alice", tokenAlice);
  console.log("  ✅ Alice connected");

  const bob = await connectClient("Bob", tokenBob);
  console.log("  ✅ Bob connected");
  await sleep(200);

  const charlie = await connectClient("Charlie", tokenCharlie);
  console.log("  ✅ Charlie connected");
  await sleep(300);

  // 3. Add inventory items
  console.log("\n━━━ Phase 2: Adding Inventory Items ━━━━━━━━━━━━━━━━━━━━━");
  const baseTime = Date.now();

  console.log("\n  Alice adds: Laptop (qty: 50)");
  sendOp(alice.ws, { id: "op-1", type: "add", itemId: "laptop", payload: { name: "Laptop", quantity: 50 }, replicaId: "alice-replica", wallTime: baseTime });
  await sleep(300);

  console.log("\n  Bob adds: Mouse (qty: 200)");
  sendOp(bob.ws, { id: "op-2", type: "add", itemId: "mouse", payload: { name: "Mouse", quantity: 200 }, replicaId: "bob-replica", wallTime: baseTime + 100 });
  await sleep(300);

  console.log("\n  Charlie adds: Keyboard (qty: 100)");
  sendOp(charlie.ws, { id: "op-3", type: "add", itemId: "keyboard", payload: { name: "Keyboard", quantity: 100 }, replicaId: "charlie-replica", wallTime: baseTime + 200 });
  await sleep(500);

  // 4. Concurrent updates — conflict resolution
  console.log("\n━━━ Phase 3: Concurrent Updates (Conflict Resolution) ━━━");
  console.log("\n  Alice updates Laptop quantity to 45 (wallTime: T+1000)");
  console.log("  Bob updates Laptop quantity to 48 (wallTime: T+1001) ← WINS (later timestamp)");

  sendOp(alice.ws, { id: "op-4", type: "update", itemId: "laptop", payload: { quantity: 45 }, replicaId: "alice-replica", wallTime: baseTime + 1000 });
  sendOp(bob.ws, { id: "op-5", type: "update", itemId: "laptop", payload: { quantity: 48 }, replicaId: "bob-replica", wallTime: baseTime + 1001 });
  await sleep(500);

  // Check server state
  const stateAfterConflict = await server.syncEngine.getState(SESSION_ID);
  const laptopQty = stateAfterConflict.items["laptop"]?.fields["quantity"]?.value;
  console.log(`\n  🏆 Server resolved: Laptop quantity = ${laptopQty} (Bob's update wins — later timestamp)`);

  // 5. Remove item — remove wins over concurrent update
  console.log("\n━━━ Phase 4: Remove Wins Over Concurrent Update ━━━━━━━━━");
  console.log("\n  Charlie removes Mouse");
  console.log("  Alice updates Mouse quantity to 250 (concurrent)");

  sendOp(charlie.ws, { id: "op-6", type: "remove", itemId: "mouse", payload: {}, replicaId: "charlie-replica", wallTime: baseTime + 2000 });
  sendOp(alice.ws, { id: "op-7", type: "update", itemId: "mouse", payload: { quantity: 250 }, replicaId: "alice-replica", wallTime: baseTime + 2001 });
  await sleep(500);

  const stateAfterRemove = await server.syncEngine.getState(SESSION_ID);
  const mouseRemoved = stateAfterRemove.items["mouse"]?.removedAt !== null;
  console.log(`\n  🏆 Server resolved: Mouse removed = ${mouseRemoved} (remove wins regardless of timestamp)`);

  // 6. Presence — Bob disconnects
  console.log("\n━━━ Phase 5: Presence Tracking ━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n  Bob disconnecting...");
  bob.ws.close();
  await sleep(500);

  // 7. Final state summary
  console.log("\n━━━ Final State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const finalState = await server.syncEngine.getState(SESSION_ID);
  console.log(`\n  Session: ${finalState.sessionId}`);
  console.log(`  Version: ${finalState.version}`);
  console.log(`  Items:`);
  for (const [id, item] of Object.entries(finalState.items)) {
    const fields: Record<string, unknown> = {};
    for (const [key, reg] of Object.entries(item.fields)) {
      fields[key] = reg.value;
    }
    const status = item.removedAt ? "❌ REMOVED" : "✅ active";
    console.log(`    • ${id}: ${JSON.stringify(fields)} [${status}]`);
  }

  const presenceList = server.connectionManager.getPresenceList(SESSION_ID);
  console.log(`\n  Connected users: ${presenceList.map(p => p.displayName).join(", ") || "(none)"}`);
  console.log(`  Total connections: ${server.connectionManager.getConnectionCount(SESSION_ID)}`);

  // Cleanup
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  alice.ws.close();
  charlie.ws.close();
  await sleep(200);
  await server.stop();
  console.log("\n✅ Demo complete. Server stopped.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
