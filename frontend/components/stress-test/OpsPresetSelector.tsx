"use client";

import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/benchmark-utils";

interface OpsPresetSelectorProps {
  presets: number[];
  selected: number;
  onSelect: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
}

export function OpsPresetSelector({
  presets,
  selected,
  onSelect,
  disabled = false,
  ariaLabel,
}: OpsPresetSelectorProps): JSX.Element {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-1.5">
      {presets.map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={selected === value}
          onClick={() => onSelect(value)}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-mono transition-all",
            selected === value
              ? "bg-accent/20 text-accent border border-accent/40 shadow-glow-sm"
              : "bg-background-surface text-foreground-muted border border-border hover:border-border-hover",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          {formatNumber(value)}
        </button>
      ))}
    </div>
  );
}
