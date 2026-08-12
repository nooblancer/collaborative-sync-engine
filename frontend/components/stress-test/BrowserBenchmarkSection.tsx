"use client";

import { useEffect, useState } from "react";
import { useBrowserBenchmark } from "@/hooks/use-browser-benchmark";
import { OpsLogSlider } from "@/components/stress-test/OpsLogSlider";
import { ThroughputChart } from "@/components/stress-test/ThroughputChart";
import { OperationStream } from "@/components/stress-test/OperationStream";
import { GlowButton } from "@/components/ui/glow-button";
import { GlassCard } from "@/components/ui/glass-card";
import { MetricCounter } from "@/components/ui/metric-counter";
import { BACKEND_URL } from "@/lib/constants";

interface BrowserBenchmarkSectionProps {
  roomId: string;
}

/** Browser benchmark uses lower operation counts since WebSocket is slower */
const BROWSER_STOPS = [100, 500, 1_000, 5_000, 10_000];
const BROWSER_LABELS = ["100", "500", "1K", "5K", "10K"];

export function BrowserBenchmarkSection({
  roomId,
}: BrowserBenchmarkSectionProps): JSX.Element {
  const { state, selectedOps, setSelectedOps, startTest, stopTest } =
    useBrowserBenchmark(roomId);

  const { phase, wsStatus, metrics, throughputSamples, operationLog, progress } =
    state;

  const isRunning = phase === "running";

  // Server connectivity status — same pattern as Engine/Production sections
  const [serverStatus, setServerStatus] = useState<"checking" | "connected" | "disconnected">("checking");

  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      try {
        const res = await fetch(`${BACKEND_URL}/health`, { method: "GET" });
        if (!cancelled) setServerStatus(res.ok ? "connected" : "disconnected");
      } catch {
        if (!cancelled) setServerStatus("disconnected");
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Derive effective connection status: use WebSocket status when running, server status otherwise
  const effectiveStatus = isRunning
    ? wsStatus === "connected" ? "connected" : wsStatus === "reconnecting" ? "checking" : "disconnected"
    : serverStatus;

  return (
    <GlassCard className="col-span-full">
      {/* Aria-live region for state change announcements */}
      <div aria-live="polite" className="sr-only">
        {phase === "running" && "Browser benchmark is running."}
        {phase === "completed" && "Browser benchmark completed."}
      </div>

      <div className="flex flex-col gap-6">
        {/* Header with status — same layout as Engine/Production */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-foreground">
              Browser Benchmark
            </h2>
            <p className="text-sm text-foreground-muted">
              End-to-end — browser serialize → WebSocket → server merge → broadcast → receive
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setServerStatus("checking");
              fetch(`${BACKEND_URL}/health`).then(r => {
                setServerStatus(r.ok ? "connected" : "disconnected");
              }).catch(() => setServerStatus("disconnected"));
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono border border-border hover:border-border-hover transition-colors"
            aria-label="Check server connection"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                effectiveStatus === "connected"
                  ? "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]"
                  : effectiveStatus === "disconnected"
                  ? "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]"
                  : "bg-yellow-500 animate-pulse"
              }`}
            />
            {effectiveStatus === "connected"
              ? "Connected"
              : effectiveStatus === "disconnected"
              ? "Disconnected"
              : "Checking…"}
          </button>
        </div>

        {/* Log-scale slider + Run/Stop button */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div className="flex-1">
            <OpsLogSlider
              value={selectedOps}
              onChange={setSelectedOps}
              disabled={isRunning}
              stops={BROWSER_STOPS}
              labels={BROWSER_LABELS}
            />
          </div>

          <GlowButton
            onClick={isRunning ? stopTest : startTest}
            disabled={!isRunning && serverStatus === "disconnected"}
            variant={isRunning ? "secondary" : "primary"}
            aria-label={isRunning ? "Stop benchmark test" : "Run benchmark test"}
          >
            {isRunning ? "Stop" : "Run Benchmark"}
          </GlowButton>
        </div>

        {/* Progress bar */}
        {(isRunning || phase === "completed") && (
          <div
            className="h-2 w-full rounded-full bg-muted/30 overflow-hidden"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Benchmark progress"
          >
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Metrics grid — using MetricCounter consistently */}
        {(isRunning || phase === "completed") && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <MetricCounter
              value={metrics.submitted}
              label="Submitted"
              duration={800}
            />
            <MetricCounter
              value={metrics.confirmed}
              label="Confirmed"
              duration={800}
            />
            <MetricCounter
              value={metrics.throughput}
              label="Throughput"
              suffix="ops/s"
              duration={800}
            />
            <MetricCounter
              value={metrics.peakThroughput}
              label="Peak"
              suffix="ops/s"
              duration={800}
            />
            <MetricCounter
              value={metrics.p50}
              label="P50"
              suffix="ms"
              decimals={1}
              duration={800}
            />
            <MetricCounter
              value={metrics.p99}
              label="P99"
              suffix="ms"
              decimals={1}
              duration={800}
            />
          </div>
        )}

        {/* Throughput chart */}
        {throughputSamples.length > 0 && (
          <ThroughputChart samples={throughputSamples} />
        )}

        {/* Operation stream */}
        {operationLog.length > 0 && (
          <OperationStream entries={operationLog} />
        )}
      </div>
    </GlassCard>
  );
}
