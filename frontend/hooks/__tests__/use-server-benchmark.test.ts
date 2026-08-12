/**
 * Unit tests for useServerBenchmark hook
 *
 * Feature: v2.4-stress-test-page
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useServerBenchmark } from "../use-server-benchmark";
import type { StandardBenchmarkResponse } from "@/lib/stress-test-types";

const MOCK_RESPONSE: StandardBenchmarkResponse = {
  mode: "standard",
  totalOps: 50000,
  elapsedMs: 980,
  opsPerSecond: 51020,
  p50Ms: 0.8,
  p99Ms: 2.1,
  batchesProcessed: 50,
  mergeEngine: "rust-napi-rs",
  timestamp: "2024-01-01T00:00:00.000Z",
  memoryPeakMb: null,
  memoryDeltaMb: null,
};

describe("useServerBenchmark", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("starts with idle status, null results, and null error", () => {
      const { result } = renderHook(() => useServerBenchmark());

      expect(result.current.state).toEqual({
        status: "idle",
        results: null,
        error: null,
      });
    });

    it("defaults selectedOps to 50000", () => {
      const { result } = renderHook(() => useServerBenchmark());

      expect(result.current.selectedOps).toBe(50000);
    });

    it("defaults selectedMode to 'standard'", () => {
      const { result } = renderHook(() => useServerBenchmark());

      expect(result.current.selectedMode).toBe("standard");
    });

    it("defaults modeParams to { rooms: 5 }", () => {
      const { result } = renderHook(() => useServerBenchmark());

      expect(result.current.modeParams).toEqual({ rooms: 5 });
    });
  });

  describe("state transitions: idle → running → completed", () => {
    /**
     * Validates: Requirements 3.4, 3.5
     * Tests that the hook transitions through states correctly on success.
     */
    it("transitions to running then completed with results on successful response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      let runPromise: Promise<void>;
      act(() => {
        runPromise = result.current.runBenchmark();
      });

      // Status should be "running" immediately
      expect(result.current.state.status).toBe("running");
      expect(result.current.state.results).toBeNull();
      expect(result.current.state.error).toBeNull();

      await act(async () => {
        await runPromise;
      });

      // After completion, status should be "completed" with results
      expect(result.current.state.status).toBe("completed");
      expect(result.current.state.results).toEqual(MOCK_RESPONSE);
      expect(result.current.state.error).toBeNull();
    });

    it("sends POST request to /benchmark with selected ops", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MOCK_RESPONSE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      // Change selected ops
      act(() => {
        result.current.setSelectedOps(100000);
      });

      await act(async () => {
        await result.current.runBenchmark();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/benchmark"),
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ops: 100000, mode: "standard" }),
        })
      );
    });
  });

  describe("state transitions: idle → running → error (HTTP 400)", () => {
    /**
     * Validates: Requirement 3.6
     * IF the /benchmark endpoint returns an HTTP 400 error,
     * THEN display the error message from the response body.
     */
    it("extracts error message from JSON response body on HTTP 400", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Invalid ops parameter: must be between 1000 and 1000000" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      await act(async () => {
        await result.current.runBenchmark();
      });

      expect(result.current.state.status).toBe("error");
      expect(result.current.state.error).toBe("Invalid ops parameter: must be between 1000 and 1000000");
      expect(result.current.state.results).toBeNull();
    });

    it("falls back to status-based message when response body is not JSON", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error("not JSON")),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      await act(async () => {
        await result.current.runBenchmark();
      });

      expect(result.current.state.status).toBe("error");
      expect(result.current.state.error).toBe("Server returned 400");
      expect(result.current.state.results).toBeNull();
    });

    it("falls back to status-based message when error field is missing from body", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: "Internal error" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      await act(async () => {
        await result.current.runBenchmark();
      });

      expect(result.current.state.status).toBe("error");
      expect(result.current.state.error).toBe("Server returned 500");
    });
  });

  describe("network failure handling", () => {
    /**
     * Validates: Requirement 3.7
     * IF a network error occurs during the benchmark request,
     * THEN display a user-friendly error message indicating the server is unreachable.
     */
    it("sets error to 'Server unreachable' message when fetch throws", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      await act(async () => {
        await result.current.runBenchmark();
      });

      expect(result.current.state.status).toBe("error");
      expect(result.current.state.error).toBe(
        "Server unreachable — check that the backend is running"
      );
      expect(result.current.state.results).toBeNull();
    });

    it("handles network timeout errors", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new DOMException("The operation was aborted"));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      await act(async () => {
        await result.current.runBenchmark();
      });

      expect(result.current.state.status).toBe("error");
      expect(result.current.state.error).toBe(
        "Server unreachable — check that the backend is running"
      );
    });
  });

  describe("concurrent run prevention", () => {
    /**
     * Validates: Requirement 3.4
     * WHILE the server benchmark request is pending, disable the run button
     * (hook returns early if already running).
     */
    it("returns early without making a second fetch call when already running", async () => {
      let resolveFetch: (value: unknown) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      const fetchMock = vi.fn().mockReturnValue(fetchPromise);
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      // Start first benchmark
      act(() => {
        result.current.runBenchmark();
      });

      expect(result.current.state.status).toBe("running");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Try to start second benchmark while first is running
      await act(async () => {
        await result.current.runBenchmark();
      });

      // Should still only have one fetch call
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Cleanup: resolve the pending fetch
      await act(async () => {
        resolveFetch!({
          ok: true,
          json: () => Promise.resolve(MOCK_RESPONSE),
        });
      });
    });
  });

  describe("mode selection and params", () => {
    /**
     * Validates: Requirement 6.5
     * Preserve selected operation count when switching between modes,
     * reset mode-specific params to defaults on mode switch.
     */
    it("preserves selectedOps when switching modes", () => {
      const { result } = renderHook(() => useServerBenchmark());

      act(() => {
        result.current.setSelectedOps(100000);
      });

      act(() => {
        result.current.setSelectedMode("rooms");
      });

      expect(result.current.selectedOps).toBe(100000);
      expect(result.current.selectedMode).toBe("rooms");
    });

    it("resets modeParams to defaults on mode switch", () => {
      const { result } = renderHook(() => useServerBenchmark());

      // Change room count
      act(() => {
        result.current.setModeParams({ rooms: 20 });
      });
      expect(result.current.modeParams.rooms).toBe(20);

      // Switch mode → params reset
      act(() => {
        result.current.setSelectedMode("conflict");
      });
      expect(result.current.modeParams).toEqual({ rooms: 5 });
    });

    it("includes mode in the request body", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_RESPONSE, mode: "conflict" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      act(() => {
        result.current.setSelectedMode("conflict");
      });

      await act(async () => {
        await result.current.runBenchmark();
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.mode).toBe("conflict");
      expect(callBody.ops).toBe(50000);
    });

    it("includes rooms param in request body when mode is 'rooms'", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_RESPONSE, mode: "rooms", roomCount: 10, perRoom: [], slowestRoomMs: 0, fastestRoomMs: 0, averageRoomMs: 0 }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      act(() => {
        result.current.setSelectedMode("rooms");
        result.current.setModeParams({ rooms: 10 });
      });

      await act(async () => {
        await result.current.runBenchmark();
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.mode).toBe("rooms");
      expect(callBody.rooms).toBe(10);
    });

    it("does not include rooms param for non-rooms modes", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_RESPONSE, mode: "breakdown", add: {}, update: {}, remove: {} }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useServerBenchmark());

      act(() => {
        result.current.setSelectedMode("breakdown");
      });

      await act(async () => {
        await result.current.runBenchmark();
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.mode).toBe("breakdown");
      expect(callBody.rooms).toBeUndefined();
    });

    it("allows partial update of modeParams", () => {
      const { result } = renderHook(() => useServerBenchmark());

      act(() => {
        result.current.setModeParams({ rooms: 25 });
      });

      expect(result.current.modeParams.rooms).toBe(25);
    });
  });
});
