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

  const connect = useCallback(async () => {
    try {
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
        setStatus("connected");

        // Join the shared room
        const joinCmd = {
          channel: "control" as const,
          roomId,
          seq: seqRef.current++,
          payload: { type: "join-room", roomId },
        };
        ws.send(JSON.stringify(joinCmd));
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

          // Handle state snapshot on join (initial state)
          if (frame.type === "control-response" && frame.payload?.state) {
            const state = frame.payload.state;
            if (state.items && Array.isArray(state.items)) {
              setItems(state.items);
            }
          }

          // Handle delta / operation broadcast
          if (frame.type === "delta" && frame.payload) {
            const payload = frame.payload;
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

  const addItem = useCallback(() => {
    const item: SyncItem = {
      id: generateId(),
      label: pickLabel(),
      color: pickColor(),
    };
    // Optimistically add locally
    setItems((prev) => [...prev, item]);

    // Send to backend
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const frame = {
        channel: "ops",
        roomId,
        seq: seqRef.current++,
        payload: {
          id: generateId(),
          type: "create",
          itemId: item.id,
          payload: { item },
          operationType: "add-item",
          timestamp: { wallTime: Date.now(), logical: 0, nodeId: clientIdRef.current },
          version: 1,
        },
      };
      wsRef.current.send(JSON.stringify(frame));
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
          type: "delete",
          itemId,
          payload: {},
          operationType: "remove-item",
          timestamp: { wallTime: Date.now(), logical: 0, nodeId: clientIdRef.current },
          version: 1,
        },
      };
      wsRef.current.send(JSON.stringify(frame));
      onSyncOp();
    }
  }, [roomId, onSyncOp]);

  return {
    status,
    items,
    clientId: clientIdRef.current,
    addItem,
    removeItem,
  };
}

// ---------------------------------------------------------------------------
// SyncPanel sub-component — renders one side of the split screen
// ---------------------------------------------------------------------------

interface SyncPanelProps {
  label: string;
  status: WsStatus;
  items: SyncItem[];
  onAdd: () => void;
  onRemove: (id: string) => void;
}

function SyncPanel({ label, status, items, onAdd, onRemove }: SyncPanelProps) {
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

      {/* Add Item Button */}
      <button
        onClick={onAdd}
        disabled={status !== "connected"}
        className={cn(
          "w-full mb-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all",
          "border border-dashed",
          status === "connected"
            ? "border-accent/30 text-accent hover:bg-accent/10 hover:border-accent/50"
            : "border-border text-foreground-dim cursor-not-allowed opacity-50"
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Add Card
      </button>

      {/* Items List */}
      <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
        {items.length === 0 && (
          <div className="text-center text-foreground-dim text-xs py-6">
            No cards yet — click Add Card to start
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center justify-between px-3 py-2 rounded-lg border transition-all animate-fade-in",
              item.color
            )}
          >
            <span className="text-sm text-foreground truncate">{item.label}</span>
            <button
              onClick={() => onRemove(item.id)}
              className="text-foreground-dim hover:text-destructive transition-colors shrink-0 ml-2"
              aria-label={`Remove ${item.label}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
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

        ws.onopen = () => {
          // Create the room
          const createCmd = {
            channel: "control",
            roomId,
            seq: 0,
            payload: { type: "create-room" },
          };
          ws.send(JSON.stringify(createCmd));
          // Give server time to create, then close this bootstrap connection
          setTimeout(() => {
            ws.close();
          }, 200);
        };

        ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data);
            if (frame.type === "ping") {
              ws.send(JSON.stringify({ type: "pong" }));
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
    <section className="w-full max-w-5xl mx-auto px-4 py-12 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="h-6 w-6 text-accent" />
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Split-Screen Sync
        </h2>
      </div>

      <p className="text-sm text-foreground-muted max-w-2xl">
        Two independent clients connected to the same room. Add or remove cards in
        either panel and watch them sync in real-time through the backend.
      </p>

      {/* Split Screen Layout */}
      <div className="flex items-stretch gap-0">
        {/* Left Panel */}
        <SyncPanel
          label="Client A"
          status={leftPanel.status}
          items={leftPanel.items}
          onAdd={leftPanel.addItem}
          onRemove={leftPanel.removeItem}
        />

        {/* Center Counter */}
        <OpsCounter opsPerSecond={opsPerSecond} />

        {/* Right Panel */}
        <SyncPanel
          label="Client B"
          status={rightPanel.status}
          items={rightPanel.items}
          onAdd={rightPanel.addItem}
          onRemove={rightPanel.removeItem}
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
