import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock next/navigation
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe("Demo Page Redirect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReplace.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("redirects to /#demos on mount", async () => {
    const { default: DemoRedirectPage } = await import("./page");

    await act(async () => {
      render(<DemoRedirectPage />);
    });

    expect(mockReplace).toHaveBeenCalledWith("/#demos");
  });

  it("renders nothing (null) while redirecting", async () => {
    const { default: DemoRedirectPage } = await import("./page");

    let container: ReturnType<typeof render>;
    await act(async () => {
      container = render(<DemoRedirectPage />);
    });

    expect(container!.container.innerHTML).toBe("");
  });
});
