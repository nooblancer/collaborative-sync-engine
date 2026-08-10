import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders text content", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders with default variant styling", () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText("Default");
    expect(badge).toHaveClass("bg-primary", "text-primary-foreground");
  });

  it("renders with secondary variant styling", () => {
    render(<Badge variant="secondary">Secondary</Badge>);
    const badge = screen.getByText("Secondary");
    expect(badge).toHaveClass("bg-muted", "text-foreground");
  });

  it("renders with destructive variant styling", () => {
    render(<Badge variant="destructive">Error</Badge>);
    const badge = screen.getByText("Error");
    expect(badge).toHaveClass("bg-destructive", "text-foreground");
  });

  it("renders with outline variant styling", () => {
    render(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText("Outline");
    expect(badge).toHaveClass("border-border", "text-foreground");
  });

  it("applies custom className", () => {
    render(<Badge className="ml-2">Custom</Badge>);
    const badge = screen.getByText("Custom");
    expect(badge).toHaveClass("ml-2");
  });

  it("renders as a div element with correct base styles", () => {
    render(<Badge>Styled</Badge>);
    const badge = screen.getByText("Styled");
    expect(badge.tagName).toBe("DIV");
    expect(badge).toHaveClass("inline-flex", "items-center", "rounded-full", "text-xs", "font-semibold");
  });
});
