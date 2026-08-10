"use client";

import { cn } from "@/lib/utils";

export interface ConnectionStatusProps {
  status: "connected" | "disconnected" | "reconnecting";
}

const statusConfig = {
  connected: { color: "bg-[#22c55e]", label: "Connected" },
  disconnected: { color: "bg-destructive", label: "Disconnected" },
  reconnecting: { color: "bg-[#f59e0b]", label: "Reconnecting..." },
} as const;

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const { color, label } = statusConfig[status];

  return (
    <div className="inline-flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
      <span className="text-sm">{label}</span>
    </div>
  );
}
