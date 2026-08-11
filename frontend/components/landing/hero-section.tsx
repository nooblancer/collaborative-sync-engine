"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Activity, Zap, CheckCircle2, ArrowRight, Github, ExternalLink } from "lucide-react";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { GlowButton } from "@/components/ui/glow-button";
import { MetricCounter } from "@/components/ui/metric-counter";
import { ConnectionIndicator } from "@/components/ui/connection-indicator";
import {
  useSyncEngine,
  type ServerFrame,
  type PerformanceMetrics,
} from "@/hooks/use-sync-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OperationDot {
  id: string;
  x: number;
  y: number;
  type: "create" | "update" | "delete";
  timestamp: number;
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOM_ID = "hero-demo";
const RAMP_INTERVAL_MS = 2000; // Increase rate every 2 seconds
const MAX_OPS_PER_SEC = 120;
const INITIAL_OPS_PER_SEC = 5;
const RAMP_INCREMENT = 15;
const DOT_LIFETIME_MS = 3000;
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 300;

// ---------------------------------------------------------------------------
// Operation Generator
// ---------------------------------------------------------------------------

function generateOperation(seq: number): Record<string, unknown> {
  const types = ["add", "update", "remove"] as const;
  const type = types[seq % 3];
  const itemId = `hero-item-${seq % 50}`;

  return {
    id: `hero-op-${Date.now().toString(36)}-${seq}`,
    type,
    itemId,
    payload: {
      name: `Item ${seq}`,
      quantity: Math.floor(Math.random() * 1000),
    },
    timestamp: {
      wallTime: Date.now(),
      logical: seq,
      nodeId: "hero-client",
    },
    version: 1,
  };
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

// ---------------------------------------------------------------------------
// LiveVisualization (canvas-based dot animation)
// ---------------------------------------------------------------------------

function LiveVisualization({
  dots,
  opsPerSec,
}: {
  dots: OperationDot[];
  opsPerSec: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    function draw() {
      if (!running || !ctx || !canvas) return;

      const now = Date.now();
      const width = canvas.width;
      const height = canvas.height;

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Draw grid lines (subtle)
      ctx.strokeStyle = "rgba(0, 212, 255, 0.05)";
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

      // Draw operation dots
      for (const dot of dots) {
        const age = now - dot.timestamp;
        if (age > DOT_LIFETIME_MS) continue;

        const progress = age / DOT_LIFETIME_MS;
        const alpha = 1 - progress;
        const radius = dot.confirmed ? 4 + progress * 2 : 3;

        // Color by type
        let color: string;
        switch (dot.type) {
          case "create":
            color = `rgba(0, 212, 255, ${alpha})`; // cyan
            break;
          case "update":
            color = `rgba(226, 232, 240, ${alpha})`; // white
            break;
          case "delete":
            color = `rgba(239, 68, 68, ${alpha})`; // red
            break;
        }

        // Draw glow
        if (dot.confirmed && alpha > 0.3) {
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, radius + 4, 0, Math.PI * 2);
          ctx.fillStyle = color.replace(String(alpha), String(alpha * 0.3));
          ctx.fill();
        }

        // Draw dot
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Draw connection line to center (pipeline flow)
        if (progress < 0.5) {
          const centerX = width / 2;
          const centerY = height / 2;
          const lineAlpha = (0.5 - progress) * 0.3;
          ctx.beginPath();
          ctx.moveTo(dot.x, dot.y);
          ctx.lineTo(
            dot.x + (centerX - dot.x) * progress * 2,
            dot.y + (centerY - dot.y) * progress * 2
          );
          ctx.strokeStyle = `rgba(0, 212, 255, ${lineAlpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Draw central processing node
      const pulseScale = 1 + Math.sin(now / 500) * 0.1;
      const centralRadius = 12 * pulseScale;
      const centerX = width / 2;
      const centerY = height / 2;

      // Glow ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, centralRadius + 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 212, 255, ${0.05 + Math.sin(now / 300) * 0.03})`;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(centerX, centerY, centralRadius, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, centralRadius
      );
      gradient.addColorStop(0, "rgba(0, 212, 255, 0.8)");
      gradient.addColorStop(1, "rgba(0, 212, 255, 0.2)");
      ctx.fillStyle = gradient;
      ctx.fill();

      // Label
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(226, 232, 240, 0.6)";
      ctx.fillText("SYNC", centerX, centerY + 28);

      // Throughput indicator ring
      const throughputFraction = Math.min(opsPerSec / MAX_OPS_PER_SEC, 1);
      ctx.beginPath();
      ctx.arc(
        centerX,
        centerY,
        centralRadius + 16,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * throughputFraction
      );
      ctx.strokeStyle = "rgba(0, 212, 255, 0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();

      animFrameRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [dots, opsPerSec]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="w-full h-full"
      style={{ imageRendering: "auto" }}
      aria-label="Live operation processing visualization"
    />
  );
}

// ---------------------------------------------------------------------------
// HeroSection Component
// ---------------------------------------------------------------------------

export default function HeroSection() {
  const { connectionState, metrics, sendOperation, subscribe } = useSyncEngine();
  const [dots, setDots] = useState<OperationDot[]>([]);
  const [localOpsPerSec, setLocalOpsPerSec] = useState(0);
  const [totalOps, setTotalOps] = useState(0);
  const [convergenceState, setConvergenceState] = useState<"synced" | "syncing">("synced");

  const opsCountRef = useRef(0);
  const opSeqRef = useRef(0);
  const targetRateRef = useRef(INITIAL_OPS_PER_SEC);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rampIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const opsPerSecIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingOpsRef = useRef(0);

  // Track confirmed operations from server
  useEffect(() => {
    const unsub = subscribe("ops", (frame: ServerFrame) => {
      if (frame.type === "ack" || frame.type === "delta") {
        pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
        // Mark a random recent dot as confirmed
        setDots((prev) => {
          const unconfirmed = prev.filter((d) => !d.confirmed);
          if (unconfirmed.length > 0) {
            const idx = prev.indexOf(unconfirmed[0]);
            const updated = [...prev];
            updated[idx] = { ...updated[idx], confirmed: true };
            return updated;
          }
          return prev;
        });
      }
    });
    return unsub;
  }, [subscribe]);

  // Update convergence state based on pending operations
  useEffect(() => {
    const timer = setInterval(() => {
      setConvergenceState(pendingOpsRef.current > 5 ? "syncing" : "synced");
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Clean up expired dots
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setDots((prev) => prev.filter((d) => now - d.timestamp < DOT_LIFETIME_MS));
    }, 500);
    return () => clearInterval(cleanupInterval);
  }, []);

  // Emit operations at the current target rate
  const emitOperations = useCallback(() => {
    if (connectionState !== "connected") return;

    const count = targetRateRef.current;
    // Emit operations spread across 1 second (called every second)
    const batchSize = Math.ceil(count / 10); // Emit in sub-batches

    for (let i = 0; i < batchSize; i++) {
      opSeqRef.current += 1;
      const op = generateOperation(opSeqRef.current);
      sendOperation(ROOM_ID, op);
      pendingOpsRef.current += 1;

      // Add visualization dot
      const types: Array<"create" | "update" | "delete"> = ["create", "update", "delete"];
      const dotType = types[opSeqRef.current % 3];

      // Position dots in a circular pattern around center
      const angle = (opSeqRef.current * 137.5 * Math.PI) / 180; // golden angle
      const radius = 60 + Math.random() * 80;
      const x = CANVAS_WIDTH / 2 + Math.cos(angle) * radius;
      const y = CANVAS_HEIGHT / 2 + Math.sin(angle) * radius;

      setDots((prev) => [
        ...prev.slice(-200), // Keep max 200 dots
        {
          id: `dot-${opSeqRef.current}`,
          x: Math.max(10, Math.min(CANVAS_WIDTH - 10, x)),
          y: Math.max(10, Math.min(CANVAS_HEIGHT - 10, y)),
          type: dotType,
          timestamp: Date.now(),
          confirmed: false,
        },
      ]);
    }

    opsCountRef.current += batchSize;
    setTotalOps((prev) => prev + batchSize);
  }, [connectionState, sendOperation]);

  // Start/stop operation emission based on connection state
  useEffect(() => {
    if (connectionState !== "connected") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Emit sub-batches 10 times per second
    intervalRef.current = setInterval(emitOperations, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connectionState, emitOperations]);

  // Ramp up operation rate over time
  useEffect(() => {
    if (connectionState !== "connected") return;

    rampIntervalRef.current = setInterval(() => {
      targetRateRef.current = Math.min(
        targetRateRef.current + RAMP_INCREMENT,
        MAX_OPS_PER_SEC
      );
    }, RAMP_INTERVAL_MS);

    return () => {
      if (rampIntervalRef.current) {
        clearInterval(rampIntervalRef.current);
        rampIntervalRef.current = null;
      }
    };
  }, [connectionState]);

  // Calculate local ops/sec
  useEffect(() => {
    opsPerSecIntervalRef.current = setInterval(() => {
      setLocalOpsPerSec(opsCountRef.current);
      opsCountRef.current = 0;
    }, 1000);

    return () => {
      if (opsPerSecIntervalRef.current) {
        clearInterval(opsPerSecIntervalRef.current);
        opsPerSecIntervalRef.current = null;
      }
    };
  }, []);

  // Derived display values
  const displayOpsPerSec = metrics?.opsPerSecond ?? localOpsPerSec;
  const displayP50 = metrics?.p50LatencyMs ?? 0;

  return (
    <section className="relative min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 pt-20 pb-16 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-radial pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: Headline and CTA */}
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="text-center lg:text-left"
          >
            <motion.div variants={item} className="mb-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-subtle text-xs font-mono text-accent">
                <Activity className="w-3 h-3" />
                Engine v2.2 — Live
              </span>
            </motion.div>

            <motion.h1
              variants={item}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-display mb-6"
            >
              <span className="text-foreground">Real-Time Sync</span>
              <br />
              <span className="bg-gradient-to-r from-accent to-accent/60 bg-clip-text text-transparent">
                at 50,000 ops/sec
              </span>
            </motion.h1>

            <motion.p
              variants={item}
              className="text-lg text-foreground-muted max-w-lg mb-8"
            >
              Production-grade CRDT collaboration engine with native Rust merge,
              batch processing, and sub-5ms latency. Watch it handle real
              operations live.
            </motion.p>

            <motion.div variants={item} className="flex flex-wrap gap-4 justify-center lg:justify-start">
              <Link href="/demo">
                <GlowButton variant="primary" size="lg">
                  <Zap className="w-4 h-4" />
                  Launch Stress Test
                  <ArrowRight className="w-4 h-4" />
                </GlowButton>
              </Link>
              <a href="https://github.com/nooblancer/collaborative-sync-engine" target="_blank" rel="noopener noreferrer">
                <GlowButton variant="secondary" size="lg">
                  <Github className="w-4 h-4" />
                  Source Code
                  <ExternalLink className="w-3.5 h-3.5" />
                </GlowButton>
              </a>
            </motion.div>
          </motion.div>

          {/* Right: Live Visualization */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <GlassCard variant="strong" padding="none" className="overflow-hidden">
              {/* Header bar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <ConnectionIndicator
                    status={connectionState === "connected" ? "connected" : connectionState === "reconnecting" ? "reconnecting" : "disconnected"}
                    size="sm"
                  />
                  <span className="text-xs font-mono text-foreground-muted">
                    sync-engine://hero-demo
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {convergenceState === "synced" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="w-3 h-3" />
                      Converged
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-warning animate-pulse">
                      <Activity className="w-3 h-3" />
                      Syncing
                    </span>
                  )}
                </div>
              </div>

              {/* Visualization canvas */}
              <div className="relative h-[300px] bg-background-deep">
                <LiveVisualization dots={dots} opsPerSec={displayOpsPerSec} />
              </div>

              {/* Metrics bar */}
              <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
                <div className="px-4 py-3 text-center">
                  <MetricCounter
                    value={displayOpsPerSec}
                    suffix="ops/s"
                    duration={800}
                    className="!gap-0"
                  />
                  <span className="text-[10px] text-foreground-dim font-mono uppercase tracking-wider">
                    Throughput
                  </span>
                </div>
                <div className="px-4 py-3 text-center">
                  <MetricCounter
                    value={displayP50}
                    suffix="ms"
                    decimals={1}
                    duration={800}
                    className="!gap-0"
                  />
                  <span className="text-[10px] text-foreground-dim font-mono uppercase tracking-wider">
                    P50 Latency
                  </span>
                </div>
                <div className="px-4 py-3 text-center">
                  <MetricCounter
                    value={totalOps}
                    duration={800}
                    className="!gap-0"
                  />
                  <span className="text-[10px] text-foreground-dim font-mono uppercase tracking-wider">
                    Total Ops
                  </span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
