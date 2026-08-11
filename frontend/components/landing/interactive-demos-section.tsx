"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import AnimateOnScroll from "@/components/landing/animate-on-scroll";
import { GlassCard } from "@/components/ui/glass-card";
import {
  useSyncEngine,
  type ServerFrame,
} from "@/hooks/use-sync-engine";
import type { ConflictEvent } from "@/components/ConflictVisualizer";

/**
 * Dynamic imports to prevent SSR issues with WebSocket-dependent components
 * and to ensure CLS < 0.1 by loading demos lazily after initial viewport renders.
 *
 * Requirements: 9.5, 22.1-22.5
 */
const StressTestDemo = dynamic(
  () => import("@/components/StressTestDemo"),
  { ssr: false, loading: () => <DemoPlaceholder label="Stress Test" /> }
);

const SplitScreenDemo = dynamic(
  () => import("@/components/SplitScreenDemo"),
  { ssr: false, loading: () => <DemoPlaceholder label="Split-Screen Sync" /> }
);

const WhiteboardCanvas = dynamic(
  () => import("@/components/demo/WhiteboardCanvas").then((m) => ({ default: m.WhiteboardCanvas })),
  { ssr: false, loading: () => <DemoPlaceholder label="Collaborative Whiteboard" /> }
);

const MetricsDashboard = dynamic(
  () => import("@/components/MetricsDashboard"),
  { ssr: false, loading: () => <DemoPlaceholder label="Metrics Dashboard" /> }
);

const ConflictVisualizer = dynamic(
  () => import("@/components/ConflictVisualizer"),
  { ssr: false, loading: () => <DemoPlaceholder label="Conflict Visualizer" /> }
);

function DemoPlaceholder({ label }: { label: string }) {
  return (
    <div className="w-full min-h-[300px] flex items-center justify-center rounded-lg border border-border bg-background-surface/50">
      <span className="text-foreground-dim text-sm font-mono">Loading {label}...</span>
    </div>
  );
}

/**
 * Wrapper that subscribes to conflict events from the Sync Engine via WebSocket
 * and passes them to the ConflictVisualizer component.
 */
function LiveConflictVisualizer() {
  const { subscribe } = useSyncEngine();
  const [events, setEvents] = useState<ConflictEvent[]>([]);

  useEffect(() => {
    const unsub = subscribe("ops", (frame: ServerFrame) => {
      if (frame.type === "conflict" && frame.payload) {
        const event = frame.payload as ConflictEvent;
        setEvents((prev) => [...prev.slice(-19), event]);
      }
    });
    return unsub;
  }, [subscribe]);

  return <ConflictVisualizer events={events} />;
}

export default function InteractiveDemosSection() {
  return (
    <section id="demos" className="px-4 sm:px-6 lg:px-8 py-20">
      <div className="max-w-7xl mx-auto space-y-16">
        {/* Section Header */}
        <AnimateOnScroll>
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-foreground">
              Live Interactive Demos
            </h2>
            <p className="text-foreground-muted max-w-2xl mx-auto">
              Every demo below connects to the live Sync Engine via WebSocket.
              Real operations, real metrics, real-time convergence.
            </p>
          </div>
        </AnimateOnScroll>

        {/* Stress Test Demo */}
        <AnimateOnScroll>
          <StressTestDemo />
        </AnimateOnScroll>

        {/* Split-Screen Sync */}
        <AnimateOnScroll>
          <SplitScreenDemo />
        </AnimateOnScroll>

        {/* Whiteboard */}
        <AnimateOnScroll>
          <GlassCard variant="default" padding="default">
            <h3 className="text-xl font-semibold mb-4 text-foreground">
              Collaborative Whiteboard
            </h3>
            <WhiteboardCanvas roomId="landing-whiteboard" width={900} height={500} />
          </GlassCard>
        </AnimateOnScroll>

        {/* Metrics + Conflict side by side */}
        <AnimateOnScroll>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MetricsDashboard />
            <LiveConflictVisualizer />
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  );
}
