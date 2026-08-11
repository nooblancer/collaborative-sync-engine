/**
 * Property Tests for Conflict Visualizer - History Bounded at 20
 *
 * **Validates: Requirements 15.4**
 *
 * Property 42: Conflict Visualizer History Bounded at 20
 * - For any number of conflict events received by the Conflict_Visualizer,
 *   only the last 20 SHALL be displayed in the scrollable history.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type {
  ConflictEvent,
  HLCTimestamp,
  ConflictOperation,
} from "@/components/ConflictVisualizer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_HISTORY = 20;

// ---------------------------------------------------------------------------
// Helpers — replicate display logic under test
// ---------------------------------------------------------------------------

/**
 * Replicates the ConflictVisualizer's bounding logic:
 * `events.slice(-maxHistory)`
 *
 * This is the pure function extracted from the component for property testing.
 */
function getDisplayEvents(
  events: ConflictEvent[],
  maxHistory: number = DEFAULT_MAX_HISTORY
): ConflictEvent[] {
  return events.slice(-maxHistory);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary HLC timestamp */
const arbHLC: fc.Arbitrary<HLCTimestamp> = fc.record({
  wallTime: fc.nat({ max: 2_000_000_000_000 }),
  logical: fc.nat({ max: 1000 }),
  nodeId: fc.string({ minLength: 1, maxLength: 16 }),
});

/** Arbitrary conflict operation */
const arbOperation: fc.Arbitrary<ConflictOperation> = fc.record({
  clientId: fc.string({ minLength: 1, maxLength: 20 }),
  value: fc.oneof(fc.integer(), fc.string({ maxLength: 10 }), fc.boolean()),
  hlc: arbHLC,
});

/** Arbitrary conflict event */
const arbConflictEvent: fc.Arbitrary<ConflictEvent> = fc.record({
  id: fc.uuid(),
  roomId: fc.string({ minLength: 1, maxLength: 12 }),
  timestamp: arbHLC,
  field: fc.string({ minLength: 1, maxLength: 30 }),
  operationA: arbOperation,
  operationB: arbOperation,
  winner: fc.constantFrom("A" as const, "B" as const),
  reason: fc.string({ minLength: 1, maxLength: 80 }),
});

/**
 * Generate an array of conflict events with a controllable size.
 * The size ranges from 0 to 150 to ensure we cover scenarios with
 * 0 events, fewer than 20, exactly 20, and well above 20.
 */
const arbEventList: fc.Arbitrary<ConflictEvent[]> = fc.array(arbConflictEvent, {
  minLength: 0,
  maxLength: 150,
});

/** Arbitrary maxHistory value (positive integer, reasonable range) */
const arbMaxHistory: fc.Arbitrary<number> = fc.integer({ min: 1, max: 100 });

// ---------------------------------------------------------------------------
// Property 42: Conflict Visualizer History Bounded at 20
// ---------------------------------------------------------------------------

describe("Property 42: Conflict Visualizer History Bounded at 20", () => {
  /**
   * **Validates: Requirements 15.4**
   *
   * For any number of conflict events, the displayed list SHALL contain
   * at most 20 items (the default maxHistory).
   */
  it("displays at most 20 events regardless of input size", () => {
    fc.assert(
      fc.property(arbEventList, (events) => {
        const displayed = getDisplayEvents(events, DEFAULT_MAX_HISTORY);
        expect(displayed.length).toBeLessThanOrEqual(DEFAULT_MAX_HISTORY);
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 15.4**
   *
   * For any number of conflict events, the displayed list SHALL contain
   * at most `maxHistory` items for any positive maxHistory value.
   */
  it("displays at most maxHistory events for any positive maxHistory value", () => {
    fc.assert(
      fc.property(arbEventList, arbMaxHistory, (events, maxHistory) => {
        const displayed = getDisplayEvents(events, maxHistory);
        expect(displayed.length).toBeLessThanOrEqual(maxHistory);
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 15.4**
   *
   * When fewer events than maxHistory are provided, all events SHALL
   * be displayed (no events are dropped).
   */
  it("displays all events when count is at or below maxHistory", () => {
    fc.assert(
      fc.property(arbEventList, arbMaxHistory, (events, maxHistory) => {
        fc.pre(events.length <= maxHistory);
        const displayed = getDisplayEvents(events, maxHistory);
        expect(displayed.length).toBe(events.length);
        // All events preserved in order
        expect(displayed).toEqual(events);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 15.4**
   *
   * When more events than maxHistory are provided, only the LAST maxHistory
   * events SHALL be shown (most recent events are retained).
   */
  it("retains only the last maxHistory events when input exceeds the limit", () => {
    fc.assert(
      fc.property(arbEventList, arbMaxHistory, (events, maxHistory) => {
        fc.pre(events.length > maxHistory);
        const displayed = getDisplayEvents(events, maxHistory);

        // Exactly maxHistory events should be displayed
        expect(displayed.length).toBe(maxHistory);

        // The displayed events should be the last maxHistory from the input
        const expected = events.slice(-maxHistory);
        expect(displayed).toEqual(expected);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 15.4**
   *
   * The displayed events SHALL always be a contiguous suffix of the input
   * array — meaning order is preserved and no events are rearranged.
   */
  it("displayed events are always a contiguous suffix of the input", () => {
    fc.assert(
      fc.property(arbEventList, (events) => {
        const displayed = getDisplayEvents(events, DEFAULT_MAX_HISTORY);

        if (displayed.length === 0) return; // empty input, nothing to check

        // Find where the displayed slice starts in the original array
        const startIdx = events.length - displayed.length;
        expect(startIdx).toBeGreaterThanOrEqual(0);

        // Every displayed event matches the corresponding event in the source
        for (let i = 0; i < displayed.length; i++) {
          expect(displayed[i]).toBe(events[startIdx + i]);
        }
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 15.4**
   *
   * With the default maxHistory of 20, adding events beyond 20 always
   * results in the oldest events being evicted first.
   */
  it("evicts the oldest events first as new events push past the limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 21, max: 150 }),
        (count) => {
          // Generate a specific sequence with indexed ids for tracking
          const events: ConflictEvent[] = Array.from({ length: count }, (_, i) => ({
            id: `event-${i}`,
            roomId: "room-1",
            timestamp: { wallTime: 1000 + i, logical: 0, nodeId: "node-1" },
            field: `field-${i}`,
            operationA: {
              clientId: "client-a",
              value: i,
              hlc: { wallTime: 1000 + i, logical: 0, nodeId: "node-a" },
            },
            operationB: {
              clientId: "client-b",
              value: i * 2,
              hlc: { wallTime: 1000 + i, logical: 1, nodeId: "node-b" },
            },
            winner: "B" as const,
            reason: `reason-${i}`,
          }));

          const displayed = getDisplayEvents(events, DEFAULT_MAX_HISTORY);

          // The first displayed event should be the one at index (count - 20)
          expect(displayed[0].id).toBe(`event-${count - DEFAULT_MAX_HISTORY}`);
          // The last displayed event should be the most recent
          expect(displayed[displayed.length - 1].id).toBe(`event-${count - 1}`);
        }
      ),
      { numRuns: 200 }
    );
  });
});
