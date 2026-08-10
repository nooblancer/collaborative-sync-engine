/**
 * Demo Server with embedded HTML frontend.
 * 
 * Run with: npx tsx demo-frontend.ts
 * Then open http://localhost:4567 in multiple browser tabs.
 * Each tab is a different "user" collaborating on a shared inventory.
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "http";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import { SyncEngine } from "./src/engine/sync-engine.js";
import { InMemoryPersistenceLayer } from "./src/persistence/persistence-layer.js";
import { ConnectionManager } from "./src/connection/connection-manager.js";
import type { ServerMessage } from "./src/types/index.js";

const PORT = 4567;
const JWT_SECRET = "demo-frontend-secret";
const SESSION_ID = "shared-inventory";

// ─── HTML Frontend ─────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Collaborative Inventory — CRDT Sync Engine Demo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; color: #38bdf8; }
    .subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 20px; }
    
    .status-bar {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; background: #1e293b; border-radius: 8px;
      margin-bottom: 16px; font-size: 0.85rem;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .status-dot.connected { background: #22c55e; }
    .status-dot.disconnected { background: #ef4444; }
    .user-badge { 
      background: #334155; padding: 3px 10px; border-radius: 12px; 
      font-size: 0.75rem; color: #94a3b8;
    }
    .user-badge.me { background: #1d4ed8; color: #dbeafe; }
    
    .presence-list { 
      display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; 
    }
    
    .panel { 
      background: #1e293b; border-radius: 10px; padding: 16px; margin-bottom: 16px;
      border: 1px solid #334155;
    }
    .panel h2 { font-size: 0.9rem; color: #94a3b8; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    
    .add-form { display: flex; gap: 8px; flex-wrap: wrap; }
    .add-form input { 
      flex: 1; min-width: 120px; padding: 8px 12px; background: #0f172a;
      border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;
      font-size: 0.85rem;
    }
    .add-form input:focus { outline: none; border-color: #38bdf8; }
    .add-form button {
      padding: 8px 16px; background: #2563eb; border: none; border-radius: 6px;
      color: white; font-weight: 500; cursor: pointer; font-size: 0.85rem;
    }
    .add-form button:hover { background: #1d4ed8; }
    
    .inventory-table { width: 100%; border-collapse: collapse; }
    .inventory-table th { 
      text-align: left; padding: 8px 12px; color: #64748b; font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #334155;
    }
    .inventory-table td { 
      padding: 10px 12px; border-bottom: 1px solid #1e293b; font-size: 0.85rem;
    }
    .inventory-table tr.removed td { text-decoration: line-through; color: #64748b; }
    .inventory-table tr.flash { animation: flash 0.5s ease; }
    @keyframes flash { 0% { background: rgba(56, 189, 248, 0.15); } 100% { background: transparent; } }
    
    .btn-sm {
      padding: 4px 10px; font-size: 0.75rem; border: 1px solid #475569;
      background: transparent; color: #94a3b8; border-radius: 4px; cursor: pointer;
    }
    .btn-sm:hover { background: #334155; color: #e2e8f0; }
    .btn-sm.danger { border-color: #dc2626; color: #fca5a5; }
    .btn-sm.danger:hover { background: #7f1d1d; }
    
    .log-panel { max-height: 180px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; }
    .log-entry { padding: 3px 0; color: #64748b; }
    .log-entry.event { color: #38bdf8; }
    .log-entry.error { color: #f87171; }
    .log-entry .time { color: #475569; margin-right: 8px; }
    
    .empty-state { color: #475569; font-style: italic; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔄 Collaborative Inventory</h1>
    <p class="subtitle">CRDT Sync Engine Demo — Open this page in multiple tabs to collaborate in real-time</p>
    
    <div class="status-bar">
      <span class="status-dot disconnected" id="status-dot"></span>
      <span id="status-text">Connecting...</span>
      <span class="user-badge me" id="my-badge">—</span>
      <div class="presence-list" id="presence-list"></div>
    </div>
    
    <div class="panel">
      <h2>Add Item</h2>
      <div class="add-form">
        <input type="text" id="item-name" placeholder="Item name" maxlength="100">
        <input type="number" id="item-qty" placeholder="Quantity" min="0" max="10000" value="1">
        <button onclick="addItem()">Add to Inventory</button>
      </div>
    </div>
    
    <div class="panel">
      <h2>Shared Inventory</h2>
      <table class="inventory-table">
        <thead><tr><th>Item</th><th>Quantity</th><th>Last Updated By</th><th>Actions</th></tr></thead>
        <tbody id="inventory-body">
          <tr><td colspan="4" class="empty-state">No items yet. Add one above!</td></tr>
        </tbody>
      </table>
    </div>
    
    <div class="panel">
      <h2>Event Log</h2>
      <div class="log-panel" id="log-panel"></div>
    </div>
  </div>

  <script>
    // ─── State ──────────────────────────────────────────────────────
    const userId = 'user-' + Math.random().toString(36).slice(2, 8);
    const displayNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank'];
    const displayName = displayNames[Math.floor(Math.random() * displayNames.length)];
    const replicaId = userId;
    let ws = null;
    let inventory = {}; // itemId -> { name, quantity, removedAt, lastUpdatedBy }
    let connected = false;
    let opCounter = 0;

    document.getElementById('my-badge').textContent = displayName;

    // ─── WebSocket Connection ───────────────────────────────────────
    function connect() {
      const token = new URLSearchParams(window.location.search).get('token') 
        || ''; // Token will be fetched from server
      
      // Get a token from the server's /token endpoint
      fetch('/token?userId=' + userId + '&displayName=' + displayName)
        .then(r => r.json())
        .then(data => {
          ws = new WebSocket('ws://' + location.host + '?token=' + data.token);
          
          ws.onopen = () => {
            connected = true;
            document.getElementById('status-dot').className = 'status-dot connected';
            document.getElementById('status-text').textContent = 'Connected';
            log('Connected as ' + displayName, 'event');
          };
          
          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
          };
          
          ws.onclose = () => {
            connected = false;
            document.getElementById('status-dot').className = 'status-dot disconnected';
            document.getElementById('status-text').textContent = 'Disconnected — reconnecting...';
            log('Disconnected', 'error');
            setTimeout(connect, 2000);
          };
        });
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'ack':
          log('ACK: ' + msg.operationId?.slice(0, 8));
          break;
        case 'delta':
          handleDelta(msg.payload);
          break;
        case 'presence-join':
          log(msg.user?.displayName + ' joined', 'event');
          updatePresence();
          break;
        case 'presence-leave':
          log(msg.userId + ' left', 'event');
          updatePresence();
          break;
        case 'presence-list':
          renderPresence(msg.users || []);
          break;
        case 'error':
          log('Error: ' + msg.message, 'error');
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    }

    function handleDelta(delta) {
      if (!delta || !delta.changes) return;
      for (const change of delta.changes) {
        if (change.type === 'added') {
          inventory[change.itemId] = {
            name: change.fields?.name || change.itemId,
            quantity: change.fields?.quantity ?? 0,
            removedAt: null,
            lastUpdatedBy: 'remote'
          };
          log('Item added: ' + (change.fields?.name || change.itemId), 'event');
        } else if (change.type === 'updated') {
          if (inventory[change.itemId]) {
            if (change.fields?.name !== undefined) inventory[change.itemId].name = change.fields.name;
            if (change.fields?.quantity !== undefined) inventory[change.itemId].quantity = change.fields.quantity;
            inventory[change.itemId].lastUpdatedBy = 'remote';
          }
          log('Item updated: ' + change.itemId, 'event');
        } else if (change.type === 'removed') {
          if (inventory[change.itemId]) {
            inventory[change.itemId].removedAt = Date.now();
            inventory[change.itemId].lastUpdatedBy = 'remote';
          }
          log('Item removed: ' + change.itemId, 'event');
        }
        renderInventory(change.itemId);
      }
    }

    // ─── Operations ─────────────────────────────────────────────────
    function addItem() {
      const nameEl = document.getElementById('item-name');
      const qtyEl = document.getElementById('item-qty');
      const name = nameEl.value.trim();
      const quantity = parseInt(qtyEl.value) || 1;
      
      if (!name) { nameEl.focus(); return; }
      if (quantity < 0 || quantity > 10000) { alert('Quantity must be 0-10,000'); return; }
      
      const itemId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
      const opId = userId + '-op-' + (++opCounter);
      
      // Apply locally
      inventory[itemId] = { name, quantity, removedAt: null, lastUpdatedBy: displayName };
      renderInventory(itemId);
      
      // Send to server
      ws.send(JSON.stringify({
        type: 'operation',
        payload: {
          id: opId,
          sessionId: '${SESSION_ID}',
          replicaId: replicaId,
          type: 'add',
          itemId: itemId,
          payload: { name, quantity },
          timestamp: { wallTime: Date.now(), logical: opCounter, nodeId: replicaId },
          version: 0
        }
      }));
      
      log('Added: ' + name + ' (qty: ' + quantity + ')');
      nameEl.value = '';
      qtyEl.value = '1';
      nameEl.focus();
    }

    function updateQuantity(itemId, delta) {
      const item = inventory[itemId];
      if (!item || item.removedAt) return;
      
      const newQty = Math.max(0, Math.min(10000, item.quantity + delta));
      item.quantity = newQty;
      item.lastUpdatedBy = displayName;
      renderInventory(itemId);
      
      const opId = userId + '-op-' + (++opCounter);
      ws.send(JSON.stringify({
        type: 'operation',
        payload: {
          id: opId,
          sessionId: '${SESSION_ID}',
          replicaId: replicaId,
          type: 'update',
          itemId: itemId,
          payload: { quantity: newQty },
          timestamp: { wallTime: Date.now(), logical: opCounter, nodeId: replicaId },
          version: 0
        }
      }));
      log('Updated ' + item.name + ' qty to ' + newQty);
    }

    function removeItem(itemId) {
      const item = inventory[itemId];
      if (!item) return;
      
      item.removedAt = Date.now();
      item.lastUpdatedBy = displayName;
      renderInventory(itemId);
      
      const opId = userId + '-op-' + (++opCounter);
      ws.send(JSON.stringify({
        type: 'operation',
        payload: {
          id: opId,
          sessionId: '${SESSION_ID}',
          replicaId: replicaId,
          type: 'remove',
          itemId: itemId,
          payload: {},
          timestamp: { wallTime: Date.now(), logical: opCounter, nodeId: replicaId },
          version: 0
        }
      }));
      log('Removed: ' + item.name);
    }

    // ─── Rendering ──────────────────────────────────────────────────
    function renderInventory(flashItemId) {
      const tbody = document.getElementById('inventory-body');
      const activeItems = Object.entries(inventory).filter(([_, item]) => !item.removedAt);
      const removedItems = Object.entries(inventory).filter(([_, item]) => item.removedAt);
      
      if (activeItems.length === 0 && removedItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No items yet. Add one above!</td></tr>';
        return;
      }
      
      let html = '';
      for (const [id, item] of activeItems) {
        const flash = id === flashItemId ? ' flash' : '';
        html += '<tr class="' + flash + '">'
          + '<td>' + escHtml(item.name) + '</td>'
          + '<td>'
          + '<button class="btn-sm" onclick="updateQuantity(\\''+id+'\\', -1)">−</button> '
          + item.quantity
          + ' <button class="btn-sm" onclick="updateQuantity(\\''+id+'\\', 1)">+</button>'
          + '</td>'
          + '<td style="color:#64748b">' + escHtml(item.lastUpdatedBy) + '</td>'
          + '<td><button class="btn-sm danger" onclick="removeItem(\\''+id+'\\')">Remove</button></td>'
          + '</tr>';
      }
      for (const [id, item] of removedItems) {
        html += '<tr class="removed"><td>' + escHtml(item.name) + '</td><td>' + item.quantity + '</td><td style="color:#64748b">' + escHtml(item.lastUpdatedBy) + '</td><td><em>removed</em></td></tr>';
      }
      tbody.innerHTML = html;
    }

    function updatePresence() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'presence-request' }));
      }
    }

    function renderPresence(users) {
      const el = document.getElementById('presence-list');
      el.innerHTML = users
        .filter(u => u.userId !== userId)
        .map(u => '<span class="user-badge">' + escHtml(u.displayName) + '</span>')
        .join('');
    }

    function log(text, type) {
      const panel = document.getElementById('log-panel');
      const time = new Date().toLocaleTimeString();
      const cls = type ? ' ' + type : '';
      panel.innerHTML = '<div class="log-entry' + cls + '"><span class="time">' + time + '</span>' + escHtml(text) + '</div>' + panel.innerHTML;
      if (panel.children.length > 50) panel.removeChild(panel.lastChild);
    }

    function escHtml(s) { 
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); 
    }

    // Enter key support for add form
    document.getElementById('item-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });
    document.getElementById('item-qty').addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });

    // Start connection
    connect();
    // Refresh presence every 5s
    setInterval(updatePresence, 5000);
  </script>
</body>
</html>`;

// ─── Server Setup ──────────────────────────────────────────────────────

async function main() {
  const persistence = new InMemoryPersistenceLayer();
  const syncEngine = new SyncEngine(persistence);

  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname === "/token") {
      // Token endpoint — generates a JWT for the requesting user
      const userId = url.searchParams.get("userId") || "anon";
      const displayName = url.searchParams.get("displayName") || "Anonymous";
      const token = jwt.sign(
        { userId, displayName, sessionId: SESSION_ID },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ token }));
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const connectionManager = new ConnectionManager({
    jwtSecret: JWT_SECRET,
    maxConnectionsPerSession: 50,
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 10000,
  });

  // Wire operation routing
  connectionManager.onOperation = async (clientId, operation) => {
    const result = await syncEngine.processOperation(operation);

    if (result.success) {
      connectionManager.sendToClient(clientId, {
        type: "ack",
        operationId: result.operationId,
      });
      if (result.delta) {
        connectionManager.broadcastDelta(operation.sessionId, result.delta, clientId);
      }
    } else {
      connectionManager.sendToClient(clientId, {
        type: "error",
        operationId: result.operationId,
        code: result.error?.code ?? "operation_failed",
        message: result.error?.message ?? "Failed to process operation",
      });
    }
  };

  connectionManager.start(httpServer);

  httpServer.listen(PORT, () => {
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║  Collaborative Inventory — CRDT Sync Engine Demo         ║");
    console.log("╠═══════════════════════════════════════════════════════════╣");
    console.log("║                                                           ║");
    console.log(`║  🌐 Open in browser: http://localhost:${PORT}              ║`);
    console.log("║                                                           ║");
    console.log("║  Open multiple tabs to see real-time collaboration!       ║");
    console.log("║  Each tab gets a random user identity.                    ║");
    console.log("║                                                           ║");
    console.log("║  Press Ctrl+C to stop the server.                         ║");
    console.log("║                                                           ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log("");
  });

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await connectionManager.stop();
    httpServer.close();
    process.exit(0);
  });
}

main().catch(console.error);
