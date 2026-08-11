"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MetricCounterProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** The target value to animate toward */
  value: number;
  /** Label displayed below/beside the value */
  label?: string;
  /** Optional prefix (e.g., "<") */
  prefix?: string;
  /** Optional suffix (e.g., "ms", "ops/sec") */
  suffix?: string;
  /** Duration of count-up animation in ms (default 1500) */
  duration?: number;
  /** Number of decimal places to display (default 0) */
  decimals?: number;
  /** Format number with locale separators (default true) */
  formatNumber?: boolean;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const MetricCounter = React.forwardRef<HTMLDivElement, MetricCounterProps>(
  (
    {
      className,
      value,
      label,
      prefix,
      suffix,
      duration = 1500,
      decimals = 0,
      formatNumber = true,
      ...props
    },
    ref
  ) => {
    const [displayValue, setDisplayValue] = useState(0);
    const prevValueRef = useRef(0);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
      const startValue = prevValueRef.current;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeOutCubic(progress);

        const current = startValue + (value - startValue) * easedProgress;
        setDisplayValue(current);

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          prevValueRef.current = value;
        }
      };

      animationFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [value, duration]);

    const formattedValue = React.useMemo(() => {
      const rounded =
        decimals > 0
          ? displayValue.toFixed(decimals)
          : Math.round(displayValue).toString();

      if (formatNumber && decimals === 0) {
        return Number(rounded).toLocaleString();
      }
      return rounded;
    }, [displayValue, decimals, formatNumber]);

    return (
      <div
        ref={ref}
        className={cn("flex flex-col items-center gap-1", className)}
        {...props}
      >
        <span className="text-3xl font-bold tracking-tight text-foreground font-mono tabular-nums">
          {prefix}
          {formattedValue}
          {suffix && (
            <span className="text-lg text-foreground-muted ml-1">
              {suffix}
            </span>
          )}
        </span>
        {label && (
          <span className="text-sm text-foreground-muted">{label}</span>
        )}
      </div>
    );
  }
);
MetricCounter.displayName = "MetricCounter";

export { MetricCounter };
