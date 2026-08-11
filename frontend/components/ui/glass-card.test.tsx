import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GlassCard } from "./glass-card";

describe("GlassCard", () => {
  it("renders children", () => {
    render(<GlassCard>Card content</GlassCard>);
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("applies default glass class", () => {
    const { container } = render(<GlassCard>Content</GlassCard>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("glass");
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("p-5");
  });

  it("applies subtle variant", () => {
    const { container } = render(
      <GlassCard variant="subtle">Content</GlassCard>
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("glass-subtle");
  });

  it("applies strong variant", () => {
    const { container } = render(
      <GlassCard variant="strong">Content</GlassCard>
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("glass-strong");
  });

  it("applies interactive variant", () => {
    const { container } = render(
      <GlassCard variant="interactive">Content</GlassCard>
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("glass-interactive");
  });

  it("applies padding variants", () => {
    const { container } = render(
      <GlassCard padding="lg">Content</GlassCard>
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("p-8");
  });

  it("applies no padding", () => {
    const { container } = render(
      <GlassCard padding="none">Content</GlassCard>
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("p-0");
  });

  it("merges custom className", () => {
    const { container } = render(
      <GlassCard className="my-custom-class">Content</GlassCard>
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("my-custom-class");
  });

  it("forwards ref", () => {
    const ref = { current: null } as React.RefObject<HTMLDivElement>;
    render(<GlassCard ref={ref}>Content</GlassCard>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("passes through additional HTML attributes", () => {
    render(<GlassCard data-testid="glass-card">Content</GlassCard>);
    expect(screen.getByTestId("glass-card")).toBeInTheDocument();
  });
});
