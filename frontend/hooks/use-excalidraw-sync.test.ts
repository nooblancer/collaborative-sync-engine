import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useExcalidrawSync } from "@/hooks/use-excalidraw-sync";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

// Mock @excalidraw/excalidraw to avoid JSON import issues in test env
vi.mock("@excalidraw/excalidraw", () => ({
  exportToBlob: vi.fn(),
}));

// --- Mock WebSocket ---

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState: number = WebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // --- Test helpers ---

  simulateOpen() {
    this.readyState = WebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  simulateClose() {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
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

  static get latest(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// Replace global WebSocket
const originalWebSocket = globalThis.WebSocket;
beforeEach(() => {
  MockWebSocket.reset();
  (globalThis as any).WebSocket = MockWebSocket as any;
  // Mock fetch for token endpoint
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ token: "mock-jwt-token" }),
  });
  // Mock sessionStorage
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "sessionStorage", {
    value: {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  (globalThis as any).WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

// --- Helpers ---

function createMockExcalidrawAPI() {
  return {
    getSceneElementsIncludingDeleted: vi.fn(() => []),
    updateScene: vi.fn(),
    getSceneElements: vi.fn(() => []),
    getAppState: vi.fn(() => ({})),
    exportToBlob: vi.fn(),
    refresh: vi.fn(),
    setToast: vi.fn(),
    readyPromise: Promise.resolve(),
    ready: true,
    id: "mock-api",
  } as any;
}

function makeElement(overrides: Partial<ExcalidrawElement> = {}): ExcalidrawElement {
  return {
    id: `el-${Math.random().toString(36).slice(2, 8)}`,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 1,
    opacity: 100,
    isDeleted: false,
    version: 1,
    versionNonce: 12345,
    updated: Date.now(),
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    boundElements: null,
    link: null,
    locked: false,
    ...overrides,
  } as any;
}

/**
 * Performs the full V2 handshake: token fetch → WS connect → connected ACK → create-room → room confirmed
 */
async function performHandshake(ws: MockWebSocket) {
  // WS open
  ws.simulateOpen();
  // Server sends connected ACK
  ws.simulateMessage({
    channel: "control",
    type: "control-response",
    payload: { type: "connected", clientId: "server-assigned-client-id" },
  });
  // Wait for create-room to be sent, then confirm room
  await vi.waitFor(() => {
    const sent = ws.sentMessages.map((m) => JSON.parse(m));
    const createRoom = sent.find((f) => f.channel === "control" && f.payload?.type === "create-room");
    expect(createRoom).toBeTruthy();
  });
  // Server confirms room
  ws.simulateMessage({
    channel: "control",
    type: "control-response",
    payload: { type: "room-created", roomId: "whiteboard-abc123" },
  });
}

// --- Tests ---

describe("useExcalidrawSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("V2 handshake sequence (Req 5.5)", () => {
    it("fetches token, connects WebSocket, sends create-room on ACK, and becomes connected", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-abc123", excalidrawAPI: api })
      );

      // Initially disconnected
      expect(result.current.connectionStatus).toBe("disconnected");

      // Let the token fetch resolve
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Should have fetched a token
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/token?")
      );

      // WebSocket should have been created
      const ws = MockWebSocket.latest!;
      expect(ws).toBeDefined();
      expect(ws.url).toContain("token=mock-jwt-token");

      // Perform handshake
      await act(async () => {
        await performHandshake(ws);
      });

      // Should now be connected
      expect(result.current.connectionStatus).toBe("connected");
    });

    it("sends create-room frame with correct roomId after connected ACK", async () => {
      const api = createMockExcalidrawAPI();

      renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-test99", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws = MockWebSocket.latest!;

      await act(async () => {
        ws.simulateOpen();
        ws.simulateMessage({
          channel: "control",
          type: "control-response",
          payload: { type: "connected", clientId: "client-x" },
        });
      });

      const sent = ws.sentMessages.map((m) => JSON.parse(m));
      const createRoom = sent.find(
        (f) => f.channel === "control" && f.payload?.type === "create-room"
      );
      expect(createRoom).toBeDefined();
      expect(createRoom.roomId).toBe("whiteboard-test99");
    });
  });

  describe("handleLocalChange — diff and send ops (Req 5.1)", () => {
    it("calls diffElements and sends ops frames for changed elements", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-ops01", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws = MockWebSocket.latest!;

      await act(async () => {
        await performHandshake(ws);
      });

      // Clear handshake messages
      ws.sentMessages.length = 0;

      // Simulate local change: add a new element
      const newElement = makeElement({ id: "new-rect-1", version: 1 });

      act(() => {
        result.current.handleLocalChange([newElement]);
      });

      // Should have sent an ops frame
      expect(ws.sentMessages.length).toBeGreaterThan(0);
      const opsFrame = JSON.parse(ws.sentMessages[0]);
      expect(opsFrame.channel).toBe("ops");
      expect(opsFrame.roomId).toBe("whiteboard-ops01");
      expect(opsFrame.payload.type).toBe("add");
      expect(opsFrame.payload.itemId).toBe("new-rect-1");
    });

    it("does not send ops when elements are unchanged", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-noops", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws);
      });

      // Set initial state
      const el = makeElement({ id: "rect-1", version: 1, versionNonce: 100 });
      act(() => {
        result.current.handleLocalChange([el]);
      });

      ws.sentMessages.length = 0;

      // Call again with same element (same version/nonce) — should produce no ops
      act(() => {
        result.current.handleLocalChange([el]);
      });

      expect(ws.sentMessages.length).toBe(0);
    });
  });

  describe("incoming delta triggers element merge (Req 5.2)", () => {
    it("merges remote element changes into local scene via updateScene", async () => {
      const api = createMockExcalidrawAPI();
      const existingElement = makeElement({ id: "existing-1", version: 1 });
      api.getSceneElementsIncludingDeleted.mockReturnValue([existingElement]);

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-delta", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws);
      });

      // Simulate incoming delta from server
      act(() => {
        ws.simulateMessage({
          channel: "ops",
          type: "delta",
          roomId: "whiteboard-delta",
          payload: {
            changes: [
              {
                type: "added",
                itemId: "remote-el-1",
                fields: makeElement({ id: "remote-el-1", version: 2 }),
              },
            ],
          },
        });
      });

      // Verify updateScene was called with merged elements
      expect(api.updateScene).toHaveBeenCalled();
      const updateCall = api.updateScene.mock.calls[0][0];
      const updatedElements = updateCall.elements;
      // Should contain both the existing element and the new remote element
      expect(updatedElements.find((el: any) => el.id === "existing-1")).toBeTruthy();
      expect(updatedElements.find((el: any) => el.id === "remote-el-1")).toBeTruthy();
    });
  });

  describe("awareness channel (Req 5.3)", () => {
    it("sendAwareness sends awareness frame via WebSocket", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-aware", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws);
      });

      ws.sentMessages.length = 0;

      act(() => {
        result.current.sendAwareness({ pointer: { x: 100, y: 200 }, button: "up" });
      });

      expect(ws.sentMessages.length).toBe(1);
      const frame = JSON.parse(ws.sentMessages[0]);
      expect(frame.channel).toBe("awareness");
      expect(frame.payload.cursor.x).toBe(100);
      expect(frame.payload.cursor.y).toBe(200);
    });

    it("incoming awareness-update populates collaborators map", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-collab", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws);
      });

      // Simulate incoming awareness from a remote user
      act(() => {
        ws.simulateMessage({
          channel: "awareness",
          type: "awareness-update",
          payload: {
            clientId: "remote-user-1",
            cursor: { x: 300, y: 400 },
            displayName: "RemoteAlice",
            color: "#ff6b6b",
          },
        });
      });

      // Collaborators map should now contain the remote user
      expect(result.current.collaborators.size).toBe(1);
      const collab = result.current.collaborators.get("remote-user-1");
      expect(collab).toBeDefined();
      expect(collab!.username).toBe("RemoteAlice");
      expect(collab!.pointer.x).toBe(300);
      expect(collab!.pointer.y).toBe(400);
      expect(collab!.color.background).toBe("#ff6b6b");
      expect(collab!.color.stroke).toBe("#ff6b6b");
    });
  });

  describe("reconnection with backoff (Req 5.6)", () => {
    it("reconnects with exponential backoff on disconnect", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-reconn", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws1 = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws1);
      });

      expect(result.current.connectionStatus).toBe("connected");

      // Simulate disconnect
      act(() => {
        ws1.simulateClose();
      });

      expect(result.current.connectionStatus).toBe("reconnecting");

      // First reconnect delay is 1000ms (1s * 2^0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // A new fetch should have been triggered
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      // A new WebSocket instance should exist
      const ws2 = MockWebSocket.latest!;
      expect(ws2).not.toBe(ws1);
    });

    it("status becomes connected after successful reconnect", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-reco2", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws1 = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws1);
      });

      // Disconnect
      act(() => {
        ws1.simulateClose();
      });

      // Reconnect after backoff
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // Allow token fetch to complete
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws2 = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws2);
      });

      expect(result.current.connectionStatus).toBe("connected");
    });
  });

  describe("offline queue flushes on reconnect (Req 5.7)", () => {
    it("queues ops when disconnected and flushes on reconnect", async () => {
      const api = createMockExcalidrawAPI();

      const { result } = renderHook(() =>
        useExcalidrawSync({ roomId: "whiteboard-queue", excalidrawAPI: api })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws1 = MockWebSocket.latest!;
      await act(async () => {
        await performHandshake(ws1);
      });

      // Disconnect
      act(() => {
        ws1.simulateClose();
      });

      // Queue some operations while offline
      const el1 = makeElement({ id: "offline-el-1", version: 1 });
      const el2 = makeElement({ id: "offline-el-2", version: 1 });

      act(() => {
        result.current.handleLocalChange([el1]);
      });
      act(() => {
        result.current.handleLocalChange([el1, el2]);
      });

      // Reconnect
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const ws2 = MockWebSocket.latest!;

      // Complete handshake — this triggers queue flush
      await act(async () => {
        await performHandshake(ws2);
      });

      // The queued ops should now be sent after room confirmation
      const opFrames = ws2.sentMessages
        .map((m) => JSON.parse(m))
        .filter((f) => f.channel === "ops");

      // Should have flushed the queued operations
      expect(opFrames.length).toBeGreaterThanOrEqual(2);
      // Verify FIFO order: offline-el-1 should come before offline-el-2
      const itemIds = opFrames.map((f) => f.payload.itemId);
      const idx1 = itemIds.indexOf("offline-el-1");
      const idx2 = itemIds.indexOf("offline-el-2");
      expect(idx1).toBeLessThan(idx2);
    });
  });
});
