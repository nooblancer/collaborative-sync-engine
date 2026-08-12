"use client";

import { useEffect, useState } from "react";
import { useServerBenchmark } from "@/hooks/use-server-benchmark";
import { OpsPresetSelector } from "@/components/stress-test/OpsPresetSelector";
import { BenchmarkModeSelector } from "@/components/stress-test/BenchmarkModeSelector";
import { ConflictResultsDisplay } from "@/components/stress-test/ConflictResultsDisplay";
import { RoomsResultsDisplay } from "@/components/stress-test/RoomsResultsDisplay";
import { BreakdownResultsDisplay } from "@/components/stress-test/BreakdownResultsDisplay";
import { SnapshotResultsDisplay } from "@/components/stress-test/SnapshotResultsDisplay";
import { GlowButton } from "@/components/ui/glow-button";
import { GlassCard } from "@/components/ui/glass-card";
import { MetricCounter } from "@/components/ui/metric-counter";
import { BACKEND_URL } from "@/lib/constants";
import type { BenchmarkMode, BenchmarkModeResponse } from "@/lib/stress-test-types";

/** Presets for standard mode (resets state per batch — fast) */
const STANDARD_PRESETS = [10_000, 50_000, 100_000, 500_000];

/** Presets for accumulating modes (conflict, rooms, snapshot — state grows per batch) */
const ACCUMULATING_PRESETS = [500, 1_000, 5_000, 10_000];

/** Presets for breakdown mode (per-op timing — moderate) */
const BREAKDOWN_PRESETS = [500, 1_000, 5_000, 10_000];

/** Get appropriate presets for the current mode */
function getPresetsForMode(mode: BenchmarkMode): number[] {
  switch (mode) {
    case "standard":
      return STANDARD_PRESETS;
    case "conflict":
      return [1_000, 5_000, 10_000, 50_000];
    case "snapshot":
    case "rooms":
      return [1_000, 5_000, 10_000, 50_000];
    case "breakdown":
      return BREAKDOWN_PRESETS;
    default:
      return ACCUMULATING_PRESETS;
  }
}

/**
 * Returns an inline validation error message for the current mode params,
 * or null if params are valid.
 * Requirement 3.7: room count must be 2–50.
 */
function getValidationError(
  mode: string,
  modeParams: { rooms: number }
): string | null {
  if (mode === "rooms") {
    if (modeParams.rooms < 2 || modeParams.rooms > 50) {
      return "Room count must be between 2 and 50.";
    }
  }
  return null;
}

