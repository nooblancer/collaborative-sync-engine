"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MonitorSmartphone,
  Plus,
  Trash2,
  ArrowLeftRight,
  Activity,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ConnectionIndicator } from "@/components/ui/connection-indicator";
import { cn } from "@/lib/utils";
import { BACKEND_URL, WS_URL } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WsStatus = "connected" | "disconnected" | "reconnecting";

interface SyncItem {
  id: string;
  label: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_COLORS = [
  "bg-accent/20 border-accent/40",
  "bg-purple-500/20 border-purple-500/40",
  "bg-emerald-500/20 border-emerald-500/40",
  "bg-amber-500/20 border-amber-500/40",
  "bg-rose-500/20 border-rose-500/40",
  "bg-sky-500/20 border-sky-500/40",
];

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickColor(): string {
  return ITEM_COLORS[Math.floor(Math.random() * ITEM_COLORS.length)];
}

const ITEM_LABELS = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon",
  "Zeta", "Eta", "Theta", "Iota", "Kappa",
  "Lambda", "Mu", "Nu", "Xi", "Omicron",
];

function pickLabel(): string {
  return ITEM_LABELS[Math.floor(Math.random() * ITEM_LABELS.length)];
}

// ---------------------------------------------------------------------------
// useSplitPanelConnection hook — manages one independent WebSocket connection
// ---------------------------------------------------------------------------

