"use client";

import { useEffect, useRef, useState } from "react";
import {
  Zap,
  Timer,
  Clock,
  Users,
  Database,
  ShieldCheck,
} from "lucide-react";
import { easeOut } from "@/lib/easing";
import { cn } from "@/lib/utils";

interface StatItem {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const stats: StatItem[] = [
  {
    label: "Operations / Second",
    value: 50000,
    suffix: "+",
    icon: Zap,
  },
  {
    label: "P50 Latency",
    value: 5,
    prefix: "<",
    suffix: "ms",
    icon: Timer,
  },
  {
    label: "P99 Latency",
    value: 50,
    prefix: "<",
    suffix: "ms",
    icon: Clock,
  },
  {
    label: "Concurrent Connections",
    value: 200,
    suffix: "+",
    icon: Users,
  },
  {
    label: "Queue Capacity",
    value: 100000,
    icon: Database,
  },
  {
    label: "Property Tests",
    value: 43,
    icon: ShieldCheck,
  },
];

const ANIMATION_DURATION_MS = 1800;

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export default function PerformanceStats() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const hasAnimatedRef = useRef(false);
  const [displayValues, setDisplayValues] = useState<number[]>(
    stats.map(() => 0)
  );

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !hasAnimatedRef.current) {
          hasAnimatedRef.current = true;
          startAnimation();
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(section);

    return () => {
      observer.disconnect();
    };
  }, []);

  function startAnimation() {
    const startTime = performance.now();

    function tick() {
      const elapsed = performance.now() - startTime;
      const rawProgress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const easedProgress = easeOut(rawProgress);

      const newValues = stats.map((stat) =>
        Math.round(stat.value * easedProgress)
      );
      setDisplayValues(newValues);

      if (rawProgress < 1) {
        requestAnimationFrame(tick);
      } else {
        // Ensure we land exactly on the target values
        setDisplayValues(stats.map((stat) => stat.value));
      }
    }

    requestAnimationFrame(tick);
  }

  return (
    <section
      ref={sectionRef}
      id="performance-stats"
      className="px-4 sm:px-6 lg:px-8 py-20 bg-gradient-section"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
          Performance at Scale
        </h2>
        <p className="text-[var(--color-foreground-muted)] text-center max-w-2xl mx-auto mb-12">
          Battle-tested under load. Every metric backed by property-based tests
          and live benchmarks.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className={cn(
                  "glass rounded-xl p-6 flex flex-col items-center text-center",
                  "transition-all duration-200 hover:border-[var(--color-border-hover)]",
                  "hover:shadow-[0_0_15px_rgba(0,212,255,0.1)]"
                )}
              >
                <Icon className="h-6 w-6 text-[var(--color-accent)] mb-3" />
                <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums tracking-tight text-[var(--color-foreground)]">
                  {stat.prefix}
                  {formatNumber(displayValues[index])}
                  {stat.suffix && (
                    <span className="text-lg text-[var(--color-foreground-muted)] ml-0.5">
                      {stat.suffix}
                    </span>
                  )}
                </span>
                <span className="text-sm text-[var(--color-foreground-muted)] mt-2">
                  {stat.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
