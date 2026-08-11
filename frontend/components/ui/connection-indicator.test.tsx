import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConnectionIndicator } from "./connection-indicator";

describe("ConnectionIndicator", () => {
  it("renders connected status with green dot", () => {
    const { container } = render(
      <ConnectionIndicator status="connected" />
    );
    const dot = container.querySelector(".bg-success");
    expect(dot).toBeInTheDocument();
  });

  it("renders reconnecting status with yellow dot", () => {
    const { container } = render(
      <ConnectionIndicator status="reconnecting" />
    );
    const dot = container.querySelector(".bg-warning");
    expect(dot).toBeInTheDocument();
  });

  it("renders disconnected status with red dot", () => {
    const { container } = render(
      <ConnectionIndicator status="disconnected" />
    );
    const dot = container.querySelector(".bg-destructive");
    expect(dot).toBeInTheDocument();
  });

  it("displays label when provided", () => {
    render(
      <ConnectionIndicator status="connected" label="Live" />
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("has correct aria-label for accessibility", () => {
    render(
      <ConnectionIndicator status="connected" label="Server status" />
    );
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveAttribute("aria-label", "Server status");
  });

  it("uses default aria-label when no label provided", () => {
    render(<ConnectionIndicator status="disconnected" />);
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveAttribute("aria-label", "Disconnected");
  });

  it("shows icon when showIcon is true", () => {
    const { container } = render(
      <ConnectionIndicator status="connected" showIcon />
    );
    // Lucide icons render as SVG
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("does not show icon by default", () => {
    const { container } = render(
      <ConnectionIndicator status="connected" />
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeInTheDocument();
  });

  it("applies animate-pulse for reconnecting dot", () => {
    const { container } = render(
      <ConnectionIndicator status="reconnecting" />
    );
    const dot = container.querySelector(".animate-pulse");
    expect(dot).toBeInTheDocument();
  });

  it("applies size variants", () => {
    const { container: sm } = render(
      <ConnectionIndicator status="connected" size="sm" />
    );
    expect(sm.querySelector(".h-2")).toBeInTheDocument();

    const { container: lg } = render(
      <ConnectionIndicator status="connected" size="lg" />
    );
    expect(lg.querySelector(".h-3")).toBeInTheDocument();
  });

  it("forwards ref", () => {
    const ref = { current: null } as React.RefObject<HTMLDivElement>;
    render(<ConnectionIndicator ref={ref} status="connected" />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("merges custom className", () => {
    const { container } = render(
      <ConnectionIndicator status="connected" className="custom-class" />
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });
});
