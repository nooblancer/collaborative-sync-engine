"use client";

import { cn } from "@/lib/utils";
import type { BenchmarkMode, ModeSpecificParams } from "@/lib/stress-test-types";

/** Mode display metadata: label shown in selector and description shown below */
const MODE_CONFIG: Record<BenchmarkMode, { label: string; description: string }> = {
  standard: {
    label: "Standard",
    description: "Measures raw merge-engine throughput by applying batched operations to a single CRDT state.",
  },
  conflict: {
    label: "Conflict Resolution",
    description: "Stresses the merge engine with high-contention workloads where most operations target overlapping keys.",
  },
  rooms: {
    label: "Concurrent Rooms",
    description: "Simulates multiple isolated rooms processing operations concurrently to measure scaling overhead.",
  },
  breakdown: {
    label: "Operation Breakdown",
    description: "Times add, update, and remove operations individually to reveal per-type performance differences.",
  },
  snapshot: {
    label: "Snapshot Cost",
    description: "Measures compaction overhead by applying operations then computing a full state snapshot.",
  },
};

const MODES: BenchmarkMode[] = ["standard", "conflict", "rooms", "breakdown", "snapshot"];

interface BenchmarkModeSelectorProps {
  selectedMode: BenchmarkMode;
  onModeChange: (mode: BenchmarkMode) => void;
  disabled: boolean;
  modeParams: ModeSpecificParams;
  onModeParamsChange: (params: Partial<ModeSpecificParams>) => void;
}

export function BenchmarkModeSelector({
  selectedMode,
  onModeChange,
  disabled,
  modeParams,
  onModeParamsChange,
}: BenchmarkModeSelectorProps): JSX.Element {
  const { description } = MODE_CONFIG[selectedMode];

  return (
    <div className="flex flex-col gap-3">
      {/* Mode radio button group */}
      <div role="radiogroup" aria-label="Benchmark mode" className="flex flex-wrap gap-1.5">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selectedMode === mode}
            aria-label={MODE_CONFIG[mode].label}
            disabled={disabled}
            onClick={() => onModeChange(mode)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-mono transition-all",
              selectedMode === mode
                ? "bg-accent/20 text-accent border border-accent/40 shadow-glow-sm"
                : "bg-background-surface text-foreground-muted border border-border hover:border-border-hover",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {MODE_CONFIG[mode].label}
          </button>
        ))}
      </div>

      {/* Mode description */}
      <p className="text-sm text-foreground-muted" aria-live="polite">
        {description}
      </p>

      {/* Mode-specific parameters: room count for "rooms" mode */}
      {selectedMode === "rooms" && (
        <div className="flex items-center gap-3">
          <label
            htmlFor="room-count-input"
            className="text-sm text-foreground-muted whitespace-nowrap"
          >
            Room count
          </label>
          <input
            id="room-count-input"
            type="number"
            min={2}
            max={50}
            value={modeParams.rooms}
            disabled={disabled}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              if (!Number.isNaN(value)) {
                onModeParamsChange({ rooms: value });
              }
            }}
            aria-label="Number of concurrent rooms (2-50)"
            className={cn(
              "w-20 px-2 py-1.5 rounded-md text-sm font-mono",
              "bg-background-surface text-foreground border border-border",
              "focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          />
          <span className="text-xs text-foreground-muted">(2–50)</span>
        </div>
      )}
    </div>
  );
}
