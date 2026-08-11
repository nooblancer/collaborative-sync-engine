import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MetricsDashboard, { getLatencyColor } from "./MetricsDashboard";

// ---------------------------------------------------------------------------
// Mock useSyncEngine hook
// ---------------------------------------------------------------------------

const mockSubscribe = vi.fn(() => vi.fn());
const mockSendOperation = vi.fn();
const mockSendControl = vi.fn();

vi.mock("@/hooks/use-sync-engine", () => ({
  useSyncEngine: () => ({
    connectionState: "connected",
    metrics: {
      opsPerSecond: 1250,
      throughputHistory: [100, 200, 300, 400, 500, 600],
      p50LatencyMs: 2.3,
      p95LatencyMs: 15.0,
      p99LatencyMs: 42.5,
      activeConnections: 12,
      activeRooms: 3,
      totalOpsProcessed: 150000,
    },
    sendOperation: mockSendOperation,
    sendControl: mockSendControl,
    subscribe: mockSubscribe,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetricsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the header with Live Metrics title", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("Live Metrics")).toBeInTheDocument();
  });

  it("displays ops/sec metric", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("Ops/sec")).toBeInTheDocument();
  });

  it("displays P50 and P99 latency labels", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("P50")).toBeInTheDocument();
    expect(screen.getByText("P99")).toBeInTheDocument();
  });

  it("displays connections count", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("Connections")).toBeInTheDocument();
  });

  it("displays rooms count", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("Rooms")).toBeInTheDocument();
  });

  it("displays total operations label", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("Total Ops")).toBeInTheDocument();
  });

  it("renders throughput chart section", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("Throughput (60s rolling)")).toBeInTheDocument();
  });

  it("subscribes to the metrics channel on mount", () => {
    render(<MetricsDashboard />);
    expect(mockSubscribe).toHaveBeenCalledWith("metrics", expect.any(Function));
  });

  it("shows connection status indicator", () => {
    render(<MetricsDashboard />);
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("renders throughput chart bars when history has data", () => {
    render(<MetricsDashboard />);
    const chart = screen.getByRole("img", { name: /throughput/i });
    expect(chart).toBeInTheDocument();
    // Should have bar elements (6 data points from mock)
    expect(chart.children.length).toBe(6);
  });
});

describe("getLatencyColor", () => {
  it("returns green when value is well below target", () => {
    expect(getLatencyColor(1, 5)).toBe("text-success");
    expect(getLatencyColor(2, 50)).toBe("text-success");
  });

  it("returns yellow when value is near target (within 10%)", () => {
    expect(getLatencyColor(4.8, 5)).toBe("text-warning");
    expect(getLatencyColor(5, 5)).toBe("text-warning");
    expect(getLatencyColor(5.5, 5)).toBe("text-warning");
    expect(getLatencyColor(48, 50)).toBe("text-warning");
    expect(getLatencyColor(50, 50)).toBe("text-warning");
  });

  it("returns red when value is above target", () => {
    expect(getLatencyColor(6, 5)).toBe("text-destructive");
    expect(getLatencyColor(60, 50)).toBe("text-destructive");
    expect(getLatencyColor(100, 50)).toBe("text-destructive");
  });
});
