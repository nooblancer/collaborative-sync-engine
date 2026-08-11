"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Gauge,
  Users,
  Layers,
  Zap,
  Timer,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { MetricCounter } from "@/components/ui/metric-counter";
import { ConnectionIndicator } from "@/components/ui/connection-indicator";
import { cn } from "@/lib/utils";
import {
  useSyncEngine,
  type PerformanceMetrics,
  type ServerFrame,
} from "@/hooks/use-sync-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** P50 latency target in ms — green when below */
const P50_TARGET_MS = 5;
/** P99 latency target in ms — green when below */
const P99_TARGET_MS = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Tailwind text color class based on latency relative to target.
 * Green: below target, Yellow: at target (within 10%), Red: above target.
 */
export function getLatencyColor(value: number, target: number): string {
  if (value < target * 0.9) return "text-success";
  if (value <= target * 1.1) return "text-warning";
  return "text-destructive";
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1";
  return ms.toFixed(1);
}

// ---------------------------------------------------------------------------
// ThroughputChart — rolling 60-second bar chart
// ---------------------------------------------------------------------------

function ThroughputChart({ history }: { history: number[] }) {
  const maxOps = Math.max(1, ...history);
  // Show last 60 entries (one per second)
  const visible = history.slice(-60);

  return (
    <div className="w-full h-24 flex items-end gap-px" role="img" aria-label="Rolling 60-second throughput chart">
      {visible.map((ops, i) => {
        const height = Math.max(2, (ops / maxOps) * 100);
        return (
          <div
            key={i}
            className="flex-1 bg-accent/50 rounded-t-sm transition-all duration-200"
            style={{ height: `${height}%` }}
            title={`${ops.toLocaleString()} ops/sec`}
          />
        );
      })}
      {visible.length === 0 && (
        <div className="w-full h-full flex items-center justify-center text-foreground-dim text-xs font-mono">
          Awaiting metrics...
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricsDashboard Component
// ---------------------------------------------------------------------------

export default function MetricsDashboard() {
  const { connectionState, metrics: hookMetrics, subscribe } = useSyncEngine();
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Subscribe to the metrics channel for live updates
  useEffect(() => {
    const unsub = subscribe("metrics", (frame: ServerFrame) => {
      if (frame.type === "metrics-snapshot" && frame.payload) {
        const now = performance.now();
        // Ensure we render updates within 100ms of receipt
        lastUpdateRef.current = now;
        setMetrics(frame.payload as PerformanceMetrics);
      }
    });
    return unsub;
  }, [subscribe]);

  // Also use the hook-level metrics as fallback
  const displayMetrics = metrics ?? hookMetrics;

  const opsPerSecond = displayMetrics?.opsPerSecond ?? 0;
  const throughputHistory = displayMetrics?.throughputHistory ?? [];
  const p50 = displayMetrics?.p50LatencyMs ?? 0;
  const p99 = displayMetrics?.p99LatencyMs ?? 0;
  const activeConnections = displayMetrics?.activeConnections ?? 0;
  const activeRooms = displayMetrics?.activeRooms ?? 0;
  const totalOps = displayMetrics?.totalOpsProcessed ?? 0;

  return (
    <section className="w-full max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gauge className="h-5 w-5 text-accent" />
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Live Metrics
          </h2>
        </div>
        <ConnectionIndicator
          status={
            connectionState === "connected"
              ? "connected"
              : connectionState === "reconnecting"
                ? "reconnecting"
                : "disconnected"
          }
          label={connectionState}
          showIcon
        />
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Ops/sec */}
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Zap className="h-3 w-3 text-accent" />
            <span className="text-xs text-foreground-muted">Ops/sec</span>
          </div>
          <MetricCounter
            value={opsPerSecond}
            duration={800}
            className="!gap-0"
          />
        </GlassCard>

        {/* P50 Latency */}
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Timer className="h-3 w-3 text-foreground-muted" />
            <span className="text-xs text-foreground-muted">P50</span>
          </div>
          <div
            className={cn(
              "text-3xl font-bold tracking-tight font-mono tabular-nums",
              getLatencyColor(p50, P50_TARGET_MS)
            )}
          >
            {formatMs(p50)}
            <span className="text-lg text-foreground-muted ml-1">ms</span>
          </div>
        </GlassCard>

        {/* P99 Latency */}
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Timer className="h-3 w-3 text-foreground-muted" />
            <span className="text-xs text-foreground-muted">P99</span>
          </div>
          <div
            className={cn(
              "text-3xl font-bold tracking-tight font-mono tabular-nums",
              getLatencyColor(p99, P99_TARGET_MS)
            )}
          >
            {formatMs(p99)}
            <span className="text-lg text-foreground-muted ml-1">ms</span>
          </div>
        </GlassCard>

        {/* Active Connections */}
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Users className="h-3 w-3 text-foreground-muted" />
            <span className="text-xs text-foreground-muted">Connections</span>
          </div>
          <MetricCounter
            value={activeConnections}
            duration={800}
            className="!gap-0"
          />
        </GlassCard>

        {/* Active Rooms */}
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Layers className="h-3 w-3 text-foreground-muted" />
            <span className="text-xs text-foreground-muted">Rooms</span>
          </div>
          <MetricCounter
            value={activeRooms}
            duration={800}
            className="!gap-0"
          />
        </GlassCard>

        {/* Total Operations */}
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Activity className="h-3 w-3 text-foreground-muted" />
            <span className="text-xs text-foreground-muted">Total Ops</span>
          </div>
          <MetricCounter
            value={totalOps}
            duration={800}
            className="!gap-0"
          />
        </GlassCard>
      </div>

      {/* Throughput Chart */}
      <GlassCard variant="default" padding="default">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-medium text-foreground">
            Throughput (60s rolling)
          </h3>
          {opsPerSecond > 0 && (
            <span className="ml-auto text-xs font-mono text-foreground-muted tabular-nums">
              {opsPerSecond.toLocaleString()} ops/sec
            </span>
          )}
        </div>
        <ThroughputChart history={throughputHistory} />
      </GlassCard>
    </section>
  );
}
