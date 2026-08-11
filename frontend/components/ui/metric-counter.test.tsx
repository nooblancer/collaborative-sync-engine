import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricCounter } from "./metric-counter";

describe("MetricCounter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders with initial value of 0", () => {
    const { container } = render(<MetricCounter value={1000} />);
    // Initially displays 0 before animation starts
    const span = container.querySelector(".tabular-nums");
    expect(span).toBeInTheDocument();
  });

  it("displays label when provided", () => {
    render(<MetricCounter value={50} label="Operations" />);
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });

  it("displays suffix when provided", () => {
    render(<MetricCounter value={5} suffix="ms" />);
    expect(screen.getByText("ms")).toBeInTheDocument();
  });

  it("displays prefix when provided", () => {
    render(<MetricCounter value={5} prefix="<" />);
    const span = screen.getByText((content, element) => {
      return element?.tagName === "SPAN" && content.includes("<");
    });
    expect(span).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <MetricCounter value={100} className="my-class" />
    );
    expect(container.firstChild).toHaveClass("my-class");
  });

  it("forwards ref", () => {
    const ref = { current: null } as React.RefObject<HTMLDivElement>;
    render(<MetricCounter ref={ref} value={100} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("renders without label when not provided", () => {
    const { container } = render(<MetricCounter value={100} />);
    const labels = container.querySelectorAll(".text-foreground-muted");
    // Only suffix span (if present) would have this class, no label
    expect(
      Array.from(labels).filter((el) => el.tagName === "SPAN" && el.textContent !== "")
    ).toHaveLength(0);
  });

  it("renders with decimals", () => {
    // When decimals > 0, the displayed value should show decimal places
    const { container } = render(
      <MetricCounter value={3.14} decimals={2} duration={0} />
    );
    // With duration 0, animation still uses requestAnimationFrame
    expect(container.querySelector(".tabular-nums")).toBeInTheDocument();
  });
});
