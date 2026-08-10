import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWebSocket } from "./use-websocket";

// --- Mock WebSocket class ---

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateClose() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// Attach static constants so code referencing WebSocket.OPEN works
Object.defineProperty(MockWebSocket, "OPEN", { value: 1 });
Object.defineProperty(MockWebSocket, "CONNECTING", { value: 0 });
Object.defineProperty(MockWebSocket, "CLOSING", { value: 2 });
Object.defineProperty(MockWebSocket, "CLOSED", { value: 3 });

// --- Test setup ---

describe("useWebSocket", () => {
  const BACKEND_URL = "http://localhost:3000";
  const FAKE_TOKEN = "test-jwt-token-123";

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();

    // Mock sessionStorage
    const store: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
    });

    // Mock global WebSocket
    vi.stubGlobal("WebSocket", MockWebSocket);

    // Mock fetch to return a token
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: FAKE_TOKEN }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches token and establishes WebSocket connection", async () => {
    const { result } = renderHook(() => useWebSocket(BACKEND_URL));

    // Wait for the fetch to be called
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Verify fetch was called with correct URL pattern
    expect(fetch).toHaveBeenCalledTimes(1);
    const fetchUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(fetchUrl).toContain(`${BACKEND_URL}/token`);
    expect(fetchUrl).toContain("userId=");
    expect(fetchUrl).toContain("displayName=");

    // Verify WebSocket was created with token
    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toContain(`token=${FAKE_TOKEN}`);

    // Initial status should still be disconnected until onopen fires
    expect(result.current.status).toBe("disconnected");
  });

  it("sets status to connected on WebSocket open", async () => {
    const { result } = renderHook(() => useWebSocket(BACKEND_URL));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Simulate WebSocket open
    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.status).toBe("connected");
  });

  it("sets status to reconnecting on WebSocket close", async () => {
    const { result } = renderHook(() => useWebSocket(BACKEND_URL));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Open then close the connection
    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    expect(result.current.status).toBe("connected");

    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    expect(result.current.status).toBe("reconnecting");
  });

  it("reconnects after 2-second delay", async () => {
    const { result } = renderHook(() => useWebSocket(BACKEND_URL));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const initialInstanceCount = MockWebSocket.instances.length;
    expect(initialInstanceCount).toBe(1);

    // Open then close to trigger reconnect
    act(() => {
      MockWebSocket.instances[0].simulateOpen();
    });

    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    expect(result.current.status).toBe("reconnecting");

    // Advance time by 2000ms (RECONNECT_DELAY_MS)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // A new fetch + WebSocket should have been created
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances.length).toBe(2);

    // Simulate the new connection opening
    act(() => {
      MockWebSocket.instances[1].simulateOpen();
    });

    expect(result.current.status).toBe("connected");
  });

  it("sends pong in response to ping message", async () => {
    renderHook(() => useWebSocket(BACKEND_URL));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = MockWebSocket.instances[0];

    // Open the connection so send works
    act(() => {
      ws.simulateOpen();
    });

    // Send a ping message
    act(() => {
      ws.simulateMessage({ type: "ping" });
    });

    // Verify pong was sent
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "pong" }));
  });

  it("dispatches messages to subscribers", async () => {
    const { result } = renderHook(() => useWebSocket(BACKEND_URL));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
    });

    // Subscribe to "ack" messages
    const handler = vi.fn();
    let unsubscribe: () => void;
    act(() => {
      unsubscribe = result.current.subscribe("ack", handler);
    });

    // Simulate an ack message
    const ackMessage = { type: "ack" as const, operationId: "op-123" };
    act(() => {
      ws.simulateMessage(ackMessage);
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ackMessage);

    // Unsubscribe and verify handler no longer called
    act(() => {
      unsubscribe!();
    });

    act(() => {
      ws.simulateMessage({ type: "ack", operationId: "op-456" });
    });

    expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
  });
});
