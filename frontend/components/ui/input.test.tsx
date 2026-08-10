import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
  });

  it("renders with the correct type attribute", () => {
    render(<Input type="email" placeholder="Email" />);
    const input = screen.getByPlaceholderText("Email");
    expect(input).toHaveAttribute("type", "email");
  });

  it("handles focus events", () => {
    const handleFocus = vi.fn();
    render(<Input onFocus={handleFocus} placeholder="Focus me" />);
    const input = screen.getByPlaceholderText("Focus me");
    fireEvent.focus(input);
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });

  it("handles blur events", () => {
    const handleBlur = vi.fn();
    render(<Input onBlur={handleBlur} placeholder="Blur me" />);
    const input = screen.getByPlaceholderText("Blur me");
    fireEvent.blur(input);
    expect(handleBlur).toHaveBeenCalledTimes(1);
  });

  it("applies error styling when error prop is true", () => {
    render(<Input error placeholder="Error input" />);
    const input = screen.getByPlaceholderText("Error input");
    expect(input).toHaveClass("border-destructive", "focus-visible:ring-destructive");
  });

  it("does not apply error styling when error prop is false", () => {
    render(<Input error={false} placeholder="Normal input" />);
    const input = screen.getByPlaceholderText("Normal input");
    expect(input).not.toHaveClass("border-destructive");
  });

  it("supports disabled state", () => {
    render(<Input disabled placeholder="Disabled" />);
    const input = screen.getByPlaceholderText("Disabled");
    expect(input).toBeDisabled();
    expect(input).toHaveClass("disabled:cursor-not-allowed", "disabled:opacity-50");
  });

  it("applies custom className", () => {
    render(<Input className="w-64" placeholder="Custom" />);
    const input = screen.getByPlaceholderText("Custom");
    expect(input).toHaveClass("w-64");
  });

  it("handles value changes", () => {
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} placeholder="Type here" />);
    const input = screen.getByPlaceholderText("Type here");
    fireEvent.change(input, { target: { value: "hello" } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });
});
