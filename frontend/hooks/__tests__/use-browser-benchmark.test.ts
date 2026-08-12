/**
 * Unit tests for useBrowserBenchmark hook
 *
 * Feature: v2.4-stress-test-page
 * Validates: Requirements 4.3, 4.4, 4.5, 4.8, 5.1, 5.2, 5.3, 5.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBrowserBenchmark } from "../use-browser-benchmark";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = 0; // CONNECTING
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sentMessages: string[] = [];
  closeCalled = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.closeCalled = true;
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  static reset() {
    MockWebSocket.instances = [];
  }

  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchToken() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ token: "test-token-123" }),
  });
}

/**
 * Advance fake timers while also flushing microtasks so that
 * the hook's `await new Promise(r => setTimeout(r, 50))` resolves.
 */
async function advanceTimersAndFlush(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useBrowserBenchmark", () => {
  let performanceNowValue: number;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", mockFetchToken());

    // Mock performance.now with controllable value
    performanceNowValue = 1000;
    vi.stubGlobal("performance", {
      now: () => {
        performanceNowValue += 5;
        return performanceNowValue;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    /**
     * Validates: Requirements 5.1, 5.2
     */
    it("starts with idle phase, disconnected wsStatus, and zero metrics", () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      expect(result.current.state.phase).toBe("idle");
      expect(result.current.state.wsStatus).toBe("disconnected");
      expect(result.current.state.metrics).toEqual({
        submitted: 0,
        confirmed: 0,
        throughput: 0,
        peakThroughput: 0,
        p50: 0,
        p99: 0,
        elapsed: 0,
      });
      expect(result.current.state.throughputSamples).toEqual([]);
      expect(result.current.state.operationLog).toEqual([]);
      expect(result.current.state.progress).toBe(0);
    });

    it("defaults selectedOps to 1000", () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));
      expect(result.current.selectedOps).toBe(1000);
    });
  });

  describe("WebSocket connection lifecycle", () => {
    /**
     * Validates: Requirements 4.3, 5.1
     * Tests status transitions: disconnected → reconnecting → connected
     */
    it("transitions wsStatus through disconnected → reconnecting → connected", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      act(() => {
        result.current.setSelectedOps(100);
      });

      // Start the test (don't await — it won't resolve until test completes)
      act(() => {
        result.current.startTest();
      });

      // Let the fetch resolve
      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();
      expect(ws).toBeDefined();

      // Simulate WS open → status should become "reconnecting"
      act(() => {
        ws.simulateOpen();
      });
      expect(result.current.state.wsStatus).toBe("reconnecting");

      // Simulate connected message → status should become "connected"
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "connected" },
        });
      });
      expect(result.current.state.wsStatus).toBe("connected");

      // Complete room creation to let test proceed
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "room-created", roomId: "test-room" },
        });
      });

      // ACK all operations to let the test complete
      await advanceTimersAndFlush(10);
      const opMessages = ws.sentMessages
        .map((s) => JSON.parse(s))
        .filter((m: { channel?: string }) => m.channel === "ops");

      act(() => {
        for (const msg of opMessages) {
          ws.simulateMessage({ type: "ack", replyTo: msg.seq });
        }
      });

      // Advance past the waiting loop
      await advanceTimersAndFlush(16000);
    });

    it("sets wsStatus to disconnected on WS close", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      // Start the test
      act(() => {
        result.current.startTest();
      });

      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();

      act(() => {
        ws.simulateOpen();
      });
      expect(result.current.state.wsStatus).toBe("reconnecting");

      // Close WS before completing handshake → triggers error path
      act(() => {
        ws.close();
      });

      expect(result.current.state.wsStatus).toBe("disconnected");
    });
  });

  describe("full pipeline: connect → create room → send ops → receive ACKs → complete", () => {
    /**
     * Validates: Requirements 4.3, 4.4, 4.5, 4.8, 5.2, 5.3, 5.4
     */
    it("completes a full benchmark run with metrics", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      act(() => {
        result.current.setSelectedOps(100);
      });

      // Start the test
      act(() => {
        result.current.startTest();
      });

      expect(result.current.state.phase).toBe("running");

      // Let fetch resolve
      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();

      // Drive handshake
      act(() => {
        ws.simulateOpen();
      });

      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "connected" },
        });
      });

      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "room-created", roomId: "test-room" },
        });
      });

      // Ops are sent synchronously after room creation resolves
      await advanceTimersAndFlush(10);

      const opMessages = ws.sentMessages
        .map((s) => JSON.parse(s))
        .filter((m: { channel?: string }) => m.channel === "ops");

      expect(opMessages.length).toBe(100);

      // ACK all operations
      act(() => {
        for (const msg of opMessages) {
          ws.simulateMessage({ type: "ack", replyTo: msg.seq });
        }
      });

      // Advance past the waiting loop (50ms intervals checking confirmed count)
      await advanceTimersAndFlush(200);

      // Should be completed
      expect(result.current.state.phase).toBe("completed");
      expect(result.current.state.metrics.submitted).toBe(100);
      expect(result.current.state.metrics.confirmed).toBe(100);
      expect(result.current.state.metrics.elapsed).toBeGreaterThan(0);
      expect(result.current.state.progress).toBe(100);
    });

    it("sends create-room command after receiving connected response", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      act(() => {
        result.current.setSelectedOps(100);
      });

      act(() => {
        result.current.startTest();
      });

      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();

      act(() => {
        ws.simulateOpen();
      });

      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "connected" },
        });
      });

      // Should have sent the create-room command
      const createRoomMsg = ws.sentMessages
        .map((s) => JSON.parse(s))
        .find((m: { payload?: { type?: string } }) => m.payload?.type === "create-room");

      expect(createRoomMsg).toBeDefined();
      expect(createRoomMsg.channel).toBe("control");

      // Complete the test to avoid dangling promises
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "room-created", roomId: "test-room" },
        });
      });
      await advanceTimersAndFlush(10);

      const opMessages = ws.sentMessages
        .map((s) => JSON.parse(s))
        .filter((m: { channel?: string }) => m.channel === "ops");
      act(() => {
        for (const msg of opMessages) {
          ws.simulateMessage({ type: "ack", replyTo: msg.seq });
        }
      });
      await advanceTimersAndFlush(16000);
    });
  });

  describe("stop mid-test", () => {
    /**
     * Validates: Requirements 4.8, 5.1
     * Start → partial ops → stopTest() → phase becomes "completed", WS closed
     */
    it("stops the test, sets phase to completed, and closes WebSocket", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      act(() => {
        result.current.setSelectedOps(100);
      });

      act(() => {
        result.current.startTest();
      });

      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();

      // Drive handshake
      act(() => {
        ws.simulateOpen();
      });
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "connected" },
        });
      });
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "room-created", roomId: "test-room" },
        });
      });

      await advanceTimersAndFlush(10);

      // Now stop the test mid-execution (before ACKs)
      act(() => {
        result.current.stopTest();
      });

      expect(result.current.state.phase).toBe("completed");
      expect(result.current.state.wsStatus).toBe("disconnected");
      expect(ws.closeCalled).toBe(true);

      // Advance past any pending loops
      await advanceTimersAndFlush(16000);
    });
  });

  describe("progress tracking", () => {
    /**
     * Validates: Requirements 5.3, 5.4
     * confirmed/submitted ratio → progress percentage
     */
    it("updates progress based on confirmed/selectedOps ratio", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      act(() => {
        result.current.setSelectedOps(100);
      });

      act(() => {
        result.current.startTest();
      });

      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();

      // Drive handshake
      act(() => {
        ws.simulateOpen();
      });
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "connected" },
        });
      });
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "room-created", roomId: "test-room" },
        });
      });

      await advanceTimersAndFlush(10);

      const opMessages = ws.sentMessages
        .map((s) => JSON.parse(s))
        .filter((m: { channel?: string }) => m.channel === "ops");

      // ACK 50 of 100 ops
      act(() => {
        for (let i = 0; i < 50; i++) {
          ws.simulateMessage({ type: "ack", replyTo: opMessages[i].seq });
        }
      });

      // Advance to let the waiting loop update state
      await advanceTimersAndFlush(100);

      // Progress should be 50%
      expect(result.current.state.progress).toBe(50);
      expect(result.current.state.metrics.confirmed).toBe(50);

      // ACK the rest
      act(() => {
        for (let i = 50; i < 100; i++) {
          ws.simulateMessage({ type: "ack", replyTo: opMessages[i].seq });
        }
      });

      await advanceTimersAndFlush(200);

      // Should be at 100%
      expect(result.current.state.progress).toBe(100);
      expect(result.current.state.metrics.confirmed).toBe(100);
    });
  });

  describe("throughput sampling", () => {
    /**
     * Validates: Requirements 5.2
     * Verify throughput samples are collected via the 1s interval
     */
    it("collects throughput samples every 1 second", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      act(() => {
        result.current.setSelectedOps(100);
      });

      act(() => {
        result.current.startTest();
      });

      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();

      // Drive handshake
      act(() => {
        ws.simulateOpen();
      });
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "connected" },
        });
      });
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "room-created", roomId: "test-room" },
        });
      });

      await advanceTimersAndFlush(10);

      const opMessages = ws.sentMessages
        .map((s) => JSON.parse(s))
        .filter((m: { channel?: string }) => m.channel === "ops");

      // ACK 30 ops
      act(() => {
        for (let i = 0; i < 30; i++) {
          ws.simulateMessage({ type: "ack", replyTo: opMessages[i].seq });
        }
      });

      // Advance 1 second to trigger throughput interval
      await advanceTimersAndFlush(1000);

      // Should have at least one throughput sample
      expect(result.current.state.throughputSamples.length).toBeGreaterThanOrEqual(1);
      const firstSample = result.current.state.throughputSamples[0];
      expect(firstSample.opsPerSec).toBeGreaterThanOrEqual(0);
      expect(firstSample.timestamp).toBeGreaterThan(0);

      // Complete the test
      act(() => {
        for (let i = 30; i < 100; i++) {
          ws.simulateMessage({ type: "ack", replyTo: opMessages[i].seq });
        }
      });
      await advanceTimersAndFlush(16000);
    });
  });

  describe("connection status transitions", () => {
    /**
     * Validates: Requirement 5.1
     */
    it("transitions through all connection states during a full run", async () => {
      const { result } = renderHook(() => useBrowserBenchmark("room-1"));

      act(() => {
        result.current.setSelectedOps(100);
      });

      // Initial state
      expect(result.current.state.wsStatus).toBe("disconnected");

      act(() => {
        result.current.startTest();
      });

      await advanceTimersAndFlush(10);

      const ws = MockWebSocket.latest();

      // After open → reconnecting
      act(() => {
        ws.simulateOpen();
      });
      expect(result.current.state.wsStatus).toBe("reconnecting");

      // After connected response → connected
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "connected" },
        });
      });
      expect(result.current.state.wsStatus).toBe("connected");

      // Complete room creation
      act(() => {
        ws.simulateMessage({
          type: "control-response",
          payload: { type: "room-created", roomId: "test-room" },
        });
      });

      await advanceTimersAndFlush(10);

      // Stop to trigger disconnect
      act(() => {
        result.current.stopTest();
      });
      expect(result.current.state.wsStatus).toBe("disconnected");

      await advanceTimersAndFlush(16000);
    });
  });
});
