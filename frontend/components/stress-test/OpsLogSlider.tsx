"use client";

import { cn } from "@/lib/utils";

/** Default log-scale stops for the benchmark ops slider */
const DEFAULT_STOPS = [1_000, 10_000, 100_000, 500_000, 1_000_000];
const DEFAULT_LABELS = ["1K", "10K", "100K", "500K", "1M"];

interface OpsLogSliderProps {
  value: number;
  onChange: (ops: number) => void;
  disabled?: boolean;
  stops?: number[];
  labels?: string[];
}

/**
 * A log-scale slider with fixed stops (configurable).
 * Displays as a discrete step slider with labeled tick marks.
 *
 * Defaults to stops at 1K, 10K, 100K, 500K, 1M.
 * Pass custom `stops` and `labels` for different ranges.
 */
export function OpsLogSlider({
  value,
  onChange,
  disabled = false,
  stops = DEFAULT_STOPS,
  labels = DEFAULT_LABELS,
}: OpsLogSliderProps): JSX.Element {
  // Use provided labels or auto-generate from stops
  const displayLabels = labels.length === stops.length
    ? labels
    : stops.map((s) => s >= 1000 ? `${(s / 1000).toLocaleString()}K` : s.toLocaleString());

  // Find the closest stop index for the current value
  const currentIndex = stops.reduce((closest, stop, idx) => {
    return Math.abs(stop - value) < Math.abs(stops[closest] - value) ? idx : closest;
  }, 0);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3">
        <label className="text-xs text-foreground-muted whitespace-nowrap font-medium">
          Operations
        </label>
        <span className="text-sm font-mono text-accent font-semibold">
          {value.toLocaleString()}
        </span>
      </div>

      {/* Slider track */}
      <div className="relative w-full">
        <input
          type="range"
          min={0}
          max={stops.length - 1}
          step={1}
          value={currentIndex}
          disabled={disabled}
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            onChange(stops[idx]);
          }}
          className={cn(
            "w-full h-2 rounded-full appearance-none cursor-pointer",
            "bg-background-surface border border-border",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent",
            "[&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(0,255,255,0.5)]",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent/60",
            "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4",
            "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent",
            "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent/60",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          aria-label="Operation count (log scale)"
        />

        {/* Tick labels */}
        <div className="flex justify-between mt-1 px-0.5">
          {displayLabels.map((label, idx) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onChange(stops[idx])}
              className={cn(
                "text-[10px] font-mono transition-colors",
                idx === currentIndex
                  ? "text-accent font-semibold"
                  : "text-foreground-muted hover:text-foreground",
                disabled && "cursor-not-allowed"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
