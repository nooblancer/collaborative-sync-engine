"use client";

import { cn } from "@/lib/utils";

export interface EventLogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: "info" | "error" | "general";
}

export interface EventLogProps {
  entries: EventLogEntry[];
  maxEntries?: number;
}

const typeColorClass = {
  info: "text-primary",
  error: "text-destructive",
  general: "text-muted-foreground",
} as const;

function formatTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function EventLog({ entries, maxEntries = 50 }: EventLogProps) {
  const visibleEntries = entries.slice(0, maxEntries);

  return (
    <div className="max-h-96 overflow-y-auto rounded-md border p-2">
      {visibleEntries.map((entry) => (
        <div
          key={entry.id}
          className={cn("font-mono text-sm", typeColorClass[entry.type])}
        >
          <span className="text-muted-foreground">
            {formatTimestamp(entry.timestamp)}
          </span>{" "}
          {entry.message}
        </div>
      ))}
    </div>
  );
}
