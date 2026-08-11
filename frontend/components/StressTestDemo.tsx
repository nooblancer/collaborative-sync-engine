"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  Zap,
  Activity,
  CheckCircle2,
  AlertCircle,
  Gauge,
  BarChart3,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { GlowButton } from "@/components/ui/glow-button";
import { ConnectionIndicator } from "@/components/ui/connection-indicator";
import { cn } from "@/lib/utils";
import { WS_URL, BACKEND_URL } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OperationCount = 100 | 500 | 1000 | 5000;
type TestMode = "burst" | "sustained";
type TestPhase = "idle" | "running" | "completed";
type WsStatus = "connected" | "disconnected" | "reconnecting";

interface StressMetrics {
  submitted: number;
  confirmed: number;
  throughput: number;
  peakThroughput: number;
  p50: number;
  p99: number;
  elapsed: number;
  convergenceConfirmed: boolean;
  queueDepth: number;
  processingLag: number;
}

interface ThroughputSample {
  timestamp: number;
  opsPerSec: number;
}

interface OperationLogEntry {
  id: string;
  type: "create" | "update" | "delete";
  timestamp: number;
  status: "submitted" | "confirmed";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateOperationId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`;
}

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// ThroughputGraph sub-component
// ---------------------------------------------------------------------------

function ThroughputGraph({ samples }: { samples: ThroughputSample[] }) {
  const maxOps = Math.max(1, ...samples.map((s) => s.opsPerSec));
  const visibleSamples = samples.slice(-60);

  return (
    <div className="w-full h-32 flex items-end gap-px">
      {visibleSamples.map((sample, i) => {
        const height = Math.max(2, (sample.opsPerSec / maxOps) * 100);
        return (
          <div
            key={i}
            className="flex-1 bg-accent/60 rounded-t-sm transition-all duration-150"
            style={{ height: `${height}%` }}
            title={`${sample.opsPerSec.toFixed(0)} ops/sec`}
          />
        );
      })}
      {visibleSamples.length === 0 && (
        <div className="w-full h-full flex items-center justify-center text-foreground-dim text-xs">
          Waiting for data...
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperationStream sub-component (scrolling log)
// ---------------------------------------------------------------------------

function OperationStream({ entries }: { entries: OperationLogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries.length]);

  const typeColors: Record<string, string> = {
    create: "text-accent",
    update: "text-foreground",
    delete: "text-destructive",
  };

  return (
    <div
      ref={containerRef}
      className="h-40 overflow-y-auto font-mono text-xs space-y-0.5 scrollbar-thin"
    >
      {entries.slice(-100).map((entry) => (
        <div key={entry.id} className="flex items-center gap-2 px-2 py-0.5">
          <span className="text-foreground-dim w-16 shrink-0">
            {new Date(entry.timestamp).toLocaleTimeString([], {
              hour12: false,
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <span className={cn("w-14 shrink-0", typeColors[entry.type])}>
            {entry.type}
          </span>
          <span className="text-foreground-muted truncate">{entry.id.slice(0, 16)}</span>
          <span
            className={cn(
              "ml-auto text-xs px-1.5 py-0.5 rounded",
              entry.status === "confirmed"
                ? "bg-success/20 text-success"
                : "bg-accent/10 text-accent"
            )}
          >
            {entry.status}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function StressTestDemo() {
  // Config state
  const [operationCount, setOperationCount] = useState<OperationCount>(1000);
  const [mode, setMode] = useState<TestMode>("burst");
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");

  // Metrics state
  const [metrics, setMetrics] = useState<StressMetrics>({
    submitted: 0,
    confirmed: 0,
    throughput: 0,
    peakThroughput: 0,
    p50: 0,
    p99: 0,
    elapsed: 0,
    convergenceConfirmed: false,
    queueDepth: 0,
    processingLag: 0,
  });

  const [throughputSamples, setThroughputSamples] = useState<ThroughputSample[]>([]);
  const [operationLog, setOperationLog] = useState<OperationLogEntry[]>([]);
  const [checksums, setChecksums] = useState<string[]>([]);

  // Refs for test execution
  const wsRef = useRef<WebSocket | null>(null);
  const roomIdRef = useRef<string>("");
  const startTimeRef = useRef<number>(0);
  const latenciesRef = useRef<number[]>([]);
  const pendingOpsRef = useRef<Map<number, number>>(new Map());
  const seqRef = useRef<number>(0);
  const confirmedCountRef = useRef<number>(0);
  const submittedCountRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const throughputIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCountRef = useRef<number>(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (throughputIntervalRef.current) {
        clearInterval(throughputIntervalRef.current);
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // WebSocket connection + room management
  // ---------------------------------------------------------------------------

  const connectAndCreateRoom = useCallback(async (): Promise<WebSocket> => {
    // Get auth token
    const userId = `stress-${Date.now().toString(36)}`;
    const displayName = `StressClient`;
    const tokenUrl = `${BACKEND_URL}/token?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}`;
    const res = await fetch(tokenUrl);
    if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
    const { token } = await res.json();

    // Connect WebSocket
    const wsUrl = WS_URL.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsUrl}?token=${token}`);

    return new Promise<WebSocket>((resolve, reject) => {
      ws.onopen = () => {
        setWsStatus("connected");
        // Create a room for the stress test
        const roomId = `stress-room-${Date.now().toString(36)}`;
        roomIdRef.current = roomId;
        const createCmd = {
          channel: "control" as const,
          roomId,
          seq: seqRef.current++,
          payload: { type: "create-room" as const },
        };
        ws.send(JSON.stringify(createCmd));
        // Give the server a moment to process room creation
        setTimeout(() => resolve(ws), 100);
      };
      ws.onerror = () => {
        setWsStatus("disconnected");
        reject(new Error("WebSocket connection failed"));
      };
      ws.onclose = () => {
        setWsStatus("disconnected");
      };
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Operation generation
  // ---------------------------------------------------------------------------

  const generateOperations = useCallback((count: number) => {
    const ops: Array<{
      id: string;
      type: "create" | "update" | "delete";
      itemId: string;
      payload: Record<string, unknown>;
    }> = [];

    const itemIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let type: "create" | "update" | "delete";
      let itemId: string;

      if (roll < 0.4 || itemIds.length === 0) {
        type = "create";
        itemId = generateItemId();
        itemIds.push(itemId);
      } else if (roll < 0.85) {
        type = "update";
        itemId = itemIds[Math.floor(Math.random() * itemIds.length)];
      } else {
        type = "delete";
        const idx = Math.floor(Math.random() * itemIds.length);
        itemId = itemIds[idx];
        itemIds.splice(idx, 1);
        if (itemIds.length === 0) itemIds.push(generateItemId());
      }

      ops.push({
        id: generateOperationId(),
        type,
        itemId,
        payload:
          type === "create"
            ? { name: `Item-${i}`, quantity: Math.floor(Math.random() * 1000) }
            : type === "update"
              ? { quantity: Math.floor(Math.random() * 1000) }
              : {},
      });
    }

    return ops;
  }, []);

  // ---------------------------------------------------------------------------
  // Handle incoming messages (ACKs, metrics, etc.)
  // ---------------------------------------------------------------------------

  const setupMessageHandler = useCallback((ws: WebSocket) => {
    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);

        // Handle ping/pong
        if (frame.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        // Handle ACK — track confirmed operations
        if (frame.type === "ack" && frame.replyTo !== undefined) {
          const sentAt = pendingOpsRef.current.get(frame.replyTo);
          if (sentAt) {
            const latency = performance.now() - sentAt;
            latenciesRef.current.push(latency);
            pendingOpsRef.current.delete(frame.replyTo);
            confirmedCountRef.current++;
          }
        }

        // Handle metrics-snapshot from server
        if (frame.type === "metrics-snapshot" && frame.payload) {
          const serverMetrics = frame.payload as {
            opsPerSecond?: number;
            p50LatencyMs?: number;
            p99LatencyMs?: number;
          };
          if (serverMetrics.opsPerSecond !== undefined) {
            setMetrics((prev) => ({
              ...prev,
              throughput: serverMetrics.opsPerSecond ?? prev.throughput,
            }));
          }
        }

        // Handle convergence/state checksum
        if (frame.type === "control-response" && frame.payload) {
          const payload = frame.payload as { checksum?: string };
          if (payload.checksum) {
            setChecksums((prev) => [...prev.slice(-4), payload.checksum!]);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Run the stress test
  // ---------------------------------------------------------------------------

  const runTest = useCallback(async () => {
    // Reset state
    cancelledRef.current = false;
    confirmedCountRef.current = 0;
    submittedCountRef.current = 0;
    latenciesRef.current = [];
    pendingOpsRef.current.clear();
    seqRef.current = 0;
    lastCountRef.current = 0;

    setMetrics({
      submitted: 0,
      confirmed: 0,
      throughput: 0,
      peakThroughput: 0,
      p50: 0,
      p99: 0,
      elapsed: 0,
      convergenceConfirmed: false,
      queueDepth: 0,
      processingLag: 0,
    });
    setThroughputSamples([]);
    setOperationLog([]);
    setChecksums([]);
    setPhase("running");

    try {
      const ws = await connectAndCreateRoom();
      wsRef.current = ws;
      setupMessageHandler(ws);

      // Subscribe to metrics channel
      const metricsSub = {
        channel: "metrics" as const,
        roomId: roomIdRef.current,
        seq: seqRef.current++,
        payload: { type: "subscribe" },
      };
      ws.send(JSON.stringify(metricsSub));

      // Generate all operations upfront
      const operations = generateOperations(operationCount);
      startTimeRef.current = performance.now();

      // Start throughput sampling (1 sample/sec)
      throughputIntervalRef.current = setInterval(() => {
        const currentConfirmed = confirmedCountRef.current;
        const delta = currentConfirmed - lastCountRef.current;
        lastCountRef.current = currentConfirmed;

        const sample: ThroughputSample = {
          timestamp: Date.now(),
          opsPerSec: delta,
        };
        setThroughputSamples((prev) => [...prev.slice(-59), sample]);
        setMetrics((prev) => ({
          ...prev,
          throughput: delta,
          peakThroughput: Math.max(prev.peakThroughput, delta),
        }));
      }, 1000);

      // Start elapsed timer
      elapsedIntervalRef.current = setInterval(() => {
        if (startTimeRef.current > 0) {
          setMetrics((prev) => ({
            ...prev,
            elapsed: performance.now() - startTimeRef.current,
          }));
        }
      }, 100);

      // Send operations based on mode
      if (mode === "burst") {
        // Burst: send all immediately
        for (let i = 0; i < operations.length; i++) {
          if (cancelledRef.current) break;
          const op = operations[i];
          const seq = seqRef.current++;
          const frame = {
            channel: "ops",
            roomId: roomIdRef.current,
            seq,
            payload: {
              id: op.id,
              type: op.type,
              itemId: op.itemId,
              payload: op.payload,
              timestamp: {
                wallTime: Date.now(),
                logical: i,
                nodeId: `stress-node`,
              },
              version: 1,
            },
          };
          pendingOpsRef.current.set(seq, performance.now());
          ws.send(JSON.stringify(frame));
          submittedCountRef.current++;

          setOperationLog((prev) => [
            ...prev.slice(-99),
            { id: op.id, type: op.type, timestamp: Date.now(), status: "submitted" },
          ]);

          // Update submitted count periodically to avoid re-render on every op
          if (i % 10 === 0 || i === operations.length - 1) {
            setMetrics((prev) => ({
              ...prev,
              submitted: submittedCountRef.current,
              queueDepth: pendingOpsRef.current.size,
            }));
          }
        }
      } else {
        // Sustained: send at ~500 ops/sec (2ms interval)
        const interval = 2;
        for (let i = 0; i < operations.length; i++) {
          if (cancelledRef.current) break;
          const op = operations[i];
          const seq = seqRef.current++;
          const frame = {
            channel: "ops",
            roomId: roomIdRef.current,
            seq,
            payload: {
              id: op.id,
              type: op.type,
              itemId: op.itemId,
              payload: op.payload,
              timestamp: {
                wallTime: Date.now(),
                logical: i,
                nodeId: `stress-node`,
              },
              version: 1,
            },
          };
          pendingOpsRef.current.set(seq, performance.now());
          ws.send(JSON.stringify(frame));
          submittedCountRef.current++;

          setOperationLog((prev) => [
            ...prev.slice(-99),
            { id: op.id, type: op.type, timestamp: Date.now(), status: "submitted" },
          ]);

          if (i % 10 === 0 || i === operations.length - 1) {
            setMetrics((prev) => ({
              ...prev,
              submitted: submittedCountRef.current,
              queueDepth: pendingOpsRef.current.size,
            }));
          }

          // Await delay for sustained mode
          await new Promise((r) => setTimeout(r, interval));
        }
      }

      // Wait for all confirmations (timeout after 30s)
      const waitStart = Date.now();
      while (
        confirmedCountRef.current < operationCount &&
        Date.now() - waitStart < 30000 &&
        !cancelledRef.current
      ) {
        await new Promise((r) => setTimeout(r, 50));
        const sorted = [...latenciesRef.current].sort((a, b) => a - b);
        setMetrics((prev) => ({
          ...prev,
          confirmed: confirmedCountRef.current,
          p50: computePercentile(sorted, 50),
          p99: computePercentile(sorted, 99),
          queueDepth: pendingOpsRef.current.size,
          processingLag: pendingOpsRef.current.size > 0
            ? performance.now() - Math.min(...pendingOpsRef.current.values())
            : 0,
        }));

        // Update operation log with confirmations
        setOperationLog((prev) =>
          prev.map((entry) =>
            entry.status === "submitted" && confirmedCountRef.current > prev.filter((e) => e.status === "confirmed").length
              ? { ...entry, status: "confirmed" }
              : entry
          )
        );
      }

      // Completion
      const totalElapsed = performance.now() - startTimeRef.current;
      const sorted = [...latenciesRef.current].sort((a, b) => a - b);

      if (throughputIntervalRef.current) {
        clearInterval(throughputIntervalRef.current);
        throughputIntervalRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }

      setMetrics((prev) => ({
        ...prev,
        submitted: submittedCountRef.current,
        confirmed: confirmedCountRef.current,
        elapsed: totalElapsed,
        p50: computePercentile(sorted, 50),
        p99: computePercentile(sorted, 99),
        throughput: totalElapsed > 0
          ? Math.round((confirmedCountRef.current / totalElapsed) * 1000)
          : 0,
        convergenceConfirmed: confirmedCountRef.current >= operationCount,
        queueDepth: pendingOpsRef.current.size,
        processingLag: 0,
      }));

      setPhase("completed");
    } catch (err) {
      console.error("Stress test error:", err);
      setPhase("idle");
      setWsStatus("disconnected");
    }
  }, [operationCount, mode, connectAndCreateRoom, setupMessageHandler, generateOperations]);

  // ---------------------------------------------------------------------------
  // Stop the test
  // ---------------------------------------------------------------------------

  const stopTest = useCallback(() => {
    cancelledRef.current = true;
    if (throughputIntervalRef.current) {
      clearInterval(throughputIntervalRef.current);
      throughputIntervalRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setPhase("completed");
  }, []);

  const resetTest = useCallback(() => {
    setPhase("idle");
    setMetrics({
      submitted: 0,
      confirmed: 0,
      throughput: 0,
      peakThroughput: 0,
      p50: 0,
      p99: 0,
      elapsed: 0,
      convergenceConfirmed: false,
      queueDepth: 0,
      processingLag: 0,
    });
    setThroughputSamples([]);
    setOperationLog([]);
    setChecksums([]);
  }, []);

  // ---------------------------------------------------------------------------
  // Progress percentage
  // ---------------------------------------------------------------------------

  const progress =
    operationCount > 0
      ? Math.min(100, Math.round((metrics.confirmed / operationCount) * 100))
      : 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section className="w-full max-w-6xl mx-auto px-4 py-12 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-6 w-6 text-accent" />
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Stress Test
          </h2>
        </div>
        <ConnectionIndicator status={wsStatus} label={wsStatus} showIcon />
      </div>

      {/* Configuration Panel */}
      <GlassCard variant="default" padding="default">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Operation Count Selector */}
          <div className="space-y-1.5">
            <label className="text-xs text-foreground-muted uppercase tracking-wide">
              Operations
            </label>
            <div className="flex gap-1.5">
              {([100, 500, 1000, 5000] as OperationCount[]).map((count) => (
                <button
                  key={count}
                  disabled={phase === "running"}
                  onClick={() => setOperationCount(count)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-mono transition-all",
                    operationCount === count
                      ? "bg-accent/20 text-accent border border-accent/40 shadow-glow-sm"
                      : "bg-background-surface text-foreground-muted border border-border hover:border-border-hover",
                    phase === "running" && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {formatNumber(count)}
                </button>
              ))}
            </div>
          </div>

          {/* Mode Selector */}
          <div className="space-y-1.5">
            <label className="text-xs text-foreground-muted uppercase tracking-wide">
              Mode
            </label>
            <div className="flex gap-1.5">
              {(["burst", "sustained"] as TestMode[]).map((m) => (
                <button
                  key={m}
                  disabled={phase === "running"}
                  onClick={() => setMode(m)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm capitalize transition-all",
                    mode === m
                      ? "bg-accent/20 text-accent border border-accent/40 shadow-glow-sm"
                      : "bg-background-surface text-foreground-muted border border-border hover:border-border-hover",
                    phase === "running" && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="sm:ml-auto flex gap-2">
            {phase === "idle" && (
              <GlowButton onClick={runTest} variant="primary" size="default">
                <Play className="h-4 w-4" />
                Run Test
              </GlowButton>
            )}
            {phase === "running" && (
              <GlowButton onClick={stopTest} variant="secondary" size="default">
                <Square className="h-4 w-4" />
                Stop
              </GlowButton>
            )}
            {phase === "completed" && (
              <GlowButton onClick={resetTest} variant="secondary" size="default">
                <Play className="h-4 w-4" />
                New Test
              </GlowButton>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Progress Bar */}
      {phase !== "idle" && (
        <GlassCard variant="subtle" padding="sm">
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground-muted w-12">{progress}%</span>
            <div className="flex-1 h-2 bg-background-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300 shadow-glow-sm"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-mono text-foreground-muted">
              {formatNumber(metrics.confirmed)}/{formatNumber(operationCount)}
            </span>
          </div>
        </GlassCard>
      )}

      {/* Live Metrics Grid */}
      {phase !== "idle" && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <GlassCard variant="subtle" padding="sm" className="text-center">
            <div className="text-xs text-foreground-muted mb-1">Submitted</div>
            <div className="text-lg font-bold font-mono text-foreground tabular-nums">
              {formatNumber(metrics.submitted)}
            </div>
          </GlassCard>

          <GlassCard variant="subtle" padding="sm" className="text-center">
            <div className="text-xs text-foreground-muted mb-1">Confirmed</div>
            <div className="text-lg font-bold font-mono text-accent tabular-nums">
              {formatNumber(metrics.confirmed)}
            </div>
          </GlassCard>

          <GlassCard variant="subtle" padding="sm" className="text-center">
            <div className="text-xs text-foreground-muted mb-1">Throughput</div>
            <div className="text-lg font-bold font-mono text-foreground tabular-nums">
              {formatNumber(metrics.throughput)}
              <span className="text-xs text-foreground-muted ml-1">ops/s</span>
            </div>
          </GlassCard>

          <GlassCard variant="subtle" padding="sm" className="text-center">
            <div className="text-xs text-foreground-muted mb-1">P50</div>
            <div className="text-lg font-bold font-mono text-foreground tabular-nums">
              {formatMs(metrics.p50)}
            </div>
          </GlassCard>

          <GlassCard variant="subtle" padding="sm" className="text-center">
            <div className="text-xs text-foreground-muted mb-1">P99</div>
            <div className={cn(
              "text-lg font-bold font-mono tabular-nums",
              metrics.p99 > 50 ? "text-destructive" : metrics.p99 > 20 ? "text-warning" : "text-success"
            )}>
              {formatMs(metrics.p99)}
            </div>
          </GlassCard>

          <GlassCard variant="subtle" padding="sm" className="text-center">
            <div className="text-xs text-foreground-muted mb-1">Elapsed</div>
            <div className="text-lg font-bold font-mono text-foreground tabular-nums">
              {formatMs(metrics.elapsed)}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Backpressure / Queue Depth */}
      {phase === "running" && metrics.queueDepth > 0 && (
        <GlassCard variant="subtle" padding="sm">
          <div className="flex items-center gap-3">
            <Gauge className="h-4 w-4 text-warning" />
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground-muted">Queue Depth</span>
                <span className="font-mono text-warning">
                  {formatNumber(metrics.queueDepth)} pending
                </span>
              </div>
              {metrics.processingLag > 0 && (
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-foreground-muted">Processing Lag</span>
                  <span className="font-mono text-foreground-dim">
                    {formatMs(metrics.processingLag)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Throughput Graph + Operation Stream */}
      {phase !== "idle" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Throughput Graph */}
          <GlassCard variant="default" padding="default">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-medium text-foreground">
                Throughput (ops/sec)
              </h3>
              {metrics.peakThroughput > 0 && (
                <span className="ml-auto text-xs text-foreground-muted font-mono">
                  Peak: {formatNumber(metrics.peakThroughput)}
                </span>
              )}
            </div>
            <ThroughputGraph samples={throughputSamples} />
          </GlassCard>

          {/* Operation Stream */}
          <GlassCard variant="default" padding="default">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-medium text-foreground">
                Operation Stream
              </h3>
              <span className="ml-auto text-xs text-foreground-muted font-mono">
                Last 100 ops
              </span>
            </div>
            <OperationStream entries={operationLog} />
          </GlassCard>
        </div>
      )}

      {/* Convergence Indicators */}
      {phase !== "idle" && checksums.length > 0 && (
        <GlassCard variant="subtle" padding="sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-xs text-foreground-muted">State Checksums:</span>
            <div className="flex gap-2 flex-wrap">
              {checksums.map((cs, i) => (
                <span
                  key={i}
                  className="text-xs font-mono px-2 py-0.5 rounded bg-background-surface text-foreground-dim border border-border"
                >
                  {cs.slice(0, 8)}
                </span>
              ))}
            </div>
            {checksums.length >= 2 &&
              checksums.every((c) => c === checksums[0]) && (
                <span className="ml-auto text-xs text-success">Converged</span>
              )}
          </div>
        </GlassCard>
      )}

      {/* Completion Summary */}
      {phase === "completed" && (
        <GlassCard variant="strong" padding="lg" className="border border-accent/20">
          <div className="flex items-center gap-2 mb-4">
            {metrics.convergenceConfirmed ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <AlertCircle className="h-5 w-5 text-warning" />
            )}
            <h3 className="text-lg font-semibold text-foreground">
              {metrics.convergenceConfirmed ? "Test Complete" : "Test Stopped"}
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">Total Time</div>
              <div className="text-xl font-bold font-mono text-foreground">
                {formatMs(metrics.elapsed)}
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">Avg Throughput</div>
              <div className="text-xl font-bold font-mono text-accent">
                {metrics.elapsed > 0
                  ? formatNumber(Math.round((metrics.confirmed / metrics.elapsed) * 1000))
                  : "0"}{" "}
                <span className="text-sm text-foreground-muted">ops/s</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">Peak Throughput</div>
              <div className="text-xl font-bold font-mono text-foreground">
                {formatNumber(metrics.peakThroughput)}{" "}
                <span className="text-sm text-foreground-muted">ops/s</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">Operations</div>
              <div className="text-xl font-bold font-mono text-foreground">
                {formatNumber(metrics.confirmed)}/{formatNumber(operationCount)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">P50 Latency</div>
              <div className="text-lg font-bold font-mono text-foreground">
                {formatMs(metrics.p50)}
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">P99 Latency</div>
              <div className={cn(
                "text-lg font-bold font-mono",
                metrics.p99 > 50 ? "text-destructive" : metrics.p99 > 20 ? "text-warning" : "text-success"
              )}>
                {formatMs(metrics.p99)}
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">Convergence</div>
              <div className={cn(
                "text-lg font-bold",
                metrics.convergenceConfirmed ? "text-success" : "text-warning"
              )}>
                {metrics.convergenceConfirmed ? "Confirmed" : "Partial"}
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground-muted mb-0.5">Dropped</div>
              <div className="text-lg font-bold font-mono text-success">
                0
              </div>
            </div>
          </div>
        </GlassCard>
      )}
    </section>
  );
}
