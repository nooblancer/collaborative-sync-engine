import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BenchmarkModeSelector } from "@/components/stress-test/BenchmarkModeSelector";
import { ConflictResultsDisplay } from "@/components/stress-test/ConflictResultsDisplay";
import { RoomsResultsDisplay } from "@/components/stress-test/RoomsResultsDisplay";
import { BreakdownResultsDisplay } from "@/components/stress-test/BreakdownResultsDisplay";
import { SnapshotResultsDisplay } from "@/components/stress-test/SnapshotResultsDisplay";
import type {
  BenchmarkMode,
  ModeSpecificParams,
  ConflictBenchmarkResponse,
  RoomsBenchmarkResponse,
  BreakdownBenchmarkResponse,
  SnapshotBenchmarkResponse,
} from "@/lib/stress-test-types";

// --- BenchmarkModeSelector Tests ---

describe("BenchmarkModeSelector", () => {
  const defaultProps = {
    selectedMode: "standard" as BenchmarkMode,
    onModeChange: vi.fn(),
    disabled: false,
    modeParams: { rooms: 5 } as ModeSpecificParams,
    onModeParamsChange: vi.fn(),
  };

  it("renders Standard as selected by default (Req 6.1)", () => {
    render(<BenchmarkModeSelector {...defaultProps} />);
    const standardBtn = screen.getByRole("radio", { name: "Standard" });
    expect(standardBtn).toHaveAttribute("aria-checked", "true");
  });

  it("renders all 5 benchmark modes (Req 6.1)", () => {
    render(<BenchmarkModeSelector {...defaultProps} />);
    expect(screen.getByRole("radio", { name: "Standard" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Conflict Resolution" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Concurrent Rooms" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Operation Breakdown" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Snapshot Cost" })).toBeInTheDocument();
  });

  it("shows room count input only when rooms mode is selected (Req 6.2)", () => {
    const { rerender } = render(<BenchmarkModeSelector {...defaultProps} />);
    // Standard mode: no room count input
    expect(screen.queryByLabelText(/Number of concurrent rooms/)).not.toBeInTheDocument();

    // Rooms mode: room count input visible
    rerender(
      <BenchmarkModeSelector {...defaultProps} selectedMode="rooms" />
    );
    expect(screen.getByLabelText(/Number of concurrent rooms/)).toBeInTheDocument();
  });

  it("does not show room count input for non-rooms modes (Req 6.2)", () => {
    const modes: BenchmarkMode[] = ["standard", "conflict", "breakdown", "snapshot"];
    for (const mode of modes) {
      const { unmount } = render(
        <BenchmarkModeSelector {...defaultProps} selectedMode={mode} />
      );
      expect(screen.queryByLabelText(/Number of concurrent rooms/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("disables all radio buttons during benchmark run (Req 6.4)", () => {
    render(<BenchmarkModeSelector {...defaultProps} disabled={true} />);
    const radios = screen.getAllByRole("radio");
    for (const radio of radios) {
      expect(radio).toBeDisabled();
    }
  });

  it("disables room count input during benchmark run (Req 6.4)", () => {
    render(
      <BenchmarkModeSelector
        {...defaultProps}
        selectedMode="rooms"
        disabled={true}
      />
    );
    const input = screen.getByLabelText(/Number of concurrent rooms/);
    expect(input).toBeDisabled();
  });

  it("calls onModeChange when a mode button is clicked", () => {
    const onModeChange = vi.fn();
    render(
      <BenchmarkModeSelector {...defaultProps} onModeChange={onModeChange} />
    );
    fireEvent.click(screen.getByRole("radio", { name: "Conflict Resolution" }));
    expect(onModeChange).toHaveBeenCalledWith("conflict");
  });

  it("displays mode description for selected mode", () => {
    render(
      <BenchmarkModeSelector {...defaultProps} selectedMode="conflict" />
    );
    expect(
      screen.getByText(/Stresses the merge engine with high-contention workloads/)
    ).toBeInTheDocument();
  });
});

// --- ConflictResultsDisplay Tests ---

describe("ConflictResultsDisplay", () => {
  const baseResults: ConflictBenchmarkResponse = {
    mode: "conflict",
    totalOps: 50000,
    elapsedMs: 1200,
    opsPerSecond: 41666,
    p50Ms: 0.02,
    p99Ms: 0.15,
    batchesProcessed: 50,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
    memoryPeakMb: 85.5,
    memoryDeltaMb: 12.3,
    conflictResolutions: 4200,
    finalStateItemCount: 10,
  };

  it("displays conflict resolution count and final state size (Req 1.5)", () => {
    render(<ConflictResultsDisplay results={baseResults} />);
    expect(screen.getByText("Conflicts Resolved")).toBeInTheDocument();
    expect(screen.getByText("Final State Size")).toBeInTheDocument();
  });

  it("displays memory metrics when non-null (Req 2.5)", () => {
    render(<ConflictResultsDisplay results={baseResults} />);
    expect(screen.getByText("Peak Heap")).toBeInTheDocument();
    expect(screen.getByText("Memory Delta")).toBeInTheDocument();
  });

  it("hides memory section when fields are null (Req 2.5)", () => {
    const nullMemResults: ConflictBenchmarkResponse = {
      ...baseResults,
      memoryPeakMb: null,
      memoryDeltaMb: null,
    };
    render(<ConflictResultsDisplay results={nullMemResults} />);
    expect(screen.queryByText("Peak Heap")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory Delta")).not.toBeInTheDocument();
  });
});

// --- RoomsResultsDisplay Tests ---

describe("RoomsResultsDisplay", () => {
  const baseResults: RoomsBenchmarkResponse = {
    mode: "rooms",
    totalOps: 50000,
    elapsedMs: 2500,
    opsPerSecond: 20000,
    p50Ms: 0.04,
    p99Ms: 0.25,
    batchesProcessed: 50,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
    memoryPeakMb: 90.2,
    memoryDeltaMb: 15.8,
    roomCount: 5,
    perRoom: [
      { roomIndex: 0, ops: 10000, elapsedMs: 400, opsPerSecond: 25000 },
      { roomIndex: 1, ops: 10000, elapsedMs: 450, opsPerSecond: 22222 },
      { roomIndex: 2, ops: 10000, elapsedMs: 380, opsPerSecond: 26315 },
      { roomIndex: 3, ops: 10000, elapsedMs: 500, opsPerSecond: 20000 },
      { roomIndex: 4, ops: 10000, elapsedMs: 420, opsPerSecond: 23809 },
    ],
    slowestRoomMs: 500,
    fastestRoomMs: 380,
    averageRoomMs: 430,
  };

  it("displays per-room summary metrics (Req 3.6)", () => {
    render(<RoomsResultsDisplay results={baseResults} />);
    expect(screen.getByText("Fastest Room")).toBeInTheDocument();
    expect(screen.getByText("Slowest Room")).toBeInTheDocument();
    expect(screen.getByText("Average Room")).toBeInTheDocument();
  });

  it("displays room count in aggregate metrics (Req 3.6)", () => {
    render(<RoomsResultsDisplay results={baseResults} />);
    expect(screen.getByText("Rooms")).toBeInTheDocument();
  });

  it("hides memory section when fields are null", () => {
    const nullMemResults: RoomsBenchmarkResponse = {
      ...baseResults,
      memoryPeakMb: null,
      memoryDeltaMb: null,
    };
    render(<RoomsResultsDisplay results={nullMemResults} />);
    expect(screen.queryByText("Peak Heap")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory Delta")).not.toBeInTheDocument();
  });
});

// --- BreakdownResultsDisplay Tests ---

describe("BreakdownResultsDisplay", () => {
  const baseResults: BreakdownBenchmarkResponse = {
    mode: "breakdown",
    totalOps: 9000,
    elapsedMs: 800,
    opsPerSecond: 11250,
    p50Ms: 0.08,
    p99Ms: 0.45,
    batchesProcessed: 9,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
    memoryPeakMb: 72.1,
    memoryDeltaMb: 8.4,
    add: { count: 3000, totalMs: 250, averageMs: 0.083, p50Ms: 0.07, p99Ms: 0.4 },
    update: { count: 3000, totalMs: 280, averageMs: 0.093, p50Ms: 0.08, p99Ms: 0.5 },
    remove: { count: 3000, totalMs: 270, averageMs: 0.09, p50Ms: 0.075, p99Ms: 0.45 },
  };

  it("displays per-type metrics in comparative layout (Req 4.4)", () => {
    render(<BreakdownResultsDisplay results={baseResults} />);
    expect(screen.getByText("Add")).toBeInTheDocument();
    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(screen.getByText("Per-Type Timing Comparison")).toBeInTheDocument();
  });

  it("displays aggregate metrics alongside breakdown (Req 4.4)", () => {
    render(<BreakdownResultsDisplay results={baseResults} />);
    expect(screen.getByText("Total Ops")).toBeInTheDocument();
    expect(screen.getByText("Ops/sec")).toBeInTheDocument();
  });

  it("hides memory section when fields are null", () => {
    const nullMemResults: BreakdownBenchmarkResponse = {
      ...baseResults,
      memoryPeakMb: null,
      memoryDeltaMb: null,
    };
    render(<BreakdownResultsDisplay results={nullMemResults} />);
    expect(screen.queryByText("Peak Heap")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory Delta")).not.toBeInTheDocument();
  });
});

// --- SnapshotResultsDisplay Tests ---

describe("SnapshotResultsDisplay", () => {
  const baseResults: SnapshotBenchmarkResponse = {
    mode: "snapshot",
    totalOps: 50000,
    elapsedMs: 3500,
    opsPerSecond: 14285,
    p50Ms: 0.06,
    p99Ms: 0.3,
    batchesProcessed: 50,
    mergeEngine: "rust-napi-rs",
    timestamp: new Date().toISOString(),
    memoryPeakMb: 100.5,
    memoryDeltaMb: 20.2,
    snapshotDurationMs: 45.123,
    itemsBefore: 50000,
    itemsAfter: 40000,
    tombstonesRemoved: 10000,
  };

  it("displays snapshot duration, items before/after, tombstones removed (Req 5.5)", () => {
    render(<SnapshotResultsDisplay results={baseResults} />);
    expect(screen.getByText("Snapshot Duration")).toBeInTheDocument();
    expect(screen.getByText("Items Before")).toBeInTheDocument();
    expect(screen.getByText("Items After")).toBeInTheDocument();
    expect(screen.getByText("Tombstones Removed")).toBeInTheDocument();
  });

  it("displays operation application metrics (Req 5.5)", () => {
    render(<SnapshotResultsDisplay results={baseResults} />);
    expect(screen.getByText("Total Ops")).toBeInTheDocument();
    expect(screen.getByText("Ops/sec")).toBeInTheDocument();
  });

  it("hides memory section when fields are null", () => {
    const nullMemResults: SnapshotBenchmarkResponse = {
      ...baseResults,
      memoryPeakMb: null,
      memoryDeltaMb: null,
    };
    render(<SnapshotResultsDisplay results={nullMemResults} />);
    expect(screen.queryByText("Peak Heap")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory Delta")).not.toBeInTheDocument();
  });
});
