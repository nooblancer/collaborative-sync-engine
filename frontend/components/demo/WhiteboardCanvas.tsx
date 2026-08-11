"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Pencil, Square, Circle, MousePointer, Trash2 } from "lucide-react";
import { WS_URL, BACKEND_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

// --- Types ---

interface HLCTimestamp {
  wallTime: number;
  logical: number;
  nodeId: string;
}

interface CanvasObject {
  id: string;
  type: "rectangle" | "circle" | "freehand";
  position: { x: number; y: number };
  dimensions?: { width: number; height: number };
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  style: { fill: string; stroke: string; strokeWidth: number };
  createdBy: string;
  createdAt: HLCTimestamp;
}

interface RemoteCursor {
  clientId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  lastUpdate: number;
}

type Tool = "select" | "freehand" | "rectangle" | "circle";

interface WhiteboardCanvasProps {
  roomId?: string;
  width?: number;
  height?: number;
  className?: string;
}

// --- Constants ---

const CURSOR_COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3",
  "#54a0ff", "#5f27cd", "#01a3a4", "#f368e0",
];

const CURSOR_TIMEOUT_MS = 5000;
const AWARENESS_INTERVAL_MS = 16; // ~60fps
const DEFAULT_ROOM = "whiteboard-demo";

// --- Utility: generate unique ID ---
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// --- Utility: generate HLC timestamp ---
function makeHLC(nodeId: string): HLCTimestamp {
  return { wallTime: Date.now(), logical: 0, nodeId };
}

// --- Utility: get session identity ---
function getSessionIdentity(): { userId: string; displayName: string; color: string } {
  const storageKey = "whiteboard-user-identity";
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      try { return JSON.parse(stored); } catch { /* regenerate */ }
    }
  }
  const userId = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const adjectives = ["Swift", "Bright", "Calm", "Bold", "Keen", "Quick", "Warm"];
  const nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk", "Deer", "Lynx"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const displayName = `${adj}${noun}${Math.floor(Math.random() * 100)}`;
  const color = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
  const identity = { userId, displayName, color };
  if (typeof window !== "undefined") {
    sessionStorage.setItem(storageKey, JSON.stringify(identity));
  }
  return identity;
}

// --- Main Component ---

