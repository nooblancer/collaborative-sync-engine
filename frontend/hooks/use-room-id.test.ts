import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";

// Mock next/navigation
const mockGet = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: mockGet,
  }),
}));

import { useRoomId } from "./use-room-id";

describe("useRoomId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue(null);
  });

  it("returns room ID from query param when present", () => {
    mockGet.mockReturnValue("my-room-123");
    const { result } = renderHook(() => useRoomId({ prefix: "whiteboard" }));
    expect(result.current.roomId).toBe("my-room-123");
  });

  it("generates a room ID in correct format when no query param", () => {
    mockGet.mockReturnValue(null);
    const { result } = renderHook(() => useRoomId({ prefix: "whiteboard" }));
    expect(result.current.roomId).toMatch(/^whiteboard-[a-z0-9]{6}$/);
  });

  it("returns the same room ID across re-renders (stability)", () => {
    mockGet.mockReturnValue(null);
    const { result, rerender } = renderHook(() =>
      useRoomId({ prefix: "whiteboard" })
    );
    const firstId = result.current.roomId;
    rerender();
    expect(result.current.roomId).toBe(firstId);
  });

  it("sanitizes prefix with invalid characters", () => {
    mockGet.mockReturnValue(null);
    const { result } = renderHook(() =>
      useRoomId({ prefix: "my_page!@#" })
    );
    expect(result.current.roomId).toMatch(/^mypage-[a-z0-9]{6}$/);
  });

  it("getShareUrl returns URL with room query param", () => {
    mockGet.mockReturnValue(null);
    // Set up window.location
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/whiteboard" },
      writable: true,
    });

    const { result } = renderHook(() => useRoomId({ prefix: "whiteboard" }));
    const shareUrl = result.current.getShareUrl();
    const url = new URL(shareUrl);
    expect(url.searchParams.get("room")).toBe(result.current.roomId);
  });

  it("copyShareUrl returns false when clipboard is unavailable", async () => {
    mockGet.mockReturnValue(null);
    // Remove clipboard API
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useRoomId({ prefix: "whiteboard" }));
    const success = await result.current.copyShareUrl();
    expect(success).toBe(false);
  });

  it("copyShareUrl returns true when clipboard is available", async () => {
    mockGet.mockReturnValue(null);
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/whiteboard" },
      writable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useRoomId({ prefix: "whiteboard" }));
    const success = await result.current.copyShareUrl();
    expect(success).toBe(true);
  });
});
