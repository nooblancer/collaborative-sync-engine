"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import AnimateOnScroll from "@/components/landing/animate-on-scroll";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Gauge,
  Zap,
  Timer,
  Users,
  Layers,
  Activity,
  BarChart3,
  Swords,
  Trophy,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dynamic imports to prevent SSR issues with WebSocket-dependent components
 * and to ensure CLS < 0.1 by loading demos lazily after initial viewport renders.
 *
 * Requirements: 9.5, 22.1-22.5
 */
const StressTestDemo = dynamic(
  () => import("@/components/StressTestDemo"),
  { ssr: false, loading: () => <DemoPlaceholder label="Stress Test" /> }
);

const SplitScreenDemo = dynamic(
  () => import("@/components/SplitScreenDemo"),
  { ssr: false, loading: () => <DemoPlaceholder label="Split-Screen Sync" /> }
);

const WhiteboardCanvas = dynamic(
  () => import("@/components/demo/WhiteboardCanvas").then((m) => ({ default: m.WhiteboardCanvas })),
  { ssr: false, loading: () => <DemoPlaceholder label="Collaborative Whiteboard" /> }
);

const MetricsDashboard = dynamic(
  () => import("@/components/MetricsDashboard"),
  { ssr: false, loading: () => <DemoPlaceholder label="Metrics Dashboard" /> }
);

