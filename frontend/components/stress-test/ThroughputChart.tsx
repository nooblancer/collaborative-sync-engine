"use client";

import { ThroughputSample } from "@/lib/stress-test-types";
import { applyWindow, formatNumber } from "@/lib/benchmark-utils";

interface ThroughputChartProps {
  samples: ThroughputSample[];
  maxWindow?: number;
}

export function ThroughputChart({
  samples,
  maxWindow = 60,
}: ThroughputChartProps): JSX.Element {
  const visible = applyWindow(samples, maxWindow);
  const maxOps = Math.max(...visible.map((s) => s.opsPerSec), 0);

  return (
    <div
      className="h-32 w-full flex items-end gap-px rounded-md bg-muted/30 p-1 overflow-hidden"
      aria-label={`Throughput chart showing last ${visible.length} samples, peak ${formatNumber(Math.round(maxOps))} ops/sec`}
      role="img"
    >
      {visible.map((sample, i) => {
        const heightPercent =
          maxOps > 0
            ? Math.max((sample.opsPerSec / maxOps) * 100, 2)
            : 2;

        return (
          <div
            key={`${sample.timestamp}-${i}`}
            className="flex-1 bg-accent/70 rounded-t-sm transition-all duration-150"
            style={{ height: `${heightPercent}%` }}
            title={`${formatNumber(Math.round(sample.opsPerSec))} ops/sec`}
          />
        );
      })}
    </div>
  );
}
