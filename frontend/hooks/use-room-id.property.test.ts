// Feature: v2.3-server-benchmark, Property 5: Room ID share URL round-trip
// Feature: v2.3-server-benchmark, Property 6: Generated room ID format
// Feature: v2.3-server-benchmark, Property 7: Room ID stability across renders
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import * as fc from "fast-check";

// Mock next/navigation
const mockGet = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: mockGet,
  }),
}));

import { useRoomId } from "./use-room-id";

/**
 * Validates: Requirements 2.1, 2.4
 *
 * Property 5: Room ID share URL round-trip
 *
 * For any room ID (either extracted from URL or generated), calling getShareUrl()
 * SHALL produce a URL that, when parsed for its `room` query parameter, yields
 * the original room ID.
 */
describe("useRoomId - Property 5: Room ID share URL round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up window.location for getShareUrl() to construct URLs
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/whiteboard" },
      writable: true,
      configurable: true,
    });
  });

  it("getShareUrl() round-trips any room ID from URL query param", () => {
    // Generate room IDs that could appear in a URL query param
    const roomIdArb = fc
      .stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/)
      .filter((s) => s.length >= 2);

    fc.assert(
      fc.property(roomIdArb, (roomId) => {
        // Simulate the room ID coming from URL query param
        mockGet.mockReturnValue(roomId);

        const { result, unmount } = renderHook(() => useRoomId({ prefix: "test" }));

        // The hook should return the room ID from the query param
        expect(result.current.roomId).toBe(roomId);

        // getShareUrl() should produce a URL containing the room ID
        const shareUrl = result.current.getShareUrl();
        const parsedUrl = new URL(shareUrl);
        const extractedRoomId = parsedUrl.searchParams.get("room");

        // Round-trip: parsing the URL yields the original room ID
        expect(extractedRoomId).toBe(roomId);

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it("getShareUrl() round-trips generated room IDs (no query param)", () => {
    const prefixArb = fc
      .stringMatching(/^[a-z][a-z0-9-]{0,9}$/)
      .filter((s) => s.length >= 1);

    fc.assert(
      fc.property(prefixArb, (prefix) => {
        mockGet.mockReturnValue(null);

        const { result, unmount } = renderHook(() => useRoomId({ prefix }));

        const roomId = result.current.roomId;
        const shareUrl = result.current.getShareUrl();
        const parsedUrl = new URL(shareUrl);
        const extractedRoomId = parsedUrl.searchParams.get("room");

        // Round-trip: parsing the URL yields the original room ID
        expect(extractedRoomId).toBe(roomId);

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Validates: Requirements 2.2, 2.6
 *
 * Property 6: Generated room ID format
 *
 * For any prefix string containing only lowercase alphanumeric characters and hyphens,
 * when no `room` query parameter is present, the generated room ID SHALL match the
 * pattern `{prefix}-[a-z0-9]{6}` (prefix followed by dash followed by exactly 6
 * alphanumeric characters).
 */
describe("useRoomId - Property 6: Generated room ID format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue(null);
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/test-page" },
      writable: true,
      configurable: true,
    });
  });

  it("generated room IDs match {prefix}-[a-z0-9]{6} for any valid prefix", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        (prefix) => {
          mockGet.mockReturnValue(null);

          const { result, unmount } = renderHook(() => useRoomId({ prefix }));

          const roomId = result.current.roomId;
          const sanitizedPrefix = prefix.replace(/[^a-z0-9-]/gi, "").toLowerCase();
          const escapedPrefix = sanitizedPrefix.replace(/[-]/g, "\\-");
          const expectedPattern = new RegExp(
            "^" + escapedPrefix + "-[a-z0-9]{6}$"
          );

          expect(roomId).toMatch(expectedPattern);

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Validates: Requirements 2.3
 *
 * Property 7: Room ID stability across renders
 *
 * For any hook invocation within the same page session, calling useRoomId
 * with the same prefix multiple times SHALL return the identical room ID
 * string each time.
 */
describe("useRoomId - Property 7: Room ID stability across renders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue(null);
  });

  it("returns the same room ID across multiple re-renders for any valid prefix", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
        (prefix) => {
          mockGet.mockReturnValue(null);

          const { result, rerender } = renderHook(() =>
            useRoomId({ prefix })
          );

          const firstRoomId = result.current.roomId;

          rerender();
          expect(result.current.roomId).toBe(firstRoomId);

          rerender();
          expect(result.current.roomId).toBe(firstRoomId);

          rerender();
          expect(result.current.roomId).toBe(firstRoomId);

          rerender();
          expect(result.current.roomId).toBe(firstRoomId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
