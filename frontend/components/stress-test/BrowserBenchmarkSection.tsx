"use client";

import { useBrowserBenchmark } from "@/hooks/use-browser-benchmark";
import { OpsPresetSelector } from "@/components/stress-test/OpsPresetSelector";
import { ThroughputChart } from "@/components/stress-test/ThroughputChart";
import { OperationStream } from "@/components/stress-test/OperationStream";
import { GlowButton } from "@/components/ui/glow-button";
import { GlassCard } from "@/components/ui/glass-card";
import { MetricCounter } from "@/components/ui/metric-counter";
import { ConnectionIndicator } from "@/components/ui/connection-indicator";
import { getLatencyColor, formatMs } from "@/lib/benchmark-utils";

interface BrowserBenchmarkSectionProps {
  roomId: string;
}

const PRESETS = [100, 500, 1_000, 5_000];

export function BrowserBenchmarkSection({
  roomId,
}: BrowserBenchmarkSectionProps): JSX.Element {
  const { state, selectedOps, setSelectedOps, startTest, stopTest } =
    useBrowserBenchmark(roomId);

  const { phase, wsStatus, metrics, throughputSamples, operationLog, progress } =
    state;

  const isRunning = phase === "running";

  return (
    <GlassCard>
      {/* Aria-live region for state change announcements */}
      <div aria-live="polite" className="sr-only">
        {phase === "running" && "Browser benchmark is running."}
        {phase === "completed" && "Browser benchmark completed."}
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          Browser → Server Benchmark
        </h2>
        <ConnectionIndicator
          status={wsStatus}
          label={wsStatus}
          showIcon
          size="default"
        />
      </div>

      {/* Presets + Run/Stop button row */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <OpsPresetSelector
          presets={PRESETS}
          selected={selectedOps}
          onSelect={setSelectedOps}
          disabled={isRunning}
          ariaLabel="Select number of operations for browser benchmark"
        />
        <GlowButton
          onClick={isRunning ? stopTest : startTest}
          variant={isRunning ? "secondary" : "primary"}
          aria-label={isRunning ? "Stop benchmark test" : "Run benchmark test"}
        >
          {isRunning ? "Stop" : "Run Test"}
        </GlowButton>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
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
        <div className="flex flex-col items-center gap-1">
          <span
            className={`text-3xl font-bold tracking-tight font-mono tabular-nums ${getLatencyColor(metrics.p99)}`}
          >
            {formatMs(metrics.p99)}
          </span>
          <span className="text-sm text-foreground-muted">P99</span>
        </div>
      </div>

      {/* Progress bar */}
      <div
        className="h-2 w-full rounded-full bg-muted/30 overflow-hidden mb-4"
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

      {/* Throughput chart */}
      <div className="mb-4">
        <ThroughputChart samples={throughputSamples} />
      </div>

      {/* Operation stream */}
      <OperationStream entries={operationLog} />
    </GlassCard>
  );
}
