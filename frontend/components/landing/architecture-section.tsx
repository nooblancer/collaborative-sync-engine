"use client";

import React, { useRef, useState, useCallback } from "react";
import { motion, useInView } from "framer-motion";
import {
  Smartphone,
  Radio,
  Cpu,
  Database,
  Server,
  ArrowRight,
  ArrowLeft,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// --- Data ---

interface NodeData {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PIPELINE_NODES: NodeData[] = [
  {
    id: "client-sdk",
    label: "Client SDK",
    description: "Channel multiplexing & offline queue",
    tooltip: "Manages WebSocket connection with channel multiplexing (ops, awareness, metrics, control). Queues up to 100K operations offline with exponential backoff reconnection.",
    icon: Smartphone,
  },
  {
    id: "connection-manager",
    label: "Connection Manager",
    description: "WebSocket gateway & routing",
    tooltip: "WebSocket gateway supporting 200+ concurrent connections. Handles CORS, channel demultiplexing, room join/leave commands, and participant tracking.",
    icon: Radio,
  },
  {
    id: "sync-engine",
    label: "Sync Engine",
    description: "CRDT merge & conflict resolution",
    tooltip: "Core processing engine with native Rust addon (napi-rs) for 50K ops/sec merge throughput. LWW field resolution, remove-wins deletes, append-only paths.",
    icon: Cpu,
  },
];

const BRANCH_NODES: NodeData[] = [
  {
    id: "persistence",
    label: "Persistence",
    description: "PostgreSQL ops & snapshots",
    tooltip: "PostgreSQL stores append-only operation log with HLC fields, room snapshots every 1,000 ops, and conflict event history. Supports time-travel state reconstruction.",
    icon: Database,
  },
  {
    id: "cache",
    label: "Cache",
    description: "Redis state & pub/sub",
    tooltip: "Redis caches current CRDT state per room, participant lists, operation counters, and throughput metrics. Enables sub-millisecond state lookups for joining clients.",
    icon: Server,
  },
];

interface EdgeLabel {
  forward: string;
  reverse: string;
  forwardTooltip: string;
  reverseTooltip: string;
}

const PIPELINE_EDGES: EdgeLabel[] = [
  { forward: "WebSocket frames", reverse: "Broadcast deltas", forwardTooltip: "JSON-multiplexed WebSocket frames over single connection per room", reverseTooltip: "Minimal state deltas broadcast to all connected room participants" },
  { forward: "Routed operations", reverse: "Merged deltas", forwardTooltip: "Demultiplexed operations routed to batch processor then sync engine", reverseTooltip: "Conflict-resolved deltas returned to connection manager for fan-out" },
];

// --- Node Component ---

function ArchNode({
  node,
  isInView,
  delay,
  onHover,
  isHighlighted,
}: {
  node: NodeData;
  isInView: boolean;
  delay: number;
  onHover: (node: NodeData | null) => void;
  isHighlighted: boolean;
}) {
  const Icon = node.icon;
  return (
    <motion.div
      className="flex flex-col items-center gap-2 shrink-0 relative cursor-pointer"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.7 }}
      transition={{ duration: 0.4, delay }}
      onMouseEnter={() => onHover(node)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={cn(
        "w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center",
        "bg-background-surface/80 backdrop-blur-md",
        "border transition-all duration-200",
        isHighlighted
          ? "border-accent/50 shadow-glow scale-105"
          : "border-border shadow-glow-sm"
      )}>
        <Icon className={cn(
          "w-6 h-6 sm:w-7 sm:h-7 transition-colors duration-200",
          isHighlighted ? "text-accent" : "text-foreground-muted"
        )} />
      </div>
      <span className={cn(
        "text-xs sm:text-sm font-medium text-center whitespace-nowrap transition-colors duration-200",
        isHighlighted ? "text-accent" : "text-foreground-muted"
      )}>
        {node.label}
      </span>
      <span className="text-[10px] text-foreground-dim text-center max-w-[120px] leading-tight">
        {node.description}
      </span>
    </motion.div>
  );
}

// --- Main Component ---

export default function ArchitectureSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px" });
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{ label: string; tooltip: string } | null>(null);

  const handleNodeHover = useCallback((node: NodeData | null) => {
    setHoveredNode(node);
  }, []);

  const nodeDelay = (index: number) => 0.3 + index * 0.15;
  const edgeDelay = (index: number) => 0.3 + PIPELINE_NODES.length * 0.15 + index * 0.12;

  return (
    <section
      ref={sectionRef}
      id="architecture"
      className="px-4 sm:px-6 lg:px-8 py-20"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 tracking-display">
            System Architecture
          </h2>
          <p className="text-foreground-muted text-center max-w-2xl mx-auto mb-12">
            Data flows through five core components — from client SDK through
            the sync engine to persistence and cache — ensuring consistency and
            sub-5ms latency at 50,000 ops/sec.
          </p>
        </motion.div>

        {/* Architecture Diagram */}
        <div className="relative flex flex-col items-center gap-6">
          {/* Main Pipeline Row */}
          <div className="flex items-center gap-0 w-full max-w-4xl justify-center">
            {PIPELINE_NODES.map((node, index) => (
              <React.Fragment key={node.id}>
                <ArchNode
                  node={node}
                  isInView={isInView}
                  delay={nodeDelay(index)}
                  onHover={handleNodeHover}
                  isHighlighted={hoveredNode?.id === node.id}
                />

                {/* Arrow connector between pipeline nodes */}
                {index < PIPELINE_NODES.length - 1 && (
                  <motion.div
                    className="flex flex-col items-center justify-center gap-1 mx-3 sm:mx-6 min-w-[100px] sm:min-w-[140px]"
                    initial={{ opacity: 0 }}
                    animate={isInView ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ duration: 0.4, delay: edgeDelay(index) }}
                  >
                    {/* Forward: label above, then arrow */}
                    <span
                      className="text-[9px] sm:text-[10px] text-foreground-dim whitespace-nowrap cursor-pointer hover:text-accent transition-colors"
                      onMouseEnter={() => setHoveredEdge({ label: PIPELINE_EDGES[index].forward, tooltip: PIPELINE_EDGES[index].forwardTooltip })}
                      onMouseLeave={() => setHoveredEdge(null)}
                    >
                      {PIPELINE_EDGES[index].forward}
                    </span>
                    <div
                      className="flex items-center gap-1.5 w-full cursor-pointer"
                      onMouseEnter={() => setHoveredEdge({ label: PIPELINE_EDGES[index].forward, tooltip: PIPELINE_EDGES[index].forwardTooltip })}
                      onMouseLeave={() => setHoveredEdge(null)}
                    >
                      <div className="flex-1 h-px bg-accent/30" />
                      <ArrowRight className="w-3.5 h-3.5 text-accent/50 shrink-0" />
                    </div>

                    {/* Spacer */}
                    <div className="h-2" />

                    {/* Reverse: arrow first, then label below */}
                    <div
                      className="flex items-center gap-1.5 w-full cursor-pointer"
                      onMouseEnter={() => setHoveredEdge({ label: PIPELINE_EDGES[index].reverse, tooltip: PIPELINE_EDGES[index].reverseTooltip })}
                      onMouseLeave={() => setHoveredEdge(null)}
                    >
                      <ArrowLeft className="w-3.5 h-3.5 text-accent/30 shrink-0" />
                      <div className="flex-1 h-px bg-accent/20" />
                    </div>
                    <span
                      className="text-[9px] sm:text-[10px] text-foreground-dim whitespace-nowrap cursor-pointer hover:text-accent transition-colors"
                      onMouseEnter={() => setHoveredEdge({ label: PIPELINE_EDGES[index].reverse, tooltip: PIPELINE_EDGES[index].reverseTooltip })}
                      onMouseLeave={() => setHoveredEdge(null)}
                    >
                      {PIPELINE_EDGES[index].reverse}
                    </span>
                  </motion.div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Vertical connector from Sync Engine to branch */}
          <motion.div
            className="flex items-center gap-2 text-accent/40"
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.4, delay: edgeDelay(2) }}
          >
            <ArrowDown className="w-4 h-4" />
          </motion.div>

          {/* Branch Row: Persistence + Cache */}
          <div className="flex items-start gap-10 sm:gap-16">
            {BRANCH_NODES.map((node, index) => (
              <div key={node.id} className="flex flex-col items-center gap-1">
                <motion.span
                  className="text-[9px] sm:text-[10px] text-foreground-dim mb-2"
                  initial={{ opacity: 0 }}
                  animate={isInView ? { opacity: 1 } : { opacity: 0 }}
                  transition={{ duration: 0.3, delay: edgeDelay(2) + 0.1 }}
                >
                  {index === 0 ? "Persist ops & snapshots" : "State updates"}
                </motion.span>
                <ArchNode
                  node={node}
                  isInView={isInView}
                  delay={nodeDelay(PIPELINE_NODES.length + index)}
                  onHover={handleNodeHover}
                  isHighlighted={hoveredNode?.id === node.id}
                />
              </div>
            ))}
          </div>

          {/* Tooltip */}
          {(hoveredNode || hoveredEdge) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full z-50 pointer-events-none"
            >
              <div className={cn(
                "px-4 py-3 rounded-lg max-w-[300px]",
                "bg-background-surface/95 backdrop-blur-md",
                "border border-accent/20 shadow-glow-sm",
                "text-xs text-foreground leading-relaxed"
              )}>
                <div className="font-semibold text-accent mb-1">
                  {hoveredNode ? hoveredNode.label : hoveredEdge?.label}
                </div>
                {hoveredNode ? hoveredNode.tooltip : hoveredEdge?.tooltip}
              </div>
            </motion.div>
          )}
        </div>

        {/* Hint */}
        <motion.p
          className="text-center text-foreground-dim text-xs mt-8"
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: edgeDelay(3), duration: 0.5 }}
        >
          Hover over nodes to explore component details
        </motion.p>
      </div>
    </section>
  );
}
