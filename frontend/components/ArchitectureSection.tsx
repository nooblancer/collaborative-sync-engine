"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Smartphone,
  Radio,
  Cpu,
  Database,
  Server,
} from "lucide-react";
import { cn } from "@/lib/utils";

// --- Types ---

export interface ArchNode {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Position as percentage of diagram area */
  x: number;
  y: number;
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  tooltip: string;
}

// --- Data ---

export const ARCHITECTURE_NODES: ArchNode[] = [
  {
    id: "client-sdk",
    label: "Client SDK",
    description: "Channel multiplexing & offline queue",
    tooltip:
      "Manages WebSocket connection with channel multiplexing (ops, awareness, metrics, control). Queues up to 100K operations offline with exponential backoff reconnection.",
    icon: Smartphone,
    x: 10,
    y: 50,
  },
  {
    id: "connection-manager",
    label: "Connection Manager",
    description: "WebSocket gateway & routing",
    tooltip:
      "WebSocket gateway supporting 200+ concurrent connections. Handles CORS, channel demultiplexing, room join/leave commands, and participant tracking.",
    icon: Radio,
    x: 30,
    y: 25,
  },
  {
    id: "sync-engine",
    label: "Sync Engine",
    description: "CRDT merge & conflict resolution",
    tooltip:
      "Core processing engine with native Rust addon (napi-rs) for 50K ops/sec merge throughput. LWW field resolution, remove-wins deletes, append-only paths. Batch processing with 1-5ms windows.",
    icon: Cpu,
    x: 55,
    y: 50,
  },
  {
    id: "persistence",
    label: "Persistence",
    description: "PostgreSQL operations & snapshots",
    tooltip:
      "PostgreSQL stores append-only operation log with HLC fields, room snapshots every 1,000 ops, and conflict event history. Supports time-travel state reconstruction.",
    icon: Database,
    x: 80,
    y: 25,
  },
  {
    id: "cache",
    label: "Cache",
    description: "Redis state & pub/sub",
    tooltip:
      "Redis caches current CRDT state per room, participant lists, operation counters, and throughput metrics. Enables sub-millisecond state lookups for joining clients.",
    icon: Server,
    x: 80,
    y: 75,
  },
];

export const ARCHITECTURE_EDGES: ArchEdge[] = [
  {
    id: "client-to-conn",
    from: "client-sdk",
    to: "connection-manager",
    label: "WebSocket frames",
    tooltip: "JSON-multiplexed WebSocket frames over single connection per room",
  },
  {
    id: "conn-to-engine",
    from: "connection-manager",
    to: "sync-engine",
    label: "Routed operations",
    tooltip: "Demultiplexed operations routed to batch processor then sync engine",
  },
  {
    id: "engine-to-persist",
    from: "sync-engine",
    to: "persistence",
    label: "Persist ops & snapshots",
    tooltip: "Merged operations persisted with HLC timestamps; snapshots every 1K ops",
  },
  {
    id: "engine-to-cache",
    from: "sync-engine",
    to: "cache",
    label: "State updates",
    tooltip: "Current CRDT state and metrics cached for fast access and pub/sub broadcast",
  },
  {
    id: "conn-to-client",
    from: "connection-manager",
    to: "client-sdk",
    label: "Broadcast deltas",
    tooltip: "Minimal state deltas broadcast to all connected room participants",
  },
  {
    id: "engine-to-conn",
    from: "sync-engine",
    to: "connection-manager",
    label: "Merged deltas",
    tooltip: "Conflict-resolved deltas returned to connection manager for fan-out",
  },
];

// --- Helpers ---

export function getNodeById(id: string): ArchNode | undefined {
  return ARCHITECTURE_NODES.find((n) => n.id === id);
}

export function getConnectedEdges(nodeId: string): string[] {
  return ARCHITECTURE_EDGES.filter(
    (e) => e.from === nodeId || e.to === nodeId
  ).map((e) => e.id);
}

export function getConnectedNodes(nodeId: string): string[] {
  const connected = new Set<string>();
  ARCHITECTURE_EDGES.forEach((e) => {
    if (e.from === nodeId) connected.add(e.to);
    if (e.to === nodeId) connected.add(e.from);
  });
  return Array.from(connected);
}

// --- Subcomponents ---

interface TooltipProps {
  content: string;
  label: string;
  x: number;
  y: number;
  visible: boolean;
}