function useSplitPanelConnection(
  panelLabel: string,
  roomId: string,
  onSyncOp: () => void
) {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [items, setItems] = useState<SyncItem[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const clientIdRef = useRef(`${panelLabel}-${generateId()}`);
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomJoinedRef = useRef(false);

  const connect = useCallback(async () => {
    try {
      roomJoinedRef.current = false;
      const userId = clientIdRef.current;
      const displayName = `Panel ${panelLabel}`;
      const tokenUrl = `${BACKEND_URL}/token?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}`;
      const res = await fetch(tokenUrl);
      if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
      const { token } = await res.json();

      if (!mountedRef.current) return;

      const wsUrl = WS_URL.replace(/^http/, "ws");
      const ws = new WebSocket(`${wsUrl}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        // V2 protocol: only set internal state on open.
        // Do NOT send any commands until we receive the server's "connected" ack.
        setStatus("reconnecting");
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const frame = JSON.parse(event.data);

          // Auto-respond to ping
          if (frame.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }

          // V2 protocol: wait for server's connected acknowledgment before joining room
          if (
            frame.type === "control-response" &&
            frame.payload?.type === "connected" &&
            !roomJoinedRef.current
          ) {
            // Server has acknowledged the connection — now send join-room
            roomJoinedRef.current = true;
            const joinCmd = {
              channel: "control" as const,
              roomId,
              seq: seqRef.current++,
              payload: { type: "join-room", roomId },
            };
            ws.send(JSON.stringify(joinCmd));
            return;
          }

          // Handle room join confirmation — mark as fully connected
          if (
            frame.type === "control-response" &&
            (frame.payload?.type === "room-joined" || frame.payload?.type === "join-room")
          ) {
            setStatus("connected");
          }

          // Handle state snapshot on join (initial state)
          if (frame.type === "control-response" && frame.payload?.state) {
            setStatus("connected");
            const state = frame.payload.state;
            if (state.items && Array.isArray(state.items)) {
              setItems(state.items);
            }
          }

          // Handle delta / operation broadcast from other clients
          if (frame.type === "delta" && frame.payload) {
            const payload = frame.payload;
            
            // Handle V2 delta format: { changes: [{ itemId, type, fields }] }
            if (payload.changes && Array.isArray(payload.changes)) {
              for (const change of payload.changes) {
                if ((change.type === "added" || change.type === "add") && change.fields) {
                  // Extract item data from fields (may be LWW registers or plain values)
                  const fields = change.fields;
                  const extractValue = (f: any) => f?.value !== undefined ? f.value : f;
                  
                  // Try to get the nested item object first (we store it in the 'item' field)
                  const nestedItem = extractValue(fields.item);
                  const item: SyncItem = nestedItem && nestedItem.id ? nestedItem : {
                    id: change.itemId,
                    label: extractValue(fields.name) || change.itemId,
                    color: extractValue(fields.color) || pickColor(),
                  };
                  
                  setItems((prev) => {
                    if (prev.find((i) => i.id === item.id)) return prev;
                    return [...prev, item];
                  });
                  onSyncOp();
                } else if (change.type === "removed" || change.type === "remove") {
                  setItems((prev) => prev.filter((i) => i.id !== change.itemId));
                  onSyncOp();
                }
              }
            }
            
            // Legacy format fallback
            if (payload.operationType === "add-item" && payload.item) {
              setItems((prev) => {
                if (prev.find((i) => i.id === payload.item.id)) return prev;
                return [...prev, payload.item];
              });
              onSyncOp();
            } else if (payload.operationType === "remove-item" && payload.itemId) {
              setItems((prev) => prev.filter((i) => i.id !== payload.itemId));
              onSyncOp();
            }
          }

          // Handle ACK with state update
          if (frame.type === "ack" && frame.payload) {
            const payload = frame.payload;
            if (payload.operationType === "add-item" && payload.item) {
              setItems((prev) => {
                if (prev.find((i) => i.id === payload.item.id)) return prev;
                return [...prev, payload.item];
              });
            } else if (payload.operationType === "remove-item" && payload.itemId) {
              setItems((prev) => prev.filter((i) => i.id !== payload.itemId));
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        wsRef.current = null;
        roomJoinedRef.current = false;
        setStatus("reconnecting");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire, handling reconnect
      };
    } catch {
      if (!mountedRef.current) return;
      setStatus("reconnecting");
      scheduleReconnect();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, panelLabel]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connect();
    }, 2000);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const addItems = useCallback((count: number = 1) => {
    const newItems: SyncItem[] = [];
    for (let i = 0; i < count; i++) {
      newItems.push({
        id: generateId(),
        label: pickLabel(),
        color: pickColor(),
      });
    }
    // Optimistically add locally
    setItems((prev) => [...prev, ...newItems]);

    // Send to backend
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      for (const item of newItems) {
        const frame = {
          channel: "ops",
          roomId,
          seq: seqRef.current++,
          payload: {
            id: generateId(),
            type: "add",
            itemId: item.id,
            payload: { name: item.label, color: item.color, item },
            timestamp: { wallTime: Date.now(), logical: 0, nodeId: clientIdRef.current },
            version: 1,
          },
        };
        wsRef.current.send(JSON.stringify(frame));
      }
      onSyncOp();
    }
  }, [roomId, onSyncOp]);

  const removeItem = useCallback((itemId: string) => {
    // Optimistically remove locally
    setItems((prev) => prev.filter((i) => i.id !== itemId));

    // Send to backend
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const frame = {
        channel: "ops",
        roomId,
        seq: seqRef.current++,
        payload: {
          id: generateId(),
          type: "remove",
          itemId,
          payload: {},
          timestamp: { wallTime: Date.now(), logical: 0, nodeId: clientIdRef.current },
          version: 1,
        },
      };
      wsRef.current.send(JSON.stringify(frame));
      onSyncOp();
    }
  }, [roomId, onSyncOp]);

  const removeAllItems = useCallback(() => {
    const currentItems = [...items];
    setItems([]);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      for (const item of currentItems) {
        const frame = {
          channel: "ops",
          roomId,
          seq: seqRef.current++,
          payload: {
            id: generateId(),
            type: "remove",
            itemId: item.id,
            payload: {},
            timestamp: { wallTime: Date.now(), logical: 0, nodeId: clientIdRef.current },
            version: 1,
          },
        };
        wsRef.current.send(JSON.stringify(frame));
      }
      onSyncOp();
    }
  }, [roomId, items, onSyncOp]);

  return {
    status,
    items,
    clientId: clientIdRef.current,
    addItems,
    removeItem,
    removeAllItems,
  };
}

// ---------------------------------------------------------------------------
// SyncPanel sub-component — renders one side of the split screen
// ---------------------------------------------------------------------------

interface SyncPanelProps {
  label: string;
  status: WsStatus;
  items: SyncItem[];
  onAdd: (count: number) => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
}

function SyncPanel({ label, status, items, onAdd, onRemove, onRemoveAll }: SyncPanelProps) {
  const [addCount, setAddCount] = useState(1);

  // Adaptive layout: grid columns based on item count
  const getGridClass = () => {
    if (items.length <= 5) return "";  // single column list
    if (items.length <= 20) return "grid grid-cols-2 gap-1.5";
    return "grid grid-cols-3 gap-1";
  };

  const isCompact = items.length > 10;

  return (
    <GlassCard variant="default" padding="default" className="flex-1 min-w-0">
      {/* Panel Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>
        <ConnectionIndicator status={status} label={status} size="sm" />
      </div>

      {/* Add/Remove Controls */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => onAdd(addCount)}
          disabled={status !== "connected"}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all",
            "border border-dashed",
            status === "connected"
              ? "border-accent/30 text-accent hover:bg-accent/10 hover:border-accent/50"
              : "border-border text-foreground-dim cursor-not-allowed opacity-50"
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add {addCount > 1 ? `${addCount} Cards` : "Card"}
        </button>
        <input
          type="number"
          min={1}
          max={100}
          value={addCount}
          onChange={(e) => setAddCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
          disabled={status !== "connected"}
          className={cn(
            "w-14 px-2 py-2 rounded-lg text-sm text-center font-mono",
            "bg-background-surface border border-border",
            "text-foreground focus:border-accent/50 focus:outline-none",
            status !== "connected" && "opacity-50 cursor-not-allowed"
          )}
        />
        {items.length > 0 && (
          <button
            onClick={onRemoveAll}
            disabled={status !== "connected"}
            className={cn(
              "px-3 py-2 rounded-lg text-sm transition-all border",
              status === "connected"
                ? "border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                : "border-border text-foreground-dim cursor-not-allowed opacity-50"
            )}
            title="Remove all cards"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Items List/Grid */}
      <div className={cn("max-h-64 overflow-y-auto scrollbar-thin", getGridClass() || "space-y-2")}>
        {items.length === 0 && (
          <div className="text-center text-foreground-dim text-xs py-6">
            No cards yet — click Add Card to start
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center justify-between rounded-lg border transition-all animate-fade-in",
              isCompact ? "px-2 py-1" : "px-3 py-2",
              item.color
            )}
          >
            <span className={cn("text-foreground truncate", isCompact ? "text-xs" : "text-sm")}>
              {item.label}
            </span>
            <button
              onClick={() => onRemove(item.id)}
              className="text-foreground-dim hover:text-destructive transition-colors shrink-0 ml-1"
              aria-label={`Remove ${item.label}`}
            >
              <Trash2 className={cn(isCompact ? "h-3 w-3" : "h-3.5 w-3.5")} />
            </button>
          </div>
        ))}
      </div>

      {/* Item Count */}
      <div className="mt-3 pt-3 border-t border-border text-xs text-foreground-muted text-center">
        {items.length} {items.length === 1 ? "card" : "cards"}
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// OpsCounter sub-component — shows live synced ops/sec between panels
// ---------------------------------------------------------------------------

function OpsCounter({ opsPerSecond }: { opsPerSecond: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4">
      <ArrowLeftRight className="h-5 w-5 text-accent animate-pulse-glow" />
      <div className="text-center">
        <div className="text-lg font-bold font-mono text-accent tabular-nums">
          {opsPerSecond}
        </div>
        <div className="text-[10px] text-foreground-muted uppercase tracking-wide">
          ops/sec
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SplitScreenDemo Component
// ---------------------------------------------------------------------------

export default function SplitScreenDemo() {
  const [roomId] = useState(() => `split-room-${generateId()}`);
  const [opsPerSecond, setOpsPerSecond] = useState(0);

  // Track ops in a sliding window
  const opsTimestampsRef = useRef<number[]>([]);
  const opsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recordOp = useCallback(() => {
    opsTimestampsRef.current.push(Date.now());
  }, []);

  // Calculate ops/sec every 500ms
  useEffect(() => {
    opsIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const oneSecondAgo = now - 1000;
      // Prune old timestamps
      opsTimestampsRef.current = opsTimestampsRef.current.filter(
        (t) => t > oneSecondAgo
      );
      setOpsPerSecond(opsTimestampsRef.current.length);
    }, 500);

    return () => {
      if (opsIntervalRef.current) clearInterval(opsIntervalRef.current);
    };
  }, []);

  // Create the shared room before panels connect
  useEffect(() => {
    async function createRoom() {
      try {
        const userId = `room-creator-${generateId()}`;
        const tokenUrl = `${BACKEND_URL}/token?userId=${encodeURIComponent(userId)}&displayName=RoomCreator`;
        const res = await fetch(tokenUrl);
        if (!res.ok) return;
        const { token } = await res.json();

        const wsUrl = WS_URL.replace(/^http/, "ws");
        const ws = new WebSocket(`${wsUrl}?token=${token}`);
        let roomCreated = false;

        ws.onopen = () => {
          // V2 protocol: do NOT send commands on open.
          // Wait for the server's connected ack in onmessage.
        };

        ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data);

            if (frame.type === "ping") {
              ws.send(JSON.stringify({ type: "pong" }));
              return;
            }

            // V2 protocol: wait for connected ack before sending create-room
            if (
              frame.type === "control-response" &&
              frame.payload?.type === "connected" &&
              !roomCreated
            ) {
              roomCreated = true;
              const createCmd = {
                channel: "control",
                roomId,
                seq: 0,
                payload: { type: "create-room" },
              };
              ws.send(JSON.stringify(createCmd));
              return;
            }

            // Once room is created, close the bootstrap connection
            if (
              frame.type === "control-response" &&
              (frame.payload?.type === "room-created" || frame.payload?.type === "create-room")
            ) {
              ws.close();
              return;
            }

            // Fallback: close after create-room response (any control-response after room creation)
            if (roomCreated && frame.type === "control-response") {
              ws.close();
            }
          } catch {
            // ignore
          }
        };

        ws.onerror = () => {
          // If we can't create the room, panels will still attempt to connect
        };
      } catch {
        // Allow panels to attempt connection regardless
      }
    }

    createRoom();
  }, [roomId]);

  // Panel connections — only connect after room is created
  const leftPanel = useSplitPanelConnection("Left", roomId, recordOp);
  const rightPanel = useSplitPanelConnection("Right", roomId, recordOp);

  return (
    <section id="split-screen" className="w-full max-w-5xl mx-auto px-4 py-12 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="h-6 w-6 text-accent" />
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Split-Screen Sync
        </h2>
      </div>

      <div className="flex items-center gap-3">
        <p className="text-sm text-foreground-muted max-w-2xl">
          Two independent clients connected to the same room. Add or remove cards in
          either panel and watch them sync in real-time through the backend.
        </p>
        <a
          href="#architecture"
          className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent/80 transition-colors shrink-0"
        >
          Learn More →
        </a>
      </div>

      {/* Split Screen Layout */}
      <div className="flex items-stretch gap-0">
        {/* Left Panel */}
        <SyncPanel
          label="Client A"
          status={leftPanel.status}
          items={leftPanel.items}
          onAdd={leftPanel.addItems}
          onRemove={leftPanel.removeItem}
          onRemoveAll={leftPanel.removeAllItems}
        />

        {/* Center Counter */}
        <OpsCounter opsPerSecond={opsPerSecond} />

        {/* Right Panel */}
        <SyncPanel
          label="Client B"
          status={rightPanel.status}
          items={rightPanel.items}
          onAdd={rightPanel.addItems}
          onRemove={rightPanel.removeItem}
          onRemoveAll={rightPanel.removeAllItems}
        />
      </div>

      {/* Footer Info */}
      <GlassCard variant="subtle" padding="sm">
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <Activity className="h-3.5 w-3.5 text-accent" />
          <span>
            Each panel maintains its own WebSocket connection. Operations travel:
            Client → Server → CRDT Merge → Broadcast → Other Client.
          </span>
        </div>
      </GlassCard>
    </section>
  );
}