export function WhiteboardCanvas({
  roomId = DEFAULT_ROOM,
  width = 900,
  height = 600,
  className,
}: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const awarenessTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [tool, setTool] = useState<Tool>("freehand");
  const [objects, setObjects] = useState<CanvasObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "disconnected" | "reconnecting">("disconnected");

  const identityRef = useRef(getSessionIdentity());
  const objectsRef = useRef<CanvasObject[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const remoteCursorsRef = useRef<Map<string, RemoteCursor>>(new Map());

  // Drawing state (not in React state for performance)
  const drawingRef = useRef(false);
  const dragRef = useRef<{ offsetX: number; offsetY: number; objectId: string } | null>(null);
  const resizeRef = useRef<{ objectId: string; startX: number; startY: number } | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const freehandPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Keep refs in sync with state
  useEffect(() => { objectsRef.current = objects; }, [objects]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { remoteCursorsRef.current = remoteCursors; }, [remoteCursors]);

  // --- WebSocket connection ---

  const sendFrame = useCallback((channel: string, payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const frame = {
      channel,
      roomId,
      seq: seqRef.current++,
      payload,
    };
    ws.send(JSON.stringify(frame));
  }, [roomId]);

  const sendOperation = useCallback((op: {
    type: string;
    itemId: string;
    payload: Record<string, unknown>;
  }) => {
    const identity = identityRef.current;
    sendFrame("ops", {
      id: generateId(),
      type: op.type,
      itemId: op.itemId,
      payload: op.payload,
      timestamp: makeHLC(identity.userId),
      version: 1,
    });
  }, [sendFrame]);

  const sendAwareness = useCallback((x: number, y: number) => {
    const identity = identityRef.current;
    sendFrame("awareness", {
      clientId: identity.userId,
      cursor: { x, y },
      displayName: identity.displayName,
      color: identity.color,
    });
  }, [sendFrame]);

  // --- Handle incoming messages ---

  const handleServerFrame = useCallback((data: string) => {
    let frame: { channel: string; type: string; payload: unknown };
    try { frame = JSON.parse(data); } catch { return; }

    if (frame.channel === "ops") {
      if (frame.type === "delta") {
        const delta = frame.payload as {
          changes?: Array<{
            type: string;
            itemId: string;
            objectData?: CanvasObject;
            position?: { x: number; y: number };
            dimensions?: { width: number; height: number };
            radius?: number;
          }>;
        };
        if (delta.changes) {
          setObjects(prev => {
            let next = [...prev];
            for (const change of delta.changes!) {
              if (change.type === "added" && change.objectData) {
                const exists = next.find(o => o.id === change.itemId);
                if (!exists) next.push(change.objectData);
              } else if (change.type === "updated") {
                next = next.map(o => {
                  if (o.id !== change.itemId) return o;
                  const updated = { ...o };
                  if (change.position) updated.position = change.position;
                  if (change.dimensions) updated.dimensions = change.dimensions;
                  if (change.radius !== undefined) updated.radius = change.radius;
                  return updated;
                });
              } else if (change.type === "removed") {
                next = next.filter(o => o.id !== change.itemId);
                if (selectedIdRef.current === change.itemId) {
                  setSelectedId(null);
                }
              }
            }
            return next;
          });
        }
      }
    } else if (frame.channel === "awareness" && frame.type === "awareness-update") {
      const update = frame.payload as {
        clientId: string;
        cursor?: { x: number; y: number };
        displayName: string;
        color: string;
      };
      const identity = identityRef.current;
      if (update.clientId === identity.userId) return;
      if (update.cursor) {
        setRemoteCursors(prev => {
          const next = new Map(prev);
          next.set(update.clientId, {
            clientId: update.clientId,
            displayName: update.displayName,
            color: update.color,
            x: update.cursor!.x,
            y: update.cursor!.y,
            lastUpdate: Date.now(),
          });
          return next;
        });
      }
    }
  }, []);

  // --- WebSocket lifecycle ---

  useEffect(() => {
    let mounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        const identity = identityRef.current;
        const tokenUrl = `${BACKEND_URL}/token?userId=${encodeURIComponent(identity.userId)}&displayName=${encodeURIComponent(identity.displayName)}`;
        const resp = await fetch(tokenUrl);
        if (!resp.ok) throw new Error("Token fetch failed");
        const { token } = await resp.json();
        if (!mounted) return;

        const wsUrl = WS_URL.replace(/^http/, "ws");
        const ws = new WebSocket(`${wsUrl}?token=${token}&roomId=${encodeURIComponent(roomId)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted) return;
          setConnectionStatus("connected");
          // Join room via control channel
          const joinFrame = {
            channel: "control",
            roomId,
            seq: seqRef.current++,
            payload: { type: "join-room", roomId },
          };
          ws.send(JSON.stringify(joinFrame));
        };

        ws.onmessage = (event) => {
          if (!mounted) return;
          handleServerFrame(event.data as string);
        };

        ws.onclose = () => {
          if (!mounted) return;
          wsRef.current = null;
          setConnectionStatus("reconnecting");
          reconnectTimer = setTimeout(connect, 2000);
        };

        ws.onerror = () => { /* onclose handles reconnect */ };
      } catch {
        if (!mounted) return;
        setConnectionStatus("reconnecting");
        reconnectTimer = setTimeout(connect, 2000);
      }
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomId, handleServerFrame]);

  // --- Awareness broadcasting at 60fps ---

  useEffect(() => {
    awarenessTimerRef.current = setInterval(() => {
      const { x, y } = mouseRef.current;
      sendAwareness(x, y);
    }, AWARENESS_INTERVAL_MS);

    return () => {
      if (awarenessTimerRef.current) clearInterval(awarenessTimerRef.current);
    };
  }, [sendAwareness]);

  // --- Prune stale cursors ---

  useEffect(() => {
    const pruneInterval = setInterval(() => {
      setRemoteCursors(prev => {
        const now = Date.now();
        const next = new Map(prev);
        let changed = false;
        for (const [id, cursor] of next) {
          if (now - cursor.lastUpdate > CURSOR_TIMEOUT_MS) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(pruneInterval);
  }, []);

  // --- Hit testing ---

  const hitTest = useCallback((x: number, y: number, objs: CanvasObject[]): CanvasObject | null => {
    // Test in reverse order (top-most first)
    for (let i = objs.length - 1; i >= 0; i--) {
      const obj = objs[i];
      if (obj.type === "rectangle") {
        const w = obj.dimensions?.width ?? 100;
        const h = obj.dimensions?.height ?? 80;
        if (x >= obj.position.x && x <= obj.position.x + w &&
            y >= obj.position.y && y <= obj.position.y + h) {
          return obj;
        }
      } else if (obj.type === "circle") {
        const r = obj.radius ?? 40;
        const dx = x - (obj.position.x + r);
        const dy = y - (obj.position.y + r);
        if (dx * dx + dy * dy <= r * r) return obj;
      } else if (obj.type === "freehand" && obj.points && obj.points.length > 1) {
        // Check proximity to path segments
        for (let j = 1; j < obj.points.length; j++) {
          const p1 = obj.points[j - 1];
          const p2 = obj.points[j];
          const dist = distToSegment(x, y, p1.x, p1.y, p2.x, p2.y);
          if (dist < 8) return obj;
        }
      }
    }
    return null;
  }, []);

  // --- Resize handle hit test ---

  const hitResizeHandle = useCallback((x: number, y: number, obj: CanvasObject): boolean => {
    if (obj.type === "freehand") return false;
    let hx: number, hy: number;
    if (obj.type === "rectangle") {
      const w = obj.dimensions?.width ?? 100;
      const h = obj.dimensions?.height ?? 80;
      hx = obj.position.x + w;
      hy = obj.position.y + h;
    } else {
      const r = obj.radius ?? 40;
      hx = obj.position.x + r * 2;
      hy = obj.position.y + r * 2;
    }
    return Math.abs(x - hx) < 8 && Math.abs(y - hy) < 8;
  }, []);

  // --- Mouse handlers ---

  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    mouseRef.current = pos;

    if (tool === "select") {
      const hit = hitTest(pos.x, pos.y, objectsRef.current);
      if (hit) {
        setSelectedId(hit.id);
        // Check for resize handle
        if (hitResizeHandle(pos.x, pos.y, hit)) {
          resizeRef.current = { objectId: hit.id, startX: pos.x, startY: pos.y };
        } else {
          dragRef.current = {
            objectId: hit.id,
            offsetX: pos.x - hit.position.x,
            offsetY: pos.y - hit.position.y,
          };
        }
      } else {
        setSelectedId(null);
      }
    } else {
      drawingRef.current = true;
      drawStartRef.current = pos;
      if (tool === "freehand") {
        freehandPointsRef.current = [pos];
      }
    }
  }, [tool, getCanvasPos, hitTest, hitResizeHandle]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    mouseRef.current = pos;

    if (tool === "select") {
      if (dragRef.current) {
        const { objectId, offsetX, offsetY } = dragRef.current;
        const newX = pos.x - offsetX;
        const newY = pos.y - offsetY;
        setObjects(prev => prev.map(o =>
          o.id === objectId ? { ...o, position: { x: newX, y: newY } } : o
        ));
      } else if (resizeRef.current) {
        const { objectId, startX, startY } = resizeRef.current;
        const dx = pos.x - startX;
        const dy = pos.y - startY;
        setObjects(prev => prev.map(o => {
          if (o.id !== objectId) return o;
          if (o.type === "rectangle") {
            const w = Math.max(20, (o.dimensions?.width ?? 100) + dx);
            const h = Math.max(20, (o.dimensions?.height ?? 80) + dy);
            return { ...o, dimensions: { width: w, height: h } };
          } else if (o.type === "circle") {
            const r = Math.max(10, (o.radius ?? 40) + Math.max(dx, dy) / 2);
            return { ...o, radius: r };
          }
          return o;
        }));
        resizeRef.current = { ...resizeRef.current, startX: pos.x, startY: pos.y };
      }
    } else if (drawingRef.current && tool === "freehand") {
      freehandPointsRef.current.push(pos);
    }
  }, [tool, getCanvasPos]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e);
    const identity = identityRef.current;

    if (tool === "select") {
      if (dragRef.current) {
        const obj = objectsRef.current.find(o => o.id === dragRef.current!.objectId);
        if (obj) {
          sendOperation({
            type: "update",
            itemId: obj.id,
            payload: { position: obj.position },
          });
        }
        dragRef.current = null;
      }
      if (resizeRef.current) {
        const obj = objectsRef.current.find(o => o.id === resizeRef.current!.objectId);
        if (obj) {
          sendOperation({
            type: "update",
            itemId: obj.id,
            payload: {
              dimensions: obj.dimensions,
              radius: obj.radius,
            },
          });
        }
        resizeRef.current = null;
      }
    } else if (drawingRef.current) {
      drawingRef.current = false;
      const start = drawStartRef.current;
      if (!start) return;

      const id = generateId();
      const hlc = makeHLC(identity.userId);
      const defaultStyle = { fill: "rgba(0, 212, 255, 0.1)", stroke: "#00d4ff", strokeWidth: 2 };

      if (tool === "freehand" && freehandPointsRef.current.length > 1) {
        const newObj: CanvasObject = {
          id,
          type: "freehand",
          position: { x: 0, y: 0 },
          points: [...freehandPointsRef.current],
          style: { ...defaultStyle, fill: "transparent" },
          createdBy: identity.userId,
          createdAt: hlc,
        };
        setObjects(prev => [...prev, newObj]);
        sendOperation({
          type: "add",
          itemId: id,
          payload: { objectData: newObj },
        });
        freehandPointsRef.current = [];
      } else if (tool === "rectangle") {
        const w = Math.abs(pos.x - start.x) || 100;
        const h = Math.abs(pos.y - start.y) || 80;
        const x = Math.min(pos.x, start.x);
        const y = Math.min(pos.y, start.y);
        const newObj: CanvasObject = {
          id,
          type: "rectangle",
          position: { x, y },
          dimensions: { width: w, height: h },
          style: defaultStyle,
          createdBy: identity.userId,
          createdAt: hlc,
        };
        setObjects(prev => [...prev, newObj]);
        sendOperation({ type: "add", itemId: id, payload: { objectData: newObj } });
      } else if (tool === "circle") {
        const dx = pos.x - start.x;
        const dy = pos.y - start.y;
        const r = Math.max(Math.sqrt(dx * dx + dy * dy), 20);
        const newObj: CanvasObject = {
          id,
          type: "circle",
          position: { x: start.x - r, y: start.y - r },
          radius: r,
          style: defaultStyle,
          createdBy: identity.userId,
          createdAt: hlc,
        };
        setObjects(prev => [...prev, newObj]);
        sendOperation({ type: "add", itemId: id, payload: { objectData: newObj } });
      }
      drawStartRef.current = null;
    }
  }, [tool, getCanvasPos, sendOperation]);

  // --- Delete handler ---

  const handleDelete = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    setObjects(prev => prev.filter(o => o.id !== id));
    setSelectedId(null);
    sendOperation({ type: "remove", itemId: id, payload: {} });
  }, [sendOperation]);

  // --- Keyboard handler ---

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Only handle if not in an input
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        handleDelete();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleDelete]);

  // --- Canvas rendering loop (60fps) ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function render() {
      if (!ctx || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // Clear with dark background
      ctx.fillStyle = "#0a0a1a";
      ctx.fillRect(0, 0, width, height);

      // Draw grid
      ctx.strokeStyle = "rgba(0, 212, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw objects
      const objs = objectsRef.current;
      for (const obj of objs) {
        drawObject(ctx, obj, obj.id === selectedIdRef.current);
      }

      // Draw in-progress freehand
      if (drawingRef.current && freehandPointsRef.current.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = "#00d4ff";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const pts = freehandPointsRef.current;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
      }

      // Draw in-progress rectangle/circle
      if (drawingRef.current && drawStartRef.current) {
        const start = drawStartRef.current;
        const mouse = mouseRef.current;
        ctx.strokeStyle = "#00d4ff";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        if (tool === "rectangle") {
          const w = mouse.x - start.x;
          const h = mouse.y - start.y;
          ctx.strokeRect(start.x, start.y, w, h);
        } else if (tool === "circle") {
          const dx = mouse.x - start.x;
          const dy = mouse.y - start.y;
          const r = Math.sqrt(dx * dx + dy * dy);
          ctx.beginPath();
          ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Draw remote cursors
      const cursors = remoteCursorsRef.current;
      for (const [, cursor] of cursors) {
        drawCursor(ctx, cursor);
      }

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [width, height, tool]);

  // --- Render UI ---

  const toolButtons: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer size={16} />, label: "Select" },
    { id: "freehand", icon: <Pencil size={16} />, label: "Draw" },
    { id: "rectangle", icon: <Square size={16} />, label: "Rectangle" },
    { id: "circle", icon: <Circle size={16} />, label: "Circle" },
  ];

  return (
    <div className={cn("relative inline-block", className)}>
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-lg bg-background-surface/90 backdrop-blur-sm border border-border px-2 py-1.5">
        {toolButtons.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setTool(id)}
            title={label}
            aria-label={label}
            className={cn(
              "p-2 rounded-md transition-colors",
              tool === id
                ? "bg-accent/20 text-accent shadow-glow-sm"
                : "text-foreground-muted hover:text-foreground hover:bg-accent/5"
            )}
          >
            {icon}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-1" />
        <button
          onClick={handleDelete}
          disabled={!selectedId}
          title="Delete (Del)"
          aria-label="Delete selected object"
          className={cn(
            "p-2 rounded-md transition-colors",
            selectedId
              ? "text-destructive hover:bg-destructive/10"
              : "text-foreground-dim cursor-not-allowed"
          )}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Connection indicator */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-background-surface/90 backdrop-blur-sm border border-border px-3 py-1.5">
        <span className={cn(
          "w-2 h-2 rounded-full",
          connectionStatus === "connected" ? "bg-success" :
          connectionStatus === "reconnecting" ? "bg-warning animate-pulse" :
          "bg-destructive"
        )} />
        <span className="text-xs text-foreground-muted">
          {connectionStatus === "connected" ? "Live" : connectionStatus === "reconnecting" ? "Reconnecting..." : "Offline"}
        </span>
        <span className="text-xs text-foreground-dim">
          {objects.length} obj{objects.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width, height }}
        className="rounded-xl border border-border cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Remote users indicator */}
      {remoteCursors.size > 0 && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1">
          {Array.from(remoteCursors.values()).map(cursor => (
            <div
              key={cursor.clientId}
              className="flex items-center gap-1 rounded-full bg-background-surface/90 backdrop-blur-sm border border-border px-2 py-0.5"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: cursor.color }}
              />
              <span className="text-xs text-foreground-muted">{cursor.displayName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Drawing helpers ---

function drawObject(ctx: CanvasRenderingContext2D, obj: CanvasObject, selected: boolean) {
  ctx.save();

  if (obj.type === "rectangle") {
    const w = obj.dimensions?.width ?? 100;
    const h = obj.dimensions?.height ?? 80;
    ctx.fillStyle = obj.style.fill;
    ctx.strokeStyle = obj.style.stroke;
    ctx.lineWidth = obj.style.strokeWidth;
    ctx.fillRect(obj.position.x, obj.position.y, w, h);
    ctx.strokeRect(obj.position.x, obj.position.y, w, h);

    if (selected) {
      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(obj.position.x - 4, obj.position.y - 4, w + 8, h + 8);
      ctx.setLineDash([]);
      // Resize handle
      drawResizeHandle(ctx, obj.position.x + w, obj.position.y + h);
    }
  } else if (obj.type === "circle") {
    const r = obj.radius ?? 40;
    const cx = obj.position.x + r;
    const cy = obj.position.y + r;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = obj.style.fill;
    ctx.fill();
    ctx.strokeStyle = obj.style.stroke;
    ctx.lineWidth = obj.style.strokeWidth;
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      drawResizeHandle(ctx, obj.position.x + r * 2, obj.position.y + r * 2);
    }
  } else if (obj.type === "freehand" && obj.points && obj.points.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = obj.style.stroke;
    ctx.lineWidth = obj.style.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(obj.points[0].x, obj.points[0].y);
    for (let i = 1; i < obj.points.length; i++) {
      ctx.lineTo(obj.points[i].x, obj.points[i].y);
    }
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
}

function drawResizeHandle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#00d4ff";
  ctx.fillRect(x - 4, y - 4, 8, 8);
  ctx.strokeStyle = "#050510";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 4, y - 4, 8, 8);
}

function drawCursor(ctx: CanvasRenderingContext2D, cursor: RemoteCursor) {
  ctx.save();
  const { x, y, color, displayName } = cursor;

  // Cursor arrow
  ctx.fillStyle = color;
  ctx.strokeStyle = "#050510";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 14);
  ctx.lineTo(x + 4, y + 11);
  ctx.lineTo(x + 7, y + 17);
  ctx.lineTo(x + 9, y + 16);
  ctx.lineTo(x + 6, y + 10);
  ctx.lineTo(x + 10, y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Label
  ctx.font = "10px system-ui, sans-serif";
  const textWidth = ctx.measureText(displayName).width;
  const labelX = x + 12;
  const labelY = y + 4;

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(labelX - 2, labelY - 9, textWidth + 6, 13, 3);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#050510";
  ctx.fillText(displayName, labelX + 1, labelY);

  ctx.restore();
}

// --- Geometry helper: distance from point to line segment ---

function distToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

export default WhiteboardCanvas;
