/**
 * Unit tests for StressTestPage layout
 *
 * Feature: v2.4-stress-test-page
 * Validates: Requirements 1.3, 1.4, 8.4
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-room-id", () => ({
  useRoomId: () => ({
    roomId: "stress-test-abc123",
    getShareUrl: () => "http://localhost/stress-test?room=stress-test-abc123",
    copyShareUrl: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/stress-test/PageHeader", () => ({
  PageHeader: () => <div data-testid="page-header">PageHeader</div>,
}));

vi.mock("@/components/stress-test/ServerBenchmarkSection", () => ({
  ServerBenchmarkSection: () => (
    <div data-testid="server-benchmark">ServerBenchmark</div>
  ),
}));

vi.mock("@/components/stress-test/BrowserBenchmarkSection", () => ({
  BrowserBenchmarkSection: ({ roomId }: { roomId: string }) => (
    <div data-testid="browser-benchmark" data-room-id={roomId}>
      BrowserBenchmark
    </div>
  ),
}));

vi.mock("@/components/stress-test/ExplanationPanel", () => ({
  ExplanationPanel: () => (
    <div data-testid="explanation-panel">ExplanationPanel</div>
  ),
}));

// Import after mocks are set up
import StressTestPage from "@/app/stress-test/page";

describe("StressTestPage", () => {
  it("renders all four sections", () => {
    render(<StressTestPage />);

    expect(screen.getByTestId("page-header")).toBeInTheDocument();
    expect(screen.getByTestId("server-benchmark")).toBeInTheDocument();
    expect(screen.getByTestId("browser-benchmark")).toBeInTheDocument();
    expect(screen.getByTestId("explanation-panel")).toBeInTheDocument();
  });

  it("has responsive grid classes (grid-cols-1 and lg:grid-cols-2)", () => {
    const { container } = render(<StressTestPage />);

    const gridElement = container.querySelector(
      ".grid.grid-cols-1.lg\\:grid-cols-2"
    );
    expect(gridElement).toBeInTheDocument();
  });

  it("passes roomId to BrowserBenchmarkSection", () => {
    render(<StressTestPage />);

    const browserSection = screen.getByTestId("browser-benchmark");
    expect(browserSection).toHaveAttribute("data-room-id", "stress-test-abc123");
  });

  it("applies dark gradient background style on main element", () => {
    const { container } = render(<StressTestPage />);

    const main = container.querySelector("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveStyle({
      background: "linear-gradient(to bottom, #050510, #0a0a1a)",
    });
  });
});
