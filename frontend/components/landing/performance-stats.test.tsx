import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import PerformanceStats from "./performance-stats";

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

let intersectionCallback: IntersectionObserverCallback;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockObserve.mockClear();
  mockDisconnect.mockClear();

  global.IntersectionObserver = vi.fn((callback) => {
    intersectionCallback = callback;
    return {
      observe: mockObserve,
      disconnect: mockDisconnect,
      unobserve: vi.fn(),
      root: null,
      rootMargin: "",
      thresholds: [],
      takeRecords: () => [],
    };
  }) as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PerformanceStats", () => {
  it("renders the section heading", () => {
    render(<PerformanceStats />);
    expect(screen.getByText("Performance at Scale")).toBeInTheDocument();
  });

  it("renders all stat labels", () => {
    render(<PerformanceStats />);
    expect(screen.getByText("Operations / Second")).toBeInTheDocument();
    expect(screen.getByText("P50 Latency")).toBeInTheDocument();
    expect(screen.getByText("P99 Latency")).toBeInTheDocument();
    expect(screen.getByText("Concurrent Connections")).toBeInTheDocument();
    expect(screen.getByText("Queue Capacity")).toBeInTheDocument();
    expect(screen.getByText("Property Tests")).toBeInTheDocument();
  });

  it("starts with values at 0 before scroll trigger", () => {
    render(<PerformanceStats />);
    // Check that the stat cards contain "0" text nodes before animation triggers
    const statCards = screen.getAllByText("0");
    // At least the stats without prefix should show "0"
    expect(statCards.length).toBeGreaterThanOrEqual(4);
  });

  it("observes the section element for intersection", () => {
    render(<PerformanceStats />);
    expect(mockObserve).toHaveBeenCalledTimes(1);
  });

  it("triggers animation when section enters viewport", async () => {
    render(<PerformanceStats />);

    // Simulate intersection
    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    // Advance time past animation duration
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // After animation, we should see target values
    const elements = screen.getAllByText((_, element) => {
      return (
        element?.tagName === "SPAN" &&
        element?.textContent?.includes("50,000") &&
        element?.classList.contains("font-mono")
      ) ?? false;
    });
    expect(elements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("43")).toBeInTheDocument();
  });

  it("only triggers animation once (not on re-scroll)", async () => {
    render(<PerformanceStats />);

    // Trigger intersection first time
    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Trigger intersection again (simulate scroll out and back in)
    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Values should still be at target (not reset to 0)
    const elements = screen.getAllByText((_, element) => {
      return (
        element?.tagName === "SPAN" &&
        element?.textContent?.includes("50,000") &&
        element?.classList.contains("font-mono")
      ) ?? false;
    });
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("disconnects observer on unmount", () => {
    const { unmount } = render(<PerformanceStats />);
    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
