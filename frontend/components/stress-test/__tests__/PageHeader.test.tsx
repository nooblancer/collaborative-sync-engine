/**
 * Unit tests for PageHeader component
 *
 * Feature: v2.4-stress-test-page
 * Validates: Requirements 1.2, 2.3, 8.1, 8.2
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageHeader } from "../PageHeader";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => <svg data-testid="arrow-left-icon" />,
  Share2: () => <svg data-testid="share2-icon" />,
  Check: () => <svg data-testid="check-icon" />,
}));

describe("PageHeader", () => {
  const defaultProps = {
    onShare: vi.fn().mockResolvedValue(undefined),
    shareStatus: "idle" as const,
  };

  it("renders the title 'Stress Test Engine Benchmark'", () => {
    render(<PageHeader {...defaultProps} />);

    expect(
      screen.getByRole("heading", { name: "Stress Test Engine Benchmark" })
    ).toBeInTheDocument();
  });

  it("renders back-link with href '/' and aria-label 'Back to home'", () => {
    render(<PageHeader {...defaultProps} />);

    const backLink = screen.getByLabelText("Back to home");
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("renders share button with aria-label 'Share stress test URL'", () => {
    render(<PageHeader {...defaultProps} />);

    const shareButton = screen.getByLabelText("Share stress test URL");
    expect(shareButton).toBeInTheDocument();
  });

  it("shows 'Copied!' text when shareStatus is 'copied'", () => {
    render(<PageHeader {...defaultProps} shareStatus="copied" />);

    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });

  it("does not show 'Copied!' when shareStatus is 'idle'", () => {
    render(<PageHeader {...defaultProps} shareStatus="idle" />);

    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });

  it("calls onShare when share button is clicked", () => {
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<PageHeader onShare={onShare} shareStatus="idle" />);

    const shareButton = screen.getByLabelText("Share stress test URL");
    fireEvent.click(shareButton);

    expect(onShare).toHaveBeenCalledTimes(1);
  });
});
