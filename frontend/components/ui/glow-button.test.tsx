import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { GlowButton } from "./glow-button";

describe("GlowButton", () => {
  it("renders with text content", () => {
    render(<GlowButton>Click me</GlowButton>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("applies primary variant by default", () => {
    const { container } = render(<GlowButton>Primary</GlowButton>);
    const button = container.firstChild as HTMLElement;
    expect(button.className).toContain("bg-accent");
  });

  it("applies secondary variant", () => {
    const { container } = render(
      <GlowButton variant="secondary">Secondary</GlowButton>
    );
    const button = container.firstChild as HTMLElement;
    expect(button.className).toContain("glass-interactive");
  });

  it("handles onClick events", () => {
    const onClick = vi.fn();
    render(<GlowButton onClick={onClick}>Click</GlowButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("can be disabled", () => {
    const onClick = vi.fn();
    render(
      <GlowButton disabled onClick={onClick}>
        Disabled
      </GlowButton>
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies disabled styles", () => {
    const { container } = render(
      <GlowButton disabled>Disabled</GlowButton>
    );
    const button = container.firstChild as HTMLElement;
    expect(button.className).toContain("disabled:opacity-50");
  });

  it("applies size variants", () => {
    const { container: sm } = render(
      <GlowButton size="sm">Small</GlowButton>
    );
    expect((sm.firstChild as HTMLElement).className).toContain("h-9");

    const { container: lg } = render(
      <GlowButton size="lg">Large</GlowButton>
    );
    expect((lg.firstChild as HTMLElement).className).toContain("h-12");
  });

  it("applies icon size", () => {
    const { container } = render(
      <GlowButton size="icon">I</GlowButton>
    );
    const button = container.firstChild as HTMLElement;
    expect(button.className).toContain("h-10");
    expect(button.className).toContain("w-10");
  });

  it("forwards ref", () => {
    const ref = { current: null } as React.RefObject<HTMLButtonElement>;
    render(<GlowButton ref={ref}>Button</GlowButton>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("merges custom className", () => {
    const { container } = render(
      <GlowButton className="custom-class">Button</GlowButton>
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("renders children including icons", () => {
    render(
      <GlowButton>
        <svg data-testid="icon" />
        <span>With Icon</span>
      </GlowButton>
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("With Icon")).toBeInTheDocument();
  });

  it("has hover glow classes for primary variant", () => {
    const { container } = render(<GlowButton>Glow</GlowButton>);
    const button = container.firstChild as HTMLElement;
    expect(button.className).toContain("hover:shadow-glow");
  });

  it("has hover glow classes for secondary variant", () => {
    const { container } = render(
      <GlowButton variant="secondary">Glow</GlowButton>
    );
    const button = container.firstChild as HTMLElement;
    expect(button.className).toContain("hover:shadow-glow-sm");
  });
});