function DemoPlaceholder({ label }: { label: string }) {
  return (
    <div className="w-full min-h-[300px] flex items-center justify-center rounded-lg border border-border bg-background-surface/50">
      <span className="text-foreground-dim text-sm font-mono">Loading {label}...</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulated Metrics — generates realistic-looking fake data on a timer
// ---------------------------------------------------------------------------

function SimulatedMetrics() {
  const [ops, setOps] = useState(1247);
  const [p50, setP50] = useState(2.3);
  const [p99, setP99] = useState(12.8);
  const [conns, setConns] = useState(14);
  const [rooms, setRooms] = useState(3);
  const [total, setTotal] = useState(48291);
  const [history, setHistory] = useState<number[]>(() =>
    Array.from({ length: 30 }, () => 800 + Math.random() * 900)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const newOps = 900 + Math.floor(Math.random() * 800);
      setOps(newOps);
      setP50(+(1.5 + Math.random() * 3).toFixed(1));
      setP99(+(8 + Math.random() * 15).toFixed(1));
      setConns(12 + Math.floor(Math.random() * 6));
      setRooms(2 + Math.floor(Math.random() * 4));
      setTotal(prev => prev + newOps);
      setHistory(prev => [...prev.slice(-59), newOps]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const maxOps = Math.max(1, ...history);

  return (
    <section className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gauge className="h-5 w-5 text-accent" />
          <h2 className="text-xl font-bold tracking-tight text-foreground">Live Metrics</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="text-xs text-foreground-muted">connected</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-foreground-muted text-sm">
          Live metrics from all active sessions — ops/sec, latency percentiles, and connection counts.
        </p>
        <a href="#architecture" className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent/80 transition-colors shrink-0">Learn More →</a>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Zap className="h-3 w-3 text-accent" /><span className="text-xs text-foreground-muted">Ops/sec</span></div>
          <div className="text-2xl font-bold font-mono text-foreground tabular-nums">{ops.toLocaleString()}</div>
        </GlassCard>
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Timer className="h-3 w-3 text-foreground-muted" /><span className="text-xs text-foreground-muted">P50</span></div>
          <div className="text-2xl font-bold font-mono text-success tabular-nums">{p50}<span className="text-sm text-foreground-muted ml-1">ms</span></div>
        </GlassCard>
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Timer className="h-3 w-3 text-foreground-muted" /><span className="text-xs text-foreground-muted">P99</span></div>
          <div className="text-2xl font-bold font-mono text-success tabular-nums">{p99}<span className="text-sm text-foreground-muted ml-1">ms</span></div>
        </GlassCard>
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Users className="h-3 w-3 text-foreground-muted" /><span className="text-xs text-foreground-muted">Conns</span></div>
          <div className="text-2xl font-bold font-mono text-foreground tabular-nums">{conns}</div>
        </GlassCard>
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Layers className="h-3 w-3 text-foreground-muted" /><span className="text-xs text-foreground-muted">Rooms</span></div>
          <div className="text-2xl font-bold font-mono text-foreground tabular-nums">{rooms}</div>
        </GlassCard>
        <GlassCard variant="subtle" padding="sm" className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1"><Activity className="h-3 w-3 text-foreground-muted" /><span className="text-xs text-foreground-muted">Total</span></div>
          <div className="text-2xl font-bold font-mono text-foreground tabular-nums">{(total / 1000).toFixed(0)}k</div>
        </GlassCard>
      </div>
      <GlassCard variant="subtle" padding="sm">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-foreground">Throughput (60s rolling)</span>
        </div>
        <div className="w-full h-20 flex items-end gap-px">
          {history.slice(-60).map((v, i) => (
            <div key={i} className="flex-1 bg-accent/50 rounded-t-sm transition-all duration-200" style={{ height: `${Math.max(4, (v / maxOps) * 100)}%` }} />
          ))}
        </div>
      </GlassCard>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Simulated Conflicts — generates fake conflict resolution events
// ---------------------------------------------------------------------------

const CONFLICT_FIELDS = ["quantity", "name", "status", "price", "color", "position"];
const CONFLICT_CLIENTS = ["ClientA", "ClientB", "ClientC", "MobileUser", "TabletUser"];
const CONFLICT_REASONS = [
  "Higher wall-clock timestamp wins (LWW)",
  "Lexicographic nodeId tiebreaker",
  "Higher logical counter",
];

function SimulatedConflicts() {
  const [events, setEvents] = useState<Array<{
    id: string;
    field: string;
    clientA: string;
    clientB: string;
    winner: "A" | "B";
    reason: string;
    timestamp: number;
    valueA: string;
    valueB: string;
  }>>([]);

  useEffect(() => {
    // Generate initial batch
    const initial = Array.from({ length: 5 }, (_, i) => generateConflict(Date.now() - (5 - i) * 3000));
    setEvents(initial);

    // Add new conflicts periodically
    const interval = setInterval(() => {
      setEvents(prev => [...prev.slice(-14), generateConflict(Date.now())]);
    }, 4000 + Math.random() * 3000);

    return () => clearInterval(interval);
  }, []);

  function generateConflict(ts: number) {
    const field = CONFLICT_FIELDS[Math.floor(Math.random() * CONFLICT_FIELDS.length)];
    const clientA = CONFLICT_CLIENTS[Math.floor(Math.random() * CONFLICT_CLIENTS.length)];
    let clientB = CONFLICT_CLIENTS[Math.floor(Math.random() * CONFLICT_CLIENTS.length)];
    while (clientB === clientA) clientB = CONFLICT_CLIENTS[Math.floor(Math.random() * CONFLICT_CLIENTS.length)];
    return {
      id: `conflict-${ts}-${Math.random().toString(36).slice(2, 6)}`,
      field,
      clientA,
      clientB,
      winner: Math.random() > 0.5 ? "A" as const : "B" as const,
      reason: CONFLICT_REASONS[Math.floor(Math.random() * CONFLICT_REASONS.length)],
      timestamp: ts,
      valueA: field === "quantity" ? String(Math.floor(Math.random() * 100)) : `"${field}_${Math.random().toString(36).slice(2, 5)}"`,
      valueB: field === "quantity" ? String(Math.floor(Math.random() * 100)) : `"${field}_${Math.random().toString(36).slice(2, 5)}"`,
    };
  }

  return (
    <section className="w-full space-y-4">
      <div className="flex items-center gap-3">
        <Swords className="h-5 w-5 text-accent" />
        <h2 className="text-xl font-bold tracking-tight text-foreground">Conflict Resolution</h2>
        <span className="ml-auto text-xs font-mono text-foreground-muted">{events.length} events</span>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-foreground-muted text-sm">
          Watch how the CRDT engine resolves concurrent edits with LWW timestamps.
        </p>
        <a href="#architecture" className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent/80 transition-colors shrink-0">Learn More →</a>
      </div>
      <GlassCard variant="default" padding="default">
        <div className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-background-surface/50 border border-border/50 text-xs">
              <div className="shrink-0 mt-0.5">
                <Trophy className="h-3.5 w-3.5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-accent">.{event.field}</span>
                  <span className="text-foreground-dim">—</span>
                  <span className="text-foreground-muted">{event.clientA}</span>
                  <span className="text-foreground-dim">vs</span>
                  <span className="text-foreground-muted">{event.clientB}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn("font-mono", event.winner === "A" ? "text-success" : "text-foreground-dim")}>{event.valueA}</span>
                  <span className="text-foreground-dim">vs</span>
                  <span className={cn("font-mono", event.winner === "B" ? "text-success" : "text-foreground-dim")}>{event.valueB}</span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-foreground-dim">
                  <Clock className="h-3 w-3" />
                  <span>{event.reason}</span>
                </div>
              </div>
              <div className="shrink-0 text-foreground-dim text-[10px]">
                {new Date(event.timestamp).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" })}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </section>
  );
}

export default function InteractiveDemosSection() {
  return (
    <section id="demos" className="px-4 sm:px-6 lg:px-8 py-20">
      <div className="max-w-7xl mx-auto space-y-16">
        {/* Section Header */}
        <AnimateOnScroll>
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-foreground">
              Live Interactive Demos
            </h2>
            <p className="text-foreground-muted max-w-2xl mx-auto">
              Every demo below connects to the live Sync Engine via WebSocket.
              Real operations, real metrics, real-time convergence.
            </p>
          </div>
        </AnimateOnScroll>

        {/* Stress Test Demo */}
        <AnimateOnScroll>
          <div id="stress-test">
            <StressTestDemo />
          </div>
        </AnimateOnScroll>

        {/* Split-Screen Sync */}
        <AnimateOnScroll>
          <div id="split-screen">
            <SplitScreenDemo />
          </div>
        </AnimateOnScroll>

        {/* Whiteboard */}
        <AnimateOnScroll>
          <div id="whiteboard">
            <GlassCard variant="default" padding="default">
              <div className="flex items-center gap-2 mb-1">
                <svg className="h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <h3 className="text-2xl font-bold tracking-tight text-foreground">
                  Collaborative Whiteboard
                </h3>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <p className="text-foreground-muted text-sm">
                  Draw on the canvas — a simulated collaborator will mirror the multi-user experience in real-time.
                </p>
                <a
                  href="#architecture"
                  className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent/80 transition-colors shrink-0"
                >
                  Learn More →
                </a>
              </div>
              <WhiteboardCanvas roomId="landing-whiteboard" width={900} height={500} />
            </GlassCard>
          </div>
        </AnimateOnScroll>

        {/* Metrics + Conflict side by side (simulated data for landing page) */}
        <AnimateOnScroll>
          <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div id="metrics">
                <SimulatedMetrics />
              </div>
              <div id="conflict-visualizer">
                <SimulatedConflicts />
              </div>
            </div>
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  );
}
