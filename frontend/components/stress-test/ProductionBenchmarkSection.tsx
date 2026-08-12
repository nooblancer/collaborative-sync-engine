"use client";

import { useEffect, useState } from "react";
import { useProductionBenchmark } from "@/hooks/use-production-benchmark";
import { OpsLogSlider } from "@/components/stress-test/OpsLogSlider";
import { BenchmarkModeSelector } from "@/components/stress-test/BenchmarkModeSelector";
import { BenchmarkRunningIndicator } from "@/components/stress-test/BenchmarkRunningIndicator";
import { UnifiedResultsDisplay } from "@/components/stress-test/UnifiedResultsDisplay";
import { GlowButton } from "@/components/ui/glow-button";
import { GlassCard } from "@/components/ui/glass-card";
import { BACKEND_URL } from "@/lib/constants";

/**
 * Returns an inline validation error message for the current mode params,
 * or null if params are valid.
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

export function ProductionBenchmarkSection(): JSX.Element {
  const {
    state,
    selectedOps,
    setSelectedOps,
    selectedMode,
    setSelectedMode,
    modeParams,
    setModeParams,
    runBenchmark,
  } = useProductionBenchmark();

  const isRunning = state.status === "running";
  const validationError = getValidationError(selectedMode, modeParams);

  // Server connectivity status
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

  return (
    <GlassCard className="col-span-full">
      <div className="flex flex-col gap-6">
        {/* Header with status */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-foreground">
              Production Benchmark
            </h2>
            <p className="text-sm text-foreground-muted">
              Full production path — Rust room state + delta tracking for real-time broadcast
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
                serverStatus === "connected"
                  ? "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]"
                  : serverStatus === "disconnected"
                  ? "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]"
                  : "bg-yellow-500 animate-pulse"
              }`}
            />
            {serverStatus === "connected" ? "Connected" : serverStatus === "disconnected" ? "Disconnected" : "Checking…"}
          </button>
        </div>

        {/* Mode selector */}
        <BenchmarkModeSelector
          selectedMode={selectedMode}
          onModeChange={setSelectedMode}
          disabled={isRunning}
          modeParams={modeParams}
          onModeParamsChange={setModeParams}
        />

        {/* Validation error */}
        {validationError && (
          <div
            role="alert"
            className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-mono"
          >
            {validationError}
          </div>
        )}

        {/* Log-scale slider + Run button */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div className="flex-1">
            <OpsLogSlider
              value={selectedOps}
              onChange={setSelectedOps}
              disabled={isRunning}
            />
          </div>

          <GlowButton
            onClick={runBenchmark}
            disabled={isRunning || validationError !== null || serverStatus === "disconnected"}
            aria-label="Run production benchmark"
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
              "Run Benchmark"
            )}
          </GlowButton>
        </div>

        {/* Running state indicator */}
        {isRunning && (
          <BenchmarkRunningIndicator ops={selectedOps} mode={selectedMode} />
        )}

        {/* Error display */}
        {state.error && (
          <div
            role="alert"
            className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-mono"
          >
            {state.error}
          </div>
        )}

        {/* Unified results — same layout for ALL modes */}
        {state.results && (
          <UnifiedResultsDisplay results={state.results} />
        )}
      </div>
    </GlassCard>
  );
}