/** Formats elapsed seconds into a relative "time ago" string */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours > 1 ? "s" : ""} ago`;
}

export function ServerBenchmarkSection(): JSX.Element {
  const {
    state,
    selectedOps,
    setSelectedOps,
    selectedMode,
    setSelectedMode,
    modeParams,
    setModeParams,
    runBenchmark,
  } = useServerBenchmark();

  const isRunning = state.status === "running";
  const validationError = getValidationError(selectedMode, modeParams);

  // Server connectivity status
  const [serverStatus, setServerStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [lastRunTimestamp, setLastRunTimestamp] = useState<number | null>(null);
  const [timeAgoText, setTimeAgoText] = useState<string>("");

  // Check server connectivity on mount
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
    return () => { cancelled = true; };
  }, []);

  // Track last run timestamp when results arrive
  useEffect(() => {
    if (state.status === "completed" && state.results) {
      setLastRunTimestamp(Date.now());
    }
  }, [state.status, state.results]);

  // Update "time ago" text every second
  useEffect(() => {
    if (!lastRunTimestamp) return;
    setTimeAgoText(formatTimeAgo(lastRunTimestamp));
    const interval = setInterval(() => {
      setTimeAgoText(formatTimeAgo(lastRunTimestamp));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastRunTimestamp]);

  return (
    <GlassCard className="col-span-full">
      <div className="flex flex-col gap-6">
        {/* Header with status indicator */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">
              Server Benchmark
            </h2>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  serverStatus === "connected"
                    ? "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]"
                    : serverStatus === "disconnected"
                    ? "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]"
                    : "bg-yellow-500 animate-pulse"
                }`}
                aria-hidden="true"
              />
              <span aria-label={`Server status: ${serverStatus}`}>
                {serverStatus === "connected" ? "Connected" : serverStatus === "disconnected" ? "Disconnected" : "Checking…"}
              </span>
            </div>
          </div>
          <p className="text-sm text-foreground-muted">
            Measures Rust merge-engine throughput on the backend via POST
            /benchmark.
          </p>
        </div>

        {/* Mode selector: Requirement 6.1, 6.2, 6.4 */}
        <BenchmarkModeSelector
          selectedMode={selectedMode}
          onModeChange={setSelectedMode}
          disabled={isRunning}
          modeParams={modeParams}
          onModeParamsChange={setModeParams}
        />

        {/* Inline validation error: Requirement 3.7 */}
        {validationError && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-mono"
          >
            {validationError}
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <OpsPresetSelector
            presets={getPresetsForMode(selectedMode)}
            selected={selectedOps}
            onSelect={setSelectedOps}
            disabled={isRunning}
            ariaLabel="Server benchmark operation count"
          />

          <GlowButton
            onClick={runBenchmark}
            disabled={isRunning || validationError !== null}
            aria-label="Run server benchmark"
          >
            {isRunning ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Running…
              </>
            ) : (
              "Run Server Benchmark"
            )}
          </GlowButton>
        </div>

        {state.error && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-mono"
          >
            {state.error}
          </div>
        )}

        {state.results && (
          <BenchmarkResults results={state.results} />
        )}

        {/* Last run timestamp */}
        {lastRunTimestamp && (
          <p className="text-xs text-foreground-muted text-right">
            Last run: {timeAgoText}
          </p>
        )}
      </div>
    </GlassCard>
  );
}

/**
 * Renders the appropriate result display based on `results.mode`.
 * For standard mode, renders the existing metrics grid with memory.
 * For other modes, delegates to mode-specific components (which already
 * handle memory display internally).
 */
function BenchmarkResults({
  results,
}: {
  results: BenchmarkModeResponse;
}): JSX.Element {
  switch (results.mode) {
    case "conflict":
      return <ConflictResultsDisplay results={results} />;
    case "rooms":
      return <RoomsResultsDisplay results={results} />;
    case "breakdown":
      return <BreakdownResultsDisplay results={results} />;
    case "snapshot":
      return <SnapshotResultsDisplay results={results} />;
    case "standard":
    default:
      return <StandardResultsDisplay results={results} />;
  }
}

/** Standard mode results — matches the existing metrics grid + memory fields */
function StandardResultsDisplay({
  results,
}: {
  results: BenchmarkModeResponse;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      {/* Hero metric: Ops/sec */}
      <div className="flex flex-col items-center py-2">
        <span className="text-4xl font-bold text-accent tabular-nums">
          {results.opsPerSecond.toLocaleString()}
        </span>
        <span className="text-sm text-foreground-muted mt-1">ops/sec</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MetricCounter
          value={results.totalOps}
          label="Total Ops"
          suffix="ops"
        />
        <MetricCounter
          value={results.elapsedMs}
          label="Elapsed"
          suffix="ms"
          decimals={results.elapsedMs >= 1000 ? 2 : 0}
        />
        <MetricCounter
          value={results.p50Ms}
          label="P50"
          suffix="ms"
          decimals={2}
        />
        <MetricCounter
          value={results.p99Ms}
          label="P99"
          suffix="ms"
          decimals={2}
        />
        <MetricCounter
          value={results.batchesProcessed}
          label="Batches"
        />
      </div>

      {results.memoryPeakMb != null && results.memoryDeltaMb != null && (
        <div className="border-t border-border/50 pt-4">
          <h4 className="text-xs font-medium text-foreground-muted mb-3">
            Memory Usage
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <MetricCounter
              value={results.memoryPeakMb}
              label="Peak Heap"
              suffix="MB"
              decimals={2}
            />
            <MetricCounter
              value={results.memoryDeltaMb}
              label="Memory Delta"
              suffix="MB"
              decimals={2}
            />
          </div>
        </div>
      )}
    </div>
  );
}
