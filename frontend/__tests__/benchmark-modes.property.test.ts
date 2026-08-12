/**
 * Property-based tests for Benchmark Mode frontend correctness.
 *
 * Feature: v2.4.2, Property 13: Mode Description Minimum Length
 * Feature: v2.4.2, Property 14: Operation Count Preservation Across Mode Switches
 *
 * **Validates: Requirements 6.3, 6.5**
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import fc from "fast-check";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/constants", () => ({
  BACKEND_URL: "http://localhost:3001",
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { BenchmarkModeSelector } from "@/components/stress-test/BenchmarkModeSelector";
import { useServerBenchmark } from "@/hooks/use-server-benchmark";
import type { BenchmarkMode } from "@/lib/stress-test-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_MODES: BenchmarkMode[] = ["standard", "conflict", "rooms", "breakdown", "snapshot"];

// Arbitrary for BenchmarkMode
const arbBenchmarkMode = fc.constantFrom<BenchmarkMode>(
  "standard",
  "conflict",
  "rooms",
  "breakdown",
  "snapshot"
);

// ---------------------------------------------------------------------------
// Property 13: Mode Description Minimum Length
// ---------------------------------------------------------------------------

describe("Property 13: Mode Description Minimum Length", () => {
  afterEach(() => {
    cleanup();
  });

  it("all mode descriptions are at least 10 characters long", () => {
    /**
     * Feature: v2.4.2, Property 13: Mode Description Minimum Length
     *
     * For any benchmark mode in the mode selector, the displayed description
     * text SHALL be at least 10 characters long.
     *
     * **Validates: Requirements 6.3**
     */
    fc.assert(
      fc.property(arbBenchmarkMode, (mode: BenchmarkMode) => {
        const { container } = render(
          React.createElement(BenchmarkModeSelector, {
            selectedMode: mode,
            onModeChange: () => {},
            disabled: false,
            modeParams: { rooms: 5 },
            onModeParamsChange: () => {},
          })
        );

        // The description is rendered in a <p> with aria-live="polite"
        const description = container.querySelector('p[aria-live="polite"]');
        expect(description).not.toBeNull();
        expect(description!.textContent!.length).toBeGreaterThanOrEqual(10);

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it("each specific mode has a distinct non-trivial description", () => {
    /**
     * Feature: v2.4.2, Property 13: Mode Description Minimum Length
     *
     * Verify that for all pairs of different modes, descriptions are unique,
     * ensuring each mode has its own meaningful explanation.
     *
     * **Validates: Requirements 6.3**
     */
    fc.assert(
      fc.property(
        fc.tuple(arbBenchmarkMode, arbBenchmarkMode).filter(([a, b]) => a !== b),
        ([modeA, modeB]) => {
          const { container: containerA } = render(
            React.createElement(BenchmarkModeSelector, {
              selectedMode: modeA,
              onModeChange: () => {},
              disabled: false,
              modeParams: { rooms: 5 },
              onModeParamsChange: () => {},
            })
          );
          const descA = containerA.querySelector('p[aria-live="polite"]')!.textContent!;
          cleanup();

          const { container: containerB } = render(
            React.createElement(BenchmarkModeSelector, {
              selectedMode: modeB,
              onModeChange: () => {},
              disabled: false,
              modeParams: { rooms: 5 },
              onModeParamsChange: () => {},
            })
          );
          const descB = containerB.querySelector('p[aria-live="polite"]')!.textContent!;
          cleanup();

          expect(descA).not.toBe(descB);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Operation Count Preservation Across Mode Switches
// ---------------------------------------------------------------------------

describe("Property 14: Operation Count Preservation Across Mode Switches", () => {
  it("operation count remains unchanged after any sequence of mode switches", () => {
    /**
     * Feature: v2.4.2, Property 14: Operation Count Preservation Across Mode Switches
     *
     * For any sequence of mode switches in the UI, the selected operation
     * count SHALL remain unchanged when switching between modes.
     *
     * **Validates: Requirements 6.5**
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.array(arbBenchmarkMode, { minLength: 1, maxLength: 10 }),
        (initialOps: number, modeSequence: BenchmarkMode[]) => {
          const { result } = renderHook(() => useServerBenchmark());

          // Set the initial operation count
          act(() => {
            result.current.setSelectedOps(initialOps);
          });

          // Verify initial ops were set
          expect(result.current.selectedOps).toBe(initialOps);

          // Switch modes in sequence
          for (const mode of modeSequence) {
            act(() => {
              result.current.setSelectedMode(mode);
            });
          }

          // After all mode switches, ops should remain unchanged
          expect(result.current.selectedOps).toBe(initialOps);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("mode-specific params reset to defaults on mode switch but ops remain stable", () => {
    /**
     * Feature: v2.4.2, Property 14: Operation Count Preservation Across Mode Switches
     *
     * Verify that while mode-specific parameters (like room count) reset
     * on switch, the operation count is never affected.
     *
     * **Validates: Requirements 6.5**
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 2, max: 50 }),
        arbBenchmarkMode,
        (ops: number, customRooms: number, targetMode: BenchmarkMode) => {
          const { result } = renderHook(() => useServerBenchmark());

          // Set a custom ops value
          act(() => {
            result.current.setSelectedOps(ops);
          });

          // Switch to rooms mode and set custom room count
          act(() => {
            result.current.setSelectedMode("rooms");
          });
          act(() => {
            result.current.setModeParams({ rooms: customRooms });
          });

          // Verify custom room count is set
          expect(result.current.modeParams.rooms).toBe(customRooms);
          // Verify ops hasn't changed
          expect(result.current.selectedOps).toBe(ops);

          // Switch to a different mode
          act(() => {
            result.current.setSelectedMode(targetMode);
          });

          // Ops should still be preserved
          expect(result.current.selectedOps).toBe(ops);
          // Mode params should be reset to defaults
          expect(result.current.modeParams.rooms).toBe(5);
        }
      ),
      { numRuns: 100 }
    );
  });
});