function DiagramTooltip({ content, label, x, y, visible }: TooltipProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        "absolute z-50 pointer-events-none",
        "transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0"
      )}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -110%)",
      }}
      role="tooltip"
    >
      <div
        className={cn(
          "px-3 py-2 rounded-lg max-w-[260px]",
          "bg-background-surface/95 backdrop-blur-md",
          "border border-accent/20 shadow-glow-sm",
          "text-xs text-foreground leading-relaxed"
        )}
      >
        <div className="font-semibold text-accent mb-1">{label}</div>
        {content}
      </div>
    </div>
  );
}

// --- Main Component ---

export interface ArchitectureSectionProps {
  className?: string;
}

export default function ArchitectureSection({
  className,
}: ArchitectureSectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    content: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  // Scroll-triggered animation using Intersection Observer
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect(); // only trigger once
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const highlightedEdges = hoveredNode ? getConnectedEdges(hoveredNode) : [];
  const highlightedNodes = hoveredNode
    ? [hoveredNode, ...getConnectedNodes(hoveredNode)]
    : [];

  const handleNodeHover = useCallback((node: ArchNode | null) => {
    if (node) {
      setHoveredNode(node.id);
      setHoveredEdge(null);
      setTooltip({
        content: node.tooltip,
        label: node.label,
        x: node.x,
        y: node.y,
      });
    } else {
      setHoveredNode(null);
      setTooltip(null);
    }
  }, []);

  const handleEdgeHover = useCallback((edge: ArchEdge | null) => {
    if (edge) {
      setHoveredEdge(edge.id);
      setHoveredNode(null);
      const fromNode = getNodeById(edge.from);
      const toNode = getNodeById(edge.to);
      if (fromNode && toNode) {
        setTooltip({
          content: edge.tooltip,
          label: edge.label,
          x: (fromNode.x + toNode.x) / 2,
          y: (fromNode.y + toNode.y) / 2,
        });
      }
    } else {
      setHoveredEdge(null);
      setTooltip(null);
    }
  }, []);

  // Stagger delays: nodes appear sequentially, then edges animate in
  const nodeDelay = (index: number) => 0.2 + index * 0.15;
  const edgeDelay = (index: number) =>
    0.2 + ARCHITECTURE_NODES.length * 0.15 + 0.1 + index * 0.12;

  return (
    <section
      ref={sectionRef}
      id="architecture"
      className={cn("px-4 sm:px-6 lg:px-8 py-20", className)}
      aria-label="System architecture diagram"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div
          className={cn(
            "transition-all duration-500 ease-out",
            isInView
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-6"
          )}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 tracking-display">
            System Architecture
          </h2>
          <p className="text-foreground-muted text-center max-w-2xl mx-auto mb-12">
            Data flows through five core components — from client SDK through
            the sync engine to persistence and cache — ensuring consistency and
            sub-5ms latency at 50,000 ops/sec.
          </p>
        </div>

        {/* Diagram Container */}
        <div
          className="relative w-full aspect-[16/9] max-h-[500px] min-h-[320px]"
          data-testid="architecture-diagram"
        >
          {/* SVG edges layer */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="arch-arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon
                  points="0 0, 8 3, 0 6"
                  fill="rgba(0, 212, 255, 0.4)"
                />
              </marker>
              <marker
                id="arch-arrowhead-active"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#00d4ff" />
              </marker>
              <filter
                id="arch-edge-glow"
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <feGaussianBlur in="SourceGraphic" stdDeviation="0.4" />
              </filter>
            </defs>

            {ARCHITECTURE_EDGES.map((edge, index) => {
              const fromNode = getNodeById(edge.from);
              const toNode = getNodeById(edge.to);
              if (!fromNode || !toNode) return null;

              const isHighlighted =
                highlightedEdges.includes(edge.id) ||
                hoveredEdge === edge.id;
              const isDimmed =
                (hoveredNode !== null &&
                  !highlightedEdges.includes(edge.id)) ||
                (hoveredEdge !== null && hoveredEdge !== edge.id);

              // Compute curved path
              const dx = toNode.x - fromNode.x;
              const dy = toNode.y - fromNode.y;
              const midX = (fromNode.x + toNode.x) / 2;
              const midY = (fromNode.y + toNode.y) / 2;
              const curveOffset = Math.abs(dy) < 10 ? 5 : 3;
              const cx =
                midX + (dy > 0 ? -curveOffset : curveOffset) * 0.3;
              const cy =
                midY + (dx > 0 ? curveOffset : -curveOffset) * 0.3;

              const pathD = `M ${fromNode.x} ${fromNode.y} Q ${cx} ${cy} ${toNode.x} ${toNode.y}`;

              const delay = edgeDelay(index);
              const animStyle: React.CSSProperties = isInView
                ? {
                    opacity: isDimmed ? 0.3 : 1,
                    strokeDashoffset: "0",
                    transition: `opacity 0.3s ease ${delay}s, stroke-dashoffset 0.6s ease-out ${delay}s, stroke 0.2s ease, stroke-width 0.2s ease`,
                  }
                : {
                    opacity: 0,
                    strokeDashoffset: "200",
                  };

              return (
                <g key={edge.id} data-testid={`edge-${edge.id}`}>
                  {/* Hit area for hover */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="4"
                    className="pointer-events-auto cursor-pointer"
                    onMouseEnter={() => handleEdgeHover(edge)}
                    onMouseLeave={() => handleEdgeHover(null)}
                  />
                  {/* Visible edge with direction arrow */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={
                      isHighlighted
                        ? "#00d4ff"
                        : "rgba(0, 212, 255, 0.2)"
                    }
                    strokeWidth={isHighlighted ? 0.5 : 0.3}
                    strokeDasharray={isHighlighted ? "none" : "2 1.5"}
                    markerEnd={
                      isHighlighted
                        ? "url(#arch-arrowhead-active)"
                        : "url(#arch-arrowhead)"
                    }
                    filter={
                      isHighlighted ? "url(#arch-edge-glow)" : undefined
                    }
                    style={{
                      ...animStyle,
                      strokeDasharray: isInView
                        ? isHighlighted
                          ? "none"
                          : "2 1.5"
                        : "200",
                    }}
                  />
                  {/* Edge label */}
                  <text
                    x={cx}
                    y={cy - 2}
                    textAnchor="middle"
                    className="text-[2.2px] fill-foreground-dim pointer-events-none select-none"
                    style={{
                      opacity: isInView
                        ? isDimmed
                          ? 0.2
                          : isHighlighted
                          ? 1
                          : 0.6
                        : 0,
                      transition: `opacity 0.3s ease ${delay + 0.3}s`,
                    }}
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Nodes layer */}
          {ARCHITECTURE_NODES.map((node, index) => {
            const Icon = node.icon;
            const isHighlighted =
              hoveredNode === node.id ||
              highlightedNodes.includes(node.id);
            const isDimmed =
              hoveredNode !== null &&
              !highlightedNodes.includes(node.id);

            const delay = nodeDelay(index);

            return (
              <div
                key={node.id}
                className="absolute z-10"
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: "translate(-50%, -50%)",
                  opacity: isInView ? (isDimmed ? 0.4 : 1) : 0,
                  scale: isInView ? (isHighlighted ? "1.05" : "1") : "0.6",
                  transition: `opacity 0.4s ease ${delay}s, scale 0.3s ease ${delay}s`,
                }}
                data-testid={`node-${node.id}`}
                onMouseEnter={() => handleNodeHover(node)}
                onMouseLeave={() => handleNodeHover(null)}
              >
                <div
                  className={cn(
                    "flex flex-col items-center gap-1.5 cursor-pointer transition-all duration-200",
                    "group"
                  )}
                >
                  {/* Node box with glassmorphism */}
                  <div
                    className={cn(
                      "w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center",
                      "bg-background-surface/80 backdrop-blur-md",
                      "border transition-all duration-200",
                      isHighlighted
                        ? "border-accent/50 shadow-glow"
                        : "border-border shadow-glow-sm"
                    )}
                  >
                    <Icon
                      className={cn(
                        "w-6 h-6 sm:w-7 sm:h-7 transition-colors duration-200",
                        isHighlighted
                          ? "text-accent"
                          : "text-foreground-muted"
                      )}
                    />
                  </div>
                  {/* Label */}
                  <span
                    className={cn(
                      "text-[10px] sm:text-xs font-medium text-center whitespace-nowrap transition-colors duration-200",
                      isHighlighted
                        ? "text-accent"
                        : "text-foreground-muted"
                    )}
                  >
                    {node.label}
                  </span>
                  {/* Description */}
                  <span className="text-[8px] sm:text-[10px] text-foreground-dim text-center max-w-[100px] leading-tight">
                    {node.description}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Tooltip */}
          {tooltip && (
            <DiagramTooltip
              content={tooltip.content}
              label={tooltip.label}
              x={tooltip.x}
              y={tooltip.y}
              visible={!!tooltip}
            />
          )}
        </div>

        {/* Interaction hint */}
        <p
          className={cn(
            "text-center text-foreground-dim text-xs mt-6",
            "transition-opacity duration-500",
            isInView ? "opacity-100" : "opacity-0"
          )}
          style={{
            transitionDelay: isInView
              ? `${edgeDelay(ARCHITECTURE_EDGES.length - 1) + 0.5}s`
              : "0s",
          }}
        >
          Hover over nodes and edges to explore component details
        </p>
      </div>
    </section>
  );
}
