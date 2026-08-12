"use client";

import { useEffect, useRef } from "react";
import type { OperationLogEntry } from "@/lib/stress-test-types";
import { applyWindow } from "@/lib/benchmark-utils";

interface OperationStreamProps {
  entries: OperationLogEntry[];
  maxEntries?: number;
}

const typeColors: Record<OperationLogEntry["type"], string> = {
  create: "text-green-400",
  update: "text-amber-400",
  delete: "text-red-400",
};

function formatTimestamp(epoch: number): string {
  const date = new Date(epoch);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

export function OperationStream({
  entries,
  maxEntries = 100,
}: OperationStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleEntries = applyWindow(entries, maxEntries);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleEntries.length]);

  return (
    <div
      ref={containerRef}
      className="max-h-48 overflow-y-auto font-mono text-xs"
      aria-label="Operation stream log"
    >
      {visibleEntries.map((entry) => (
        <div key={entry.id} className="flex items-center gap-2 py-0.5">
          <span className={typeColors[entry.type]}>
            {entry.type.toUpperCase().padEnd(6)}
          </span>
          <span className="text-muted-foreground">
            {formatTimestamp(entry.timestamp)}
          </span>
          <span
            className={
              entry.status === "confirmed"
                ? "rounded bg-green-500/20 px-1.5 py-0.5 text-green-300"
                : "rounded bg-white/10 px-1.5 py-0.5 text-white/50"
            }
          >
            {entry.status}
          </span>
        </div>
      ))}
    </div>
  );
}
