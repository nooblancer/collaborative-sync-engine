"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Swords,
  Trophy,
  Clock,
  ChevronDown,
  ChevronRight,
  Info,
  User,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HLCTimestamp {
  wallTime: number;
  logical: number;
  nodeId: string;
}

export interface ConflictOperation {
  clientId: string;
  value: unknown;
  hlc: HLCTimestamp;
}

export interface ConflictEvent {
  id: string;
  roomId: string;
  timestamp: HLCTimestamp;
  field: string;
  operationA: ConflictOperation;
  operationB: ConflictOperation;
  winner: "A" | "B";
  reason: string;
}

export interface ConflictVisualizerProps {
  /** Maximum number of conflict events to retain in history */
  maxHistory?: number;
  /** Externally provided conflict events (for controlled usage) */
  events?: ConflictEvent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_HISTORY = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHLC(hlc: HLCTimestamp): string {
  const date = new Date(hlc.wallTime);
  const time = date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${time}.${ms} L:${hlc.logical}`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function truncateNodeId(nodeId: string, maxLen = 12): string {
  if (nodeId.length <= maxLen) return nodeId;
  return nodeId.slice(0, maxLen) + "…";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OperationCard({
  operation,
  side,
  isWinner,
}: {
  operation: ConflictOperation;
  side: "A" | "B";
  isWinner: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-lg p-3 border transition-all duration-300",
        isWinner
          ? "border-accent/40 bg-accent/5 shadow-glow-sm"
          : "border-border bg-background-surface/50 opacity-50"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span
          className={cn(
            "text-xs font-mono px-1.5 py-0.5 rounded",
            isWinner
              ? "bg-accent/20 text-accent"
              : "bg-background-surface text-foreground-dim"
          )}
        >
          Op {side}
        </span>
        {isWinner && (
          <Trophy className="h-3.5 w-3.5 text-accent" aria-label="Winner" />
        )}
      </div>

      {/* Client */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <User className="h-3 w-3 text-foreground-dim" />
        <span className="text-xs text-foreground-muted font-mono">
          {truncateNodeId(operation.clientId)}
        </span>
      </div>

      {/* HLC Timestamp */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Clock className="h-3 w-3 text-foreground-dim" />
        <span className="text-xs text-foreground-muted font-mono">
          {formatHLC(operation.hlc)}
        </span>
      </div>

      {/* Value */}
      <div className="mt-2 px-2 py-1.5 rounded bg-background-deep/50 border border-border">
        <span className="text-xs font-mono text-foreground break-all">
          {formatValue(operation.value)}
        </span>
      </div>
    </div>
  );
}

function ConflictEventItem({ event }: { event: ConflictEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden transition-all duration-200 hover:border-border-hover">
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-background-surface/50 transition-colors"
        aria-expanded={expanded}
      >
        <Swords className="h-4 w-4 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {event.field}
            </span>
            <span className="text-xs text-foreground-dim font-mono">
              {formatHLC(event.timestamp)}
            </span>
          </div>
          <p className="text-xs text-foreground-muted mt-0.5 truncate">
            {event.reason}
          </p>
        </div>
        <span
          className={cn(
            "text-xs font-mono px-1.5 py-0.5 rounded shrink-0",
            "bg-accent/20 text-accent"
          )}
        >
          Winner: {event.winner}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-foreground-dim shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-foreground-dim shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border">
          {/* Operations side-by-side */}
          <div className="flex gap-3">
            <OperationCard
              operation={event.operationA}
              side="A"
              isWinner={event.winner === "A"}
            />
            <OperationCard
              operation={event.operationB}
              side="B"
              isWinner={event.winner === "B"}
            />
          </div>

          {/* Resolution explanation */}
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-accent/5 border border-accent/10">
            <Info className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <p className="text-xs text-foreground-muted leading-relaxed">
              {event.reason}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ConflictVisualizer({
  maxHistory = DEFAULT_MAX_HISTORY,
  events: externalEvents,
}: ConflictVisualizerProps) {
  const [internalEvents, setInternalEvents] = useState<ConflictEvent[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Use external events if provided, otherwise internal state
  const events = externalEvents ?? internalEvents;

  // Bounded history: only keep last `maxHistory` events
  const displayEvents = events.slice(-maxHistory);

  /**
   * Add a conflict event to the internal history.
   * Exposed via ref or can be called externally if needed.
   */
  const addEvent = useCallback(
    (event: ConflictEvent) => {
      setInternalEvents((prev) => {
        const updated = [...prev, event];
        // Keep only the last maxHistory
        if (updated.length > maxHistory) {
          return updated.slice(-maxHistory);
        }
        return updated;
      });
    },
    [maxHistory]
  );

  // Auto-scroll to latest event
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [displayEvents.length]);

  return (
    <section className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Swords className="h-5 w-5 text-accent" />
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Conflict Resolution
        </h2>
        {displayEvents.length > 0 && (
          <span className="ml-auto text-xs font-mono text-foreground-muted">
            {displayEvents.length}/{maxHistory} events
          </span>
        )}
      </div>

      <GlassCard variant="default" padding="default">
        {displayEvents.length === 0 ? (
          /* Empty state with instructional text */
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="rounded-full p-3 bg-accent/10 mb-4">
              <Swords className="h-8 w-8 text-accent/60" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-2">
              No conflicts yet
            </h3>
            <p className="text-xs text-foreground-muted max-w-sm leading-relaxed">
              Conflicts occur when two clients simultaneously edit the same
              field on the same object. Try opening two panels and editing the
              same property at the same time to trigger a conflict resolution.
            </p>
          </div>
        ) : (
          /* Scrollable conflict history */
          <div
            ref={scrollContainerRef}
            className="max-h-[500px] overflow-y-auto space-y-2 scrollbar-thin pr-1"
          >
            {displayEvents.map((event) => (
              <ConflictEventItem key={event.id} event={event} />
            ))}
          </div>
        )}
      </GlassCard>
    </section>
  );
}

// Export addEvent hook for integration with WebSocket listeners
export { type ConflictEvent as ConflictEventType };
