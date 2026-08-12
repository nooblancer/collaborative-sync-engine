/**
 * Property-based test for ServerBenchmarkSection results display completeness
 *
 * Feature: v2.4-stress-test-page, Property 6: Server benchmark results display completeness
 * **Validates: Requirements 3.5**
 *
 * For any valid BenchmarkResponse, when the ServerBenchmarkSection displays results,
 * all 6 metric labels are rendered in the DOM. This ensures no metric is accidentally
 * omitted during refactoring.
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-server-benchmark", () => ({
  useServerBenchmark: vi.fn(),
}));

import { ServerBenchmarkSection } from "../ServerBenchmarkSection";
import { useServerBenchmark } from "@/hooks/use-server-benchmark";

const mockedUseServerBenchmark = vi.mocked(useServerBenchmark);

// Generator for valid BenchmarkModeResponse objects (standard mode)
const benchmarkResponseArb = fc.record({
  mode: fc.constant("standard" as const),
  totalOps: fc.integer({ min: 1, max: 10_000_000 }),
  elapsedMs: fc.double({ min: 0.01, max: 100_000, noNaN: true }),
  opsPerSecond: fc.integer({ min: 1, max: 10_000_000 }),
  p50Ms: fc.double({ min: 0.001, max: 1000, noNaN: true }),
  p99Ms: fc.double({ min: 0.001, max: 5000, noNaN: true }),
  batchesProcessed: fc.integer({ min: 1, max: 100_000 }),
  mergeEngine: fc.constant("rust-napi-rs" as const),
  timestamp: fc.date().map((d) => d.toISOString()),
  memoryPeakMb: fc.constant(null),
  memoryDeltaMb: fc.constant(null),
});

// Feature: v2.4-stress-test-page, Property 6: Server benchmark results display completeness
describe("Feature: v2.4-stress-test-page, Property 6: Server benchmark results display completeness", () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * For any valid BenchmarkResponse object, the rendered ServerBenchmarkSection
   * SHALL contain all six metric labels: "Total Ops", "Elapsed", "Ops/sec",
   * "P50", "P99", and "Batches".
   */
  it("renders all 6 metric labels for any valid BenchmarkResponse", () => {
    fc.assert(
      fc.property(benchmarkResponseArb, (response) => {
        mockedUseServerBenchmark.mockReturnValue({
          state: {
            status: "completed",
            results: response,
            error: null,
          },
          selectedOps: 50000,
          setSelectedOps: vi.fn(),
          selectedMode: "standard",
          setSelectedMode: vi.fn(),
          modeParams: { rooms: 5 },
          setModeParams: vi.fn(),
          runBenchmark: vi.fn().mockResolvedValue(undefined),
        });

        const { unmount } = render(<ServerBenchmarkSection />);

        const expectedLabels = [
          "Total Ops",
          "Elapsed",
          "Ops/sec",
          "P50",
          "P99",
          "Batches",
        ];

        for (const label of expectedLabels) {
          expect(screen.getByText(label)).toBeInTheDocument();
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
