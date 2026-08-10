// Feature: sync-engine-frontend, Property 12: Event log entry formatting
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { EventLog } from "./event-log";
import type { EventLogEntry } from "./event-log";

/**
 * Validates: Requirements 12.2, 12.3, 12.4
 *
 * Property: For any event log entry with a given type ("info", "error", or "general"),
 * the rendered entry SHALL include a timestamp prefix, use a monospace font class,
 * and apply the correct color class: primary accent for "info", destructive for "error",
 * and muted-foreground for "general".
 */

const colorClassMap: Record<EventLogEntry["type"], string> = {
  info: "text-primary",
  error: "text-destructive",
  general: "text-muted-foreground",
};

// Generator for entry type
const arbType = fc.constantFrom<EventLogEntry["type"]>("info", "error", "general");

// Generator for messages: 1-100 characters
const arbMessage = fc.string({ minLength: 1, maxLength: 100 });

// Generator for timestamps as Date objects
const arbTimestamp = fc.date({
  min: new Date("2020-01-01T00:00:00Z"),
  max: new Date("2030-12-31T23:59:59Z"),
});

// Generator for entry IDs
const arbId = fc.string({ minLength: 1, maxLength: 20 });

// Generator for a single EventLogEntry
const arbEventLogEntry: fc.Arbitrary<EventLogEntry> = fc.record({
  id: arbId,
  timestamp: arbTimestamp,
  message: arbMessage,
  type: arbType,
});

function formatTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

describe("EventLog - Property 12: Event log entry formatting", () => {
  it("renders entry with monospace font, correct color class, and timestamp prefix", () => {
    fc.assert(
      fc.property(arbEventLogEntry, (entry) => {
        const { unmount, container } = render(
          <EventLog entries={[entry]} />
        );

        // Find the entry div (first child of the scrollable container)
        const entryDiv = container.querySelector(".font-mono");

        // Assert: the entry div has the monospace font class
        expect(entryDiv).not.toBeNull();
        expect(entryDiv!.classList.contains("font-mono")).toBe(true);

        // Assert: the entry div has the correct color class for its type
        const expectedColorClass = colorClassMap[entry.type];
        expect(entryDiv!.classList.contains(expectedColorClass)).toBe(true);

        // Assert: the rendered text includes the formatted timestamp (HH:MM:SS format)
        const expectedTimestamp = formatTimestamp(entry.timestamp);
        expect(entryDiv!.textContent).toContain(expectedTimestamp);

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
