// Feature: sync-engine-frontend, Property 11: Event log capacity invariant
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { render } from "@testing-library/react";
import { EventLog } from "./event-log";
import type { EventLogEntry } from "./event-log";

/**
 * Validates: Requirements 12.1
 *
 * Property: For any sequence of N events (where N ≥ 0) added to the event log,
 * the displayed event log SHALL contain at most 50 entries, and those entries
 * SHALL be the N most recent events (or all events if N ≤ 50), ordered from
 * newest to oldest.
 */

// Generator for event types
const arbType = fc.constantFrom("info", "error", "general") as fc.Arbitrary<
  "info" | "error" | "general"
>;

// Generator for a single EventLogEntry
const arbEventLogEntry: fc.Arbitrary<EventLogEntry> = fc.record({
  id: fc.uuid(),
  timestamp: fc.date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1) }),
  message: fc.string({ minLength: 1, maxLength: 100 }),
  type: arbType,
});

// Generator for arrays of 0-200 entries
const arbEntries = fc.array(arbEventLogEntry, { minLength: 0, maxLength: 200 });

describe("EventLog - Property 11: Event log capacity invariant", () => {
  it("displays at most 50 entries and those are the most recent ones (first 50 from input)", () => {
    fc.assert(
      fc.property(arbEntries, (entries) => {
        const { unmount, container } = render(<EventLog entries={entries} />);

        // The component renders each entry as a div with font-mono class
        const renderedEntries = container.querySelectorAll(".font-mono");
        const renderedCount = renderedEntries.length;

        // Assert: at most 50 entries are displayed
        expect(renderedCount).toBeLessThanOrEqual(50);

        // Assert: displayed count is min(entries.length, 50)
        const expectedCount = Math.min(entries.length, 50);
        expect(renderedCount).toBe(expectedCount);

        // Assert: the rendered entries are the first 50 of the input
        // (parent provides entries newest-first, component slices first maxEntries)
        const expectedEntries = entries.slice(0, 50);
        expectedEntries.forEach((entry, index) => {
          const entryEl = renderedEntries[index];
          expect(entryEl.textContent).toContain(entry.message);
        });

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
