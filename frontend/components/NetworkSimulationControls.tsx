"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Gauge,
  Wifi,
  WifiOff,
  Split,
  Merge,
  Timer,
  CloudOff,
  ArrowDownToLine,
  Activity,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ControlCommand =
  | { type: "set-latency"; latencyMs: number }
  | { type: "disconnect-simulation" }
  | { type: "reconnect-simulation" }
  | { type: "partition-simulation"; groupA: string[]; groupB: string[] }
  | { type: "heal-partition" };

export interface NetworkSimulationControlsProps {
  /** Send a control command to the backend via WebSocket control channel */
  onCommand: (command: ControlCommand) => void;
  /** Client IDs for the left and right panels (used for partition grouping) */
  panelClientIds: { left: string; right: string };
  /** Externally provided offline buffer count (from SDK queue) */
  offlineBufferCount?: number;
  /** Optional class name */
  className?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LatencySlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-accent" />
          <span className="text-sm text-foreground">Latency</span>
        </div>
        <span className="text-sm font-mono text-accent tabular-nums">
          {value}ms
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={5000}
        step={50}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={cn(
          "w-full h-1.5 rounded-full appearance-none cursor-pointer",
          "bg-background-surface",
          "[&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
          "[&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:bg-accent",
          "[&::-webkit-slider-thumb]:shadow-glow-sm",
          "[&::-webkit-slider-thumb]:transition-shadow",
          "[&::-webkit-slider-thumb]:hover:shadow-glow",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4",
          "[&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:bg-accent",
          "[&::-moz-range-thumb]:border-0",
          "[&::-moz-range-thumb]:shadow-glow-sm",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        aria-label="Latency injection slider"
      />
      <div className="flex justify-between text-[10px] text-foreground-dim">
        <span>0ms</span>
        <span>1000ms</span>
        <span>2500ms</span>
        <span>5000ms</span>
      </div>
    </div>
  );
}

function DisconnectToggle({
  active,
  onToggle,
  disabled,
}: {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-all duration-200",
        "border",
        active
          ? "bg-destructive/10 border-destructive/40 shadow-[0_0_12px_rgba(239,68,68,0.2)]"
          : "bg-background-surface border-border hover:border-border-hover",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      aria-pressed={active}
      aria-label="Toggle disconnect simulation"
    >
      {active ? (
        <WifiOff className="h-4 w-4 text-destructive" />
      ) : (
        <Wifi className="h-4 w-4 text-foreground-muted" />
      )}
      <div className="flex-1 text-left">
        <div className={cn("text-sm font-medium", active ? "text-destructive" : "text-foreground")}>
          {active ? "Disconnected" : "Disconnect"}
        </div>
        <div className="text-xs text-foreground-dim">
          {active ? "Operations queuing offline" : "Simulate connection loss"}
        </div>
      </div>
      <div
        className={cn(
          "w-10 h-5 rounded-full relative transition-colors duration-200",
          active ? "bg-destructive/40" : "bg-background-mid"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full transition-all duration-200",
            active ? "left-5 bg-destructive" : "left-0.5 bg-foreground-dim"
          )}
        />
      </div>
    </button>
  );
}

function PartitionToggle({
  active,
  onToggle,
  disabled,
}: {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-all duration-200",
        "border",
        active
          ? "bg-warning/10 border-warning/40 shadow-[0_0_12px_rgba(234,179,8,0.2)]"
          : "bg-background-surface border-border hover:border-border-hover",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      aria-pressed={active}
      aria-label="Toggle network partition simulation"
    >
      {active ? (
        <Split className="h-4 w-4 text-warning" />
      ) : (
        <Split className="h-4 w-4 text-foreground-muted" />
      )}
      <div className="flex-1 text-left">
        <div className={cn("text-sm font-medium", active ? "text-warning" : "text-foreground")}>
          {active ? "Partitioned" : "Partition"}
        </div>
        <div className="text-xs text-foreground-dim">
          {active ? "Panels isolated, diverging states" : "Split panels into isolated groups"}
        </div>
      </div>
      <div
        className={cn(
          "w-10 h-5 rounded-full relative transition-colors duration-200",
          active ? "bg-warning/40" : "bg-background-mid"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full transition-all duration-200",
            active ? "left-5 bg-warning" : "left-0.5 bg-foreground-dim"
          )}
        />
      </div>
    </button>
  );
}

function OfflineBufferCounter({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/5 border border-destructive/20">
      <CloudOff className="h-3.5 w-3.5 text-destructive" />
      <span className="text-xs text-foreground-muted">Offline buffer:</span>
      <span className="text-sm font-mono font-bold text-destructive tabular-nums">
        {count.toLocaleString()}
      </span>
      <span className="text-xs text-foreground-dim">ops queued</span>
    </div>
  );
}

function ReplayAnimation({ isReplaying }: { isReplaying: boolean }) {
  if (!isReplaying) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20 animate-pulse">
      <ArrowDownToLine className="h-3.5 w-3.5 text-accent animate-bounce" />
      <span className="text-xs text-accent font-medium">
        Draining offline queue...
      </span>
      <div className="flex gap-0.5 ml-auto">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function ConvergenceAnimation({ isConverging }: { isConverging: boolean }) {
  if (!isConverging) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/5 border border-success/20">
      <Merge className="h-3.5 w-3.5 text-success" />
      <span className="text-xs text-success font-medium">
        Converging states...
      </span>
      <Activity className="h-3.5 w-3.5 text-success animate-pulse ml-auto" />
    </div>
  );
}

function PartitionWall({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="relative flex items-center justify-center py-2">
      <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-warning/60 to-transparent" />
      <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-warning/30 to-transparent blur-sm" />
      <div className="relative px-3 py-0.5 rounded-full bg-background-mid border border-warning/30 shadow-[0_0_8px_rgba(234,179,8,0.15)]">
        <span className="text-[10px] font-mono text-warning uppercase tracking-wider">
          Partition Wall
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function NetworkSimulationControls({
  onCommand,
  panelClientIds,
  offlineBufferCount = 0,
  className,
}: NetworkSimulationControlsProps) {
  const [latencyMs, setLatencyMs] = useState(0);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isPartitioned, setIsPartitioned] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isConverging, setIsConverging] = useState(false);

  const latencyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced latency update — send command after user stops sliding for 100ms
  const handleLatencyChange = useCallback(
    (value: number) => {
      setLatencyMs(value);

      if (latencyTimeoutRef.current) {
        clearTimeout(latencyTimeoutRef.current);
      }

      latencyTimeoutRef.current = setTimeout(() => {
        onCommand({ type: "set-latency", latencyMs: value });
      }, 100);
    },
    [onCommand]
  );

  // Disconnect toggle handler
  const handleDisconnectToggle = useCallback(() => {
    if (isDisconnected) {
      // Reconnecting — show replay animation
      setIsDisconnected(false);
      setIsReplaying(true);
      onCommand({ type: "reconnect-simulation" });

      // Simulate replay drain duration (auto-clear after a delay)
      setTimeout(() => {
        setIsReplaying(false);
      }, 2000);
    } else {
      // Disconnecting
      setIsDisconnected(true);
      onCommand({ type: "disconnect-simulation" });
    }
  }, [isDisconnected, onCommand]);

  // Partition toggle handler
  const handlePartitionToggle = useCallback(() => {
    if (isPartitioned) {
      // Healing partition — show convergence animation
      setIsPartitioned(false);
      setIsConverging(true);
      onCommand({ type: "heal-partition" });

      // Auto-clear convergence animation after merge completes
      setTimeout(() => {
        setIsConverging(false);
      }, 2500);
    } else {
      // Creating partition
      setIsPartitioned(true);
      onCommand({
        type: "partition-simulation",
        groupA: [panelClientIds.left],
        groupB: [panelClientIds.right],
      });
    }
  }, [isPartitioned, onCommand, panelClientIds]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (latencyTimeoutRef.current) {
        clearTimeout(latencyTimeoutRef.current);
      }
    };
  }, []);

  return (
    <GlassCard
      variant="default"
      padding="default"
      className={cn("space-y-4", className)}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground tracking-tight">
          Network Simulation
        </h3>
      </div>

      {/* Latency Slider */}
      <LatencySlider
        value={latencyMs}
        onChange={handleLatencyChange}
        disabled={isDisconnected}
      />

      {/* Disconnect Toggle */}
      <DisconnectToggle
        active={isDisconnected}
        onToggle={handleDisconnectToggle}
        disabled={isPartitioned}
      />

      {/* Offline Buffer Counter */}
      <OfflineBufferCounter
        count={isDisconnected ? offlineBufferCount : 0}
      />

      {/* Replay Animation (visible during reconnect drain) */}
      <ReplayAnimation isReplaying={isReplaying} />

      {/* Partition Toggle */}
      <PartitionToggle
        active={isPartitioned}
        onToggle={handlePartitionToggle}
        disabled={isDisconnected}
      />

      {/* Partition Wall Visual */}
      <PartitionWall active={isPartitioned} />

      {/* Convergence Animation (visible during partition heal) */}
      <ConvergenceAnimation isConverging={isConverging} />
    </GlassCard>
  );
}
