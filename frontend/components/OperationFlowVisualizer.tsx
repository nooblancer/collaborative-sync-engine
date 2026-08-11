"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  Monitor,
  Radio,
  Layers,
  Cpu,
  Database,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

// --- Types ---

export type OperationType = "create" | "update" | "delete";

export interface FlowOperation {
  id: string;
  type: OperationType;
  /** Progress along the path: 0 = start (Client), 1 = end (Broadcast) */
  progress: number;
  /** Speed multiplier for this operation */
  speed: number;
}

interface NodeDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** X position as fraction of container width (0-1) */
  x: number;
  /** Y position as fraction of container height (0-1) */
  y: number;
}

// --- Constants ---

const NODES: NodeDef[] = [
  { id: "client", label: "Client", icon: Monitor, x: 0.08, y: 0.5 },
  { id: "websocket", label: "WebSocket", icon: Radio, x: 0.25, y: 0.5 },
  { id: "batch", label: "Batch Processor", icon: Layers, x: 0.42, y: 0.5 },
  { id: "engine", label: "Sync Engine", icon: Cpu, x: 0.59, y: 0.5 },
  { id: "persistence", label: "Persistence", icon: Database, x: 0.76, y: 0.5 },
  { id: "broadcast", label: "Broadcast", icon: Send, x: 0.93, y: 0.5 },
];

/** Edges connecting consecutive nodes */
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
];

const COLOR_MAP: Record<OperationType, string> = {
  create: "#00d4ff",
  update: "#e2e8f0",
  delete: "#ef4444",
};

const GLOW_MAP: Record<OperationType, string> = {
  create: "rgba(0, 212, 255, 0.6)",
  update: "rgba(226, 232, 240, 0.4)",
  delete: "rgba(239, 68, 68, 0.6)",
};

const BASE_SPEED = 0.003; // progress per frame at 60fps
const MAX_OPERATIONS = 20; // cap simultaneous indicators
const SPAWN_INTERVAL_MS = 400; // ms between new operation spawns

// --- Utility ---

export function getOperationColor(type: OperationType): string {
  return COLOR_MAP[type] ?? COLOR_MAP.update;
}

function randomOperationType(): OperationType {
  const r = Math.random();
  if (r < 0.4) return "create";
  if (r < 0.75) return "update";
  return "delete";
}

let nextId = 0;
function createOperation(): FlowOperation {
  return {
    id: `op-${nextId++}`,
    type: randomOperationType(),
    progress: 0,
    speed: BASE_SPEED * (0.7 + Math.random() * 0.6), // slight variation
  };
}

// --- Component ---

export interface OperationFlowVisualizerProps {
  className?: string;
  /** Whether animation is running (default: true) */
  active?: boolean;
  /** Operations per second spawn rate override */
  opsPerSecond?: number;
}

