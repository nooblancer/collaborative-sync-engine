import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- MockWebSocket ---
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  simulateMessage(data: any) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) })
    );
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// --- Setup and teardown ---
let originalFetch: typeof global.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.reset();

  // Mock WebSocket global
  vi.stubGlobal("WebSocket", MockWebSocket);

  // Mock fetch for the token endpoint
  originalFetch = global.fetch;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: "test-token" }),
  });

  // Mock sessionStorage with a fixed identity
  const storage: Record<string, string> = {
    "sync-engine-user-identity": JSON.stringify({
      userId: "test-user-id",
      displayName: "TestUser",
    }),
  };
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
  });

  // Mock crypto.randomUUID for predictable IDs
  let uuidCounter = 0;
  vi.stubGlobal("crypto", {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Helper to get the latest MockWebSocket instance and connect it
async function renderAndConnect() {
  // Dynamic import to ensure mocks are in place
  const { default: DemoPage } = await import("./page");

  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<DemoPage />);
  });

  // Wait for fetch to be called (token request)
  await act(async () => {
    await vi.runAllTimersAsync();
  });

  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

  // Simulate WebSocket open
  await act(async () => {
    ws.simulateOpen();
  });

  return { result: result!, ws };
}

describe("Demo Page Integration Tests", () => {
  it("renders connection status and connects via WebSocket", async () => {
    const { default: DemoPage } = await import("./page");

    let container: ReturnType<typeof render>;
    await act(async () => {
      container = render(<DemoPage />);
    });

    // Initially should show Disconnected (before token fetch completes)
    expect(screen.getByText("Disconnected")).toBeInTheDocument();

    // Wait for fetch to complete and WebSocket to be created
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws).toBeDefined();

    // Simulate WebSocket open
    await act(async () => {
      ws.simulateOpen();
    });

    // Should now show Connected
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("adds item with optimistic update", async () => {
    const { ws } = await renderAndConnect();

    // Fill in the form
    const nameInput = screen.getByLabelText("Item name");
    const quantityInput = screen.getByLabelText("Quantity");

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Test Widget" } });
      fireEvent.change(quantityInput, { target: { value: "5" } });
    });

    // Click Add Item
    const addButton = screen.getByRole("button", { name: /add item/i });
    await act(async () => {
      fireEvent.click(addButton);
    });

    // Verify item appears in the table
    expect(screen.getByText("Test Widget")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();

    // Verify WebSocket.send was called with an operation message
    expect(ws.send).toHaveBeenCalled();
    const sentData = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
    expect(sentData.type).toBe("operation");
    expect(sentData.payload.type).toBe("add");
    expect(sentData.payload.payload.name).toBe("Test Widget");
    expect(sentData.payload.payload.quantity).toBe(5);
  });

  it("applies incoming delta and shows flash", async () => {
    const { ws } = await renderAndConnect();

    // Simulate incoming delta message with an "added" change
    await act(async () => {
      ws.simulateMessage({
        type: "delta",
        payload: {
          changes: [
            {
              type: "added",
              itemId: "remote-item-1",
              name: "Remote Widget",
              quantity: 10,
              removedAt: null,
              lastUpdatedBy: "OtherUser",
            },
          ],
        },
      });
    });

    // Verify the new item appears in the table
    expect(screen.getByText("Remote Widget")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("OtherUser")).toBeInTheDocument();
  });

  it("updates presence bar on join/leave", async () => {
    const { ws } = await renderAndConnect();

    // Simulate presence-list message with users
    await act(async () => {
      ws.simulateMessage({
        type: "presence-list",
        users: [
          { userId: "user-1", displayName: "Alice" },
          { userId: "user-2", displayName: "Bob" },
        ],
      });
    });

    // Verify user badges appear
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    // Simulate presence-leave message
    await act(async () => {
      ws.simulateMessage({
        type: "presence-leave",
        userId: "user-2",
      });
    });

    // Verify Bob's badge is removed
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    // Alice should still be there
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