export default function OperationFlowVisualizer({
  className,
  active = true,
  opsPerSecond,
}: OperationFlowVisualizerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const operationsRef = useRef<FlowOperation[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const lastSpawnRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: 800, height: 200 });

  // Compute spawn interval from opsPerSecond or default
  const spawnInterval = opsPerSecond
    ? 1000 / opsPerSecond
    : SPAWN_INTERVAL_MS;

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Compute node positions in pixel space
  const nodePositions = NODES.map((node) => ({
    x: node.x * dimensions.width,
    y: node.y * dimensions.height,
  }));

  // Interpolate position along the full path for a given progress [0,1]
  const getPositionAtProgress = useCallback(
    (progress: number) => {
      const totalSegments = EDGES.length;
      const segment = Math.min(
        Math.floor(progress * totalSegments),
        totalSegments - 1
      );
      const segmentProgress = (progress * totalSegments) - segment;

      const [fromIdx, toIdx] = EDGES[segment];
      const from = nodePositions[fromIdx];
      const to = nodePositions[toIdx];

      return {
        x: from.x + (to.x - from.x) * segmentProgress,
        y: from.y + (to.y - from.y) * segmentProgress,
      };
    },
    [nodePositions]
  );

  // Animation loop
  useEffect(() => {
    if (!active) {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    let lastTime = performance.now();

    const tick = (now: number) => {
      const deltaMs = now - lastTime;
      lastTime = now;

      // Cap delta to prevent huge jumps on tab switch
      const cappedDelta = Math.min(deltaMs, 100);
      const deltaFraction = cappedDelta / 16.67; // normalize to 60fps

      // Spawn new operations
      if (now - lastSpawnRef.current > spawnInterval) {
        if (operationsRef.current.length < MAX_OPERATIONS) {
          operationsRef.current.push(createOperation());
        }
        lastSpawnRef.current = now;
      }

      // Update positions
      const ops = operationsRef.current;
      for (let i = ops.length - 1; i >= 0; i--) {
        ops[i].progress += ops[i].speed * deltaFraction;
        if (ops[i].progress >= 1) {
          ops.splice(i, 1);
        }
      }

      // Render to SVG
      renderOperations();

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [active, spawnInterval]);

  // Direct SVG DOM manipulation for performance (avoids React re-renders)
  const renderOperations = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const group = svg.getElementById("flow-indicators");
    if (!group) return;

    // Clear existing indicators
    while (group.firstChild) {
      group.removeChild(group.firstChild);
    }

    // Draw each operation indicator
    for (const op of operationsRef.current) {
      const pos = getPositionAtProgress(op.progress);
      const color = COLOR_MAP[op.type];
      const glow = GLOW_MAP[op.type];

      // Glow circle (larger, blurred)
      const glowCircle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      glowCircle.setAttribute("cx", String(pos.x));
      glowCircle.setAttribute("cy", String(pos.y));
      glowCircle.setAttribute("r", "8");
      glowCircle.setAttribute("fill", glow);
      glowCircle.setAttribute("filter", "url(#glow-blur)");
      group.appendChild(glowCircle);

      // Core circle
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      circle.setAttribute("cx", String(pos.x));
      circle.setAttribute("cy", String(pos.y));
      circle.setAttribute("r", "4");
      circle.setAttribute("fill", color);
      group.appendChild(circle);
    }
  }, [getPositionAtProgress]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full min-h-[200px] overflow-hidden rounded-xl",
        "bg-background-deep/50 border border-border",
        className
      )}
      role="img"
      aria-label="Operation flow visualizer showing data flowing through Client, WebSocket, Batch Processor, Sync Engine, Persistence, and Broadcast nodes"
    >
      {/* SVG layer for edges and animated indicators */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="glow-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
        </defs>

        {/* Connection edges */}
        {EDGES.map(([fromIdx, toIdx]) => {
          const from = nodePositions[fromIdx];
          const to = nodePositions[toIdx];
          return (
            <line
              key={`edge-${fromIdx}-${toIdx}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(0, 212, 255, 0.15)"
              strokeWidth="2"
              strokeDasharray="6 4"
            />
          );
        })}

        {/* Animated indicators group (manipulated directly for perf) */}
        <g id="flow-indicators" />
      </svg>

      {/* Node labels overlay */}
      <div className="relative w-full h-full flex items-center justify-between px-4 py-8 min-h-[200px]">
        {NODES.map((node) => {
          const Icon = node.icon;
          return (
            <div
              key={node.id}
              className="flex flex-col items-center gap-1.5 z-10"
              style={{ flex: "0 0 auto" }}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  "bg-background-surface/80 backdrop-blur-sm",
                  "border border-border shadow-glow-sm"
                )}
              >
                <Icon className="w-5 h-5 text-accent" />
              </div>
              <span className="text-[10px] sm:text-xs text-foreground-muted text-center whitespace-nowrap">
                {node.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 right-3 flex items-center gap-3 text-[10px] text-foreground-dim">
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: COLOR_MAP.create }}
          />
          create
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: COLOR_MAP.update }}
          />
          update
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: COLOR_MAP.delete }}
          />
          delete
        </span>
      </div>
    </div>
  );
}
